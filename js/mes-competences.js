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
import { getMyCompetencyProgressFromQuestions, summarizeMasteryStatus } from "./services/competency-progress-service.js";
import { COMPETENCY_LEVEL_LABELS, COMPETENCY_LEVEL_NUMERIC_VALUE } from "./services/progression-policy-service.js";
import { getCompetencyById } from "./services/competency-catalog-service.js";
import { getExistingQuestionsByPedagogicalIds } from "./services/question-catalog-service.js";
import { renderSiteHeader } from "./site-header.js";
import { renderMasteryDonutHtml } from "./mastery-donut-chart.js";
import { icon, renderAnyIcon } from "./icons.js";

// CORRECTIF (demande directe de David, 23/07/2026, "des petits cadres plus
// adaptés") : tuile a icone (meme composant que admin/document-sources.js,
// .source-tile) plutot que la liste bank-row - une pastille de couleur
// (coin superieur droit, meme pattern que source-tile-status-dot) indique
// le masteryStatus deja calcule, jamais une nouvelle echelle de couleur.
const MASTERY_STATUS_DOT = { mastered: 'dot-green', to_reinforce: 'dot-orange', not_acquired: 'dot-red' };
const COMPETENCY_TILE_ICON = 'content-skills';

// CORRECTIF (demande directe de David, 23/07/2026) : plus de "tendance"
// (voir getMyCompetencyProgressFromQuestions(), competency-progress-
// service.js - aucun historique de score dans le temps n'existe plus par
// competence). Statut par QUESTION (mastered/in_progress/to_work, meme
// echelle que question-progress-logic.js#summarizeQuestionMastery) a la
// place - badge et libelle associes.
const QUESTION_STATUS_BADGE = {
  mastered: { cls: 'bank-badge-published', label: 'Maîtrisée', icon: 'feedback-correct' },
  in_progress: { cls: 'bank-badge-draft', label: 'En cours', icon: 'feedback-incorrect' },
  to_work: { cls: 'bank-badge-archived', label: 'À travailler', icon: 'action-warning' },
};
function questionStatusOf(q) {
  if ((q.timesCorrect || 0) === 0) return 'to_work';
  return q.lastStatus === 'correct' ? 'mastered' : 'in_progress';
}

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function qs(id) { return document.getElementById(id); }

let state = { items: [], selectedId: null, questionTextCache: new Map() };

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
  const result = await getMyCompetencyProgressFromQuestions();
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
  qs('mc-list').innerHTML = state.items.map(competencyTileHtml).join('');
}

function competencyTileHtml(p) {
  const selectedCls = p.competencyId === state.selectedId ? ' source-tile-selected' : '';
  const dotKey = MASTERY_STATUS_DOT[p.masteryStatus] || 'dot-white-grey';
  const levelLabel = COMPETENCY_LEVEL_LABELS[p.currentLevel] || p.currentLevel;
  const title = levelLabel + ' · ' + p.masteredPercent + ' % maîtrisé (' + p.masteredCount + '/' + p.evaluationCount + ' questions)';
  return (
    '<button type="button" class="source-tile' + selectedCls + '" onclick="selectCompetency(\'' + escapeHtml(p.competencyId) + '\')" title="' + escapeHtml(title) + '">' +
      '<span class="source-tile-status-dot" aria-hidden="true">' + renderAnyIcon(dotKey, { size: 12 }) + '</span>' +
      '<span class="source-tile-emoji" aria-hidden="true">' + icon(COMPETENCY_TILE_ICON, { size: 24 }) + '</span>' +
      '<span class="source-tile-name">' + escapeHtml(p.competencyName) + '</span>' +
    '</button>'
  );
}

