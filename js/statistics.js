// ===================== ANALYSE DE PROGRESSION (INTERFACE) =====================
// Rendu uniquement. Aucun calcul metier important ici (conformement a la
// demande) : toute la logique de calcul vit dans
// js/services/statistics-service.js, ce fichier ne fait qu'appeler ces
// fonctions et afficher le resultat.
//
// Chaine de responsabilite (respectee telle que demandee) :
//   Firestore -> history-service.js -> statistics-service.js -> statistics.js -> affichage

import { getEvaluationsForStatistics } from "./services/history-service.js";
import {
  calculateOverview,
  calculateProgressTrend,
  calculatePerformanceBySpace,
  getStrongThemes,
  getWeakThemes,
  hasReliableThemeData,
  STATISTICS_THRESHOLDS,
} from "./services/statistics-service.js";
import { getScoreLevel } from "./services/score-utils.js";

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Formate un pourcentage pour l'affichage, sans jamais produire "NaN %" ni "undefined". */
function pctLabel(value) {
  return (typeof value === 'number' && !isNaN(value)) ? (Math.round(value) + ' %') : '—';
}

/**
 * Point d'entree, appele par js/history.js a l'ouverture du Centre de
 * progression. Effectue UNE seule lecture Firestore (voir
 * getEvaluationsForStatistics) qui alimente tous les indicateurs.
 */
export async function loadAndRenderStatistics() {
  const container = document.getElementById('statistics-section');
  if (!container) return;
  renderLoading();

  const result = await getEvaluationsForStatistics();

  if (result.error) {
    renderError();
    return;
  }

  render(result.items, result.truncated);
}

function renderLoading() {
  const container = document.getElementById('statistics-body');
  if (container) container.innerHTML = '<div class="stats-loading">Chargement de votre analyse…</div>';
}

function renderError() {
  // Message convivial uniquement : jamais de detail Firebase brut. Ne
  // bloque jamais la liste de l'historique, qui utilise une lecture et un
  // rendu totalement independants (voir js/history.js).
  const container = document.getElementById('statistics-body');
  if (container) {
    container.innerHTML = '<div class="stats-error">Impossible de charger votre analyse de progression pour le moment. Votre historique ci-dessous reste disponible.</div>';
  }
}

