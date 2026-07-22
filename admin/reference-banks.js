// ===================== CONTROLEUR GENERIQUE DES BANQUES DE REFERENCE (Sprint 14) =====================
// UNE SEULE interface pour les trois banques structurellement identiques
// (Organisations, Profils, Groupes) - voir js/services/reference-bank-
// service.js pour la justification de cette factorisation. Aucune logique
// metier ici : appelle le service de la banque active et affiche le
// resultat, exactement comme admin/competencies.js.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatDateFr } from "../js/services/date-utils.js";
import { organizationsBank, ORGANIZATION_TYPE_OPTIONS } from "../js/services/organizations-bank-service.js";
import { profilesBank, SUGGESTED_PROFILE_NAMES } from "../js/services/profiles-bank-service.js";
import { groupsBank, SUGGESTED_GROUP_NAMES } from "../js/services/groups-bank-service.js";
import { renderSiteHeader } from "../js/site-header.js";

const STATUS_BADGES = {
  draft: { emoji: '🟡', label: 'Brouillon', cls: 'bank-badge-draft' },
  published: { emoji: '🟢', label: 'Publié', cls: 'bank-badge-published' },
  archived: { emoji: '⚫', label: 'Archivé', cls: 'bank-badge-archived' },
  trash: { emoji: '🔴', label: 'Corbeille', cls: 'bank-badge-trash' },
};

const BANKS = {
  organizations: {
    service: organizationsBank, label: 'Organisations', titleSingular: 'organisation',
    suggestions: null,
    extraField: { key: 'organizationType', label: 'Type d\'organisation', options: ORGANIZATION_TYPE_OPTIONS },
  },
  profiles: {
    service: profilesBank, label: 'Profils', titleSingular: 'profil',
    suggestions: SUGGESTED_PROFILE_NAMES, extraField: null,
  },
  groups: {
    service: groupsBank, label: 'Groupes', titleSingular: 'groupe',
    suggestions: SUGGESTED_GROUP_NAMES, extraField: null,
  },
};

let state = {
  activeBank: 'organizations',
  searchText: '', filters: { status: '' }, sortField: 'createdAt', sortDirection: 'desc',
  page: 0, cursorStack: [null], cursorIndex: 0,
  items: [], hasMore: false, selectedId: null,
};
let pendingAction = null;

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function valueOf(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function currentConfig() { return BANKS[state.activeBank]; }
function currentService() { return currentConfig().service; }
function showMessage(status, message) {
  const el = document.getElementById('refbanks-message');
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
  const loadingEl = document.getElementById('refbanks-loading');
  const deniedEl = document.getElementById('refbanks-denied');
  const viewEl = document.getElementById('refbanks-view');

  if (!user) { clearCurrentUserContext(); window.location.href = '../index.html'; return; }
  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) { console.error('Erreur lors de la vérification du compte :', err); }

  if (loadingEl) loadingEl.style.display = 'none';
  if (!hasPermission(PERMISSIONS.MANAGE_REFERENCE_DATA)) {
    if (deniedEl) deniedEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    return;
  }
  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('administration');

  updateTabButtons();
  await loadPage();
});

