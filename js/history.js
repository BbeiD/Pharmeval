// ===================== CENTRE DE PROGRESSION — "MES EVALUATIONS" =====================
// Logique d'affichage uniquement. Toute lecture de donnees passe par
// js/services/history-service.js (aucun appel Firestore direct ici).
//
// Decision d'architecture (demandee explicitement pour ce sprint) : les
// cartes et le detail affichent uniquement des donnees deja enregistrees,
// sans aucun calcul (moyenne, progression, tendance...). Le futur
// js/services/statistics-service.js (Sprint 6) fera ces calculs a partir des
// memes donnees, sans que ce fichier n'ait besoin d'etre modifie.

import { getEvaluationsPage, getEvaluationsForStatistics, findQuestionByQuestionId, getCorrectAnswerLabel } from "./services/history-service.js";
import { formatDateFr } from "./services/date-utils.js";
import { getScoreClass } from "./services/score-utils.js";
import { renderStatisticsFromData, renderError as renderStatisticsError, renderLoading as renderStatisticsLoading } from "./statistics.js";
import { renderRecommendationsFromData, renderRecommendationsError, renderRecommendationsLoading } from "./recommendation.js";

const PAGE_SIZE = 20;

const SPACE_LABELS = { student: 'Étudiant', pharmacist: 'Pharmacien' };

let state = {
  allLoaded: [],   // evaluations chargees jusqu'ici, toutes pages confondues
  cursor: null,
  hasMore: false,
  spaceFilter: 'all',
  searchText: '',
  loading: false,
};

// ---------------------------------------------------------------------------
// Ouverture / fermeture de la vue
// ---------------------------------------------------------------------------

/**
 * Ouvre le centre de progression. Accessible a tout utilisateur connecte
 * (aucune restriction de role, contrairement a la zone d'administration).
 */
