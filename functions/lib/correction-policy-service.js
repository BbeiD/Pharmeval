// ===================== POLITIQUE DE CORRECTION — COPIE SERVEUR =====================
// Copie fidele de js/services/correction-policy-service.js (fonctions
// PURES, zero dependance), convertie en CommonJS pour etre utilisable par
// functions/index.js. Raison de la copie plutot qu'un import relatif direct
// ("../../js/services/...") : firebase.json ne deploie QUE le contenu du
// dossier functions/ (voir firebase.json, functions.source) - un import
// hors de ce dossier fonctionnerait en local mais casserait une fois
// deploye sur Cloud Functions.
//
// IMPORTANT : garder cette copie manuellement synchronisee avec l'original
// cote client si la politique de correction change un jour (seuils,
// arrondi...). Aucune logique n'a ete ajoutee/modifiee ici - copie
// verbatim, seule la syntaxe d'export change (voir en-tete du fichier
// source pour tous les commentaires d'origine).

const COMPETENCY_STATUS = Object.freeze({
  MASTERED: 'mastered',
  TO_REINFORCE: 'to_reinforce',
  NOT_ACQUIRED: 'not_acquired',
});

const QUESTION_RESULT_STATUS = Object.freeze({
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  UNANSWERED: 'unanswered',
});

const ROUNDING_MODES = Object.freeze({
  NEAREST: 'nearest',
  FLOOR: 'floor',
  CEIL: 'ceil',
});

const MULTI_CHOICE_SCORING_METHODS = Object.freeze({
  EXACT_MATCH: 'exact_match',
  PARTIAL_CREDIT: 'partial_credit',
});

const DEFAULT_POLICY = Object.freeze({
  masteryThresholdPercent: 80,
  reinforceThresholdPercent: 50,
  countUnansweredInDenominator: true,
  roundingMode: ROUNDING_MODES.NEAREST,
  multipleChoiceScoringMethod: MULTI_CHOICE_SCORING_METHODS.EXACT_MATCH,
});

let currentPolicy = Object.assign({}, DEFAULT_POLICY);

function getCorrectionPolicy() {
  return Object.assign({}, currentPolicy);
}

function roundPercent(value, policy) {
  const p = policy || getCorrectionPolicy();
  if (p.roundingMode === ROUNDING_MODES.FLOOR) return Math.floor(value);
  if (p.roundingMode === ROUNDING_MODES.CEIL) return Math.ceil(value);
  return Math.round(value);
}

function computeCompetencyStatus(percent, policy) {
  const p = policy || getCorrectionPolicy();
  if (percent >= p.masteryThresholdPercent) return COMPETENCY_STATUS.MASTERED;
  if (percent >= p.reinforceThresholdPercent) return COMPETENCY_STATUS.TO_REINFORCE;
  return COMPETENCY_STATUS.NOT_ACQUIRED;
}

module.exports = {
  COMPETENCY_STATUS,
  QUESTION_RESULT_STATUS,
  ROUNDING_MODES,
  MULTI_CHOICE_SCORING_METHODS,
  getCorrectionPolicy,
  roundPercent,
  computeCompetencyStatus,
};
