// ===================== CONTROLEUR "ENTRAINEMENT LIBRE" (Sprint 21.5, Phase B1) =====================
// Espace UTILISATEUR (pas un écran d'administration) : accessible à toute
// personne connectée, même principe que js/mes-parcours.js. Aucune logique
// métier ici : compose le pool via free-training-service.js (Phase B1),
// affiche le résultat, et démarre/remplace une session via
// evaluation-session-service.js (Sprint 17 + Phase B1).
//
// CORRECTIF (demande directe de David, 29/07/2026) : tuiles "Thème(s)"
// basées sur les grandes classifications des Parcours (voir
// parcours-classification-logic.js) plutôt que les document_sources brutes.
//
// REFONTE UX (03/08/2026) :
// - Flux en une étape (plus de "Composer le pool" séparé) : compose +
//   lance en un seul clic "Lancer mon entraînement".
// - Compteur live estimé (sans Firestore supplémentaire) depuis les IDs
//   déjà chargés dans state.classifications.
// - Test rapide désactivé si une session est déjà en cours (évite deux
//   sessions actives simultanément).
// - Sélection des thèmes : "Tout sélectionner" / "Effacer" / recherche.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { getSelfServiceCatalogParcours } from "./services/parcours-service.js";
import { groupParcoursByClassification } from "./services/parcours-classification-logic.js";
import { resolveParcoursColorHex, ACCESS_TIERS } from "./services/parcours-metadata-service.js";
import { composeFreeTrainingPoolByIds, launchTestMeByIds } from "./services/free-training-service.js";
import { pickRandomSubset } from "./services/free-training-logic.js";
import {
  getActiveFreeTrainingSession, startNewFreeTrainingSession, restartFreeTrainingSession,
  resumeSession,
} from "./services/evaluation-session-service.js";
import { finalizeEvaluation } from "./services/evaluation-result-service.js";
import { renderSiteHeader } from "./site-header.js";
import { icon } from "./icons.js";
import { toComparableDate } from "./services/date-utils.js";