export function openHistoryView() {
  ['home-view', 'quiz-view', 'results-view', 'admin-view'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  var historyEl = document.getElementById('history-view');
  if (historyEl) historyEl.style.display = 'block';

  showHistoryList();

  // Recharge toujours des donnees fraiches a l'ouverture (plutot que de
  // reafficher un etat mis en cache) : une nouvelle evaluation a pu etre
  // terminee depuis la derniere consultation de cet ecran durant la session.
  loadFirstPage();

  // Sprint 7 : une SEULE lecture Firestore (getEvaluationsForStatistics,
  // deja plafonnee a 100 evaluations depuis le Sprint 6) alimente a la fois
  // l'Analyse de progression ET les recommandations, conformement au
  // principe "ne jamais relire plusieurs fois les memes evaluations" et a la
  // chaine Firestore -> history-service -> statistics-service ->
  // recommendation-service demandee pour ce sprint. Cette lecture est
  // totalement independante de celle de la liste ci-dessus : une erreur ici
  // n'affecte jamais l'affichage de la liste, et inversement.
  loadStatisticsAndRecommendations();
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

export function closeHistoryView() {
  var historyEl = document.getElementById('history-view');
  if (historyEl) historyEl.style.display = 'none';
  var homeEl = document.getElementById('home-view');
  if (homeEl) homeEl.style.display = 'block';
}

/** Depuis l'etat vide : ferme l'historique et retourne directement a l'accueil pour lancer un quiz. */
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

/** Charge la page suivante (20 evaluations supplementaires) sans tout recharger. */
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
  // Message convivial uniquement : jamais de code d'erreur Firebase brut.
  const grid = document.getElementById('history-cards-grid');
  if (grid) grid.innerHTML = '<div class="history-error">Impossible de charger votre historique pour le moment. Veuillez réessayer plus tard.</div>';
  const loadMoreBtn = document.getElementById('history-load-more');
  if (loadMoreBtn) loadMoreBtn.style.display = 'none';
  const emptyState = document.getElementById('history-empty-state');
  if (emptyState) emptyState.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Recherche et filtres (cote client, sur les pages deja chargees - voir
// RAPPORT_SPRINT5.md pour la limite assumee sur de tres grands historiques)
// ---------------------------------------------------------------------------

/**
 * Architecture volontairement extensible : chaque nouveau filtre (periode,
 * difficulte, theme - annonces comme prevus par la demande) n'a qu'a ajouter
 * une condition ici, sans toucher au reste du fichier.
 */
function matchesFilters(ev) {
  if (state.spaceFilter !== 'all' && ev.space !== state.spaceFilter) return false;
  if (state.searchText) {
    const haystack = [
      SPACE_LABELS[ev.space] || ev.space || '',
      (ev.selection && ev.selection.theme) || '',
      formatDateFr(ev.completedAt),
    ].join(' ').toLowerCase();
    if (haystack.indexOf(state.searchText.toLowerCase()) === -1) return false;
  }
  return true;
}

export function setHistorySpaceFilter(space) {
  state.spaceFilter = space;
  document.querySelectorAll('.history-filter-btn').forEach(function(btn) {
    const isActive = btn.getAttribute('data-space') === space;
    if (isActive) btn.classList.add('active'); else btn.classList.remove('active');
  });
  renderCards();
}

export function onHistorySearchInput() {
  const input = document.getElementById('history-search');
  state.searchText = input ? input.value : '';
  renderCards();
}

// ---------------------------------------------------------------------------
// Rendu de la liste (cartes)
// ---------------------------------------------------------------------------

// La conversion/format de date est desormais centralisee dans
// js/services/date-utils.js (formatDateFr), pour ne jamais dupliquer cette
// logique entre l'historique et l'analyse de progression (Sprint 6).

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

// Les cartes n'effectuent AUCUN calcul : uniquement l'affichage brut des
// champs deja presents dans le document d'evaluation (voir buildEvaluationObject
// dans evaluation-service.js).
function cardHtml(ev) {
  const spaceLabel = SPACE_LABELS[ev.space] || ev.space || '';
  const pct = (ev.score && typeof ev.score.percentage === 'number') ? ev.score.percentage : 0;
  const correct = ev.score ? ev.score.correctAnswers : 0;
  const total = ev.score ? ev.score.totalQuestions : 0;
  const scoreClass = getScoreClass(pct);
  return (
    '<div class="history-card">' +
      '<div class="history-card-date">' + escapeHtml(formatDateFr(ev.completedAt)) + '</div>' +
      '<div class="history-card-space">' + escapeHtml(spaceLabel) + '</div>' +
      '<div class="history-card-pct ' + escapeHtml(scoreClass) + '">' + pct + ' %</div>' +
      '<div class="history-card-frac">' + correct + ' / ' + total + '</div>' +
      '<button class="btn-secondary history-card-detail-btn" onclick="openHistoryDetail(\'' + escapeHtml(ev.id) + '\')">Voir le détail</button>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Detail d'une evaluation
// ---------------------------------------------------------------------------

/**
 * Affiche le detail d'une evaluation deja chargee (aucune nouvelle lecture
 * Firestore : les donnees de la carte suffisent). C'est ICI, et seulement
 * ici, que la banque de questions locale est parcourue pour retrouver
 * l'enonce et la bonne reponse de chaque question - jamais pour la liste.
 */
export function openHistoryDetail(evaluationId) {
  const ev = state.allLoaded.find(function(e) { return e.id === evaluationId; });
  if (!ev) return;

  const listEl = document.getElementById('history-list-section');
  const detailEl = document.getElementById('history-detail-section');
  if (listEl) listEl.style.display = 'none';
  if (detailEl) detailEl.style.display = 'block';

  const body = document.getElementById('history-detail-body');
  if (!body) return;

  const spaceLabel = SPACE_LABELS[ev.space] || ev.space || '';
  const pct = (ev.score && typeof ev.score.percentage === 'number') ? ev.score.percentage : 0;
  const correct = ev.score ? ev.score.correctAnswers : 0;
  const total = ev.score ? ev.score.totalQuestions : 0;
  const difficulty = (ev.selection && ev.selection.difficulty) || 'all';
  const theme = (ev.selection && ev.selection.theme) || '';
  const scoreClass = getScoreClass(pct);

  let html = '';
  html += '<div class="history-detail-summary">';
  html += '<div class="history-detail-date">' + escapeHtml(formatDateFr(ev.completedAt)) + '</div>';
  html += '<div class="history-detail-space">' + escapeHtml(spaceLabel) + '</div>';
  html += '<div class="history-detail-pct ' + escapeHtml(scoreClass) + '">' + pct + ' %</div>';
  html += '<div class="history-detail-frac">' + correct + ' / ' + total + ' bonnes réponses</div>';
  html += '</div>';
  html += '<div class="history-detail-params">';
  html += '<span><strong>Thème :</strong> ' + escapeHtml(theme || 'Non renseigné') + '</span>';
  html += '<span><strong>Difficulté :</strong> ' + escapeHtml(difficulty) + '</span>';
  html += '</div>';

  html += '<div class="history-detail-questions">';
  (ev.questions || []).forEach(function(entry, i) {
    const q = findQuestionByQuestionId(entry.questionId);
    const enonce = q ? (q.q || q.question || q.situation || '(énoncé indisponible)') : '(question introuvable dans la banque actuelle)';
    const bonneReponse = q ? getCorrectAnswerLabel(q) : null;
    html += '<div class="history-question-row ' + (entry.correct ? 'is-correct' : 'is-incorrect') + '">';
    html += '<div class="history-question-num">Question ' + (i + 1) + '</div>';
    html += '<div class="history-question-text">' + escapeHtml(enonce) + '</div>';
    html += '<div class="history-question-answer"><strong>Réponse donnée :</strong> ' + escapeHtml(entry.answerGiven || '—') + '</div>';
    if (bonneReponse) {
      html += '<div class="history-question-correct"><strong>Bonne réponse :</strong> ' + escapeHtml(bonneReponse) + '</div>';
    }
    html += '<div class="history-question-result">' + (entry.correct ? '✓ Correct' : '✗ Incorrect') + '</div>';
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
window.setHistorySpaceFilter = setHistorySpaceFilter;
window.onHistorySearchInput = onHistorySearchInput;
window.loadMoreHistory = loadMoreHistory;
