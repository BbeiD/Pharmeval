// ===================== CONTROLEUR "MES COMPETENCES" (Sprint 19) =====================
// Aucune logique metier ici : appelle js/services/competency-progress-
// service.js et affiche le resultat. "Ne pas recalculer directement les
// résultats" (SPRINT19, "Radar de compétences") : ce fichier ne lit QUE
// des documents de progression deja calcules, jamais evaluation_results
// ni evaluation_sessions.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { formatDateFr } from "./services/date-utils.js";
import { getMyCompetencyProgress, summarizeMasteryStatus } from "./services/competency-progress-service.js";
import {
  COMPETENCY_LEVEL_LABELS, COMPETENCY_LEVEL_NUMERIC_VALUE,
  PROGRESSION_TREND_LABELS,
} from "./services/progression-policy-service.js";
import { getCompetencyById } from "./services/competency-catalog-service.js";
import { renderSiteHeader } from "./site-header.js";
import { renderMasteryDonutHtml } from "./mastery-donut-chart.js";
import { icon } from "./icons.js";

// AJOUT (bibliotheque d'icones, remplace les emojis) : associe une icone a
// chaque tendance de PROGRESSION_TREND_LABELS (progression-policy-service.js,
// desormais texte seul) - reste ICI, pas dans le service, qui est une
// politique metier pure sans dependance de rendu.
const TREND_ICONS = { improving: 'feedback-trend-up', declining: 'feedback-trend-down' };
function trendLabelHtml(trend) {
  const label = PROGRESSION_TREND_LABELS[trend] || trend;
  const iconKey = TREND_ICONS[trend];
  return (iconKey ? icon(iconKey, { size: 13 }) + ' ' : '') + escapeHtml(label);
}

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function qs(id) { return document.getElementById(id); }

let state = { items: [], selectedId: null };

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
  const result = await getMyCompetencyProgress();
  qs('mc-loading').style.display = 'none';
  qs('mc-view').style.display = 'block';
  renderSiteHeader('mes-competences');

  if (!result.authorized) {
    qs('mc-message').className = 'admin-message admin-message-denied';
    qs('mc-message').textContent = result.message;
    qs('mc-message').style.display = 'block';
    return;
  }
  if (result.error) {
    qs('mc-message').className = 'admin-message admin-message-error';
    qs('mc-message').textContent = result.message;
    qs('mc-message').style.display = 'block';
  }
  if (result.items.length === 0) {
    qs('mc-empty').style.display = 'block';
    return;
  }

  // Resolution des noms de competences (une seule fois, en lot).
  const names = await Promise.all(result.items.map(function(p) { return getCompetencyById(p.competencyId); }));
  state.items = result.items.map(function(p, i) {
    return Object.assign({}, p, { competencyName: (names[i] && names[i].name) || 'Compétence' });
  });
  // Les plus recemment evaluees en premier (deja trie ainsi par le
  // service, conserve tel quel).

  qs('mc-content').style.display = 'block';
  qs('mc-mastery-donut').innerHTML = renderMasteryDonutHtml(summarizeMasteryStatus(result.items));
  renderRadar();
  renderList();

  const preselect = new URLSearchParams(window.location.search).get('competencyId');
  const initial = preselect && state.items.find(function(p) { return p.competencyId === preselect; });
  if (initial) selectCompetency(initial.competencyId);
}

// ---------------------------------------------------------------------------
// Radar de compétences (SPRINT19, "Radar de compétences")
// ---------------------------------------------------------------------------

function renderRadar() {
  // "les compétences principales" : les 8 plus evaluees, pour rester
  // lisible - jamais plus, un radar a trop d'axes devient illisible.
  const main = state.items.slice().sort(function(a, b) { return b.evaluationCount - a.evaluationCount; }).slice(0, 8);
  qs('mc-radar-chart').innerHTML = buildRadarChart(main);
  qs('mc-radar-legend').innerHTML = main.map(function(p, i) {
    return '<span class="mc-radar-legend-item"><strong>' + (i + 1) + '.</strong> ' + escapeHtml(p.competencyName) + ' — ' + escapeHtml(COMPETENCY_LEVEL_LABELS[p.currentLevel] || p.currentLevel) + '</span>';
  }).join('');
}

