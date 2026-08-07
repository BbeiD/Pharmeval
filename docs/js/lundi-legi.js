// ===================== CONTROLEUR "LUNDI LEGI" =====================
// Page utilisateur (lundi-legi.html). Aucune logique metier ici :
// appelle lundi-legi-service.js, affiche le resultat.
// Pattern identique a js/defi.js.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { getLundiLegiStateForUser, submitLundiLegiAnswer } from "./services/lundi-legi-service.js";
import { renderSiteHeader } from "./site-header.js";
import { formatDateFr } from "./services/date-utils.js";

const LETTERS = ['A', 'B', 'C', 'D'];

function qs(id) { return document.getElementById(id); }

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showMessage(status, message) {
  const el = qs('ll-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

onAuthStateChanged(auth, async function(user) {
  const loadingEl = qs('ll-loading');
  const viewEl = qs('ll-view');

  if (!user) {
    clearCurrentUserContext();
    window.location.href = 'index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la verification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('lundi-legi');

  await loadState();
});

// Bfcache : rechargement de l'etat reel si l'utilisateur revient
// en arriere depuis la page de reponse (meme pattern que defi.js).
window.addEventListener('pageshow', function(event) {
  if (event.persisted) loadState();
});

async function loadState() {
  const el = qs('ll-card');
  if (!el) return;
  el.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  showMessage(null, null);

  const state = await getLundiLegiStateForUser();
  render(state);
}

function render(state) {
  const el = qs('ll-card');
  if (!el) return;

  if (state.outOfSeason) {
    el.innerHTML =
      '<div class="ll-out-of-season">' +
        '<div class="ll-out-of-season-icon"><i class="ti ti-calendar-off" aria-hidden="true"></i></div>' +
        '<h3 style="margin-bottom:8px;">Pas de question cette semaine</h3>' +
        '<p class="import-intro">Le Lundi Légi démarre le lundi 7 septembre 2026 et couvre 50 semaines.</p>' +
      '</div>';
    return;
  }

  if (!state.question) {
    showMessage('error', 'Impossible de charger la question de la semaine. Réessayez plus tard.');
    el.innerHTML = '';
    return;
  }

  const weekLabel = 'Semaine ' + state.weekNumber + ' · ' + formatDateFr(state.date + 'T00:00:00');
  const diffColor = state.question.difficulty === 'Expert' ? 'var(--accent-purple)' : state.question.difficulty === 'Approfondi' ? 'var(--accent-yellow)' : 'var(--accent-blue)';

  if (state.alreadyAnswered) {
    renderResult(el, state.question, state.userAnswer.selectedAnswer, state.userAnswer.correct, weekLabel, diffColor);
    return;
  }

  renderQuestion(el, state, weekLabel, diffColor);
}

function weekPillHtml(weekLabel, diff, diffColor) {
  return (
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:var(--space-2);">' +
      '<span class="ll-week-pill"><i class="ti ti-gavel" aria-hidden="true" style="font-size:13px;"></i> ' + escapeHtml(weekLabel) + '</span>' +
      '<span class="bank-chip" style="color:' + escapeHtml(diffColor) + ';background:rgba(255,255,255,.05);">' + escapeHtml(diff || '') + '</span>' +
    '</div>'
  );
}

function renderQuestion(el, state, weekLabel, diffColor) {
  const q = state.question;
  const answers = Array.isArray(q.answers) ? q.answers : [];

  let optionsHtml = '<div class="ll-options">';
  answers.forEach(function(text, i) {
    optionsHtml +=
      '<button class="ll-option" onclick="submitAnswer(' + i + ',' + q.correctAnswer + ')">' +
        '<span class="ll-option-letter">' + escapeHtml(LETTERS[i]) + '</span>' +
        '<span class="ll-option-text">' + escapeHtml(text) + '</span>' +
      '</button>';
  });
  optionsHtml += '</div>';

  el.innerHTML =
    weekPillHtml(weekLabel, q.difficulty, diffColor) +
    '<div class="ll-question-block">' + escapeHtml(q.question) + '</div>' +
    optionsHtml;
}

function renderResult(el, q, selectedIdx, correct, weekLabel, diffColor) {
  const answers = Array.isArray(q.answers) ? q.answers : [];

  const bannerHtml =
    '<div class="ll-result-banner ' + (correct ? 'll-result-ok' : 'll-result-ko') + '">' +
      '<span class="ll-result-icon">' + (correct
        ? '<i class="ti ti-circle-check" style="color:var(--green);" aria-hidden="true"></i>'
        : '<i class="ti ti-circle-x" style="color:var(--red);" aria-hidden="true"></i>') +
      '</span>' +
      '<div>' +
        '<div class="ll-result-title" style="color:' + (correct ? 'var(--green-dark)' : 'var(--red)') + ';">' +
          (correct ? 'Bonne réponse' : 'Ce n\'est pas la bonne réponse') +
        '</div>' +
        '<div class="ll-result-sub">' +
          (correct ? 'Vous avez répondu correctement à la question de cette semaine.' : 'Voici ce que dit la réglementation.') +
        '</div>' +
      '</div>' +
    '</div>';

  let optionsHtml = '<div class="ll-options">';
  answers.forEach(function(text, i) {
    const isCorrect = i === q.correctAnswer;
    const isSelectedWrong = i === selectedIdx && !correct;
    const cls = isCorrect ? 'correct' : isSelectedWrong ? 'selected-wrong' : 'wrong';
    optionsHtml +=
      '<div class="ll-option ' + cls + '">' +
        '<span class="ll-option-letter">' + escapeHtml(LETTERS[i]) + '</span>' +
        '<span class="ll-option-text">' + escapeHtml(text) + '</span>' +
      '</div>';
  });
  optionsHtml += '</div>';

  const explHtml = q.explanation
    ? '<div class="ll-expl">' +
        '<div class="ll-expl-label">Explication</div>' +
        '<div class="ll-expl-text">' + escapeHtml(q.explanation) + '</div>' +
        (q.resourceRefs && q.resourceRefs.length
          ? '<p style="font-size:11px;color:var(--text3);margin-top:8px;font-style:italic;">(' + escapeHtml(q.resourceRefs[0]) + ')</p>'
          : '') +
      '</div>'
    : '';

  el.innerHTML =
    weekPillHtml(weekLabel, q.difficulty, diffColor) +
    '<div class="ll-question-block" style="font-size:13px;">' + escapeHtml(q.question) + '</div>' +
    bannerHtml +
    optionsHtml +
    explHtml +
    '<a href="index.html" class="ll-archive-link"><i class="ti ti-arrow-left" aria-hidden="true"></i> Retour à l\'accueil</a>';
}

// Appelee depuis les boutons onclick generees par renderQuestion()
export async function submitAnswer(selectedIdx, correctIdx) {
  const buttons = document.querySelectorAll('.ll-option');
  buttons.forEach(function(b) { b.disabled = true; });

  const correct = selectedIdx === correctIdx;
  const state = await getLundiLegiStateForUser();
  if (!state || !state.date || !state.pedagogicalId) return;

  await submitLundiLegiAnswer(state.date, state.pedagogicalId, selectedIdx, correct);

  const el = qs('ll-card');
  const weekLabel = 'Semaine ' + state.weekNumber + ' · ' + formatDateFr(state.date + 'T00:00:00');
  const diffColor = state.question && state.question.difficulty === 'Expert' ? 'var(--accent-purple)' : state.question && state.question.difficulty === 'Approfondi' ? 'var(--accent-yellow)' : 'var(--accent-blue)';
  renderResult(el, state.question, selectedIdx, correct, weekLabel, diffColor);
}
window.submitAnswer = submitAnswer;
