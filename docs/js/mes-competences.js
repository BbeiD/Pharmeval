// ===================== CONTROLEUR "MES COMPETENCES" (Sprint 19 + refonte référentiels) =====================
// Aucune logique metier ici : appelle js/services/competency-progress-
// service.js et affiche le resultat.
//
// REFONTE (31/07/2026) : sélecteur de thème/classification (même
// regroupement que l'Entraînement libre, via groupParcoursByClassification)
// pilote le radar et la grille de compétences. Une question est rattachée
// à un thème si son pedagogicalId figure dans les directQuestionIds d'au
// moins un Parcours de ce thème — même source de vérité que l'Entraînement
// libre, jamais un calcul parallèle.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { formatDateFr } from "./services/date-utils.js";
import { getMyCompetencyProgressFromQuestions, summarizeMasteryStatus } from "./services/competency-progress-service.js";
import { COMPETENCY_LEVEL_LABELS, COMPETENCY_LEVEL_NUMERIC_VALUE } from "./services/progression-policy-service.js";
import { getCompetencyById } from "./services/competency-catalog-service.js";
import { getExistingQuestionsByPedagogicalIds } from "./services/question-catalog-service.js";
import { getSelfServiceCatalogParcours } from "./services/parcours-service.js";
import { groupParcoursByClassification } from "./services/parcours-classification-logic.js";
import { resolveParcoursColorHex } from "./services/parcours-metadata-service.js";
import { renderSiteHeader } from "./site-header.js";
import { renderMasteryDonutHtml } from "./mastery-donut-chart.js";
import { icon, renderAnyIcon } from "./icons.js";

const MASTERY_STATUS_DOT = { mastered: 'dot-green', to_reinforce: 'dot-orange', not_acquired: 'dot-red' };
const COMPETENCY_TILE_ICON = 'content-skills';
const DEFAULT_CLASSIFICATION_COLOR = '#94A3B8';

const QUESTION_STATUS_BADGE = {
  mastered: { cls: 'bank-badge-published', label: 'Maîtrisée', icon: 'feedback-correct' },
  in_progress: { cls: 'bank-badge-draft', label: 'En cours', icon: 'feedback-incorrect' },
  to_work: { cls: 'bank-badge-archived', label: 'À travailler', icon: 'action-warning' },
};
const SESSION_TYPE_BADGE = {
  daily_challenge: { cls: 'bank-badge-published', label: 'Défi du jour' },
  parcours:        { cls: 'bank-badge-draft',     label: 'Parcours' },
  parcours_mixed:  { cls: 'bank-badge-draft',     label: 'Parcours' },
  free_training:   { cls: 'bank-badge-archived',  label: 'Entraînement libre' },
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

let state = {
  items: [],               // items compétence enrichis avec classificationName
  selectedId: null,        // compétence sélectionnée pour le détail
  selectedClassification: null,  // thème sélectionné
  classifications: [],     // [{name, color}] dans l'ordre d'affichage
  questionTextCache: new Map(),
};

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

  // Résolution des noms de compétences + chargement des parcours en parallèle.
  const allPedagogicalIds = [];
  result.items.forEach(function(p) {
    p.questions.forEach(function(q) { allPedagogicalIds.push(q.pedagogicalId); });
  });

  const [names, questionsResult, parcoursResult] = await Promise.all([
    Promise.all(result.items.map(function(p) { return getCompetencyById(p.competencyId); })),
    getExistingQuestionsByPedagogicalIds(allPedagogicalIds),
    getSelfServiceCatalogParcours(),
  ]);

  // Cache des textes de questions (pré-chargement complet).
  if (!questionsResult.error) {
    questionsResult.map.forEach(function(q, id) { state.questionTextCache.set(id, q); });
  }

  // Construction du mapping questionId → classification via les Parcours.
  // Même logique que l'Entraînement libre : une question appartient au thème
  // des Parcours dont elle fait partie (directQuestionIds).
  const parcoursItems = (parcoursResult && parcoursResult.items) || [];
  const classifications = groupParcoursByClassification(parcoursItems);
  const questionToClassification = new Map();
  classifications.forEach(function(c) {
    c.questionIds.forEach(function(id) {
      // Une question peut théoriquement apparaître dans plusieurs
      // classifications ; on retient la première rencontrée (ordre stable :
      // classifications triées par nb de questions décroissant).
      if (!questionToClassification.has(id)) questionToClassification.set(id, c.classification);
    });
  });

  // Affectation du thème majoritaire à chaque compétence.
  // "Majoritaire" = thème le plus fréquent parmi les questions de la
  // compétence. Si toutes les questions ont le même thème (cas habituel),
  // le résultat est déterministe et immédiat.
  state.items = result.items.map(function(p, i) {
    const counts = new Map();
    p.questions.forEach(function(q) {
      const cl = questionToClassification.get(q.pedagogicalId);
      if (cl) counts.set(cl, (counts.get(cl) || 0) + 1);
    });
    let bestClassification = null;
    let bestCount = 0;
    counts.forEach(function(count, cl) {
      if (count > bestCount) { bestCount = count; bestClassification = cl; }
    });
    return Object.assign({}, p, {
      competencyName: (names[i] && names[i].name) || 'Compétence',
      classificationName: bestClassification,
    });
  });

  // Toutes les classifications du catalogue (même ordre que l'Entraînement
  // libre : nb de questions décroissant). Les thèmes sans activité sont
  // affichés avec un état vide et des boutons vers les modes de pratique.
  state.classifications = classifications.map(function(c) {
    return { name: c.classification, color: resolveParcoursColorHex(c.color) || DEFAULT_CLASSIFICATION_COLOR };
  });

  qs('mc-content').style.display = 'block';

  // Donut global + sous-titre explicatif.
  const totalQuestions = state.items.reduce(function(s, i) { return s + i.evaluationCount; }, 0);
  qs('mc-donut-subtitle').textContent =
    'Parmi vos ' + totalQuestions + ' question' + (totalQuestions > 1 ? 's' : '') +
    ' déjà rencontrées dans vos évaluations.';
  qs('mc-mastery-donut').innerHTML = renderMasteryDonutHtml(summarizeMasteryStatus(result.items));

  renderSourceSelector();

  // Pré-sélection via URL (?competencyId=...).
  const preselect = new URLSearchParams(window.location.search).get('competencyId');
  if (preselect) {
    const initial = state.items.find(function(p) { return p.competencyId === preselect; });
    if (initial && initial.classificationName) {
      selectSource(initial.classificationName);
      selectCompetency(preselect);
    }
  }
}