export function switchBank(bankKey) {
  if (!BANKS[bankKey] || bankKey === state.activeBank) return;
  state.activeBank = bankKey;
  state.searchText = ''; document.getElementById('refbanks-search-input').value = '';
  state.filters = { status: '' }; document.getElementById('refbanks-filter-status').value = '';
  state.sortField = 'createdAt'; document.getElementById('refbanks-sort-field').value = 'createdAt';
  state.page = 0; state.cursorIndex = 0; state.cursorStack = [null];
  state.selectedId = null;
  document.getElementById('refbanks-detail-placeholder').style.display = 'block';
  document.getElementById('refbanks-detail').style.display = 'none';
  closeCreateForm();
  updateTabButtons();
  loadPage();
}
function updateTabButtons() {
  Object.keys(BANKS).forEach(function(key) {
    const btn = document.getElementById('refbanks-tab-' + key);
    if (btn) btn.classList.toggle('bank-row-selected', key === state.activeBank);
  });
  document.getElementById('refbanks-title').textContent = '🏷️ ' + BANKS[state.activeBank].label;
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

async function loadPage() {
  const listEl = document.getElementById('refbanks-list');
  const emptyEl = document.getElementById('refbanks-list-empty');
  listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  emptyEl.style.display = 'none';

  const isSearch = !!state.searchText.trim();
  const cursorDoc = isSearch ? null : state.cursorStack[state.cursorIndex];
  const result = await currentService().browse({
    searchText: state.searchText, filters: state.filters,
    sortField: state.sortField, sortDirection: state.sortDirection,
    page: state.page, cursorDoc: cursorDoc,
  });

  if (!result.authorized) { showMessage('denied', result.message); return; }
  if (result.error) { listEl.innerHTML = ''; emptyEl.style.display = 'block'; emptyEl.textContent = result.message; return; }

  state.items = result.items;
  state.hasMore = result.hasMore;
  if (!result.searchMode) state.lastDoc = result.lastDoc;

  const disclaimerEl = document.getElementById('refbanks-search-disclaimer');
  if (result.searchMode && result.truncatedScan) {
    disclaimerEl.style.display = 'block';
    disclaimerEl.textContent = 'Recherche limitée aux éléments les plus récents correspondant aux filtres actifs.';
  } else {
    disclaimerEl.style.display = 'none';
  }

  renderList();
  renderPagination();
}

function renderList() {
  const listEl = document.getElementById('refbanks-list');
  const emptyEl = document.getElementById('refbanks-list-empty');
  if (state.items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'Aucun élément ne correspond à ces critères.';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = state.items.map(rowHtml).join('');
}

function rowHtml(item) {
  const badge = STATUS_BADGES[item.status] || STATUS_BADGES.draft;
  const selected = item.id === state.selectedId ? ' bank-row-selected' : '';
  const extra = currentConfig().extraField;
  return (
    '<div class="bank-row' + selected + '" onclick="selectItem(\'' + escapeHtml(item.id) + '\')">' +
      '<div class="bank-row-top">' +
        '<span class="bank-row-id">' + escapeHtml(item.name) + '</span>' +
        '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>' +
      '</div>' +
      '<div class="bank-row-question">' + escapeHtml((item.description || '').slice(0, 90)) + '</div>' +
      '<div class="bank-row-meta">' + (extra ? escapeHtml(labelForExtraValue(extra, item[extra.key]) || '—') : escapeHtml(item.id)) + '</div>' +
    '</div>'
  );
}
function labelForExtraValue(extra, value) {
  const found = (extra.options || []).find(function(o) { return o.value === value; });
  return found ? found.label : value;
}

function renderPagination() {
  const el = document.getElementById('refbanks-pagination');
  el.innerHTML =
    '<button class="btn-secondary" onclick="goToPage(-1)"' + (state.page === 0 ? ' disabled' : '') + '>← Précédent</button>' +
    '<span class="bank-pagination-label">Page ' + (state.page + 1) + '</span>' +
    '<button class="btn-secondary" onclick="goToPage(1)"' + (!state.hasMore ? ' disabled' : '') + '>Suivant →</button>';
}

export function onSearchInput() {
  state.searchText = valueOf('refbanks-search-input');
  state.page = 0; state.cursorIndex = 0; state.cursorStack = [null];
  loadPage();
}
export function onFilterChange() {
  state.filters.status = document.getElementById('refbanks-filter-status').value;
  state.sortField = document.getElementById('refbanks-sort-field').value;
  state.page = 0; state.cursorIndex = 0; state.cursorStack = [null];
  loadPage();
}
export function toggleSortDirection() {
  state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  document.getElementById('refbanks-sort-dir-btn').textContent = state.sortDirection === 'asc' ? '⬆️' : '⬇️';
  state.page = 0; state.cursorIndex = 0; state.cursorStack = [null];
  loadPage();
}
export function goToPage(direction) {
  const isSearch = !!state.searchText.trim();
  if (isSearch) {
    if (direction > 0 && !state.hasMore) return;
    if (direction < 0 && state.page === 0) return;
    state.page += direction; loadPage(); return;
  }
  if (direction > 0 && state.hasMore) {
    state.cursorStack[state.cursorIndex + 1] = state.lastDoc; state.cursorIndex++; state.page++;
  } else if (direction < 0 && state.cursorIndex > 0) {
    state.cursorIndex--; state.page--;
  } else { return; }
  loadPage();
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export function openCreateForm() {
  const cfg = currentConfig();
  document.getElementById('refbanks-create-title').textContent = 'Nouveau : ' + cfg.titleSingular;
  document.getElementById('refbanks-create-name').value = '';
  document.getElementById('refbanks-create-description').value = '';

  const suggEl = document.getElementById('refbanks-create-suggestions');
  suggEl.innerHTML = cfg.suggestions
    ? '<p class="admin-users-disclaimer" style="margin-bottom:4px;">Suggestions :</p>' +
      cfg.suggestions.map(function(s) { return '<button type="button" class="btn-secondary" style="margin:2px;" onclick="fillSuggestion(\'' + escapeHtml(s) + '\')">' + escapeHtml(s) + '</button>'; }).join('')
    : '';

  const extraEl = document.getElementById('refbanks-create-extra');
  if (cfg.extraField) {
    extraEl.innerHTML = '<label class="bank-edit-label">' + escapeHtml(cfg.extraField.label) + '</label>' +
      '<select id="refbanks-create-extra-input" class="bank-select"><option value="">—</option>' +
      cfg.extraField.options.map(function(o) { return '<option value="' + escapeHtml(o.value) + '">' + escapeHtml(o.label) + '</option>'; }).join('') +
      '</select>';
  } else {
    extraEl.innerHTML = '';
  }

  document.getElementById('refbanks-create-card').style.display = 'block';
}
export function closeCreateForm() {
  document.getElementById('refbanks-create-card').style.display = 'none';
}
export function fillSuggestion(name) {
  document.getElementById('refbanks-create-name').value = name;
}
export async function submitCreate() {
  const cfg = currentConfig();
  const fields = { name: valueOf('refbanks-create-name'), description: valueOf('refbanks-create-description') };
  if (cfg.extraField) {
    const extraInput = document.getElementById('refbanks-create-extra-input');
    if (extraInput) fields[cfg.extraField.key] = extraInput.value;
  }
  const result = await currentService().create(fields);
  showMessage(result.status, result.message);
  if (result.status === 'success') {
    closeCreateForm();
    state.page = 0; state.cursorIndex = 0; state.cursorStack = [null];
    await loadPage();
  }
}

// ---------------------------------------------------------------------------
// Fiche détaillée / édition / actions
// ---------------------------------------------------------------------------

export async function selectItem(id) {
  const item = state.items.find(function(i) { return i.id === id; });
  if (!item) return;
  state.selectedId = id;
  renderList();
  document.getElementById('refbanks-detail-placeholder').style.display = 'none';
  const detailEl = document.getElementById('refbanks-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = detailHtml(item);
  await renderTimeline(item);
}

function detailHtml(item) {
  const cfg = currentConfig();
  const badge = STATUS_BADGES[item.status] || STATUS_BADGES.draft;
  let html = '<div class="bank-detail-card">';
  html += '<div class="bank-detail-header"><h3>' + escapeHtml(item.name) + '</h3><span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span></div>';
  html += '<div class="bank-detail-tags-row"><span class="bank-chip">' + escapeHtml(item.id) + '</span>';
  if (cfg.extraField && item[cfg.extraField.key]) html += '<span class="bank-chip">' + escapeHtml(labelForExtraValue(cfg.extraField, item[cfg.extraField.key])) + '</span>';
  html += '</div>';
  html += '<div class="bank-detail-section"><h4>Description</h4><p>' + escapeHtml(item.description || '—') + '</p></div>';
  html += '<div class="bank-detail-section"><h4>Métadonnées</h4>';
  html += '<div class="bank-detail-row"><strong>Auteur :</strong> ' + escapeHtml(item.author || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Créé le :</strong> ' + escapeHtml(item.createdAt ? formatDateFr(item.createdAt) : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Modifié le :</strong> ' + escapeHtml(item.updatedAt ? formatDateFr(item.updatedAt) : '—') + '</div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Actions</h4><div class="bank-actions-row">';
  if (item.status !== 'trash') {
    if (item.status !== 'published') html += '<button class="btn-primary" onclick="requestAction(\'publish\')">Publier</button>';
    if (item.status !== 'archived') html += '<button class="btn-secondary" onclick="requestAction(\'archive\')">Archiver</button>';
    if (item.status !== 'draft') html += '<button class="btn-secondary" onclick="requestAction(\'draft\')">Remettre en brouillon</button>';
  }
  if (item.status === 'archived') html += '<button class="btn-secondary bank-trash-btn" onclick="requestAction(\'trash\')">🗑️ Mettre à la corbeille</button>';
  if (item.status === 'trash') {
    html += '<button class="btn-secondary" onclick="requestAction(\'restore\')">↩️ Restaurer</button>';
    if (hasPermission(PERMISSIONS.PURGE_REFERENCE_DATA)) html += '<button class="btn-secondary bank-delete-btn" onclick="requestAction(\'purge\')">Supprimer définitivement</button>';
  }
  html += '</div></div>';

  html += '<div class="bank-detail-section"><h4>Historique</h4><div id="refbanks-timeline-container" class="bank-timeline">Chargement…</div></div>';

  html += '<div class="bank-detail-section"><h4>Modifier</h4>';
  html += '<label class="bank-edit-label">Nom</label><input type="text" id="refbanks-edit-name" class="bank-select" value="' + escapeHtml(item.name) + '">';
  html += '<label class="bank-edit-label">Description</label><textarea id="refbanks-edit-description" class="bank-edit-textarea">' + escapeHtml(item.description || '') + '</textarea>';
  if (cfg.extraField) {
    html += '<label class="bank-edit-label">' + escapeHtml(cfg.extraField.label) + '</label>';
    html += '<select id="refbanks-edit-extra-input" class="bank-select"><option value="">—</option>';
    html += cfg.extraField.options.map(function(o) { return '<option value="' + escapeHtml(o.value) + '"' + (item[cfg.extraField.key] === o.value ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>'; }).join('');
    html += '</select>';
  }
  html += '<div class="btn-row"><button class="btn-primary" onclick="saveEdit()">Enregistrer les modifications</button></div>';
  html += '</div></div>';
  return html;
}

async function renderTimeline(item) {
  const container = document.getElementById('refbanks-timeline-container');
  if (!container) return;
  const result = await currentService().getTimeline(item);
  if (!result.authorized) { container.textContent = result.message || 'Accès refusé.'; return; }
  if (result.items.length === 0) { container.textContent = 'Aucun historique disponible.'; return; }
  let html = '<ul class="bank-timeline-list">' + result.items.map(function(entry) {
    const dateLabel = entry.date ? formatDateFr(entry.date) : '—';
    const who = entry.adminEmail ? ' — ' + escapeHtml(entry.adminEmail) : '';
    return '<li class="bank-timeline-item"><div class="bank-timeline-date">' + escapeHtml(dateLabel) + '</div><div class="bank-timeline-label">' + escapeHtml(entry.label) + who + '</div></li>';
  }).join('') + '</ul>';
  if (result.auditUnavailable) html += '<p class="bank-timeline-partial-note">Historique partiel : le journal détaillé n\u2019a pas pu être chargé pour le moment.</p>';
  container.innerHTML = html;
}

export async function saveEdit() {
  const item = state.items.find(function(i) { return i.id === state.selectedId; });
  if (!item) return;
  const cfg = currentConfig();
  const fields = { name: valueOf('refbanks-edit-name'), description: valueOf('refbanks-edit-description') };
  if (cfg.extraField) {
    const extraInput = document.getElementById('refbanks-edit-extra-input');
    if (extraInput) fields[cfg.extraField.key] = extraInput.value;
  }
  const result = await currentService().edit(item, fields);
  showMessage(result.status, result.message);
  if (result.status === 'success') await loadPage();
}

const ACTION_LABELS = {
  publish: 'publier cet élément', archive: 'archiver cet élément', draft: 'remettre cet élément en brouillon',
  trash: 'mettre cet élément à la corbeille', restore: 'restaurer cet élément depuis la corbeille',
  purge: 'supprimer DÉFINITIVEMENT cet élément (irréversible)',
};
export function requestAction(kind) {
  const item = state.items.find(function(i) { return i.id === state.selectedId; });
  if (!item) return;
  pendingAction = { kind: kind, item: item };
  document.getElementById('refbanks-confirm-message').textContent = 'Voulez-vous vraiment ' + (ACTION_LABELS[kind] || kind) + ' « ' + item.name + ' » ?';
  document.getElementById('refbanks-confirm-overlay').style.display = 'flex';
}
export function cancelAction() {
  pendingAction = null;
  document.getElementById('refbanks-confirm-overlay').style.display = 'none';
}
export async function confirmAction() {
  if (!pendingAction) return;
  const { kind, item } = pendingAction;
  document.getElementById('refbanks-confirm-overlay').style.display = 'none';
  const svc = currentService();
  let result;
  if (kind === 'publish') result = await svc.publish(item);
  else if (kind === 'archive') result = await svc.archive(item);
  else if (kind === 'draft') result = await svc.revertToDraft(item);
  else if (kind === 'trash') result = await svc.moveToTrash(item);
  else if (kind === 'restore') result = await svc.restoreFromTrash(item);
  else if (kind === 'purge') result = await svc.permanentlyDelete(item);
  else result = { status: 'error', message: 'Action inconnue.' };
  pendingAction = null;
  showMessage(result.status, result.message);
  if (result.status === 'success') await loadPage();
}

// ---------------------------------------------------------------------------
// Exposition au HTML
// ---------------------------------------------------------------------------

window.switchBank = switchBank;
window.onSearchInput = onSearchInput;
window.onFilterChange = onFilterChange;
window.toggleSortDirection = toggleSortDirection;
window.goToPage = goToPage;
window.openCreateForm = openCreateForm;
window.closeCreateForm = closeCreateForm;
window.fillSuggestion = fillSuggestion;
window.submitCreate = submitCreate;
window.selectItem = selectItem;
window.saveEdit = saveEdit;
window.requestAction = requestAction;
window.cancelAction = cancelAction;
window.confirmAction = confirmAction;
