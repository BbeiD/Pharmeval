// ===================== MOTEUR DE RENDU DES QUESTIONS (Sprint 17) =====================
// Correspond au "QuestionRenderer" du cadrage (section 15) : afficher le
// bon composant selon le type de question, lire la réponse sélectionnée,
// restaurer une réponse existante. "La logique ne doit pas être codée
// dans un grand bloc conditionnel... Prévoir des fonctions distinctes par
// type de question" (section 6) : ce fichier est un REGISTRE
// {questionType -> {renderOptions, readAnswer}}, jamais un `if/else`
// géant - ajouter un type revient à ajouter une entrée au registre,
// jamais à modifier la logique existante.
//
// ETAT REEL DE LA BANQUE DE QUESTIONS (a documenter honnetement, comme
// demande) : seul le type "qcm" (choix unique) est aujourd'hui reellement
// importable dans Firestore (voir js/services/question-import-
// validator.js, SUPPORTED_IMPORT_QUESTION_TYPES = ['single-choice'] ->
// 'qcm'). Aucune question a choix multiple ni vrai/faux n'existe
// reellement dans la Banque de questions au moment de ce sprint. "Ne pas
// inventer de nouveaux types si la banque n'en contient pas" (SPRINT17,
// section 6) : seul le rendu "qcm" est donc IMPLEMENTE ci-dessous. Les
// entrees 'multiple-choice' et 'vrai_faux' pourront etre ajoutees au
// REGISTRE (une simple entree supplementaire, jamais une refonte) des
// qu'un futur sprint permettra reellement de les importer/creer.
//
// ACCESSIBILITE (SPRINT17, section 17) : chaque option est un `<label>`
// englobant un `<input type="radio">` explicitement associe (clic sur le
// texte = clic sur l'input), navigable au clavier nativement (radio
// standard du navigateur), jamais un `<div onclick>` sans semantique.

export const QUESTION_TYPES_SUPPORTED = Object.freeze(['qcm']);

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Rendu "qcm" (choix unique) - le seul reellement implemente ce sprint.
// ---------------------------------------------------------------------------

function renderQcmOptions(snapshot, currentValue) {
  const answers = Array.isArray(snapshot.answers) ? snapshot.answers : [];
  if (answers.length === 0) {
    return '<p class="pv-list-empty">Cette question ne comporte aucune option exploitable.</p>';
  }
  return '<div class="ev-options" role="radiogroup" aria-label="Options de réponse">' + answers.map(function(text, i) {
    const inputId = 'ev-option-' + escapeHtml(snapshot.pedagogicalId) + '-' + i;
    const checked = (typeof currentValue === 'number' && currentValue === i) ? ' checked' : '';
    return (
      '<label class="ev-option" for="' + inputId + '">' +
        '<input type="radio" id="' + inputId + '" name="ev-answer-' + escapeHtml(snapshot.pedagogicalId) + '" value="' + i + '"' + checked + '>' +
        '<span>' + escapeHtml(text) + '</span>' +
      '</label>'
    );
  }).join('') + '</div>';
}

function readQcmAnswer(snapshot) {
  const selector = 'input[name="ev-answer-' + cssEscape(snapshot.pedagogicalId) + '"]:checked';
  const checked = document.querySelector(selector);
  return checked ? parseInt(checked.value, 10) : null;
}

// CSS.escape n'est pas garanti disponible partout (tres anciens
// navigateurs) - repli minimal, un pedagogicalId reel ne contient que
// lettres/chiffres/tirets/underscores (voir CHARTE_QUALITE_PHARMEVAL.md,
// section 12.1), donc ce repli n'est jamais reellement sollicite en
// pratique, mais evite un plantage plutot qu'une hypothese non verifiee.
function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '');
}

// ---------------------------------------------------------------------------
// Registre {questionType -> {renderOptions, readAnswer}}
// ---------------------------------------------------------------------------

const RENDERERS = {
  qcm: { renderOptions: renderQcmOptions, readAnswer: readQcmAnswer },
};

/**
 * Rendu HTML des options de reponse d'une question, avec la reponse
 * ACTUELLE deja restauree (option cochee) si `currentValue` est fourni -
 * "restaurer une reponse existante" (SPRINT17, section 15).
 * @param {object} snapshot - un `session.questionSnapshot[pedagogicalId]`
 * @param {*} currentValue - `session.answers[pedagogicalId].value`, ou null/undefined
 * @returns {string} HTML
 */
export function renderQuestionOptions(snapshot, currentValue) {
  const renderer = RENDERERS[snapshot && snapshot.questionType];
  if (!renderer) {
    // Etat clair plutot qu'une page blanche ou un plantage (SPRINT17,
    // section 16) - type reconnu par le schema mais pas encore pris en
    // charge par ce moteur de rendu (voir en-tete de fichier).
    return '<p class="pv-list-empty">Ce type de question (« ' + escapeHtml(snapshot && snapshot.questionType) + ' ») n\'est pas encore pris en charge par le moteur d\'évaluation.</p>';
  }
  return renderer.renderOptions(snapshot, currentValue);
}

/**
 * Lit la reponse actuellement selectionnee dans le DOM pour une question
 * donnee.
 * @param {object} snapshot
 * @returns {*} la valeur lue (format dependant du type), ou null si aucune
 */
export function readAnswerFromDom(snapshot) {
  const renderer = RENDERERS[snapshot && snapshot.questionType];
  if (!renderer) return null;
  return renderer.readAnswer(snapshot);
}

/**
 * Indique si le moteur de rendu prend reellement en charge ce type de
 * question - utilise par evaluation.js pour desactiver silencieusement
 * une question non rendable plutot que d'afficher un formulaire casse.
 * @param {string} questionType
 * @returns {boolean}
 */
export function isQuestionTypeSupported(questionType) {
  return Object.prototype.hasOwnProperty.call(RENDERERS, questionType);
}
