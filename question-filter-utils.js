// ===================== DESCRIPTEURS DE FILTRE — QUESTIONS (Sprint 21.5, Phase B0) =====================
// Logique PURE, aucune dependance au SDK Firestore (qui ne peut pas etre
// importe hors navigateur - voir question-catalog-service.js, seul
// fichier a traduire ces descripteurs en clauses `where(...)` reelles).
// Extrait dans son propre fichier UNIQUEMENT pour permettre un test
// unitaire reel de la logique de filtrage.

/**
 * @param {object} filters
 * @returns {Array<{field:string, op:string, value:*}>}
 */
export function buildFilterDescriptors(filters) {
  const descriptors = [];
  const f = filters || {};
  if (f.status) descriptors.push({ field: 'status', op: '==', value: f.status });
  if (f.theme) descriptors.push({ field: 'theme', op: '==', value: f.theme });
  if (f.difficulty) descriptors.push({ field: 'difficulty', op: '==', value: f.difficulty });
  if (f.questionType) descriptors.push({ field: 'questionType', op: '==', value: f.questionType });
  if (f.author) descriptors.push({ field: 'author', op: '==', value: f.author });
  if (f.documentSourceId) descriptors.push({ field: 'documentSourceId', op: '==', value: f.documentSourceId });
  if (f.documentSectionId) descriptors.push({ field: 'documentSectionId', op: '==', value: f.documentSectionId });
  if (f.tag) descriptors.push({ field: 'tags', op: 'array-contains', value: f.tag });
  return descriptors;
}

/**
 * Decide si un entrainement peut etre lance a partir du resultat d'un
 * chargement de pool BORNE (ex. searchQuestionsBounded(), deja existant
 * et INCHANGE - voir question-catalog-service.js). Fonction PURE,
 * reutilisable telle quelle par le futur ecran Entrainement libre (Phase
 * B1) - "ne jamais lancer silencieusement un entrainement sur un
 * sous-ensemble tronque" (cadrage, point 4) : centralisee ICI, jamais
 * reimplementee dans l'interface.
 *
 * @param {{items:Array, truncated:boolean}} boundedPoolResult
 * @returns {{canLaunch:boolean, message:(string|null)}}
 */
export function evaluateTrainingPoolReadiness(boundedPoolResult) {
  if (!boundedPoolResult) return { canLaunch: false, message: 'Aucun résultat de chargement.' };
  if (boundedPoolResult.truncated) {
    return { canLaunch: false, message: 'Trop de questions correspondent à cette sélection. Affinez votre sélection (source, section, ou filtres supplémentaires) avant de lancer l\'entraînement.' };
  }
  if (boundedPoolResult.items.length === 0) {
    return { canLaunch: false, message: 'Aucune question ne correspond à cette sélection.' };
  }
  return { canLaunch: true, message: null };
}
