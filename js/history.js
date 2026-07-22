// ===================== CENTRE DE PROGRESSION — "MES EVALUATIONS" =====================
// Logique d'affichage uniquement. Toute lecture de donnees passe par
// js/services/history-service.js (aucun appel Firestore direct ici).

import { getEvaluationsPage, getEvaluationsForStatistics } from "./services/history-service.js";
import { formatDateFr } from "./services/date-utils.js";
import { getScoreClass } from "./services/score-utils.js";
import { renderStatisticsFromData, renderError as renderStatisticsError, renderLoading as renderStatisticsLoading } from "./statistics.js";
import { renderRecommendationsFromData, renderRecommendationsError, renderRecommendationsLoading } from "./recommendation.js";
import { getCurrentUserContext } from "./services/app-context.js";
import { getParcoursCompletionForUser } from "./services/parcours-completion-service.js";
import { reconcileProgressForUser } from "./services/evaluation-result-service.js";
import {
  renderParcoursCompletionFromData, renderParcoursCompletionError, renderParcoursCompletionLoading,
} from "./mes-parcours-completion.js";
import { renderSiteHeader } from "./site-header.js";
import { icon } from "./icons.js";

const PAGE_SIZE = 20;

let state = {
  allLoaded: [],   // evaluations chargees jusqu'ici, toutes pages confondues
  cursor: null,
  hasMore: false,
  searchText: '',
  loading: false,
};

// ---------------------------------------------------------------------------
// Ouverture / fermeture de la vue
// ---------------------------------------------------------------------------

export function openHistoryView() {
  ['home-view', 'quiz-view', 'results-view', 'admin-view'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  var historyEl = document.getElementById('history-view');
  if (historyEl) historyEl.style.display = 'block';
  renderSiteHeader('mes-evaluations');

  showHistoryList();
  loadFirstPage();
  loadStatisticsAndRecommendations();
  loadParcoursCompletion();
}

async function loadStatisticsAndRecommendations() {
  renderStatisticsLoading();
  renderRecommendationsLoading();
  const result = await getEvaluationsForStatistics();
  if (result.error) {
    renderStatisticsError();
    renderRecommendationsError();
    return;
  }
  renderStatisticsFromData(result.items, result.truncated);
  renderRecommendationsFromData(result.items);
}

// AJOUT : "Mes parcours" - lecture Firestore INDEPENDANTE de tout le reste
// de cet ecran (meme principe que loadStatisticsAndRecommendations()
// ci-dessus) - une erreur ici ne bloque jamais la liste des evaluations,
// et inversement.
//
// CORRECTIF (bug du 22/07/2026) : rejoue d'abord la progression manquante
// (reconcileProgressForUser(), evaluation-result-service.js) - repare en
// silence les evaluations terminees AVANT le correctif de finalizeEvaluation()
// (ecriture de question_progress/competency_progress alors interrompue par
// la redirection immediate vers la page de resultat). Ne bloque jamais cet
// ecran en cas d'echec (.catch() local) - au pire, "Mes parcours" affiche
// simplement l'etat actuel sans avoir pu le reparer cette fois-ci.
async function loadParcoursCompletion() {
  renderParcoursCompletionLoading();
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) { renderParcoursCompletionError(); return; }
  await reconcileProgressForUser(ctx.uid).catch(function(err) {
    console.error('[history.js] réconciliation de la progression impossible', err);
  });
  const result = await getParcoursCompletionForUser(ctx.uid);
  if (result.error) { renderParcoursCompletionError(); return; }
  renderParcoursCompletionFromData(result.items);
}

export function closeHistoryView() {
  var historyEl = document.getElementById('history-view');
  if (historyEl) historyEl.style.display = 'none';
  var homeEl = document.getElementById('home-view');
  if (homeEl) homeEl.style.display = 'block';
  renderSiteHeader('accueil');
}

export function startEvaluationFromHistory() {
  closeHistoryView();
  if (typeof window.goHome === 'function') window.goHome();
}

