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

  await loadState();
});

async function loadState() {
  const el = qs('defi-card');
  el.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  const state = await getDailyChallengeStateForUser();
  if (state.error) {
    showMessage('error', 'Impossible de charger le défi du jour pour le moment. Réessayez plus tard.');
  }
  render(state);
}

function streakSummaryHtml(progress) {
  return (
    '<div class="defi-streak-row">' +
      '<div class="defi-streak-block">' +
        '<span class="defi-streak-flame">' + icon('feedback-streak-regularity', { size: 28 }) + '</span>' +
        '<span class="defi-streak-value">' + progress.currentStreak + '</span>' +
        '<span class="defi-streak-label">jour(s) de suite</span>' +
      '</div>' +
      '<div class="defi-streak-block">' +
        '<span class="defi-streak-value">' + progress.bestStreak + '</span>' +
        '<span class="defi-streak-label">Meilleure série</span>' +
      '</div>' +
      '<div class="defi-streak-block">' +
        '<span class="defi-streak-value">' + progress.totalCompleted + '</span>' +
        '<span class="defi-streak-label">Défis relevés</span>' +
      '</div>' +
    '</div>'
  );
}

function render(state) {
  const el = qs('defi-card');
  const questionCount = Math.min(DAILY_CHALLENGE_QUESTION_COUNT, state.eligibleCount);

  let html = streakSummaryHtml(state.progress);

  if (state.eligibleCount === 0) {
    html += '<p class="admin-users-disclaimer" style="margin-top:16px;">Aucune question n\'est actuellement disponible pour le défi du jour.</p>';
  } else if (state.alreadyCompletedToday) {
    html +=
      '<div class="defi-done-block">' +
        icon('highlight-check-validated', { size: 32 }) +
        '<p><strong>Défi relevé pour aujourd\'hui !</strong></p>' +
        '<p class="admin-users-disclaimer">Revenez demain pour continuer votre série.</p>' +
        (state.progress.lastResultId
          ? '<a class="btn-secondary" href="evaluation-result.html?resultId=' + encodeURIComponent(state.progress.lastResultId) + '">Voir mon résultat du jour</a>'
          : '') +
      '</div>';
  } else {
    html +=
      '<div class="defi-start-block">' +
        '<p>' + questionCount + ' question(s) vous attendent aujourd\'hui.</p>' +
        '<button class="btn-primary" id="defi-start-btn" onclick="startDefi()">Commencer le défi</button>' +
      '</div>';
  }

  el.innerHTML = html;
}

export async function startDefi() {
  const btn = qs('defi-start-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Préparation du défi…'; }

  const result = await startTodaysChallenge();
  if (result.status !== 'success') {
    showMessage('error', result.message || 'Impossible de démarrer le défi du jour pour le moment.');
    if (btn) { btn.disabled = false; btn.textContent = 'Commencer le défi'; }
    return;
  }

  window.location.href = 'evaluation.html?sessionType=daily_challenge';
}
window.startDefi = startDefi;
