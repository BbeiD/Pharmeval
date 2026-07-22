// ===================== CONTROLEUR DE LA BANQUE DE QUESTIONS (Sprint 11) =====================
// Aucune logique metier ici : ce fichier ne fait qu'appeler
// js/services/question-bank-service.js et js/services/question-
// completeness-service.js, et afficher le resultat. Toute regle
// (validation, journalisation, controle d'acces) vit exclusivement dans
// les services.
//
// Double controle d'acces (meme principe que admin/import.js, Sprint 10) :
// 1. Interface : #bank-view reste masque tant que l'acces n'est pas confirme.
// 2. Logique metier : question-bank-service.js revalide lui-meme la
//    permission a chaque appel, independamment de ce controleur.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatThemeLabel } from "../js/services/theme-utils.js";
import { formatDateFr } from "../js/services/date-utils.js";
import {
  browseQuestions, publishQuestion, archiveQuestion, revertQuestionToDraft,
  moveQuestionToTrash, restoreQuestionFromTrash, permanentlyDeleteQuestion,
  editQuestionMetadata, getQuestionTimeline, publishAllDraftQuestions,
} from "../js/services/question-bank-service.js";
import { computeCompleteness, renderCompletenessBar } from "../js/services/question-completeness-service.js";
import { getDocumentSourceById, getDocumentSourcesByIds } from "../js/services/document-source-catalog-service.js";
import { getDocumentSectionById } from "../js/services/document-section-catalog-service.js";
import { renderSiteHeader } from "../js/site-header.js";
import { icon } from "../js/icons.js";

// CORRECTIF (bibliotheque d'icones, remplace les emojis) : `emoji` contient
// desormais le SVG inline deja rendu (icon(...)), plus un caractere - les
// sites d'appel (badge.emoji + ' ' + badge.label) restent inchanges.
const STATUS_BADGES = {
  draft: { emoji: icon('status-draft', { size: 14 }), label: 'Brouillon', cls: 'bank-badge-draft' },
  review: { emoji: icon('status-review', { size: 14 }), label: 'En relecture', cls: 'bank-badge-review' },
  published: { emoji: icon('status-published-active', { size: 14 }), label: 'Publiée', cls: 'bank-badge-published' },
  archived: { emoji: icon('status-archived', { size: 14 }), label: 'Archivée', cls: 'bank-badge-archived' },
  // CORRECTIF (suppression securisee) : etape intermediaire avant
  // suppression definitive - voir js/services/question-bank-service.js.
  trash: { emoji: icon('status-trash', { size: 14 }), label: 'Corbeille', cls: 'bank-badge-trash' },
};
const DIFFICULTY_LABELS = { essentiel: 'Essentiel', approfondi: 'Approfondi', avance: 'Avancé' };

// Etat en memoire de l'ecran (recherche, pagination, selection). CORRECTIF :
// les filtres/tri manuels ont ete retires de l'interface - `filters`/
// `sortField`/`sortDirection` restent figes aux valeurs par defaut ci-dessous
// car browseQuestions() (question-bank-service.js) les attend toujours.
let state = {
  searchText: '',
  filters: { status: '', theme: '', difficulty: '', questionType: '', author: '' },
  sortField: 'createdAt',
  sortDirection: 'desc',
  page: 0,               // utilise en mode recherche (pagination cote client)
  cursorStack: [null],   // utilise en mode navigation normale (pile de curseurs Firestore, [0] = premiere page)
  cursorIndex: 0,
  items: [],
  hasMore: false,
  selectedId: null,
  sourceNameMap: new Map(), // resolu par lot a chaque chargement de page (voir loadPage)
};
let pendingAction = null; // { kind: 'publish'|'archive'|'draft'|'delete', question }

// ---------------------------------------------------------------------------
// Controle d'acces
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('bank-loading');
  const deniedEl = document.getElementById('bank-denied');
  const viewEl = document.getElementById('bank-view');

  if (!user) {
    clearCurrentUserContext();
    window.location.href = '../index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';

  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) {
    if (deniedEl) deniedEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    return;
  }

  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('administration');

  await loadPage();
});

