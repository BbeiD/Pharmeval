// ===================== SERVICE D'ENTRAINEMENT LIBRE — Sprint 21.5, Phase B1 =====================
// Point d'entrée métier pour l'écran Entraînement libre. Compose
// exclusivement des briques déjà existantes (Phase B0 + moteur de
// session Phase B1) - AUCUNE nouvelle règle de filtrage, de
// dédoublonnage ou de session n'est inventée ici.
//
// PRINCIPE (cadrage Phase B0, point 3) : la difficulté et les tags ne
// passent JAMAIS tous les deux par une clause Firestore en même temps
// qu'une section - voir composeFreeTrainingPool() ci-dessous pour le
// détail exact de ce qui va au serveur vs au client.

import { searchQuestionsBounded } from "./question-catalog-service.js";
import { evaluateTrainingPoolReadiness } from "./question-filter-utils.js";
import { applySecondaryFilters, pickRandomSubset } from "./free-training-logic.js";
import { classifyCandidatePoolForUser } from "./question-progress-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { startNewFreeTrainingSession } from "./evaluation-session-service.js";

/**
 * Compose le pool de questions candidates pour un ensemble de filtres
 * (source obligatoire, tout le reste optionnel) - LECTURE SEULE, ne crée
 * aucune session. C'est l'étape "Filtres optionnels" du workflow (voir
 * cadrage). Jamais silencieux sur un pool tronqué (Phase B0, point 4).
 *
 * @param {{documentSourceId:string, documentSectionId?:string, tag?:string, difficulty?:string, neverSeen?:boolean, neverSucceeded?:boolean, withImages?:boolean}} filters
 * @returns {Promise<{ready:boolean, message:(string|null), items:Array<object>}>}
 */
export async function composeFreeTrainingPool(filters) {
  const f = filters || {};
  if (!f.documentSourceId) return { ready: false, message: 'Choisissez une source documentaire.', items: [] };

  const serverFilters = { status: 'published', documentSourceId: f.documentSourceId };
  const sectionAlreadyScoped = !!f.documentSectionId;
  if (sectionAlreadyScoped) {
    serverFilters.documentSectionId = f.documentSectionId;
    // Difficulté appliquée cote CLIENT quand une section est deja choisie
    // (voir Phase B0 : pas d'index a 4 champs) - jamais ajoutee ici.
  } else if (f.difficulty) {
    serverFilters.difficulty = f.difficulty; // aucune section -> peut aller cote serveur (index dedie)
  }

  const boundedResult = await searchQuestionsBounded({ filters: serverFilters });
  const readiness = evaluateTrainingPoolReadiness(boundedResult);
  if (!readiness.canLaunch) {
    return { ready: false, message: readiness.message || boundedResult.message, items: [] };
  }

  let items = applySecondaryFilters(boundedResult.items, {
    tag: f.tag,
    difficulty: f.difficulty,
    sectionAlreadyScoped: sectionAlreadyScoped,
    withImages: f.withImages,
  });

  if (f.neverSeen || f.neverSucceeded) {
    const ctx = getCurrentUserContext();
    if (!ctx || !ctx.uid) return { ready: false, message: 'Vous devez être connecté.', items: [] };
    const classification = await classifyCandidatePoolForUser(ctx.uid, items.map(function(q) { return q.pedagogicalId; }));
    if (classification.error) return { ready: false, message: 'Impossible de vérifier votre progression pour le moment. Réessayez plus tard.', items: [] };
    const allowedIds = new Set(
      (f.neverSeen ? classification.neverSeen : [])
        .concat(f.neverSucceeded ? classification.neverSucceeded : [])
    );
    // "jamais vue" OU "jamais réussie" sont deux cases à cocher
    // indépendantes (union), pas une conjonction - une question qui
    // satisfait l'une ou l'autre reste proposée.
    items = items.filter(function(q) { return allowedIds.has(q.pedagogicalId); });
  }

  if (items.length === 0) {
    return { ready: false, message: 'Aucune question ne correspond à cette sélection.', items: [] };
  }
  return { ready: true, message: null, items: items };
}

/**
 * Lance réellement l'entraînement : choisit `questionCount` questions au
 * hasard dans le pool déjà composé, puis démarre la session. N'appelle
 * JAMAIS composeFreeTrainingPool() elle-même (l'appelant doit l'avoir
 * déjà fait et avoir affiché le pool à l'utilisateur avant confirmation).
 *
 * @param {Array<object>} poolItems - le pool DEJA composé (composeFreeTrainingPool)
 * @param {number} questionCount - nombre souhaité par l'utilisateur
 * @returns {Promise<object>} même forme de retour que startNewFreeTrainingSession()
 */
export async function launchFreeTraining(poolItems, questionCount) {
  const picked = pickRandomSubset(poolItems, questionCount);
  const pedagogicalIds = picked.selected.map(function(q) { return q.pedagogicalId; });
  const result = await startNewFreeTrainingSession(pedagogicalIds);
  return Object.assign({}, result, { requestedCount: picked.requestedCount, actualCount: picked.actualCount });
}
