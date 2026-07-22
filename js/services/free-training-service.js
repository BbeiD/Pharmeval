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
import { applySecondaryFilters, pickRandomSubset, pickDiversifiedSubset } from "./free-training-logic.js";
import { classifyCandidatePoolForUser } from "./question-progress-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { startNewFreeTrainingSession } from "./evaluation-session-service.js";

/**
 * Compose le pool de questions candidates pour un ensemble de filtres
 * (au moins une source obligatoire, tout le reste optionnel) - LECTURE
 * SEULE, ne crée aucune session. C'est l'étape "Filtres optionnels" du
 * workflow (voir cadrage). Jamais silencieux sur un pool tronqué (Phase
 * B0, point 4).
 *
 * AJOUT (refonte visuelle, phase 1, decision validee avec David) :
 * `documentSourceIds` (tableau, selection multiple par icones) remplace
 * l'ancien `documentSourceId` unique - une requete Firestore BORNEE par
 * source (jamais une clause `in`, pour rester sur les memes index deja
 * deployes), les resultats sont ensuite fusionnes et dedupliques ICI,
 * cote client. Si UNE SEULE source scannee est tronquee, le pool ENTIER
 * est refuse (jamais un agregat partiellement incomplet, meme principe
 * qu'avant).
 *
 * @param {{documentSourceIds:Array<string>, documentSectionId?:string, tag?:string, difficulty?:string, neverSeen?:boolean, neverSucceeded?:boolean}} filters
 * @returns {Promise<{ready:boolean, message:(string|null), items:Array<object>}>}
 */
export async function composeFreeTrainingPool(filters) {
  const f = filters || {};
  const sourceIds = Array.isArray(f.documentSourceIds) ? f.documentSourceIds.filter(Boolean) : [];
  if (sourceIds.length === 0) return { ready: false, message: 'Choisissez au moins une source documentaire.', items: [] };

  // La section ne reste applicable cote serveur QUE si une seule source est
  // selectionnee (une section appartient a UNE source precise - avec
  // plusieurs sources choisies, le filtre de section n'a plus de sens et
  // est ignore, voir js/entrainement-libre.js qui le masque deja dans ce cas).
  const sectionAlreadyScoped = !!f.documentSectionId && sourceIds.length === 1;

  const perSourceResults = await Promise.all(sourceIds.map(function(sourceId) {
    const serverFilters = { status: 'published', documentSourceId: sourceId };
    if (sectionAlreadyScoped) {
      serverFilters.documentSectionId = f.documentSectionId;
      // Difficulté appliquée cote CLIENT quand une section est deja choisie
      // (voir Phase B0 : pas d'index a 4 champs) - jamais ajoutee ici.
    } else if (f.difficulty) {
      serverFilters.difficulty = f.difficulty; // aucune section -> peut aller cote serveur (index dedie)
    }
    return searchQuestionsBounded({ filters: serverFilters });
  }));

  const erroredResult = perSourceResults.find(function(r) { return r.error; });
  if (erroredResult) {
    return { ready: false, message: erroredResult.message || 'Impossible de charger les questions pour le moment. Réessayez plus tard.', items: [] };
  }
  const truncatedResult = perSourceResults.find(function(r) { return r.truncated; });
  if (truncatedResult) {
    const readiness = evaluateTrainingPoolReadiness(truncatedResult);
    return { ready: false, message: readiness.message, items: [] };
  }

  const seenIds = new Set();
  const merged = [];
  perSourceResults.forEach(function(r) {
    r.items.forEach(function(q) {
      if (!seenIds.has(q.pedagogicalId)) { seenIds.add(q.pedagogicalId); merged.push(q); }
    });
  });
  if (merged.length === 0) {
    return { ready: false, message: 'Aucune question ne correspond à cette sélection.', items: [] };
  }

  let items = applySecondaryFilters(merged, {
    tag: f.tag,
    difficulty: f.difficulty,
    sectionAlreadyScoped: sectionAlreadyScoped,
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

/**
 * AJOUT ("Test me", demande directe de David) : lance directement
 * `questionCount` questions réparties sur TOUS les thèmes disponibles
 * (une source documentaire = un thème), sans aucune configuration
 * préalable - compose le pool sur l'ENSEMBLE des sources actives fournies
 * (réutilise composeFreeTrainingPool() à l'identique, aucun filtre
 * supplémentaire), puis pioche via pickDiversifiedSubset() plutôt que
 * pickRandomSubset() ci-dessus - un tirage uniforme sur le pool fusionné
 * laisserait une grosse source (ex. 84 questions) écraser mécaniquement
 * les petites, à l'opposé de l'objectif "sur tous les thèmes".
 * @param {Array<string>} activeSourceIds - sources actives ET non masquées
 *   de l'entraînement libre (voir browseActiveDocumentSources(), déjà
 *   filtrée - jamais un second filtre dupliqué ici)
 * @param {number} questionCount
 * @returns {Promise<object>} même forme de retour que startNewFreeTrainingSession()
 */
export async function launchTestMe(activeSourceIds, questionCount) {
  const poolResult = await composeFreeTrainingPool({ documentSourceIds: activeSourceIds });
  if (!poolResult.ready) {
    return { status: 'error', message: poolResult.message || 'Impossible de préparer le test pour le moment.' };
  }

  const picked = pickDiversifiedSubset(poolResult.items, questionCount, function(q) { return q.documentSourceId; });
  const pedagogicalIds = picked.selected.map(function(q) { return q.pedagogicalId; });
  const result = await startNewFreeTrainingSession(pedagogicalIds);
  return Object.assign({}, result, { requestedCount: picked.requestedCount, actualCount: picked.actualCount });
}