// ---------------------------------------------------------------------------
// Chargement et rendu de la liste (colonne gauche)
// ---------------------------------------------------------------------------

async function loadPage() {
  const listEl = document.getElementById('bank-list');
  const emptyEl = document.getElementById('bank-list-empty');
  if (listEl) listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  if (emptyEl) emptyEl.style.display = 'none';

  const isSearch = !!state.searchText.trim();
  const cursorDoc = isSearch ? null : state.cursorStack[state.cursorIndex];

  const result = await browseQuestions({
    searchText: state.searchText,
    filters: state.filters,
    sortField: state.sortField,
    sortDirection: state.sortDirection,
    page: state.page,
    cursorDoc: cursorDoc,
  });

  if (!result.authorized) {
    showBankMessage('denied', result.message);
    return;
  }
  if (result.error) {
    if (listEl) listEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = result.message; }
    return;
  }

  state.items = result.items;
  state.hasMore = result.hasMore;

  const disclaimerEl = document.getElementById('bank-search-disclaimer');
  if (disclaimerEl) {
    if (result.searchMode && result.truncatedScan) {
      disclaimerEl.style.display = 'block';
      disclaimerEl.textContent = 'Recherche limitée aux questions les plus récentes correspondant aux filtres actifs. Affinez votre recherche si nécessaire.';
    } else {
      disclaimerEl.style.display = 'none';
    }
  }

  if (!result.searchMode) state.lastDoc = result.lastDoc;

  // CORRECTIF : resolution des noms de source PAR LOT, une seule fois pour
  // toute la page (jamais un appel par ligne) - voir getDocumentSourcesByIds()
  // de document-source-catalog-service.js.
  const sourceIds = state.items.map(function(q) { return q.documentSourceId; }).filter(Boolean);
  state.sourceNameMap = sourceIds.length > 0 ? await getDocumentSourcesByIds(sourceIds) : new Map();

  renderList(state.items);
  renderPagination();
}

function renderList(items) {
  const listEl = document.getElementById('bank-list');
  const emptyEl = document.getElementById('bank-list-empty');
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = 'Aucune question ne correspond à ces critères.'; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML =
    '<table class="bank-table">' +
      '<thead><tr><th>Identifiant</th><th>Question</th><th>Référentiel</th><th>Difficulté</th><th>Statut</th></tr></thead>' +
      '<tbody>' + items.map(rowHtml).join('') + '</tbody>' +
    '</table>';
}

function rowHtml(q) {
  const badge = STATUS_BADGES[q.status] || STATUS_BADGES.draft;
  const preview = (q.question || '').toString().slice(0, 90) + ((q.question || '').length > 90 ? '…' : '');
  const selected = q.pedagogicalId === state.selectedId ? ' bank-row-selected' : '';
  const source = q.documentSourceId ? state.sourceNameMap.get(q.documentSourceId) : null;
  const referentielLabel = q.documentSourceId ? (source ? source.name : 'Introuvable') : 'Non classée';
  return (
    '<tr class="bank-row' + selected + '" onclick="selectBankQuestion(\'' + escapeHtml(q.pedagogicalId) + '\')">' +
      '<td class="bank-row-id">' + escapeHtml(q.pedagogicalId) + '</td>' +
      '<td class="bank-row-question">' + escapeHtml(preview) + '</td>' +
      '<td>' + escapeHtml(referentielLabel) + '</td>' +
      '<td>' + escapeHtml(DIFFICULTY_LABELS[q.difficulty] || q.difficulty) + '</td>' +
      '<td><span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span></td>' +
    '</tr>'
  );
}

