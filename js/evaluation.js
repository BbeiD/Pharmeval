// ===================== CONTROLEUR DE LA PAGE "EVALUATION" (Sprint 17) =====================
// Aucune logique metier ici : appelle js/services/evaluation-session-
// service.js (+ parcours-evaluation-service.js, question-renderer-
// service.js) et affiche/reagit - meme discipline que toutes les autres
// pages du projet.
//
// "Le contrôle doit également être effectué dans la logique métier..."
// (SPRINT17, section 14) : cette page ne fait AUCUNE verification de
// securite elle-meme - toute verification (attribution, propriete de la
// session, statut) est deleguee aux services, qui sont eux-memes soutenus
// par firestore.rules (voir ce fichier pour le detail et les limites
// assumees).

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import {
  getActiveSession, startNewSession, resumeSession, restartSession,
  saveAnswer, saveCurrentQuestionIndex,
  getActiveFreeTrainingSession,
  startParcoursMixedSession, restartParcoursMixedSession,
} from "./services/evaluation-session-service.js";
import { finalizeEvaluation, resolveExplanations } from "./services/evaluation-result-service.js";
import { checkAnswerCorrectness } from "./services/evaluation-correction-service.js";
import { isQuestionAnswered } from "./services/evaluation-session-metadata-service.js";
import { renderQuestionOptions, readAnswerFromDom } from "./services/question-renderer-service.js";
import { getParcoursById } from "./services/parcours-catalog-service.js";
import { getCompetencyById } from "./services/competency-catalog-service.js";

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function qs(id) { return document.getElementById(id); }
function showOnly(id) {
  ['ev-loading', 'ev-denied', 'ev-session-dialog', 'ev-taking'].forEach(function(v) {
    var el = qs(v);
    if (el) el.style.display = (v === id) ? 'block' : 'none';
  });
}
function showMessage(status, message) {
  const el = qs('ev-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

let state = {
  sessionType: 'parcours', // 'parcours' (comportement historique, inchange) ou 'free_training' (Phase B1)
  parcoursId: null, competencyId: null,
  parcoursName: '', competencyName: '', competencyDescription: '',
  session: null,
  pendingSession: null, // session in_progress detectee, en attente du choix Reprendre/Recommencer
};

// ---------------------------------------------------------------------------
// Chargement initial
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async function(user) {
  if (!user) { clearCurrentUserContext(); window.location.href = 'index.html'; return; }
  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }
  await init();
});

async function init() {
  const params = new URLSearchParams(window.location.search);

  // SPRINT 21.5, PHASE B1 : une session d'entrainement libre est deja
  // creee AVANT d'arriver ici (voir entrainement-libre.js, qui gere
  // lui-meme le choix Reprendre/Remplacer en amont) - cette page se
  // contente de la reprendre, jamais d'en creer ou d'en recommencer une
  // elle-meme pour ce type de session. Comportement "parcours"
  // historique ci-dessous entierement inchange.
  if (params.get('sessionType') === 'free_training') {
    await initFreeTraining();
    return;
  }

  state.parcoursId = params.get('parcoursId');
  state.competencyId = params.get('competencyId');

  // AJOUT : "Commencer" unique d'un parcours (competences + sources +
  // questions directes melangees, voir parcours-detail.js) - un parcoursId
  // present SANS competencyId identifie ce mode, distinct du mode
  // "parcours classique" ci-dessous (une competence precise).
  if (state.parcoursId && !state.competencyId) {
    await initParcoursMixed();
    return;
  }

  if (!state.parcoursId || !state.competencyId) {
    showDenied('Paramètres manquants', 'Cette évaluation n\'a pas pu être identifiée. Retournez à votre parcours et réessayez.', 'mes-parcours.html');
    return;
  }

  const active = await getActiveSession(state.parcoursId, state.competencyId);
  if (active) {
    state.pendingSession = active;
    await loadDisplayContext();
    showOnly('ev-session-dialog');
    return;
  }

  await startFresh();
}