/**
 * Radar SVG minimal : un axe par competence, la distance au centre
 * reflete `COMPETENCY_LEVEL_NUMERIC_VALUE` (0-4) - jamais un pourcentage
 * brut (le niveau, deja calcule par la politique de progression, est la
 * mesure pertinente ici, pas une moyenne recalculee sur place).
 * @param {Array<object>} items
 * @returns {string} SVG
 */
function buildRadarChart(items) {
  const n = items.length;
  if (n < 3) {
    // Un radar a moins de 3 axes n'a pas de sens geometrique - repli en
    // liste simple plutot qu'une forme degenerée.
    return '<p class="bank-list-empty">Le radar apparaîtra dès que 3 compétences ou plus auront été évaluées (' + n + ' pour l\'instant).</p>';
  }
  const size = 220, center = size / 2, maxRadius = 85;
  const points = items.map(function(p, i) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const levelFraction = (COMPETENCY_LEVEL_NUMERIC_VALUE[p.currentLevel] + 1) / 5; // 0.2 -> 1.0, jamais un point totalement au centre
    const r = levelFraction * maxRadius;
    return { x: center + r * Math.cos(angle), y: center + r * Math.sin(angle), axisX: center + maxRadius * Math.cos(angle), axisY: center + maxRadius * Math.sin(angle) };
  });
  const polygon = points.map(function(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  const axes = points.map(function(p) {
    return '<line x1="' + center + '" y1="' + center + '" x2="' + p.axisX.toFixed(1) + '" y2="' + p.axisY.toFixed(1) + '" stroke="var(--border)" stroke-width="1"></line>';
  }).join('');
  const labels = items.map(function(p, i) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const lx = center + (maxRadius + 16) * Math.cos(angle);
    const ly = center + (maxRadius + 16) * Math.sin(angle);
    return '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" font-size="11" fill="var(--text2)">' + (i + 1) + '</text>';
  }).join('');
  return (
    '<svg viewBox="0 0 ' + size + ' ' + size + '" width="240" height="240" role="img" aria-label="Radar des compétences principales">' +
      axes +
      '<polygon points="' + polygon + '" fill="rgba(29,158,117,.25)" stroke="#1D9E75" stroke-width="2"></polygon>' +
      labels +
    '</svg>'
  );
}

// ---------------------------------------------------------------------------
// Liste des compétences
// ---------------------------------------------------------------------------

function renderList() {
  qs('mc-list').innerHTML = state.items.map(function(p) {
    const selected = p.competencyId === state.selectedId ? ' bank-row-selected' : '';
    return (
      '<div class="bank-row' + selected + '" onclick="selectCompetency(\'' + escapeHtml(p.competencyId) + '\')">' +
        '<div class="bank-row-top">' +
          '<span class="bank-row-id">' + escapeHtml(p.competencyName) + '</span>' +
          '<span class="bank-badge bank-badge-published">' + escapeHtml(COMPETENCY_LEVEL_LABELS[p.currentLevel] || p.currentLevel) + '</span>' +
        '</div>' +
        '<div class="bank-row-question">Meilleure : ' + p.bestPercent + ' % · Dernière : ' + p.lastPercent + ' % · ' + trendLabelHtml(p.trend) + '</div>' +
        '<div class="bank-row-meta">' + p.evaluationCount + ' évaluation(s)</div>' +
      '</div>'
    );
  }).join('');
}