export async function selectCompetency(competencyId) {
  state.selectedId = competencyId;
  renderList();
  const p = state.items.find(function(i) { return i.competencyId === competencyId; });
  if (!p) return;

  qs('mc-detail-placeholder').style.display = 'none';
  const detailEl = qs('mc-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = '<p class="bank-list-loading">Chargement…</p>';

  // Resolution du texte des questions de CETTE competence uniquement, a la
  // demande (jamais pour toutes les competences a l'ouverture de la page) -
  // mise en cache pour eviter une relecture si l'utilisateur revient sur
  // la meme competence.
  const missingIds = p.questions.map(function(q) { return q.pedagogicalId; })
    .filter(function(id) { return !state.questionTextCache.has(id); });
  if (missingIds.length > 0) {
    const result = await getExistingQuestionsByPedagogicalIds(missingIds);
    if (!result.error) {
      result.map.forEach(function(q, id) { state.questionTextCache.set(id, q); });
    }
  }

  // L'utilisateur a pu selectionner une autre competence pendant la
  // lecture reseau - jamais afficher le detail de la mauvaise competence.
  if (state.selectedId !== competencyId) return;
  detailEl.innerHTML = detailHtml(p);
}

function detailHtml(p) {
  let html = '<div class="bank-detail-card">';
  // CORRECTIF (demande directe de David, 23/07/2026) : .bank-detail-header
  // h3 est en police monospace dans le reste de l'appli (pensee pour des
  // codes/identifiants) - un nom de competence est du texte normal, jamais
  // un code, d'ou le retour explicite a la police standard ici.
  html += '<div class="bank-detail-header"><h3 style="font-family:inherit;">' + escapeHtml(p.competencyName) + '</h3><span class="bank-badge bank-badge-published">' + escapeHtml(COMPETENCY_LEVEL_LABELS[p.currentLevel] || p.currentLevel) + '</span></div>';

  html += '<div class="bank-detail-section"><h4>Chiffres clés</h4>';
  html += '<div class="bank-detail-row"><strong>Maîtrisées :</strong> ' + p.masteredCount + ' / ' + p.evaluationCount + ' (' + p.masteredPercent + ' %)</div>';
  html += '<div class="bank-detail-row"><strong>En cours :</strong> ' + p.inProgressCount + '</div>';
  html += '<div class="bank-detail-row"><strong>À travailler :</strong> ' + p.toWorkCount + '</div>';
  html += '<div class="bank-detail-row"><strong>Score de confiance :</strong> ' + p.confidenceScore + ' / 100 <span class="admin-users-disclaimer" style="display:inline;">(reflète le nombre, la régularité et la récence de vos réponses — pas seulement votre score)</span></div>';
  html += '<div class="bank-detail-row"><strong>Dernière activité :</strong> ' + escapeHtml(p.lastEvaluationAt ? formatDateFr(p.lastEvaluationAt) : '—') + '</div>';
  html += '</div>';

  // CORRECTIF (demande directe de David, 23/07/2026) : plus de graphique
  // d'evolution ni d'historique de pourcentage - cette donnee n'existe
  // plus par competence (voir getMyCompetencyProgressFromQuestions()).
  // Remplace par le detail REELLEMENT disponible : l'etat present de
  // chaque question deja rencontree dans cette competence.
  html += '<div class="bank-detail-section"><h4>Détail par question (' + p.questions.length + ')</h4>';
  html += '<ul class="bank-timeline-list">' + p.questions.map(function(q) {
    const status = questionStatusOf(q);
    const badge = QUESTION_STATUS_BADGE[status];
    const questionDoc = state.questionTextCache.get(q.pedagogicalId);
    const label = (questionDoc && questionDoc.question) ? questionDoc.question : q.pedagogicalId;
    return '<li class="bank-timeline-item">' +
      '<div class="bank-timeline-label">' + icon(badge.icon, { size: 13 }) + ' ' + escapeHtml(label) + '</div>' +
      '<div class="bank-timeline-date"><span class="bank-badge ' + badge.cls + '">' + escapeHtml(badge.label) + '</span> · vue ' + q.timesSeen + ' fois · dernière tentative le ' + escapeHtml(q.lastSeenAt ? formatDateFr(q.lastSeenAt) : '—') + '</div>' +
    '</li>';
  }).join('') + '</ul></div>';

  html += '</div>';
  return html;
}

window.selectCompetency = selectCompetency;