async function initFreeTraining() {
  state.sessionType = 'free_training';
  showOnly('ev-loading');

  const active = await getActiveFreeTrainingSession();
  if (!active) {
    showDenied('Aucun entraînement en cours', 'Configurez un nouvel entraînement depuis l\'écran dédié.', 'entrainement-libre.html');
    return;
  }

  const result = await resumeSession(active.id);
  if (result.status !== 'success') {
    showDenied('Entraînement indisponible', result.message || 'Cet entraînement n\'est pas accessible pour le moment.', 'entrainement-libre.html');
    return;
  }
  state.session = result.session;
  renderTaking();
}

// AJOUT : "Commencer" unique d'un parcours mixte - meme principe que le
// mode "parcours classique" ci-dessus (dialogue Reprendre/Recommencer si
// une session est deja en cours), mais sans competence unique : la
// verification d'une session active reutilise getActiveSession() TELLE
// QUELLE, avec competencyId=null (aucune autre session ne peut porter ce
// meme couple parcoursId+competencyId=null, voir evaluation-session-
// service.js#startParcoursMixedSession).
async function initParcoursMixed() {
  state.sessionType = 'parcours_mixed';
  showOnly('ev-loading');

  const active = await getActiveSession(state.parcoursId, null);
  if (active) {
    state.pendingSession = active;
    state.parcoursName = (await getParcoursById(state.parcoursId) || {}).name || 'Parcours';
    showOnly('ev-session-dialog');
    return;
  }

  await startFreshMixed();
}

async function startFreshMixed() {
  showOnly('ev-loading');
  const result = await startParcoursMixedSession(state.parcoursId);
  if (result.status !== 'success') {
    showDenied('Évaluation indisponible', result.message || 'Cette évaluation n\'est pas accessible pour le moment.', backLinkForParcours());
    return;
  }
  state.session = result.session;
  state.parcoursName = (result.parcours && result.parcours.name) || 'Parcours';
  renderTaking();
}

async function loadDisplayContext() {
  const [parcours, competency] = await Promise.all([
    getParcoursById(state.parcoursId),
    getCompetencyById(state.competencyId),
  ]);
  state.parcoursName = (parcours && parcours.name) || 'Parcours';
  state.competencyName = (competency && competency.name) || 'Compétence';
  state.competencyDescription = (competency && competency.description) || '';
}

function backLinkForParcours() {
  return state.parcoursId ? ('parcours-detail.html?id=' + encodeURIComponent(state.parcoursId)) : 'mes-parcours.html';
}

function showDenied(title, message, backHref) {
  qs('ev-denied-title').textContent = title;
  qs('ev-denied-message').textContent = message;
  qs('ev-denied-back-link').href = backHref || backLinkForParcours();
  showOnly('ev-denied');
}

// ---------------------------------------------------------------------------
// Démarrage d'une toute nouvelle session
// ---------------------------------------------------------------------------

async function startFresh() {
  showOnly('ev-loading');
  const result = await startNewSession(state.parcoursId, state.competencyId);
  if (result.status !== 'success') {
    showDenied('Évaluation indisponible', result.message || 'Cette évaluation n\'est pas accessible pour le moment.', backLinkForParcours());
    return;
  }
  state.session = result.session;
  state.parcoursName = (result.parcours && result.parcours.name) || 'Parcours';
  state.competencyName = (result.competency && result.competency.name) || 'Compétence';
  state.competencyDescription = (result.competency && result.competency.description) || '';
  renderTaking();
}

export async function handleResume() {
  showOnly('ev-loading');
  const result = await resumeSession(state.pendingSession.id);
  if (result.status !== 'success') {
    showDenied('Évaluation indisponible', result.message || 'Impossible de reprendre cette évaluation.', backLinkForParcours());
    return;
  }
  state.session = result.session;
  renderTaking();
}