// ---------------------------------------------------------------------------
// Sélecteur de thèmes (chips)
// ---------------------------------------------------------------------------

function renderSourceSelector() {
  const container = qs('mc-source-selector');
  if (!container) return;

  if (state.classifications.length === 0) {
    container.innerHTML = '<p class="bank-list-empty" style="margin:0;">Aucun thème identifié pour vos compétences.</p>';
    return;
  }

  container.innerHTML = state.classifications.map(function(c) {
    const active = c.name === state.selectedClassification;
    return (
      '<button type="button" class="mc-source-chip' + (active ? ' mc-source-chip-active' : '') + '" ' +
        (active ? 'style="background:' + escapeHtml(c.color) + ';border-color:' + escapeHtml(c.color) + ';"' : '') +
        ' onclick="selectSource(\'' + escapeHtml(c.name) + '\')">' +
        escapeHtml(c.name) +
      '</button>'
    );
  }).join('');
}

export function selectSource(classificationName) {
  state.selectedClassification = classificationName;
  state.selectedId = null;
  renderSourceSelector();

  const filtered = state.items.filter(function(p) { return p.classificationName === classificationName; });

  qs('mc-source-panel').style.display = 'block';

  if (filtered.length === 0) {
    qs('mc-source-empty').style.display = 'block';
    qs('mc-source-filled').style.display = 'none';
    qs('mc-source-empty-title').textContent = classificationName;
    return;
  }

  qs('mc-source-empty').style.display = 'none';
  qs('mc-source-filled').style.display = 'block';

  const radarTitle = qs('mc-radar-title');
  if (radarTitle) radarTitle.textContent = 'Vue d\'ensemble — ' + classificationName;

  renderRadar(filtered);
  renderList(filtered);

  const placeholder = qs('mc-detail-placeholder');
  const detail = qs('mc-detail');
  if (placeholder) placeholder.style.display = 'block';
  if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
}
window.selectSource = selectSource;

// ---------------------------------------------------------------------------
// Radar de compétences
// ---------------------------------------------------------------------------

function renderRadar(filtered) {
  const main = (filtered || []).slice().sort(function(a, b) { return b.evaluationCount - a.evaluationCount; }).slice(0, 8);
  qs('mc-radar-chart').innerHTML = buildRadarChart(main);
  qs('mc-radar-legend').innerHTML = main.map(function(p, i) {
    return (
      '<span class="mc-radar-legend-item"><strong>' + (i + 1) + '.</strong> ' +
      escapeHtml(p.competencyName) + ' — ' +
      escapeHtml(COMPETENCY_LEVEL_LABELS[p.currentLevel] || p.currentLevel) +
      '</span>'
    );
  }).join('');
}