export function selectCompetency(competencyId) {
  state.selectedId = competencyId;
  renderList();
  const p = state.items.find(function(i) { return i.competencyId === competencyId; });
  if (!p) return;

  qs('mc-detail-placeholder').style.display = 'none';
  const detailEl = qs('mc-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = detailHtml(p);
}

function detailHtml(p) {
  let html = '<div class="bank-detail-card">';
  html += '<div class="bank-detail-header"><h3>' + escapeHtml(p.competencyName) + '</h3><span class="bank-badge bank-badge-published">' + escapeHtml(COMPETENCY_LEVEL_LABELS[p.currentLevel] || p.currentLevel) + '</span></div>';

  html += '<div class="bank-detail-section"><h4>Chiffres clés</h4>';
  html += '<div class="bank-detail-row"><strong>Meilleure performance :</strong> ' + p.bestPercent + ' %</div>';
  html += '<div class="bank-detail-row"><strong>Dernière performance :</strong> ' + p.lastPercent + ' %</div>';
  html += '<div class="bank-detail-row"><strong>Moyenne :</strong> ' + p.averagePercent + ' %</div>';
  html += '<div class="bank-detail-row"><strong>Tendance :</strong> ' + trendLabelHtml(p.trend) + '</div>';
  html += '<div class="bank-detail-row"><strong>Nombre d\'évaluations :</strong> ' + p.evaluationCount + '</div>';
  html += '<div class="bank-detail-row"><strong>Score de confiance :</strong> ' + p.confidenceScore + ' / 100 <span class="admin-users-disclaimer" style="display:inline;">(reflète le nombre, la régularité et la récence de vos évaluations — pas seulement votre score)</span></div>';
  html += '<div class="bank-detail-row"><strong>Première évaluation :</strong> ' + escapeHtml(p.firstEvaluationAt ? formatDateFr(p.firstEvaluationAt) : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Dernière évaluation :</strong> ' + escapeHtml(p.lastEvaluationAt ? formatDateFr(p.lastEvaluationAt) : '—') + '</div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Évolution</h4>' + buildEvolutionChart(p.history) + '</div>';

  html += '<div class="bank-detail-section"><h4>Historique</h4><ul class="bank-timeline-list">' + p.history.slice().reverse().map(function(h) {
    return '<li class="bank-timeline-item"><div class="bank-timeline-date">' + escapeHtml(formatDateFr(h.date)) + '</div><div class="bank-timeline-label">' + h.percent + ' %</div></li>';
  }).join('') + '</ul></div>';

  html += '</div>';
  return html;
}

/**
 * Graphique d'évolution simple (SPRINT19, "graphique simple d'évolution") :
 * une ligne brisée SVG reliant les pourcentages successifs, dans l'ordre
 * chronologique - jamais un recalcul, uniquement l'historique déjà
 * enregistré.
 * @param {Array<{date:string, percent:number}>} history
 * @returns {string} SVG
 */
function buildEvolutionChart(history) {
  if (history.length < 2) {
    return '<p class="bank-list-empty">L\'évolution apparaîtra dès la deuxième évaluation.</p>';
  }
  const width = 320, height = 120, padding = 20;
  const points = history.map(function(h, i) {
    const x = padding + (i / (history.length - 1)) * (width - 2 * padding);
    const y = height - padding - (h.percent / 100) * (height - 2 * padding);
    return { x: x, y: y, percent: h.percent };
  });
  const polyline = points.map(function(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  const dots = points.map(function(p) {
    return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.5" fill="#1D9E75"><title>' + p.percent + ' %</title></circle>';
  }).join('');
  return (
    '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="120" role="img" aria-label="Évolution des performances dans le temps" preserveAspectRatio="xMidYMid meet">' +
      '<line x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '" stroke="var(--border)"></line>' +
      '<polyline points="' + polyline + '" fill="none" stroke="#1D9E75" stroke-width="2"></polyline>' +
      dots +
    '</svg>'
  );
}

window.selectCompetency = selectCompetency;
