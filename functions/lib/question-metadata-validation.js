// ===================== VALIDATION DE DIFFICULTE — COPIE SERVEUR (partielle) =====================
// Copie fidele de la seule fonction necessaire de js/services/question-
// metadata-service.js (isRecognizedDifficultyInput + sa table de
// variantes), convertie en CommonJS - voir correction-policy-service.js
// (ce dossier) pour l'explication de la copie. GARDER SYNCHRONISEE avec
// l'original si une variante de difficulte est ajoutee/retiree (voir
// l'ajout de "fondamental", 27/07/2026).

const DIFFICULTY_LEVELS = Object.freeze({
  ESSENTIEL: 'essentiel',
  APPROFONDI: 'approfondi',
  AVANCE: 'avance',
});

const DIFFICULTY_NORMALIZATION_MAP = Object.freeze({
  essentiel: DIFFICULTY_LEVELS.ESSENTIEL,
  basique: DIFFICULTY_LEVELS.ESSENTIEL,
  'débutant': DIFFICULTY_LEVELS.ESSENTIEL,
  fondamental: DIFFICULTY_LEVELS.ESSENTIEL,
  approfondi: DIFFICULTY_LEVELS.APPROFONDI,
  'intermédiaire': DIFFICULTY_LEVELS.APPROFONDI,
  avance: DIFFICULTY_LEVELS.AVANCE,
  'avancé': DIFFICULTY_LEVELS.AVANCE,
  expert: DIFFICULTY_LEVELS.AVANCE,
});

function isRecognizedDifficultyInput(rawDifficulty) {
  const key = (rawDifficulty || '').toString().trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DIFFICULTY_NORMALIZATION_MAP, key);
}

module.exports = { isRecognizedDifficultyInput };