function showHistoryList() {
  var listEl = document.getElementById('history-list-section');
  var detailEl = document.getElementById('history-detail-section');
  if (listEl) listEl.style.display = 'block';
  if (detailEl) detailEl.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Chargement / pagination
// ---------------------------------------------------------------------------

async function loadFirstPage() {
  state.allLoaded = [];
  state.cursor = null;
  state.hasMore = false;
  setLoading(true);
  const page = await getEvaluationsPage({ pageSize: PAGE_SIZE });
  setLoading(false);
  if (page.error) { showHistoryError(); return; }
  state.allLoaded = page.items;
  state.cursor = page.nextCursor;
  state.hasMore = page.hasMore;
  renderCards();
}

export async function loadMoreHistory() {
  if (!state.hasMore || state.loading) return;
  setLoading(true);
  const page = await getEvaluationsPage({ pageSize: PAGE_SIZE, cursor: state.cursor });
  setLoading(false);
  if (page.error) { showHistoryError(); return; }
  state.allLoaded = state.allLoaded.concat(page.items);
  state.cursor = page.nextCursor;
  state.hasMore = page.hasMore;
  renderCards();
}

function setLoading(isLoading) {
  state.loading = isLoading;
  const btn = document.getElementById('history-load-more');
  if (btn) btn.textContent = isLoading ? 'Chargement…' : 'Charger plus';
}

function showHistoryError() {
  const grid = document.getElementById('history-cards-grid');
  if (grid) grid.innerHTML = '<div class="history-error">Impossible de charger votre historique pour le moment. Veuillez réessayer plus tard.</div>';
  const loadMoreBtn = document.getElementById('history-load-more');
  if (loadMoreBtn) loadMoreBtn.style.display = 'none';
  const emptyState = document.getElementById('history-empty-state');
  if (emptyState) emptyState.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Recherche (cote client, sur les pages deja chargees)
// ---------------------------------------------------------------------------

function matchesFilters(ev) {
  if (state.searchText) {
    const haystack = formatDateFr(ev.completedAt).toLowerCase();
    if (haystack.indexOf(state.searchText.toLowerCase()) === -1) return false;
  }
  return true;
}

export function onHistorySearchInput() {
  const input = document.getElementById('history-search');
  state.searchText = input ? input.value : '';
  renderCards();
}

// ---------------------------------------------------------------------------
// Rendu de la liste (cartes)
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function renderCards() {
  const grid = document.getElementById('history-cards-grid');
  const emptyState = document.getElementById('history-empty-state');
  const loadMoreBtn = document.getElementById('history-load-more');
  if (!grid) return;

  if (state.allLoaded.length === 0) {
    grid.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  const filtered = state.allLoaded.filter(matchesFilters);

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="history-no-match">Aucune évaluation ne correspond à votre recherche.</div>';
  } else {
    grid.innerHTML = filtered.map(cardHtml).join('');
  }
  if (loadMoreBtn) loadMoreBtn.style.display = state.hasMore ? 'inline-flex' : 'none';
}

function cardHtml(ev) {
  const pct = (ev.score && typeof ev.score.percentage === 'number') ? ev.score.percentage : 0;
  const correct = ev.score ? (ev.score.correctAnswers || 0) : 0;
  const total = ev.score ? (ev.score.totalQuestions || 0) : 0;
  const scoreClass = getScoreClass(pct);
  return (
    '<div class="history-card">' +
      '<div class="history-card-date">' + escapeHtml(formatDateFr(ev.completedAt)) + '</div>' +
      '<div class="history-card-pct ' + escapeHtml(scoreClass) + '">' + pct + ' %</div>' +
      '<div class="history-card-frac">' + correct + ' / ' + total + '</div>' +
      '<button class="btn-secondary history-card-detail-btn" onclick="openHistoryDetail(\'' + escapeHtml(ev.id) + '\')">Voir le détail</button>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Detail d'une evaluation
// ---------------------------------------------------------------------------

export function openHistoryDetail(evaluationId) {
  const ev = state.allLoaded.find(function(e) { return e.id === evaluationId; });
  if (!ev) return;

  const listEl = document.getElementById('history-list-section');
  const detailEl = document.getElementById('history-detail-section');
  if (listEl) listEl.style.display = 'none';
  if (detailEl) detailEl.style.display = 'block';

  const body = document.getElementById('history-detail-body');
  if (!body) return;

  const pct = (ev.score && typeof ev.score.percentage === 'number') ? ev.score.percentage : 0;
  const correct = ev.score ? (ev.score.correctAnswers || 0) : 0;
  const total = ev.score ? (ev.score.totalQuestions || 0) : 0;
  const scoreClass = getScoreClass(pct);

  let html = '';
  html += '<div class="history-detail-summary">';
  html += '<div class="history-detail-date">' + escapeHtml(formatDateFr(ev.completedAt)) + '</div>';
  html += '<div class="history-detail-pct ' + escapeHtml(scoreClass) + '">' + pct + ' %</div>';
  html += '<div class="history-detail-frac">' + correct + ' / ' + total + ' bonnes réponses</div>';
  html += '</div>';

  html += '<div class="history-detail-questions">';
  (ev.questions || []).forEach(function(entry, i) {
    const bonneReponse = (entry.options && typeof entry.correctAnswer === 'number' && entry.options[entry.correctAnswer] !== undefined)
      ? String(entry.options[entry.correctAnswer])
      : null;
    html += '<div class="history-question-row ' + (entry.correct ? 'is-correct' : 'is-incorrect') + '">';
    html += '<div class="history-question-num">Question ' + (i + 1) + '</div>';
    html += '<div class="history-question-text">' + escapeHtml(entry.question || '(énoncé indisponible)') + '</div>';
    html += '<div class="history-question-answer"><strong>Réponse donnée :</strong> ' + escapeHtml(entry.answerGiven || '—') + '</div>';
    if (bonneReponse) {
      html += '<div class="history-question-correct"><strong>Bonne réponse :</strong> ' + escapeHtml(bonneReponse) + '</div>';
    }
    html += '<div class="history-question-result">' + (entry.correct ? icon('feedback-correct', { size: 14 }) + ' Correct' : icon('feedback-incorrect', { size: 14 }) + ' Incorrect') + '</div>';
    html += '</div>';
  });
  html += '</div>';

  body.innerHTML = html;
}

export function backToHistoryList() {
  showHistoryList();
}

// ---------------------------------------------------------------------------
// Pont vers le HTML classique (attributs onclick).
// ---------------------------------------------------------------------------
window.openHistoryView = openHistoryView;
window.closeHistoryView = closeHistoryView;
window.startEvaluationFromHistory = startEvaluationFromHistory;
window.openHistoryDetail = openHistoryDetail;
window.backToHistoryList = backToHistoryList;
window.onHistorySearchInput = onHistorySearchInput;
window.loadMoreHistory = loadMoreHistory;