function renderPagination() {
  const el = document.getElementById('bank-pagination');
  if (!el) return;
  const isSearch = !!state.searchText.trim();
  const canGoBack = isSearch ? state.page > 0 : state.cursorIndex > 0;
  const canGoForward = state.hasMore;
  el.innerHTML =
    '<button class="btn-secondary" onclick="goToBankPage(-1)"' + (canGoBack ? '' : ' disabled') + '>← Précédent</button>' +
    '<span class="bank-pagination-label">Page ' + ((isSearch ? state.page : state.cursorIndex) + 1) + '</span>' +
    '<button class="btn-secondary" onclick="goToBankPage(1)"' + (canGoForward ? '' : ' disabled') + '>Suivant →</button>';
}

export async function goToBankPage(delta) {
  const isSearch = !!state.searchText.trim();
  if (isSearch) {
    state.page = Math.max(0, state.page + delta);
  } else {
    if (delta > 0 && state.hasMore) {
      // Empile le curseur de fin de la page courante (utilise pour charger la suivante).
      state.cursorStack = state.cursorStack.slice(0, state.cursorIndex + 1);
      state.cursorStack.push(state.lastDoc);
      state.cursorIndex++;
    } else if (delta < 0 && state.cursorIndex > 0) {
      state.cursorIndex--;
    }
  }
  return loadPage();
}

function resetPagination() {
  state.page = 0;
  state.cursorStack = [null];
  state.cursorIndex = 0;
}

// ---------------------------------------------------------------------------
// Recherche, filtres, tri
// ---------------------------------------------------------------------------

export function onBankSearchInput() {
  const input = document.getElementById('bank-search-input');
  state.searchText = input ? input.value : '';
  resetPagination();
  return loadPage();
}

// ---------------------------------------------------------------------------
// Selection et fiche detaillee (colonne droite)
// ---------------------------------------------------------------------------