export function requestRestart() {
  qs('ev-restart-confirm-overlay').style.display = 'flex';
}
export function cancelRestart() {
  qs('ev-restart-confirm-overlay').style.display = 'none';
}
export async function confirmRestart() {
  qs('ev-restart-confirm-overlay').style.display = 'none';
  showOnly('ev-loading');
  const result = state.sessionType === 'parcours_mixed'
    ? await restartParcoursMixedSession(state.pendingSession.id, state.parcoursId)
    : await restartSession(state.pendingSession.id, state.parcoursId, state.competencyId);
  if (result.status !== 'success') {
    showDenied('Évaluation indisponible', result.message || 'Cette évaluation n\'est pas accessible pour le moment.', backLinkForParcours());
    return;
  }
  state.session = result.session;
  state.parcoursName = (result.parcours && result.parcours.name) || state.parcoursName;
  state.competencyName = (result.competency && result.competency.name) || state.competencyName;
  state.competencyDescription = (result.competency && result.competency.description) || state.competencyDescription;
  renderTaking();
}

// ---------------------------------------------------------------------------
// Rendu de l'evaluation en cours
// ---------------------------------------------------------------------------

function renderTaking() {
  showOnly('ev-taking');

  if (state.sessionType === 'free_training') {
    // SPRINT 21.5, PHASE B1 : masquage du bloc parcours/competence (aucun
    // des deux n'existe pour une session d'entrainement libre) - fil
    // d'Ariane reduit a un seul maillon, jamais un texte "null"/vide trompeur.
    qs('ev-breadcrumb-root').textContent = 'Entraînement libre';
    qs('ev-breadcrumb-root').href = 'entrainement-libre.html';
    qs('ev-breadcrumb-sep1').style.display = 'none';
    qs('ev-breadcrumb-parcours').style.display = 'none';
    qs('ev-breadcrumb-sep2').style.display = 'none';
    qs('ev-breadcrumb-competency').textContent = '';
    qs('ev-competency-name').textContent = 'Entraînement libre';
    qs('ev-parcours-name').textContent = state.session.questionIds.length + ' question(s)';
  } else if (state.sessionType === 'parcours_mixed') {
    // AJOUT : parcours mixte - meme fil d'Ariane que le mode classique
    // (le parcours reste affiche), sans le second maillon "competence"
    // (aucune competence unique pour ce type de session).
    qs('ev-breadcrumb-parcours').textContent = state.parcoursName;
    qs('ev-breadcrumb-parcours').href = backLinkForParcours();
    qs('ev-breadcrumb-sep2').style.display = 'none';
    qs('ev-breadcrumb-competency').style.display = 'none';
    qs('ev-competency-name').textContent = state.parcoursName;
    qs('ev-parcours-name').textContent = state.session.questionIds.length + ' question(s)';
  } else {
    qs('ev-breadcrumb-parcours').textContent = state.parcoursName;
    qs('ev-breadcrumb-parcours').href = backLinkForParcours();
    qs('ev-breadcrumb-competency').textContent = state.competencyName;
    qs('ev-competency-name').textContent = state.competencyName;
    qs('ev-parcours-name').textContent = state.parcoursName + (state.competencyDescription ? ' — ' + state.competencyDescription : '');
  }

  renderQuestion(state.session.currentQuestionIndex || 0);
}

function renderProgress() {
  const total = state.session.questionIds.length;
  const index = state.session.currentQuestionIndex;
  qs('ev-progress-label').textContent = 'Question ' + (index + 1) + ' sur ' + total;
  const pct = Math.round(((index + 1) / total) * 100);
  qs('ev-progress-bar-track').setAttribute('aria-valuenow', String(pct));
  qs('ev-progress-bar-track').setAttribute('aria-valuetext', 'Question ' + (index + 1) + ' sur ' + total);
  qs('ev-progress-bar-fill').style.width = pct + '%';
}

function currentSnapshot() {
  const pid = state.session.questionIds[state.session.currentQuestionIndex];
  return { pedagogicalId: pid, snapshot: state.session.questionSnapshot[pid] };
}