function buildRadarChart(items) {
  const n = items.length;
  if (n < 3) {
    return '<p class="bank-list-empty">Le radar apparaîtra dès que 3 compétences ou plus auront été évaluées dans ce thème (' + n + ' pour l\'instant).</p>';
  }
  const size = 220, center = size / 2, maxRadius = 85;
  const points = items.map(function(p, i) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const levelFraction = (COMPETENCY_LEVEL_NUMERIC_VALUE[p.currentLevel] + 1) / 5;
    const r = levelFraction * maxRadius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      axisX: center + maxRadius * Math.cos(angle),
      axisY: center + maxRadius * Math.sin(angle),
    };
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
    '<svg viewBox="0 0 ' + size + ' ' + size + '" width="240" height="240" role="img" aria-label="Radar des compétences du thème">' +
      axes +
      '<polygon points="' + polygon + '" fill="rgba(29,158,117,.25)" stroke="#1D9E75" stroke-width="2"></polygon>' +
      labels +
    '</svg>'
  );
}

// ---------------------------------------------------------------------------
// Grille de compétences
// ---------------------------------------------------------------------------

function renderList(filtered) {
  qs('mc-list').innerHTML = (filtered || []).map(competencyTileHtml).join('');
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

// ---------------------------------------------------------------------------
// Détail d'une compétence
// ---------------------------------------------------------------------------

export async function selectCompetency(competencyId) {
  state.selectedId = competencyId;

  const filtered = state.items.filter(function(p) { return p.classificationName === state.selectedClassification; });
  renderList(filtered);

  const p = state.items.find(function(i) { return i.competencyId === competencyId; });
  if (!p) return;

  qs('mc-detail-placeholder').style.display = 'none';
  const detailEl = qs('mc-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = '<p class="bank-list-loading">Chargement…</p>';

  if (state.selectedId !== competencyId) return;
  detailEl.innerHTML = detailHtml(p);
}

function detailHtml(p) {
  let html = '<div class="bank-detail-card">';
  html += '<div class="bank-detail-header"><h3 style="font-family:inherit;">' + escapeHtml(p.competencyName) + '</h3><span class="bank-badge bank-badge-published">' + escapeHtml(COMPETENCY_LEVEL_LABELS[p.currentLevel] || p.currentLevel) + '</span></div>';

  html += '<div class="bank-detail-section"><h4>Chiffres clés</h4>';
  html += '<div class="bank-detail-row"><strong>Maîtrisées :</strong> ' + p.masteredCount + ' / ' + p.evaluationCount + ' (' + p.masteredPercent + ' %)</div>';
  html += '<div class="bank-detail-row"><strong>En cours :</strong> ' + p.inProgressCount + '</div>';
  html += '<div class="bank-detail-row"><strong>À travailler :</strong> ' + p.toWorkCount + '</div>';
  html += '<div class="bank-detail-row"><strong>Score de confiance :</strong> ' + p.confidenceScore + ' / 100 <span class="admin-users-disclaimer" style="display:inline;">(reflète le nombre, la régularité et la récence de vos réponses — pas seulement votre score)</span></div>';
  html += '<div class="bank-detail-row"><strong>Dernière activité :</strong> ' + escapeHtml(p.lastEvaluationAt ? formatDateFr(p.lastEvaluationAt) : '—') + '</div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Détail par question (' + p.questions.length + ')</h4>';
  html += '<ul class="bank-timeline-list">' + p.questions.map(function(q) {
    const status = questionStatusOf(q);
    const badge = QUESTION_STATUS_BADGE[status];
    const questionDoc = state.questionTextCache.get(q.pedagogicalId);
    const label = (questionDoc && questionDoc.question) ? questionDoc.question : q.pedagogicalId;
    const srcBadge = SESSION_TYPE_BADGE[q.lastSessionType];
    const srcHtml = srcBadge
      ? ' · <span class="bank-badge ' + srcBadge.cls + '">' + escapeHtml(srcBadge.label) + '</span>'
      : '';
    return '<li class="bank-timeline-item">' +
      '<div class="bank-timeline-label">' + icon(badge.icon, { size: 13 }) + ' ' + escapeHtml(label) + '</div>' +
      '<div class="bank-timeline-date"><span class="bank-badge ' + badge.cls + '">' + escapeHtml(badge.label) + '</span>' + srcHtml + ' · vue ' + q.timesSeen + ' fois · dernière tentative le ' + escapeHtml(q.lastSeenAt ? formatDateFr(q.lastSeenAt) : '—') + '</div>' +
    '</li>';
  }).join('') + '</ul></div>';

  html += '</div>';
  return html;
}

window.selectCompetency = selectCompetency;