const CLASSIFICATION_ICON_KEY = 'content-tag-label';
const DEFAULT_CLASSIFICATION_HEX = '#94A3B8';
const TEST_ME_QUESTION_COUNT = 10;

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function qs(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return (s === undefined || s === null ? '' : s).toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function plural(n, sing, plur) {
  return n + ' ' + (n <= 1 ? sing : plur);
}

function showMessage(status, message) {
  const el = qs('etl-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

function formatSessionDate(isoValue) {
  const d = toComparableDate(isoValue);
  if (!d) return '';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const timeStr = hh + ' h ' + mm;
  if (d >= todayStart) return "aujourd’hui à " + timeStr;
  if (d >= yesterdayStart) return "hier à " + timeStr;
  try {
    return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) + ' à ' + timeStr;
  } catch (e) {
    return timeStr;
  }
}

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

let state = {
  replacingSessionId: null,
  classifications: [],
  selectedClassifications: new Set(),
  activeSession: null,
  themeFilter: '',
};

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

let initDone = false;

onAuthStateChanged(auth, async function(user) {
  const loadingEl = qs('etl-loading');
  const deniedEl = qs('etl-denied');
  const viewEl = qs('etl-view');

  if (!user) {
    clearCurrentUserContext();
    if (loadingEl) loadingEl.style.display = 'none';
    if (viewEl) viewEl.style.display = 'none';
    if (deniedEl) deniedEl.style.display = 'block';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('entrainement-libre');

  if (initDone) return;
  initDone = true;
  await init();
});

async function init() {
  await Promise.all([checkActiveSession(), populateClassifications()]);
  wireEvents();
}

// ---------------------------------------------------------------------------
// Session en cours
// ---------------------------------------------------------------------------

async function checkActiveSession() {
  const active = await getActiveFreeTrainingSession();
  if (!active) return;

  state.activeSession = active;

  const total = (active.questionIds && active.questionIds.length) || 0;
  const answered = (typeof active.currentQuestionIndex === 'number') ? active.currentQuestionIndex : 0;
  const remaining = total - answered;
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  const dateStr = formatSessionDate(active.updatedAt || active.startedAt);

  const textParts = [plural(answered, 'question réalisée', 'questions réalisées') + ' sur ' + total];
  if (remaining > 0) textParts.push(plural(remaining, 'restante', 'restantes'));
  if (dateStr) textParts.push('Dernière activité : ' + dateStr);

  const textEl = qs('etl-active-session-text');
  if (textEl) textEl.textContent = textParts.join(' · ');

  if (total > 0) {
    const progressRow = qs('etl-active-progress-row');
    const fill = qs('etl-active-progress-fill');
    const bar = qs('etl-active-bar');
    const label = qs('etl-active-progress-label');
    if (progressRow) progressRow.style.display = 'flex';
    if (fill) fill.style.width = pct + '%';
    if (bar) bar.setAttribute('aria-valuenow', pct);
    if (label) label.textContent = pct + ' %';
  }

  const card = qs('etl-active-session-card');
  if (card) card.style.display = 'block';

  refreshTestMeState();

  qs('etl-resume-btn').addEventListener('click', function() {
    window.location.href = 'evaluation.html?sessionType=free_training';
  });

  qs('etl-replace-btn').addEventListener('click', function() {
    state.replacingSessionId = active.id;
    state.activeSession = null;
    if (card) card.style.display = 'none';
    refreshTestMeState();
  });

  qs('etl-stop-btn').addEventListener('click', function() {
    qs('etl-stop-confirm-overlay').style.display = 'flex';
  });

  qs('etl-stop-cancel-btn').addEventListener('click', function() {
    qs('etl-stop-confirm-overlay').style.display = 'none';
  });

  qs('etl-stop-confirm-btn').addEventListener('click', async function() {
    qs('etl-stop-confirm-overlay').style.display = 'none';
    qs('etl-stop-confirm-btn').disabled = true;
    const resumed = await resumeSession(state.activeSession.id);
    if (resumed.status === 'success') {
      await finalizeEvaluation(resumed.session);
    }
    window.location.href = 'index.html';
  });
}

function refreshTestMeState() {
  const btn = qs('etl-testme-btn');
  const note = qs('etl-testme-note');
  if (!btn) return;
  const hasActive = !!state.activeSession;
  btn.disabled = hasActive;
  if (note) {
    if (hasActive) {
      note.style.display = 'block';
      note.textContent = 'Un entraînement est en cours. Reprenez-le ou mettez-y fin avant de lancer un test rapide.';
    } else {
      note.style.display = 'none';
    }
  }
}

// ---------------------------------------------------------------------------
// Chargement et rendu des classifications
// ---------------------------------------------------------------------------

async function populateClassifications() {
  const result = await getSelfServiceCatalogParcours();
  const parcoursItems = ((result && result.items) || []).filter(function(p) {
    return p.accessTier !== ACCESS_TIERS.PREMIUM && !p.editorialOnly;
  });
  state.classifications = groupParcoursByClassification(parcoursItems);
  renderClassificationTiles();
  updateSelectionUI();
}

function renderClassificationTiles() {
  const container = qs('etl-source-icons');
  if (!container) return;
  const filterStr = state.themeFilter.toLowerCase().trim();
  let visible = 0;

  container.innerHTML = state.classifications.map(function(c) {
    const matchesSearch = !filterStr || c.classification.toLowerCase().indexOf(filterStr) !== -1;
    const isSelected = state.selectedClassifications.has(c.classification);
    const hex = resolveParcoursColorHex(c.color) || DEFAULT_CLASSIFICATION_HEX;
    if (matchesSearch) visible++;
    return (
      '<button type="button" class="source-tile' + (isSelected ? ' source-tile-selected' : '') + '"' +
        (matchesSearch ? '' : ' style="display:none;"') +
        ' onclick="toggleEtlClassification(\'' + escapeHtml(c.classification) + '\')"' +
        ' aria-pressed="' + (isSelected ? 'true' : 'false') + '">' +
        '<span class="source-tile-emoji" aria-hidden="true" style="color:' + escapeHtml(hex) + ';">' + icon(CLASSIFICATION_ICON_KEY, { size: 24 }) + '</span>' +
        (isSelected ? '<span class="etl-tile-check" aria-hidden="true">✓</span>' : '') +
        '<span class="source-tile-name">' + escapeHtml(c.classification) + '</span>' +
        (isSelected ? '<span class="sr-only"> — sélectionné</span>' : '') +
      '</button>'
    );
  }).join('');

  const noMatch = qs('etl-no-theme-match');
  if (noMatch) noMatch.style.display = (visible === 0 && filterStr) ? 'block' : 'none';
}

export function toggleEtlClassification(classification) {
  if (state.selectedClassifications.has(classification)) {
    state.selectedClassifications.delete(classification);
  } else {
    state.selectedClassifications.add(classification);
  }
  renderClassificationTiles();
  updateSelectionUI();
}
window.toggleEtlClassification = toggleEtlClassification;

export function selectAllEtlClassifications() {
  state.classifications.forEach(function(c) { state.selectedClassifications.add(c.classification); });
  renderClassificationTiles();
  updateSelectionUI();
}
window.selectAllEtlClassifications = selectAllEtlClassifications;

export function clearEtlClassifications() {
  state.selectedClassifications.clear();
  renderClassificationTiles();
  updateSelectionUI();
}
window.clearEtlClassifications = clearEtlClassifications;

function selectedQuestionIds() {
  const ids = new Set();
  state.classifications
    .filter(function(c) { return state.selectedClassifications.has(c.classification); })
    .forEach(function(c) { c.questionIds.forEach(function(id) { ids.add(id); }); });
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Mise à jour de l'interface de sélection
// ---------------------------------------------------------------------------

function updateSelectionUI() {
  const count = state.selectedClassifications.size;
  const totalIds = selectedQuestionIds().length;

  const countEl = qs('etl-selected-count');
  if (countEl) {
    if (count === 0) {
      countEl.textContent = 'Aucun thème sélectionné';
      countEl.className = 'etl-selected-count etl-selected-count-empty';
    } else {
      countEl.textContent = plural(count, 'thème sélectionné', 'thèmes sélectionnés');
      countEl.className = 'etl-selected-count';
    }
  }

  const launchBtn = qs('etl-launch-btn');
  if (launchBtn) launchBtn.disabled = count === 0;

  const hint = qs('etl-launch-hint');
  if (hint) hint.style.display = count === 0 ? 'block' : 'none';

  updateCountInfo(totalIds);
}

function updateCountInfo(totalIds) {
  const infoEl = qs('etl-count-info');
  if (!infoEl) return;
  if (state.selectedClassifications.size === 0) {
    infoEl.textContent = '';
    return;
  }
  if (totalIds === undefined) totalIds = selectedQuestionIds().length;
  if (totalIds === 0) {
    infoEl.textContent = 'Aucune question disponible pour cette sélection.';
    return;
  }
  const desiredCount = Math.max(1, parseInt((qs('etl-count') || {}).value, 10) || 1);
  const actual = Math.min(desiredCount, totalIds);
  if (desiredCount > totalIds) {
    infoEl.textContent = '~ ' + totalIds + ' questions disponibles — votre entraînement comportera ' + totalIds + ' questions.';
  } else {
    infoEl.textContent = '~ ' + totalIds + ' questions disponibles — ' + actual + ' seront tirées au hasard.';
  }
}

// ---------------------------------------------------------------------------
// Lancement de l'entraînement personnalisé (compose + lance en une étape)
// ---------------------------------------------------------------------------

async function onLaunchClick() {
  const launchBtn = qs('etl-launch-btn');
  const errorsEl = qs('etl-errors-card');
  const errMsgEl = qs('etl-errors-message');

  launchBtn.disabled = true;
  launchBtn.textContent = 'Préparation en cours…';
  if (errorsEl) errorsEl.style.display = 'none';

  const result = await composeFreeTrainingPoolByIds(selectedQuestionIds());

  if (!result.ready) {
    launchBtn.disabled = false;
    launchBtn.textContent = 'Lancer mon entraînement';
    if (errMsgEl) errMsgEl.textContent = result.message || 'Aucune question ne correspond à cette sélection.';
    if (errorsEl) errorsEl.style.display = 'block';
    return;
  }

  const desiredCount = Math.max(1, parseInt((qs('etl-count') || {}).value, 10) || 1);
  const picked = pickRandomSubset(result.items, desiredCount);
  const pedagogicalIds = picked.selected.map(function(q) { return q.pedagogicalId; });

  const startResult = state.replacingSessionId
    ? await restartFreeTrainingSession(state.replacingSessionId, pedagogicalIds)
    : await startNewFreeTrainingSession(pedagogicalIds);

  launchBtn.disabled = false;
  launchBtn.textContent = 'Lancer mon entraînement';

  if (startResult.status !== 'success') {
    if (errMsgEl) errMsgEl.textContent = startResult.message || 'Le démarrage de l\'entraînement a échoué. Réessayez.';
    if (errorsEl) errorsEl.style.display = 'block';
    return;
  }

  window.location.href = 'evaluation.html?sessionType=free_training';
}

// ---------------------------------------------------------------------------
// Test rapide (diversifié sur toutes les classifications)
// ---------------------------------------------------------------------------

async function onTestMeClick() {
  if (state.activeSession) return;

  const btn = qs('etl-testme-btn');
  btn.disabled = true;
  btn.textContent = 'Préparation…';

  const classificationByQuestionId = new Map();
  const allIds = [];
  state.classifications.forEach(function(c) {
    c.questionIds.forEach(function(id) {
      classificationByQuestionId.set(id, c.classification);
      allIds.push(id);
    });
  });

  const result = await launchTestMeByIds(allIds, TEST_ME_QUESTION_COUNT, function(q) {
    return classificationByQuestionId.get(q.pedagogicalId) || '(inconnue)';
  });

  btn.disabled = false;
  btn.textContent = 'Lancer le test rapide';

  if (result.status !== 'success') {
    showMessage('error', result.message || 'Impossible de démarrer le test pour le moment. Réessayez.');
    return;
  }

  window.location.href = 'evaluation.html?sessionType=free_training';
}

// ---------------------------------------------------------------------------
// Presets de nombre de questions
// ---------------------------------------------------------------------------

function syncCountPresets() {
  const current = parseInt((qs('etl-count') || {}).value, 10);
  document.querySelectorAll('.etl-count-preset').forEach(function(btn) {
    const val = parseInt(btn.getAttribute('data-count'), 10);
    const active = val === current;
    btn.classList.toggle('etl-count-preset-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

// ---------------------------------------------------------------------------
// Câblage des événements
// ---------------------------------------------------------------------------

function wireEvents() {
  qs('etl-testme-btn').addEventListener('click', onTestMeClick);
  qs('etl-launch-btn').addEventListener('click', onLaunchClick);
  qs('etl-select-all-btn').addEventListener('click', selectAllEtlClassifications);
  qs('etl-clear-all-btn').addEventListener('click', clearEtlClassifications);

  qs('etl-theme-search').addEventListener('input', function() {
    state.themeFilter = this.value;
    renderClassificationTiles();
  });

  qs('etl-count').addEventListener('input', function() {
    syncCountPresets();
    updateCountInfo();
  });

  document.querySelectorAll('.etl-count-preset').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const val = parseInt(this.getAttribute('data-count'), 10);
      const countEl = qs('etl-count');
      if (countEl) countEl.value = val;
      syncCountPresets();
      updateCountInfo();
    });
  });
}