function renderQuestion(index) {
  state.session.currentQuestionIndex = index;
  renderProgress();

  const { pedagogicalId, snapshot } = currentSnapshot();
  qs('ev-question-statement').textContent = (snapshot && snapshot.question) || 'Question indisponible.';

  const currentValue = state.session.answers[pedagogicalId] ? state.session.answers[pedagogicalId].value : null;
  qs('ev-question-options').innerHTML = renderQuestionOptions(snapshot, currentValue);
  hideExplanation();

  const optionsEl = qs('ev-question-options');
  if (currentValue === null || currentValue === undefined) {
    optionsEl.onchange = function() { handleAnswerChange(pedagogicalId, snapshot); };
  } else {
    // Question deja repondue (revisitee via Precedent/navigation) : reponse
    // verrouillee, meme retour immediat que juste apres avoir repondu -
    // jamais de nouvelle modification silencieuse d'une reponse deja vue.
    optionsEl.onchange = null;
    applyAnswerFeedback(pedagogicalId, snapshot, currentValue);
  }

  qs('ev-btn-prev').disabled = (index === 0);
  qs('ev-btn-next').disabled = (index === state.session.questionIds.length - 1);
}

// ---------------------------------------------------------------------------
// Retour immediat par question (couleur + justification a la selection) -
// reutilise checkAnswerCorrectness() (meme registre que la correction
// finale de session, evaluation-correction-service.js) et resolveExplanations()
// (meme fonction que la page de resultat, evaluation-result-service.js) :
// aucune logique de comparaison ni de lecture d'explication dupliquee ici.
// ---------------------------------------------------------------------------

const explanationCache = new Map();

function hideExplanation() {
  const el = qs('ev-explanation');
  el.className = 'explanation';
  el.innerHTML = '';
}

async function applyAnswerFeedback(pedagogicalId, snapshot, value) {
  const optionsEl = qs('ev-question-options');
  const inputs = optionsEl.querySelectorAll('input[type="radio"]');
  const correction = checkAnswerCorrectness(snapshot.questionType, snapshot, value);
  inputs.forEach(function(input, i) {
    input.disabled = true;
    const label = input.closest('.ev-option');
    if (!label) return;
    if (i === snapshot.correctAnswer) label.classList.add('ev-option-correct');
    else if (i === value) label.classList.add('ev-option-incorrect');
  });

  let text = explanationCache.get(pedagogicalId);
  if (text === undefined) {
    const map = await resolveExplanations([pedagogicalId]);
    text = map.get(pedagogicalId) || '';
    explanationCache.set(pedagogicalId, text);
  }
  // L'utilisateur a pu changer de question pendant la lecture reseau -
  // jamais afficher une justification sur la mauvaise question.
  if (state.session.questionIds[state.session.currentQuestionIndex] !== pedagogicalId) return;

  const explanationEl = qs('ev-explanation');
  explanationEl.innerHTML = '<strong>' + (correction.isCorrect ? '✓ Bonne réponse' : '✗ Incorrect') + ' :</strong> ' +
    escapeHtml(text || 'Aucune justification disponible pour cette question.');
  explanationEl.className = 'explanation show';
}

// ---------------------------------------------------------------------------
// Sauvegarde automatique (SPRINT17, section 9)
// ---------------------------------------------------------------------------

function setSaveIndicator(text) {
  qs('ev-save-indicator').textContent = text;
}

async function handleAnswerChange(pedagogicalId, snapshot) {
  const value = readAnswerFromDom(snapshot);
  setSaveIndicator('Enregistrement…');
  const result = await saveAnswer(state.session, pedagogicalId, value);
  if (result.status !== 'success') {
    setSaveIndicator('Erreur d\'enregistrement');
    return;
  }
  state.session.answers[pedagogicalId] = result.entry;
  setSaveIndicator('Enregistré');
  qs('ev-question-options').onchange = null; // verrouille : reponse deja revelee, plus de changement possible
  applyAnswerFeedback(pedagogicalId, snapshot, value);
}