export async function selectBankQuestion(pedagogicalId) {
  const q = state.items.find(function(item) { return item.pedagogicalId === pedagogicalId; });
  if (!q) return;
  state.selectedId = pedagogicalId;
  renderList(state.items); // rafraichit la mise en surbrillance de la ligne selectionnee

  document.getElementById('bank-detail-placeholder').style.display = 'none';
  const detailEl = document.getElementById('bank-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = detailHtml(q);

  await renderTimeline(q);
  await renderClassification(q);
}

/**
 * NOUVEAU (Sprint 20) : resout et affiche le nom de la source/section
 * documentaire liees a cette question (ou "Non classée"). Lecture seule -
 * jamais d'ecriture depuis ce fichier (voir admin/document-sources.js).
 */
async function renderClassification(q) {
  const container = document.getElementById('bank-classification-container');
  if (!container) return;
  if (!q.documentSourceId) {
    container.innerHTML = '<span class="bank-chip">Non classée</span>';
    return;
  }
  const [source, section] = await Promise.all([
    getDocumentSourceById(q.documentSourceId),
    q.documentSectionId ? getDocumentSectionById(q.documentSectionId) : null,
  ]);
  let html = '<div class="bank-detail-row"><strong>Source :</strong> ' + escapeHtml(source ? source.name : q.documentSourceId + ' (introuvable)') + '</div>';
  html += '<div class="bank-detail-row"><strong>Section :</strong> ' + escapeHtml(section ? section.pathLabels.concat([section.name]).join(' › ') : (q.documentSectionId ? q.documentSectionId + ' (introuvable)' : '—')) + '</div>';
  if (q.functionalCode) html += '<div class="bank-detail-row"><strong>Identifiant fonctionnel :</strong> ' + escapeHtml(q.functionalCode) + '</div>';
  container.innerHTML = html;
}

/**
 * CORRECTIF : charge et affiche la chronologie (creation/import + journal
 * d'audit) directement dans la fiche de la question, sans quitter l'ecran.
 * Voir js/services/question-bank-service.js, getQuestionTimeline().
 */
async function renderTimeline(q) {
  const container = document.getElementById('bank-timeline-container');
  if (!container) return;
  const result = await getQuestionTimeline(q);
  if (!result.authorized) {
    container.textContent = result.message || 'Accès refusé.';
    return;
  }
  if (result.error) {
    container.textContent = 'Impossible de charger l\u2019historique pour le moment.';
    return;
  }
  if (result.items.length === 0) {
    container.textContent = 'Aucun historique disponible pour cette question.';
    return;
  }
  container.innerHTML = '<ul class="bank-timeline-list">' + result.items.map(function(entry) {
    const dateLabel = entry.date ? formatDateFr(entry.date) : '—';
    const who = entry.adminEmail ? ' — ' + escapeHtml(entry.adminEmail) : '';
    const detail = entry.detail ? '<div class="bank-timeline-detail">' + escapeHtml(entry.detail) + '</div>' : '';
    return '<li class="bank-timeline-item"><div class="bank-timeline-date">' + escapeHtml(dateLabel) + '</div><div class="bank-timeline-label">' + escapeHtml(entry.label) + who + '</div>' + detail + '</li>';
  }).join('') + '</ul>';
}

function detailHtml(q) {
  const badge = STATUS_BADGES[q.status] || STATUS_BADGES.draft;
  const completeness = computeCompleteness(q);
  const bar = renderCompletenessBar(completeness.score);

  let html = '<div class="bank-detail-card">';

  // En-tete
  html += '<div class="bank-detail-header">';
  html += '<h3>' + escapeHtml(q.pedagogicalId) + '</h3>';
  html += '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>';
  html += '</div>';
  html += '<div class="bank-detail-tags-row">';
  html += '<span class="bank-chip">' + escapeHtml(formatThemeLabel(q.theme)) + '</span>';
  html += '<span class="bank-chip">' + escapeHtml(q.subtheme || '—') + '</span>';
  html += '<span class="bank-chip">' + escapeHtml(DIFFICULTY_LABELS[q.difficulty] || q.difficulty) + '</span>';
  html += '<span class="bank-chip">' + escapeHtml(q.questionType || '—') + '</span>';
  html += '</div>';

  // Question complete
  html += '<div class="bank-detail-section"><h4>Question</h4><p class="bank-detail-question">' + escapeHtml(q.question) + '</p>';
  html += '<ul class="bank-detail-answers">';
  (q.answers || []).forEach(function(a, i) {
    const isCorrect = i === q.correctAnswer;
    html += '<li class="' + (isCorrect ? 'bank-answer-correct' : '') + '">' + (isCorrect ? '✅ ' : '◻️ ') + escapeHtml(a) + '</li>';
  });
  html += '</ul></div>';

  html += '<div class="bank-detail-section"><h4>Explication</h4><p>' + escapeHtml(q.explanation || '—') + '</p></div>';

  // Metadonnees
  html += '<div class="bank-detail-section"><h4>Métadonnées</h4>';
  html += '<div class="bank-detail-row"><strong>Tags :</strong> ' + ((q.tags || []).map(function(t) { return '<span class="bank-chip">' + escapeHtml(t) + '</span>'; }).join(' ') || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Source :</strong> ' + escapeHtml(q.source || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Objectifs pédagogiques :</strong> ' + ((q.learningObjectives && q.learningObjectives.length) ? ('<ul>' + q.learningObjectives.map(function(o) { return '<li>' + escapeHtml(o) + '</li>'; }).join('') + '</ul>') : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Auteur :</strong> ' + escapeHtml(q.author || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Version :</strong> ' + escapeHtml(q.version || 1) + '</div>';
  html += '<div class="bank-detail-row"><strong>Créée le :</strong> ' + escapeHtml(q.createdAt ? formatDateFr(q.createdAt) : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Modifiée le :</strong> ' + escapeHtml(q.updatedAt ? formatDateFr(q.updatedAt) : '—') + '</div>';
  html += '</div>';

  // NOUVEAU (Sprint 20) : classification documentaire, en LECTURE SEULE
  // ici (le rattachement lui-meme se fait depuis admin/document-sources.html,
  // "rattachement individuel" ou "migration par lots" - jamais deux
  // endroits differents ne modifient la meme donnee). Rempli de facon
  // asynchrone par renderClassification(), meme principe que le
  // conteneur d'historique ci-dessous.
  html += '<div class="bank-detail-section"><h4>Classification documentaire</h4><div id="bank-classification-container">Chargement…</div>';
  html += '<div class="btn-row"><a class="btn-secondary" href="document-sources.html">Gérer dans Sources documentaires →</a></div></div>';

  // Completude ("coup de coeur")
  html += '<div class="bank-detail-section"><h4>Complétude</h4>';
  html += '<div class="bank-completeness-bar">' + bar + ' <span class="bank-completeness-pct">' + completeness.score + ' %</span></div>';
  html += '<ul class="bank-completeness-checklist">';
  completeness.checks.forEach(function(c) {
    html += '<li>' + icon(c.passed ? 'highlight-check-validated' : 'action-close-remove', { size: 14 }) + ' ' + escapeHtml(c.label) + '</li>';
  });
  html += '</ul></div>';

  // Actions (CORRECTIF : suppression securisee, workflow Archivee -> Corbeille -> Suppression definitive)
  html += '<div class="bank-detail-section"><h4>Actions</h4><div class="bank-actions-row">';
  if (q.status !== 'trash') {
    if (q.status !== 'published') html += '<button class="btn-primary" onclick="requestBankAction(\'publish\')">Publier</button>';
    if (q.status !== 'archived') html += '<button class="btn-secondary" onclick="requestBankAction(\'archive\')">Archiver</button>';
    if (q.status !== 'draft') html += '<button class="btn-secondary" onclick="requestBankAction(\'draft\')">Remettre en brouillon</button>';
  }
  if (q.status === 'archived') {
    html += '<button class="btn-secondary bank-trash-btn" onclick="requestBankAction(\'trash\')">' + icon('action-delete', { size: 16 }) + ' Mettre à la corbeille</button>';
  }
  if (q.status === 'trash') {
    html += '<button class="btn-secondary" onclick="requestBankAction(\'restore\')">' + icon('action-restore', { size: 16 }) + ' Restaurer</button>';
    if (hasPermission(PERMISSIONS.PURGE_QUESTIONS)) {
      html += '<button class="btn-secondary bank-delete-btn" onclick="requestBankAction(\'purge\')">Supprimer définitivement</button>';
    }
  }
  html += '</div></div>';

  // CORRECTIF : historique visuel (timeline), consultable sans quitter l'ecran
  html += '<div class="bank-detail-section"><h4>Historique</h4><div id="bank-timeline-container" class="bank-timeline">Chargement…</div></div>';

  // Edition limitee
  html += '<div class="bank-detail-section"><h4>Modifier</h4>';
  html += '<label class="bank-edit-label">Explication</label>';
  html += '<textarea id="bank-edit-explanation" class="bank-edit-textarea">' + escapeHtml(q.explanation || '') + '</textarea>';
  html += '<label class="bank-edit-label">Tags (séparés par des virgules)</label>';
  html += '<input type="text" id="bank-edit-tags" class="bank-select" value="' + escapeHtml((q.tags || []).join(', ')) + '">';
  html += '<label class="bank-edit-label">Source</label>';
  html += '<input type="text" id="bank-edit-source" class="bank-select" value="' + escapeHtml(q.source || '') + '">';
  html += '<div class="btn-row"><button class="btn-primary" onclick="saveBankEdit()">Enregistrer les modifications</button></div>';
  html += '</div>';

  html += '</div>';
  return html;
}

export async function saveBankEdit() {
  const q = state.items.find(function(item) { return item.pedagogicalId === state.selectedId; });
  if (!q) return;
  const explanation = document.getElementById('bank-edit-explanation').value;
  const tags = document.getElementById('bank-edit-tags').value.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
  const source = document.getElementById('bank-edit-source').value;

  const result = await editQuestionMetadata(q, { explanation: explanation, tags: tags, source: source });
  showBankMessage(result.status, result.message);
  if (result.status === 'success') loadPage();
}

// ---------------------------------------------------------------------------
// Confirmation avant action sensible
// ---------------------------------------------------------------------------

const ACTION_LABELS = {
  publish: 'publier',
  archive: 'archiver',
  draft: 'remettre en brouillon',
  trash: 'mettre à la corbeille',
  restore: 'restaurer depuis la corbeille',
  purge: 'supprimer définitivement',
};

export function requestBankAction(kind) {
  const q = state.items.find(function(item) { return item.pedagogicalId === state.selectedId; });
  if (!q) return;
  pendingAction = { kind: kind, question: q };
  const verb = ACTION_LABELS[kind] || kind;
  let extra = '';
  if (kind === 'purge') extra = ' Cette action est définitive et ne peut pas être annulée.';
  else if (kind === 'trash') extra = ' Cette question pourra être restaurée depuis la corbeille, ou supprimée définitivement plus tard.';
  document.getElementById('bank-confirm-message').textContent = 'Voulez-vous vraiment ' + verb + ' la question « ' + q.pedagogicalId + ' » ?' + extra;
  document.getElementById('bank-confirm-overlay').style.display = 'flex';
}

export function requestBulkPublish() {
  pendingAction = { kind: 'bulk_publish' };
  document.getElementById('bank-confirm-message').textContent = 'Publier toutes les questions actuellement en brouillon ? Les questions déjà publiées, en relecture, archivées ou à la corbeille ne seront pas touchées.';
  document.getElementById('bank-confirm-overlay').style.display = 'flex';
}

export function cancelBankAction() {
  pendingAction = null;
  document.getElementById('bank-confirm-overlay').style.display = 'none';
}

export async function confirmBankAction() {
  document.getElementById('bank-confirm-overlay').style.display = 'none';
  if (!pendingAction) return;
  const action = pendingAction;
  pendingAction = null;

  if (action.kind === 'bulk_publish') {
    const result = await publishAllDraftQuestions();
    showBankMessage(result.status, result.message);
    if (result.status === 'success') loadPage();
    return;
  }

  let result;
  if (action.kind === 'publish') result = await publishQuestion(action.question);
  else if (action.kind === 'archive') result = await archiveQuestion(action.question);
  else if (action.kind === 'draft') result = await revertQuestionToDraft(action.question);
  else if (action.kind === 'trash') result = await moveQuestionToTrash(action.question);
  else if (action.kind === 'restore') result = await restoreQuestionFromTrash(action.question);
  else if (action.kind === 'purge') result = await permanentlyDeleteQuestion(action.question);

  showBankMessage(result.status, result.message);
  if (result.status === 'success') {
    if (action.kind === 'purge') {
      state.selectedId = null;
      document.getElementById('bank-detail').style.display = 'none';
      document.getElementById('bank-detail-placeholder').style.display = 'block';
    }
    loadPage();
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function showBankMessage(status, text) {
  const el = document.getElementById('bank-message');
  if (!el) return;
  el.className = 'admin-message admin-message-' + status;
  el.textContent = text;
  el.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return (s === undefined || s === null ? '' : s).toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------------------------------------------------------------------------
// Pont vers le HTML classique (attributs onclick/oninput/onchange).
// ---------------------------------------------------------------------------
window.onBankSearchInput = onBankSearchInput;
window.requestBulkPublish = requestBulkPublish;
window.goToBankPage = goToBankPage;
window.selectBankQuestion = selectBankQuestion;
window.saveBankEdit = saveBankEdit;
window.requestBankAction = requestBankAction;
window.cancelBankAction = cancelBankAction;
window.confirmBankAction = confirmBankAction;