function render(evaluations, truncated) {
  const container = document.getElementById('statistics-body');
  if (!container) return;

  if (!evaluations || evaluations.length === 0) {
    container.innerHTML = '<div class="stats-empty">Réalisez une première évaluation pour commencer votre suivi.</div>';
    return;
  }

  const overview = calculateOverview(evaluations);
  const trend = calculateProgressTrend(evaluations);
  const bySpace = calculatePerformanceBySpace(evaluations);
  const strongThemes = getStrongThemes(evaluations);
  const weakThemes = getWeakThemes(evaluations);
  const themeDataReliable = hasReliableThemeData(evaluations);

  let html = '';

  if (truncated) {
    html += '<div class="stats-disclaimer">Analyse basée sur vos ' + evaluations.length + ' dernières évaluations.</div>';
  }

  html += '<div class="stats-overview-grid">' + overviewCardsHtml(overview) + '</div>';
  html += trendHtml(trend);
  html += performanceBySpaceHtml(bySpace);
  html += themesHtml(strongThemes, weakThemes, themeDataReliable);

  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Indicateurs generaux
// ---------------------------------------------------------------------------

function overviewCardsHtml(overview) {
  const avgLevel = getScoreLevel(overview.averageScore);
  const bestLevel = getScoreLevel(overview.bestScore);
  const lastLevel = getScoreLevel(overview.lastScore);

  return (
    statCard(String(overview.count), overview.count > 1 ? 'évaluations' : 'évaluation', 'stat-neutral') +
    statCard(pctLabel(overview.averageScore), 'Score moyen', avgLevel.className) +
    statCard(pctLabel(overview.bestScore), 'Meilleur score', bestLevel.className) +
    statCard(pctLabel(overview.lastScore), 'Dernier score', lastLevel.className)
  );
}

function statCard(value, label, scoreClass) {
  return (
    '<div class="stats-card">' +
      '<div class="stats-card-value ' + escapeHtml(scoreClass) + '">' + escapeHtml(value) + '</div>' +
      '<div class="stats-card-label">' + escapeHtml(label) + '</div>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Tendance recente
// ---------------------------------------------------------------------------

function trendHtml(trend) {
  let message;
  let trendClass = 'trend-neutral';

  if (trend.status === 'single') {
    message = 'Une première base est disponible. La tendance apparaîtra après plusieurs évaluations.';
  } else if (trend.status === 'insufficient') {
    message = 'Pas encore assez de données pour calculer une tendance.';
  } else if (trend.status === 'stable') {
    message = 'Tendance stable';
  } else if (trend.status === 'up') {
    message = 'Progression récente : +' + Math.abs(trend.delta) + ' points';
    trendClass = 'trend-up';
  } else if (trend.status === 'down') {
    message = 'Baisse récente : -' + Math.abs(trend.delta) + ' points';
    trendClass = 'trend-down';
  } else {
    message = 'Pas encore assez de données pour calculer une tendance.';
  }

  return (
    '<div class="stats-trend ' + trendClass + '">' +
      '<div class="stats-section-title">Tendance</div>' +
      '<div class="stats-trend-message">' + escapeHtml(message) + '</div>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Performance par espace
// ---------------------------------------------------------------------------

function performanceBySpaceHtml(bySpace) {
  const keys = Object.keys(bySpace);
  if (keys.length === 0) return '';

  let html = '<div class="stats-by-space">';
  html += '<div class="stats-section-title">Par espace</div>';
  html += '<div class="stats-space-grid">';
  keys.forEach(function(key) {
    const entry = bySpace[key];
    const level = getScoreLevel(entry.averageScore);
    html += (
      '<div class="stats-space-card">' +
        '<div class="stats-space-name">' + escapeHtml(entry.label) + '</div>' +
        '<div class="stats-space-pct ' + escapeHtml(level.className) + '">' + pctLabel(entry.averageScore) + '</div>' +
        '<div class="stats-space-detail">' + entry.count + (entry.count > 1 ? ' évaluations' : ' évaluation') +
          ' · meilleur ' + pctLabel(entry.bestScore) + '</div>' +
      '</div>'
    );
  });
  html += '</div></div>';
  return html;
}

// ---------------------------------------------------------------------------
// Themes forts / a retravailler
// ---------------------------------------------------------------------------

function themesHtml(strongThemes, weakThemes, themeDataReliable) {
  let html = '<div class="stats-themes">';

  if (!themeDataReliable) {
    html += '<div class="stats-section-title">Thèmes</div>';
    html += '<div class="stats-themes-insufficient">Pas encore assez de données pour identifier vos thèmes forts et vos thèmes à retravailler.</div>';
    html += '</div>';
    return html;
  }

  html += '<div class="stats-themes-columns">';

  html += '<div class="stats-theme-column">';
  html += '<div class="stats-section-title">Thèmes forts</div>';
  html += strongThemes.length
    ? strongThemes.map(themeRowHtml).join('')
    : '<div class="stats-themes-none">Pas encore de thème suffisamment renseigné.</div>';
  html += '</div>';

  html += '<div class="stats-theme-column">';
  html += '<div class="stats-section-title">À retravailler</div>';
  html += weakThemes.length
    ? weakThemes.map(themeRowHtml).join('')
    : '<div class="stats-themes-none">Pas encore de thème suffisamment renseigné.</div>';
  html += '</div>';

  html += '</div></div>';
  return html;
}

function themeRowHtml(t) {
  const level = getScoreLevel(t.averageScore);
  return (
    '<div class="stats-theme-row">' +
      '<div class="stats-theme-name">' + escapeHtml(t.theme) + '</div>' +
      '<div class="stats-theme-bar-wrap"><div class="stats-theme-bar ' + escapeHtml(level.className) + '" style="width:' + Math.max(0, Math.min(100, t.averageScore)) + '%;"></div></div>' +
      '<div class="stats-theme-pct ' + escapeHtml(level.className) + '">' + pctLabel(t.averageScore) + '</div>' +
    '</div>'
  );
}
