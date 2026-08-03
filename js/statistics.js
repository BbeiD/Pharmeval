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
  getStrongThemes,
  getWeakThemes,
  hasReliableThemeData,
  STATISTICS_THRESHOLDS,
} from "./services/statistics-service.js";
import { getScoreLevel } from "./services/score-utils.js";
import { formatThemeLabel } from "./services/theme-utils.js";

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
 * Point d'entree autonome (fetch + rendu), conserve tel quel pour la
 * compatibilite et les tests existants. Depuis le Sprint 7, l'ouverture du
 * Centre de progression n'appelle plus cette fonction directement : elle
 * effectue desormais UNE lecture partagee (voir js/history.js) et appelle
 * `renderStatisticsFromData` ci-dessous pour a la fois l'analyse et les
 * recommandations, evitant une deuxieme lecture Firestore redondante.
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

  renderStatisticsFromData(result.items, result.truncated);
}

/**
 * Rendu pur a partir d'une liste d'evaluations deja chargee (aucun acces
 * Firestore ici). Utilisee par js/history.js depuis le Sprint 7 pour
 * partager une seule lecture entre l'analyse et les recommandations.
 *
 * @param {Array<object>} evaluations
 * @param {boolean} truncated
 */
export function renderStatisticsFromData(evaluations, truncated) {
  render(evaluations, truncated);
}

export function renderLoading() {
  const container = document.getElementById('statistics-body');
  if (container) container.innerHTML = '<div class="stats-loading">Chargement de votre analyse…</div>';
}

export function renderError() {
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
    container.innerHTML = '<div class="stats-empty">Réalisez une première évaluation et cette section prendra vie.</div>';
    return;
  }

  const overview = calculateOverview(evaluations);
  const trend = calculateProgressTrend(evaluations);
  const strongThemes = getStrongThemes(evaluations);
  const weakThemes = getWeakThemes(evaluations);
  const themeDataReliable = hasReliableThemeData(evaluations);

  let html = '';

  if (truncated) {
    html += '<div class="stats-disclaimer">Analyse basée sur vos ' + evaluations.length + ' dernières évaluations.</div>';
  }

  html += overviewSectionHtml(overview);
  html += trendHtml(trend);
  html += themesHtml(strongThemes, weakThemes, themeDataReliable);

  container.innerHTML = html;
  wireInfoBtns(container);
}

// ---------------------------------------------------------------------------
// Boutons info
// ---------------------------------------------------------------------------

function infoBtnHtml(targetId) {
  return '<button class="stats-info-btn" aria-label="En savoir plus" aria-expanded="false" data-info-target="' + targetId + '">i</button>';
}

function infoPanelHtml(id, content) {
  return '<div class="stats-info-panel" id="' + id + '" hidden>' + content + '</div>';
}

function sectionHeaderHtml(title, targetId) {
  return '<div class="stats-section-header"><span class="stats-section-title">' + escapeHtml(title) + '</span>' + infoBtnHtml(targetId) + '</div>';
}

