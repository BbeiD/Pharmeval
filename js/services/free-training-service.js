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

import { searchQuestionsBounded, getExistingQuestionsByPedagogicalIds } from "./question-catalog-service.js";
import { evaluateTrainingPoolReadiness } from "./question-filter-utils.js";
import { applySecondaryFilters, pickRandomSubset, pickDiversifiedSubset } from "./free-training-logic.js";
import { classifyCandidatePoolForUser } from "./question-progress-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { startNewFreeTrainingSession } from "./evaluation-session-service.js";
import { getActiveSectionTree } from "./document-section-service.js";

/**
 * Filtres communs "jamais vue"/"jamais réussie" - factorise entre
 * composeFreeTrainingPool() (par source documentaire) et
 * composeFreeTrainingPoolByIds() (par classification, voir plus bas) pour
 * ne jamais dupliquer cette lecture de progression.
 * @param {Array<object>} items
 * @param {{neverSeen?:boolean, neverSucceeded?:boolean}} f
 * @returns {Promise<{ready:boolean, message:(string|null), items:Array<object>}>}
 */
async function applyProgressFilters(items, f) {
  if (!f.neverSeen && !f.neverSucceeded) return { ready: true, message: null, items: items };

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
  const filtered = items.filter(function(q) { return allowedIds.has(q.pedagogicalId); });
  return { ready: true, message: null, items: filtered };
}

/**
 * Compose le pool de questions candidates pour un ensemble de filtres
 * (au moins une source obligatoire, tout le reste optionnel) - LECTURE
 * SEULE, ne crée aucune session. C'est l'étape "Filtres optionnels" du
 * workflow (voir cadrage). Jamais silencieux sur un pool tronqué (Phase
 * B0, point 4).
 *
 * CORRECTIF (theme sombre + classification, demande directe de David,
 * 29/07/2026) : l'ecran Entraînement libre n'appelle plus cette fonction
 * (les tuiles "Thème(s)" reposent desormais sur les grandes
 * classifications utilisees pour les Parcours - noms de sources
 * documentaires bruts type "A-4"/"A-5" juges peu clairs, voir
 * composeFreeTrainingPoolByIds() plus bas). Conservee TELLE QUELLE
 * (fonctionnelle, testee) plutot que supprimee : la selection par source
 * documentaire reste une notion metier reelle, potentiellement reutile
 * ailleurs (admin, previsualisation) - jamais de suppression par
 * precaution sans confirmation explicite.
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
  if (sourceIds.length === 0) return { ready: false, message: 'Choisissez au moins un thème.', items: [] };

  // La section ne reste applicable cote serveur QUE si une seule source est
  // selectionnee (une section appartient a UNE source precise - avec
  // plusieurs sources choisies, le filtre de section n'a plus de sens et
  // est ignore, voir js/entrainement-libre.js qui le masque deja dans ce cas).
  const sectionAlreadyScoped = !!f.documentSectionId && sourceIds.length === 1;

  // CORRECTIF ("pool vide" malgre une source active bien remplie,
  // 27/07/2026) : le selecteur de section (js/entrainement-libre.js)
  // presente l'arborescence ENTIERE, categories comprises - une categorie
  // parente n'a genéralement AUCUNE question rattachee DIRECTEMENT (voir
  // js/services/document-section-service.js : directQuestionCount peut
  // etre 0 alors que totalQuestionCount, incluant les sous-sections, est
  // eleve). Filtrer sur une correspondance EXACTE de `documentSectionId`
  // ignorait donc silencieusement toutes les questions des sous-sections.
  // Calcule ici l'ensemble {section choisie + tous ses descendants} via
  // `path` (deja utilise pour la meme detection ailleurs, voir
  // document-section-service.js) - jamais envoye a Firestore via une
  // clause `in` (une categorie peut avoir largement plus de descendants
  // que la limite de 30 valeurs d'une telle clause), toujours applique
  // cote CLIENT (meme principe deja en place ici pour la difficulte et
  // les tags une fois une section choisie).
  let allowedSectionIds = null;
  if (sectionAlreadyScoped) {
    const treeResult = await getActiveSectionTree(sourceIds[0]);
    if (treeResult.error) {
      return { ready: false, message: 'Impossible de charger les sections pour le moment. Réessayez plus tard.', items: [] };
    }
    allowedSectionIds = new Set([f.documentSectionId]);
    (treeResult.items || []).forEach(function(s) {
      if (Array.isArray(s.path) && s.path.indexOf(f.documentSectionId) !== -1) allowedSectionIds.add(s.id);
    });
  }

  const perSourceResults = await Promise.all(sourceIds.map(function(sourceId) {
    const serverFilters = { status: 'published', documentSourceId: sourceId };
    if (!sectionAlreadyScoped && f.difficulty) {
      serverFilters.difficulty = f.difficulty; // aucune section -> peut aller cote serveur (index dedie)
    }
    // Difficulté ET section, quand une section est choisie, sont
    // desormais TOUJOURS des post-filtres client (voir allowedSectionIds
    // ci-dessus et applySecondaryFilters() plus bas) - jamais envoyees
    // au serveur dans ce cas.
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

  const items = applySecondaryFilters(merged, {
    tag: f.tag,
    difficulty: f.difficulty,
    sectionAlreadyScoped: sectionAlreadyScoped,
    allowedSectionIds: allowedSectionIds,
  });

  const progressResult = await applyProgressFilters(items, f);
  if (!progressResult.ready) return progressResult;
  if (progressResult.items.length === 0) {
    return { ready: false, message: 'Aucune question ne correspond à cette sélection.', items: [] };
  }
  return { ready: true, message: null, items: progressResult.items };
}

/**
 * AJOUT (theme sombre + classification, demande directe de David,
 * 29/07/2026) : meme role que composeFreeTrainingPool() ci-dessus, mais
 * pour un thème = une "grande classification" (nom de Parcours avant son
 * suffixe " — Niveau...", voir js/services/parcours-classification-logic.js)
 * plutôt qu'une source documentaire - le pool candidat n'est donc pas une
 * requête Firestore filtrée par source, mais une liste FERMÉE de
 * `pedagogicalId` déjà connue (union des `directQuestionIds` des Parcours
 * de la/les classification(s) choisies) : jamais de troncature possible
 * (l'ensemble est fini et déjà chargé), donc jamais de notion de "pool
 * tronqué" ici, contrairement à composeFreeTrainingPool().
 *
 * @param {Array<string>} pedagogicalIds - union des questions des
 *   classifications sélectionnées (déjà dédupliquée ou non, peu importe)
 * @param {{tag?:string, difficulty?:string, neverSeen?:boolean, neverSucceeded?:boolean}} [filters]
 * @returns {Promise<{ready:boolean, message:(string|null), items:Array<object>}>}
 */