async function persistCurrentIndex() {
  await saveCurrentQuestionIndex(state.session, state.session.currentQuestionIndex);
}

export function goToPrevious() {
  if (state.session.currentQuestionIndex === 0) return;
  renderQuestion(state.session.currentQuestionIndex - 1);
  persistCurrentIndex();
}
export function goToNext() {
  if (state.session.currentQuestionIndex >= state.session.questionIds.length - 1) return;
  renderQuestion(state.session.currentQuestionIndex + 1);
  persistCurrentIndex();
}

// Sauvegarde "best effort" avant de quitter la page (SPRINT17, section 9 :
// "avant de quitter la page lorsque cela est techniquement possible") -
// aucune garantie forte (les navigateurs limitent fortement le travail
// asynchrone dans ce contexte), mais la position courante a de toute
// facon deja ete enregistree a chaque navigation (persistCurrentIndex),
// donc rien d'important ne depend reellement de ce dernier essai.
window.addEventListener('beforeunload', function() {
  if (state.session && state.session.status === 'in_progress') {
    persistCurrentIndex();
  }
});

// Gestion minimale des erreurs reseau (SPRINT17, section 9)
window.addEventListener('offline', function() {
  showMessage('denied', 'Connexion internet perdue. Vos réponses seront enregistrées dès que la connexion sera rétablie.');
});
window.addEventListener('online', function() {
  showMessage('success', 'Connexion rétablie.');
  setTimeout(function() { showMessage('success', ''); }, 3000);
});

// ---------------------------------------------------------------------------
// Terminaison (SPRINT17, section 11)
// ---------------------------------------------------------------------------

export function requestSubmit() {
  const total = state.session.questionIds.length;
  const answeredCount = state.session.questionIds.filter(function(pid) { return isQuestionAnswered(state.session.answers[pid]); }).length;
  const unanswered = total - answeredCount;
  const noteEl = qs('ev-submit-confirm-unanswered');
  if (unanswered > 0) {
    noteEl.textContent = unanswered + ' question' + (unanswered > 1 ? 's sont encore sans réponse.' : ' est encore sans réponse.');
    noteEl.style.display = 'block';
  } else {
    noteEl.style.display = 'none';
  }
  qs('ev-submit-confirm-overlay').style.display = 'flex';
}
export function cancelSubmit() {
  qs('ev-submit-confirm-overlay').style.display = 'none';
}
export async function confirmSubmit() {
  qs('ev-submit-confirm-overlay').style.display = 'none';
  showOnly('ev-loading');
  const result = await finalizeEvaluation(state.session);
  if (result.status === 'submitted_no_result') {
    // SPRINT18 : la soumission elle-meme a reussi (definitive, jamais
    // remise en cause) mais le rapport n'a pas pu etre genere/enregistre -
    // etat honnete plutot qu'une redirection vers une page de resultat
    // inexistante.
    showDenied('Évaluation soumise', result.message, backLinkForParcours());
    return;
  }
  if (result.status !== 'success') {
    showMessage('error', result.message || 'La soumission a échoué. Veuillez réessayer.');
    showOnly('ev-taking');
    return;
  }
  // SPRINT18 : redirection vers la véritable page de résultat (score,
  // détail par question) - remplace l'état local minimal du Sprint 17
  // ("Évaluation terminée" sans score), désormais retiré (voir
  // evaluation.html).
  window.location.href = 'evaluation-result.html?resultId=' + encodeURIComponent(result.resultId);
}

// ---------------------------------------------------------------------------
// Exposition au HTML
// ---------------------------------------------------------------------------

window.handleResume = handleResume;
window.requestRestart = requestRestart;
window.cancelRestart = cancelRestart;
window.confirmRestart = confirmRestart;
window.goToPrevious = goToPrevious;
window.goToNext = goToNext;
window.requestSubmit = requestSubmit;
window.cancelSubmit = cancelSubmit;
window.confirmSubmit = confirmSubmit;