function wireInfoBtns(container) {
  container.querySelectorAll('.stats-info-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var targetId = btn.getAttribute('data-info-target');
      var panel = container.querySelector('#' + targetId);
      if (!panel) return;
      var isHidden = panel.hasAttribute('hidden');
      if (isHidden) {
        panel.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
      } else {
        panel.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Indicateurs generaux
// ---------------------------------------------------------------------------

function overviewSectionHtml(overview) {
  const avgLevel = getScoreLevel(overview.averageScore);
  const bestLevel = getScoreLevel(overview.bestScore);
  const lastLevel = getScoreLevel(overview.lastScore);

  const info = 'Le score moyen et le meilleur score sont calculés sur l\'ensemble de vos évaluations terminées. Le dernier score correspond à votre évaluation la plus récente.';

  return (
    sectionHeaderHtml('Vue d\'ensemble', 'info-overview') +
    infoPanelHtml('info-overview', info) +
    '<div class="stats-overview-grid">' +
      statCard(String(overview.count), overview.count > 1 ? 'évaluations' : 'évaluation', 'stat-neutral') +
      statCard(pctLabel(overview.averageScore), 'Score moyen', avgLevel.className) +
      statCard(pctLabel(overview.bestScore), 'Meilleur score', bestLevel.className) +
      statCard(pctLabel(overview.lastScore), 'Dernier score', lastLevel.className) +
    '</div>'
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

  const info = 'Compare la moyenne de vos 5 dernières évaluations à la moyenne des 5 évaluations précédentes. Une variation inférieure à 2 points est considérée comme stable. Disponible à partir de 10 évaluations.';

  return (
    '<div class="stats-trend ' + trendClass + '">' +
      sectionHeaderHtml('Progression', 'info-trend') +
      infoPanelHtml('info-trend', info) +
      '<div class="stats-trend-message">' + escapeHtml(message) + '</div>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Themes forts / a retravailler
// ---------------------------------------------------------------------------

function themesHtml(strongThemes, weakThemes, themeDataReliable) {
  let html = '<div class="stats-themes">';

  // Correction : une comparaison forts/a-retravailler n'est fiable que s'il
  // existe au moins un theme distinct de chaque cote, ET que le meilleur et
  // le moins bon theme ne sont pas le meme (ce qui se produirait avec un
  // seul theme eligible, ou par chevauchement des deux classements sur un
  // trop petit nombre de themes distincts). Sans cette verification, un
  // meme theme pouvait apparaitre a la fois comme "fort" et "a
  // retravailler" avec peu de donnees - une analyse trompeuse.
  const strongNames = strongThemes.map(function(t) { return t.theme; });
  const weakNames = weakThemes.map(function(t) { return t.theme; });
  const overlap = strongNames.some(function(name) { return weakNames.indexOf(name) !== -1; });
  const comparisonReliable = themeDataReliable && strongThemes.length > 0 && weakThemes.length > 0 && !overlap;

  const themeInfo = 'Basé sur au moins 2 évaluations par thème. Les thèmes forts ont votre meilleure moyenne ; les thèmes à retravailler ont la plus basse. Un même thème ne peut pas figurer dans les deux colonnes.';

  if (!comparisonReliable) {
    html += sectionHeaderHtml('Thèmes', 'info-themes');
    html += infoPanelHtml('info-themes', themeInfo);
    html += '<div class="stats-themes-insufficient">Pas encore assez de données pour identifier vos points forts et vos axes d\u2019amélioration.</div>';
    html += '</div>';
    return html;
  }

  html += sectionHeaderHtml('Thèmes', 'info-themes');
  html += infoPanelHtml('info-themes', themeInfo);
  html += '<div class="stats-themes-columns">';

  html += '<div class="stats-theme-column">';
  html += '<div class="stats-section-title">Thèmes forts</div>';
  html += strongThemes.map(themeRowHtml).join('');
  html += '</div>';

  html += '<div class="stats-theme-column">';
  html += '<div class="stats-section-title">À retravailler</div>';
  html += weakThemes.map(themeRowHtml).join('');
  html += '</div>';

  html += '</div></div>';
  return html;
}

function themeRowHtml(t) {
  const level = getScoreLevel(t.averageScore);
  return (
    '<div class="stats-theme-row">' +
      '<div class="stats-theme-name">' + escapeHtml(formatThemeLabel(t.theme)) + '</div>' +
      '<div class="stats-theme-bar-wrap"><div class="stats-theme-bar ' + escapeHtml(level.className) + '" style="width:' + Math.max(0, Math.min(100, t.averageScore)) + '%;"></div></div>' +
      '<div class="stats-theme-pct ' + escapeHtml(level.className) + '">' + pctLabel(t.averageScore) + '</div>' +
    '</div>'
  );
}
