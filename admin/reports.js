// ===================== CONTROLEUR "SIGNALEMENTS" (demande directe de David, 29/07/2026) =====================
// "le bouton 'signaler une question' ne donne rien (dead end), est-il
// possible d'avoir un menu d'ouverture de ticket dans le menu Admin ?" -
// le circuit de signalement existait deja de bout en bout (question-report-
// widget.js -> question-report-service.js -> Cloud Function -> Firestore
// `question_reports`, et une section "Signalements" DEJA visible dans la
// fiche detaillee d'UNE question precise, admin/bank.js) mais aucune vue
// d'ensemble - il fallait deviner quelle question ouvrir pour voir si elle
// avait un signalement. Cette page ne duplique aucune regle metier :
// reutilise listAllQuestionReports()/markReportResolved() telles quelles
// (question-report-service.js), meme discipline que les autres ecrans
// d'administration du projet.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatDateFr } from "../js/services/date-utils.js";
import { listAllQuestionReports, markReportResolved, REPORT_REASON_LABELS } from "../js/services/question-report-service.js";
import { getExistingQuestionsByPedagogicalIds } from "../js/services/question-catalog-service.js";
import { renderSiteHeader } from "../js/site-header.js";
import { icon } from "../js/icons.js";

const TABS = [
  { key: 'open', label: 'Ouverts' },
  { key: 'resolved', label: 'Résolus' },
  { key: 'all', label: 'Tous' },
];

let state = { activeStatus: 'open', items: [], questionPreviews: new Map() };

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showMessage(status, message) {
  const el = document.getElementById('qr-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Controle d'acces
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('qr-loading');
  const deniedEl = document.getElementById('qr-denied');
  const viewEl = document.getElementById('qr-view');

  if (!user) { clearCurrentUserContext(); window.location.href = '../index.html'; return; }
  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) { console.error('Erreur lors de la vérification du compte :', err); }

  if (loadingEl) loadingEl.style.display = 'none';
  // Meme permission que question-report-service.js#getReportsForQuestion()/
  // getOpenReportCounts() - jamais un controle d'acces different pour la
  // vue d'ensemble que pour la vue par question.
  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) {
    if (deniedEl) deniedEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    return;
  }
  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('administration');

  renderTabs();
  await loadTab('open');
});

function renderTabs() {
  const container = document.getElementById('qr-tabs');
  container.innerHTML = TABS.map(function(t) {
    const activeCls = t.key === state.activeStatus ? ' bank-tab-active' : '';
    return '<button type="button" class="bank-tab' + activeCls + '" onclick="switchReportsTab(\'' + t.key + '\')">' + escapeHtml(t.label) + '</button>';
  }).join('');
}

export async function switchReportsTab(statusKey) {
  state.activeStatus = statusKey;
  renderTabs();
  await loadTab(statusKey);
}

async function loadTab(statusKey) {
  const listEl = document.getElementById('qr-list');
  const emptyEl = document.getElementById('qr-list-empty');
  listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  emptyEl.style.display = 'none';
  showMessage(null, null);

  const result = await listAllQuestionReports({ status: statusKey });
  if (result.error) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'Impossible de charger les signalements pour le moment. Réessayez plus tard.';
    return;
  }
  state.items = result.items || [];

  // Apercu du texte de la question - PUREMENT INFORMATIF (jamais un lien
  // d'edition depuis ici, voir en-tete de question-report-service.js) :
  // une question introuvable (supprimee/jamais resynchronisee) reste
  // affichable, juste sans apercu.
  const ids = state.items.map(function(r) { return r.pedagogicalId; }).filter(Boolean);
  const questionsResult = await getExistingQuestionsByPedagogicalIds(ids);
  state.questionPreviews = questionsResult.map || new Map();

  renderList();
}

function renderList() {
  const listEl = document.getElementById('qr-list');
  const emptyEl = document.getElementById('qr-list-empty');

  if (state.items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = state.activeStatus === 'open'
      ? 'Aucun signalement ouvert pour le moment.'
      : 'Aucun signalement ne correspond à ce filtre.';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = state.items.map(function(r) {
    const bank = state.questionPreviews.get(r.pedagogicalId);
    const preview = bank ? escapeHtml((bank.question || '').toString().slice(0, 140)) : 'Question introuvable (peut-être supprimée).';
    const isOpen = r.status !== 'resolved';
    const statusBadge = isOpen
      ? '<span class="bank-badge bank-badge-archived">' + icon('action-warning', { size: 12 }) + ' Ouvert</span>'
      : '<span class="bank-badge bank-badge-published">' + icon('feedback-correct', { size: 12 }) + ' Résolu</span>';
    const resolvedNote = !isOpen
      ? '<p class="admin-users-disclaimer" style="margin:4px 0 0;">Résolu le ' + escapeHtml(r.resolvedAt ? formatDateFr(r.resolvedAt) : '—') + '</p>'
      : '';
    const resolveBtn = isOpen
      ? '<div class="parcours-competency-actions"><button class="btn-secondary" onclick="resolveReport(\'' + escapeHtml(r.id) + '\')">Marquer résolu</button></div>'
      : '';

    return (
      '<div class="parcours-competency-card">' +
        '<div class="parcours-competency-header"><strong>' + escapeHtml(REPORT_REASON_LABELS[r.reason] || r.reason) + '</strong>' +
          statusBadge +
          '<span class="bank-chip">' + escapeHtml(r.pedagogicalId || '—') + '</span>' +
        '</div>' +
        '<p class="parcours-competency-description">' + preview + '</p>' +
        (r.comment ? '<p class="parcours-competency-description">« ' + escapeHtml(r.comment) + ' »</p>' : '') +
        '<p class="admin-users-disclaimer" style="margin:4px 0 0;">Signalé le ' + escapeHtml(r.createdAt ? formatDateFr(r.createdAt) : '—') + (r.userEmail ? ' — ' + escapeHtml(r.userEmail) : '') + '</p>' +
        resolvedNote +
        resolveBtn +
      '</div>'
    );
  }).join('');
}

export async function resolveReport(reportId) {
  const result = await markReportResolved(reportId);
  if (!result.success) {
    showMessage('error', 'Impossible de marquer ce signalement comme résolu pour le moment.');
    return;
  }
  showMessage('success', 'Signalement marqué comme résolu.');
  await loadTab(state.activeStatus);
}

window.switchReportsTab = switchReportsTab;
window.resolveReport = resolveReport;
