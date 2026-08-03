// ===================== CONTROLEUR "DEFI DU JOUR" =====================
// Espace UTILISATEUR (pas un ecran d'administration), meme principe que
// js/mes-parcours.js/js/entrainement-libre.js. Aucune logique metier ici :
// appelle js/services/daily-challenge-service.js et affiche le resultat.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { getDailyChallengeStateForUser, startTodaysChallenge } from "./services/daily-challenge-service.js";
import { DAILY_CHALLENGE_QUESTION_COUNT } from "./services/daily-challenge-logic.js";
import { renderSiteHeader } from "./site-header.js";
import { icon } from "./icons.js";

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function qs(id) { return document.getElementById(id); }
function showMessage(status, message) {
  const el = qs('defi-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Helpers de rendu
// ---------------------------------------------------------------------------

function plural(n, sing, plur) {
  return n === 1 ? sing : (plur || sing + 's');
}

const JOURS_FR = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function formatDefiDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return JOURS_FR[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS_FR[d.getMonth()] + ' ' + d.getFullYear();
}

function formatTime(value) {
  if (!value) return null;
  let d;
  if (value && typeof value.toDate === 'function') d = value.toDate();
  else if (typeof value === 'number') d = new Date(value * 1000);
  else d = new Date(value);
  if (!d || isNaN(d.getTime())) return null;
  return "aujourd’hui à " + d.getHours() + ' h ' + String(d.getMinutes()).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async function(user) {
  const loadingEl = qs('defi-loading');
  const viewEl = qs('defi-view');

  if (!user) {
    clearCurrentUserContext();
    window.location.href = 'index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('defi');
  wireHeaderInfo();

  await loadState();
});

// CORRECTIF bfcache (bouton bloqué sur "Préparation du défi…" au retour arrière)
window.addEventListener('pageshow', function(event) {
  if (event.persisted) loadState();
});

// ---------------------------------------------------------------------------
// Câblage du bouton "i" statique dans l'en-tête
// ---------------------------------------------------------------------------

function wireHeaderInfo() {
  const btn = qs('defi-how-btn');
  if (!btn) return;
  const panel = qs('defi-how-panel');
  if (!panel) return;
  btn.addEventListener('click', function() {
    const hidden = panel.hasAttribute('hidden');
    if (hidden) { panel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    else { panel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); }
  });
}

// ---------------------------------------------------------------------------
// Chargement de l'état
// ---------------------------------------------------------------------------

// Indique si une session défi est active — empêche startDefi() de créer
// une session dupliquée lorsque l'utilisateur clique "Continuer le défi".
let _hasActiveSession = false;

async function loadState() {
  const el = qs('defi-card');
  el.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  const state = await getDailyChallengeStateForUser();
  if (state.error) {
    showMessage('error', 'Impossible de charger le défi du jour pour le moment. Réessayez plus tard.');
  }
  render(state);
}

// ---------------------------------------------------------------------------
// Rendu principal
// ---------------------------------------------------------------------------

function render(state) {
  // Date dans l'en-tête
  const headerSub = qs('defi-header-sub');
  if (headerSub && state.dateStr) {
    headerSub.textContent = 'Défi du ' + formatDefiDate(state.dateStr);
  }

  _hasActiveSession = !!(state.activeSession);
  const el = qs('defi-card');
  const questionCount = Math.min(DAILY_CHALLENGE_QUESTION_COUNT, state.eligibleCount);

  let html = streakSummaryHtml(state.progress);

  if (state.eligibleCount === 0) {
    html += renderNoQuestions();
  } else if (state.alreadyCompletedToday) {
    html += renderDone(state);
  } else if (state.activeSession) {
    html += renderInProgress(state, questionCount);
  } else {
    html += renderNotStarted(questionCount);
  }

  el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Blocs de statistiques (série)
// ---------------------------------------------------------------------------

function streakSummaryHtml(progress) {
  const streak = progress.currentStreak;
  const best = progress.bestStreak;
  const total = progress.totalCompleted;
  const infoId = 'defi-serie-info';

  return (
    '<div class="defi-streak-row">' +
      '<div class="defi-streak-block">' +
        '<span class="defi-streak-icon defi-streak-icon-orange" aria-hidden="true">' + icon('feedback-streak-regularity', { size: 16 }) + '</span>' +
        '<span class="defi-streak-value">' + streak + '</span>' +
        '<span class="defi-streak-label">Série actuelle</span>' +
        '<span class="defi-streak-sublabel">' + escapeHtml(plural(streak, 'jour consécutif', 'jours consécutifs')) + '</span>' +
      '</div>' +
      '<div class="defi-streak-block">' +
        '<span class="defi-streak-icon defi-streak-icon-yellow" aria-hidden="true">' + icon('highlight-star-filled', { size: 16 }) + '</span>' +
        '<span class="defi-streak-value">' + best + '</span>' +
        '<span class="defi-streak-label">Meilleure série</span>' +
        '<span class="defi-streak-sublabel">' + escapeHtml(plural(best, 'jour', 'jours')) + '</span>' +
      '</div>' +
      '<div class="defi-streak-block">' +
        '<span class="defi-streak-icon defi-streak-icon-green" aria-hidden="true">' + icon('highlight-check-validated', { size: 16 }) + '</span>' +
        '<span class="defi-streak-value">' + total + '</span>' +
        '<span class="defi-streak-label">Défis terminés</span>' +
        '<span class="defi-streak-sublabel">' + escapeHtml(plural(total, 'défi complété', 'défis complétés')) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="defi-serie-info-row">' +
      '<button class="defi-info-toggle" aria-expanded="false" aria-controls="' + infoId + '" onclick="toggleDefiSerieInfo()">' +
        'Comment fonctionne ma série ?' +
      '</button>' +
    '</div>' +
    '<div class="defi-serie-info-panel" id="' + infoId + '" hidden role="note">' +
      'Votre série augmente chaque jour où vous terminez le défi avant minuit (heure locale). ' +
      'Une journée manquée remet la série actuelle à zéro — votre meilleure série, elle, reste inchangée. ' +
      'Un défi commencé mais non terminé ne compte pas.' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// États de la page
// ---------------------------------------------------------------------------

function renderNoQuestions() {
  return (
    '<div class="defi-state-block">' +
      '<p class="defi-pitch">Le défi du jour n\'est pas encore disponible.</p>' +
      '<p class="defi-pitch" style="color:var(--text2);">Il devrait arriver sous peu, avec le calme qui le caractérise.</p>' +
    '</div>'
  );
}

function renderNotStarted(questionCount) {
  return (
    '<div class="defi-state-block">' +
      '<div class="defi-meta-row">' +
        '<span class="defi-question-pill">' + questionCount + ' ' + escapeHtml(plural(questionCount, 'question')) + '</span>' +
        '<span class="defi-duration">Environ 3 minutes</span>' +
      '</div>' +
      '<p class="defi-pitch">Cinq questions vous attendent aujourd\'hui.<br>Elles se montrent remarquablement patientes.</p>' +
      '<div class="btn-row">' +
        '<button class="btn-primary defi-main-btn" id="defi-start-btn" onclick="startDefi()">' +
          '<i class="ti ti-player-play" aria-hidden="true"></i> Commencer le défi' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

function renderInProgress(state, questionCount) {
  const session = state.activeSession;
  const answered = typeof session.currentQuestionIndex === 'number' ? session.currentQuestionIndex : 0;
  const total = (session.questionIds || []).length || questionCount;
  const pct = total > 0 ? Math.round(answered / total * 100) : 0;
  const remaining = total - answered;
  const lastTime = formatTime(session.updatedAt || session.startedAt);

  return (
    '<div class="defi-state-block">' +
      '<div class="defi-active-badge-row">' +
        '<span class="defi-active-badge">En cours</span>' +
      '</div>' +
      '<div class="defi-meta-row" style="margin-top:8px;">' +
        '<span class="defi-question-pill">' + answered + ' / ' + total + '</span>' +
        '<span class="defi-duration">' + escapeHtml(plural(remaining, 'question restante', 'questions restantes')) + '</span>' +
      '</div>' +
      '<div class="defi-active-progress-row" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Avancement du défi : ' + pct + ' %">' +
        '<div class="ev-progress-bar-track defi-active-bar">' +
          '<div class="ev-progress-bar-fill" style="width:' + pct + '%;"></div>' +
        '</div>' +
        '<span class="defi-active-pct" aria-hidden="true">' + pct + ' %</span>' +
      '</div>' +
      (lastTime ? '<p class="defi-last-activity">Dernière activité : ' + escapeHtml(lastTime) + '</p>' : '') +
      '<div class="btn-row" style="margin-top:16px;">' +
        '<button class="btn-primary defi-main-btn" id="defi-start-btn" onclick="startDefi()">' +
          '<i class="ti ti-player-play" aria-hidden="true"></i> Continuer le défi' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

function renderDone(state) {
  return (
    '<div class="defi-state-block defi-done-state">' +
      '<div class="defi-done-icon" aria-hidden="true">' + icon('highlight-check-validated', { size: 32 }) + '</div>' +
      '<p class="defi-pitch"><strong>Défi terminé pour aujourd\'hui.</strong></p>' +
      '<p class="defi-pitch defi-done-quip">Pharmeval consent à vous laisser poursuivre votre journée.</p>' +
      '<p class="defi-renewal-text">Un nouveau défi sera disponible demain.</p>' +
      (state.progress.lastResultId
        ? '<div class="btn-row"><a class="btn-secondary" href="evaluation-result.html?resultId=' + encodeURIComponent(state.progress.lastResultId) + '"><i class="ti ti-chart-bar" aria-hidden="true"></i> Voir mes résultats</a></div>'
        : '') +
    '</div>'
  );
}


// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function startDefi() {
  const btn = qs('defi-start-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Préparation…'; }

  // Session en cours : navigation directe sans créer de doublon
  if (_hasActiveSession) {
    window.location.href = 'evaluation.html?sessionType=daily_challenge';
    return;
  }

  const result = await startTodaysChallenge();
  if (result.status !== 'success') {
    showMessage('error', result.message || 'Impossible de démarrer le défi du jour pour le moment.');
    if (btn) { btn.disabled = false; btn.textContent = 'Commencer le défi'; }
    return;
  }

  window.location.href = 'evaluation.html?sessionType=daily_challenge';
}

export function toggleDefiSerieInfo() {
  const btn = document.querySelector('.defi-info-toggle');
  const panel = qs('defi-serie-info');
  if (!btn || !panel) return;
  const hidden = panel.hasAttribute('hidden');
  if (hidden) { panel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
  else { panel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); }
}

}

window.startDefi = startDefi;
window.toggleDefiSerieInfo = toggleDefiSerieInfo;