export async function composeFreeTrainingPoolByIds(pedagogicalIds, filters) {
  const f = filters || {};
  const ids = Array.from(new Set((pedagogicalIds || []).filter(Boolean)));
  if (ids.length === 0) return { ready: false, message: 'Choisissez au moins un thème.', items: [] };

  const { map, error } = await getExistingQuestionsByPedagogicalIds(ids);
  if (error) {
    return { ready: false, message: 'Impossible de charger les questions pour le moment. Réessayez plus tard.', items: [] };
  }
  // Seules les questions REELLEMENT visibles (publiees) reviennent de
  // getExistingQuestionsByPedagogicalIds() - un id de directQuestionIds
  // dont la question aurait ete depubliee depuis est silencieusement
  // absent de `map`, jamais une entree vide/cassee.
  const merged = ids.map(function(id) { return map.get(id); }).filter(Boolean);
  if (merged.length === 0) {
    return { ready: false, message: 'Aucune question ne correspond à cette sélection.', items: [] };
  }

  // Pas de section pour une classification (regroupement a plat, aucune
  // arborescence) - sectionAlreadyScoped:true force simplement le filtre
  // de difficulte cote CLIENT (aucun filtrage serveur possible ici, le
  // pool candidat est deja une liste fermee d'ids, jamais une requete
  // Firestore parametrable).
  const items = applySecondaryFilters(merged, {
    tag: f.tag,
    difficulty: f.difficulty,
    sectionAlreadyScoped: true,
    allowedSectionIds: null,
  });

  const progressResult = await applyProgressFilters(items, f);
  if (!progressResult.ready) return progressResult;
  if (progressResult.items.length === 0) {
    return { ready: false, message: 'Aucune question ne correspond à cette sélection.', items: [] };
  }
  return { ready: true, message: null, items: progressResult.items };
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

/**
 * AJOUT (theme sombre + classification, demande directe de David,
 * 29/07/2026) : équivalent de launchTestMe() ci-dessus pour le nouveau
 * regroupement par classification - repartit le tirage par
 * `groupKeyFn(q)` (ex. la classification de chaque question) plutôt que
 * par `documentSourceId`, pour la même raison (une grosse classification
 * ne doit jamais écraser mécaniquement une petite).
 * @param {Array<string>} allPedagogicalIds - union de TOUTES les
 *   classifications connues (déjà dédupliquée ou non, peu importe)
 * @param {number} questionCount
 * @param {function(object):string} groupKeyFn
 * @returns {Promise<object>} même forme de retour que startNewFreeTrainingSession()
 */
export async function launchTestMeByIds(allPedagogicalIds, questionCount, groupKeyFn) {
  const poolResult = await composeFreeTrainingPoolByIds(allPedagogicalIds);
  if (!poolResult.ready) {
    return { status: 'error', message: poolResult.message || 'Impossible de préparer le test pour le moment.' };
  }

  const picked = pickDiversifiedSubset(poolResult.items, questionCount, groupKeyFn);
  const pedagogicalIds = picked.selected.map(function(q) { return q.pedagogicalId; });
  const result = await startNewFreeTrainingSession(pedagogicalIds);
  return Object.assign({}, result, { requestedCount: picked.requestedCount, actualCount: picked.actualCount });
}
