// ===================== LOGIQUE PURE — CLASSIFICATION DES PARCOURS PAR SUJET =====================
// Aucune dependance Firestore ici (meme principe que free-training-logic.js,
// catalog-sync-resolution-logic.js) - separee du fichier qui appelle
// reellement Firestore (js/entrainement-libre.js, via parcours-service.js)
// pour rester testable independamment.
//
// CONTEXTE (demande directe de David, 29/07/2026, "je préférerais que tu
// partes sur les grandes classifications qu'on a mis dans les parcours") :
// l'ecran Entraînement libre proposait jusqu'ici les document_sources
// brutes comme "thèmes" (noms parfois peu clairs, ex. "A-4"/"A-5" -
// des sections d'un referentiel FTM, pas un sujet pedagogique). Les
// Parcours (generate-leveled-parcours.mjs) portent deja un regroupement
// bien plus lisible ("Douleur, AINS & rhumatologie", "Cardiovasculaire"...),
// un niveau par parcours - mais AUCUNE collection Firestore dediee ne
// stocke cette classification independamment : le SEUL point de verite
// est le prefixe du nom du Parcours, avant son suffixe de niveau/partie.
// Reconstruite ICI a la volee, jamais dupliquee/persistee ailleurs.

const LEVEL_SUFFIX_SEPARATOR = ' — ';

/**
 * @param {string} name - nom complet d'un Parcours (ex. "Douleur, AINS &
 *   rhumatologie — Niveau 1 (Fondamental)" ou "... — partie 2/2")
 * @returns {string} la classification seule (ex. "Douleur, AINS & rhumatologie")
 */
export function classificationFromParcoursName(name) {
  const s = (name || '').toString();
  const idx = s.indexOf(LEVEL_SUFFIX_SEPARATOR);
  return (idx === -1 ? s : s.slice(0, idx)).trim();
}

/**
 * Regroupe une liste de Parcours (deja chargee, deja filtree "publies" par
 * l'appelant - voir getSelfServiceCatalogParcours()) par classification -
 * une entree par classification distincte, avec l'union DEDUPLIQUEE des
 * `directQuestionIds` de tous ses niveaux/parties (plusieurs Parcours -
 * un par niveau - partagent la meme classification).
 * @param {Array<{name:string, directQuestionIds?:Array<string>, color?:string}>} parcoursItems
 * @returns {Array<{classification:string, questionIds:Array<string>, color:(string|null)}>}
 *   trie par nombre de questions decroissant (les classifications les
 *   mieux fournies en premier - jamais un ordre alphabetique qui noierait
 *   les grandes classifications parmi les tres petites).
 */
export function groupParcoursByClassification(parcoursItems) {
  const byClassification = new Map();
  (parcoursItems || []).forEach(function(p) {
    const classification = classificationFromParcoursName(p.name);
    if (!classification) return;
    if (!byClassification.has(classification)) {
      byClassification.set(classification, { classification: classification, questionIds: new Set(), color: p.color || null });
    }
    const entry = byClassification.get(classification);
    (p.directQuestionIds || []).forEach(function(id) { entry.questionIds.add(id); });
  });

  return Array.from(byClassification.values())
    .map(function(entry) {
      return { classification: entry.classification, questionIds: Array.from(entry.questionIds), color: entry.color };
    })
    .sort(function(a, b) { return b.questionIds.length - a.questionIds.length; });
}
