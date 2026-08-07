// ===================== UTILITAIRES DE NORMALISATION / DEDOUBLONNAGE (Sprint 21) =====================
// Regles de normalisation TECHNIQUE partagees par la resolution des tags
// et des competences (cadrage Sprint 21, point 4) : casse, espaces
// superflus, ponctuation terminale, accents. AUCUNE fusion semantique -
// "anti-inflammatoire" et "anti-inflammatoires" ne sont JAMAIS fusionnes
// automatiquement, seulement signales comme doublons potentiels (voir
// computeSimilarity ci-dessous, utilisee uniquement pour le RAPPORT,
// jamais pour decider une fusion).
//
// Utilitaire pur : aucun appel Firestore.

/**
 * Cle de dedoublonnage TECHNIQUE (fusion automatique si et seulement si
 * deux libelles produisent la MEME cle) : minuscules, accents retires,
 * ponctuation terminale retiree, espaces superflus reduits.
 * @param {string} text
 * @returns {string}
 */
export function normalizeForDedup(text) {
  return (text || '').toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les diacritiques (accents)
    .trim()
    .replace(/[.!?;:,]+$/g, '') // ponctuation terminale uniquement (jamais au milieu du texte)
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Similarite de Jaccard sur les mots (0 = aucun mot commun, 1 =
 * identique). Utilisee UNIQUEMENT pour signaler un "doublon potentiel"
 * dans le rapport d'analyse - ne declenche JAMAIS de fusion automatique
 * (cadrage Sprint 21, point 4 : "aucune fusion semantique automatique").
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function computeSimilarity(a, b) {
  const setA = new Set(normalizeForDedup(a).split(' ').filter(Boolean));
  const setB = new Set(normalizeForDedup(b).split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach(function(w) { if (setB.has(w)) intersection++; });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Seuil au-dela duquel deux libelles NON identiques (apres normalisation)
 * sont signales comme "doublon potentiel" dans le rapport - jamais
 * fusionnes. Volontairement conservateur (peu de faux positifs). */
export const POTENTIAL_DUPLICATE_THRESHOLD = 0.6;

/**
 * Repere, pour un nouveau libelle, les entrees deja connues qui lui
 * ressemblent SANS etre identiques apres normalisation (ces dernieres
 * auraient deja ete fusionnees automatiquement en amont).
 * @param {string} label
 * @param {Array<{key:string, label:string}>} existingEntries
 * @returns {Array<{label:string, similarity:number}>}
 */
export function findPotentialDuplicates(label, existingEntries) {
  const normalizedNew = normalizeForDedup(label);
  return existingEntries
    .filter(function(e) { return e.key !== normalizedNew; })
    .map(function(e) { return { label: e.label, similarity: computeSimilarity(label, e.label) }; })
    .filter(function(e) { return e.similarity >= POTENTIAL_DUPLICATE_THRESHOLD; })
    .sort(function(a, b) { return b.similarity - a.similarity; });
}
