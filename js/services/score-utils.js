// ===================== UTILITAIRE DE NIVEAU DE SCORE (PARTAGE) =====================
// Seuils de couleur/niveau centralises ici, pour ne jamais les repeter dans
// plusieurs fichiers (Sprint 6, section 10 de la demande). Utilise par
// js/history.js (cartes d'historique) et js/statistics.js (indicateurs de
// l'analyse de progression).
//
// La couleur n'est jamais le seul indicateur : chaque niveau porte aussi un
// libelle textuel ("Très bon" / "À consolider" / "À retravailler") et une
// classe CSS nommee par le sens, pas seulement par la couleur, afin de
// rester exploitable par un lecteur d'ecran ou en cas de daltonisme.

const THRESHOLDS = Object.freeze({
  GOOD: 80,   // >= 80 : vert / "Très bon"
  MEDIUM: 60, // 60-79 : orange / "À consolider" ; < 60 : rouge / "À retravailler"
});

/**
 * Determine le niveau d'un score en pourcentage.
 *
 * @param {number} percentage
 * @returns {{level:('good'|'medium'|'weak'|'unknown'), label:string, className:string}}
 */
export function getScoreLevel(percentage) {
  if (typeof percentage !== 'number' || isNaN(percentage)) {
    // Donnee manquante ou invalide : niveau neutre, jamais de couleur
    // trompeuse (ni vert, ni rouge) pour une valeur qu'on ne connait pas.
    return { level: 'unknown', label: 'Non disponible', className: 'score-unknown' };
  }
  if (percentage >= THRESHOLDS.GOOD) {
    return { level: 'good', label: 'Très bon', className: 'score-good' };
  }
  if (percentage >= THRESHOLDS.MEDIUM) {
    return { level: 'medium', label: 'À consolider', className: 'score-medium' };
  }
  return { level: 'weak', label: 'À retravailler', className: 'score-weak' };
}

/**
 * Raccourci pratique quand seule la classe CSS est necessaire.
 * @param {number} percentage
 * @returns {string}
 */
export function getScoreClass(percentage) {
  return getScoreLevel(percentage).className;
}
