// ===================== CONTROLEUR DES ORGANISATIONS (Sprint 13) =====================
// Aucune logique metier ici : ce fichier ne fait qu'appeler
// js/services/organisation-service.js et afficher le resultat. Reutilise
// le meme style, les memes classes CSS et le meme mecanisme de palette de
// couleurs que admin/parcours.js (Sprint 12) - "Reutiliser exactement les
// composants deja developpes pour les Questions et les Parcours" (regle
// de developpement n°3).
//
// CORRECTIF v2.3.1 applique DES LE DEPART ici (jamais reproduit) : le
// champ cache de couleur du formulaire d'edition est initialise avec la
// VALEUR REELLE de l'organisation (palette ou legacy), jamais videe
// silencieusement si elle ne correspond a aucune des 6 couleurs.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatDateFr } from "../js/services/date-utils.js";
import { ORGANISATION_COLOR_HEX, ORGANISATION_TYPE_LABELS, resolveOrganisationColorHex } from "../js/services/organisation-metadata-service.js";
import {
  browseOrganisations, createOrganisation, publishOrganisation, archiveOrganisation, revertOrganisationToDraft,
  moveOrganisationToTrash, restoreOrganisationFromTrash, permanentlyDeleteOrganisation,
  editOrganisationMetadata, getOrganisationDashboard, getOrganisationTimeline,
} from "../js/services/organisation-service.js";

const STATUS_BADGES = {
  draft: { emoji: '🟡', label: 'Brouillon', cls: 'bank-badge-draft' },
  review: { emoji: '🔵', label: 'En relecture', cls: 'bank-badge-review' },
  published: { emoji: '🟢', label: 'Publiée', cls: 'bank-badge-published' },
  archived: { emoji: '⚫', label: 'Archivée', cls: 'bank-badge-archived' },
  trash: { emoji: '🔴', label: 'Corbeille', cls: 'bank-badge-trash' },
};

let state = {
  searchText: '', filters: { status: '', type: '', author: '' }, sortField: 'createdAt', sortDirection: 'desc',
  page: 0, cursorStack: [null], cursorIndex: 0,
  items: [], hasMore: false, selectedId: null,
};
let pendingAction = null;

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('orga-loading');
  const deniedEl = document.getElementById('orga-denied');
  const viewEl = document.getElementById('orga-view');

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

  if (!hasPermission(PERMISSIONS.MANAGE_ORGANISATIONS)) {
    if (deniedEl) deniedEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    return;
  }

  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';

  await loadPage();
});

async function loadPage() {
  const listEl = document.getElementById('orga-list');
  const emptyEl = document.getElementById('orga-list-empty');
  if (listEl) listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  if (emptyEl) emptyEl.style.display = 'none';

  const isSearch = !!state.searchText.trim();
  const cursorDoc = isSearch ? null : state.cursorStack[state.cursorIndex];

  const result = await browseOrganisations({
    searchText: state.searchText, filters: state.filters,
    sortField: state.sortField, sortDirection: state.sortDirection,
    page: state.page, cursorDoc: cursorDoc,
  });

  if (!result.authorized) {
    showOrgaMessage('denied', result.message);
    return;
  }
  if (result.error) {
    if (listEl) listEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = result.message; }
    return;
  }

  state.items = result.items;
  state.hasMore = result.hasMore;
  if (!result.searchMode) state.lastDoc = result.lastDoc;

  const disclaimerEl = document.getElementById('orga-search-disclaimer');
  if (disclaimerEl) {
    if (result.searchMode && result.truncatedScan) {
      disclaimerEl.style.display = 'block';
      disclaimerEl.textContent = 'Recherche limitée aux organisations les plus récentes correspondant aux filtres actifs.';
    } else {
      disclaimerEl.style.display = 'none';
    }
  }

  renderList(state.items);
  renderPagination();
}

function renderList(items) {
  const listEl = document.getElementById('orga-list');
  const emptyEl = document.getElementById('orga-list-empty');
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = 'Aucune organisation ne correspond à ces critères.'; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = items.map(rowHtml).join('');
}

function rowHtml(o) {
  const badge = STATUS_BADGES[o.status] || STATUS_BADGES.draft;
  const selected = o.id === state.selectedId ? ' bank-row-selected' : '';
  const typeLabel = ORGANISATION_TYPE_LABELS[o.type] || o.type || '—';
  return (
    '<div class="bank-row' + selected + '" onclick="selectOrga(\'' + escapeHtml(o.id) + '\')">' +
      '<div class="bank-row-top">' +
        '<span class="bank-row-id">' + escapeHtml(o.name) + '</span>' +
        '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>' +
      '</div>' +
      '<div class="bank-row-question">' + escapeHtml((o.description || '').slice(0, 90)) + '</div>' +
      '<div class="bank-row-meta">' + escapeHtml(typeLabel) + (o.country ? ' · ' + escapeHtml(o.country) : '') + '</div>' +
    '</div>'
  );
}

function renderPagination() {
  const el = document.getElementById('orga-pagination');
  if (!el) return;
  const isSearch = !!state.searchText.trim();
  const canGoBack = isSearch ? state.page > 0 : state.cursorIndex > 0;
  const canGoForward = state.hasMore;
  el.innerHTML =
    '<button class="btn-secondary" onclick="goToOrgaPage(-1)"' + (canGoBack ? '' : ' disabled') + '>← Précédent</button>' +
    '<span class="bank-pagination-label">Page ' + ((isSearch ? state.page : state.cursorIndex) + 1) + '</span>' +
    '<button class="btn-secondary" onclick="goToOrgaPage(1)"' + (canGoForward ? '' : ' disabled') + '>Suivant →</button>';
}

export function goToOrgaPage(delta) {
  const isSearch = !!state.searchText.trim();
  if (isSearch) {
    state.page = Math.max(0, state.page + delta);
  } else {
    if (delta > 0 && state.hasMore) {
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

export function onOrgaSearchInput() {
  state.searchText = valueOf('orga-search-input');
  resetPagination();
  return loadPage();
}

export function onOrgaFilterChange() {
  state.filters.status = valueOf('orga-filter-status');
  state.filters.type = valueOf('orga-filter-type');
  state.filters.author = valueOf('orga-filter-author');
  state.sortField = valueOf('orga-sort-field');
  resetPagination();
  return loadPage();
}

export function toggleOrgaSortDirection() {
  state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  const btn = document.getElementById('orga-sort-dir-btn');
  if (btn) btn.textContent = state.sortDirection === 'desc' ? '⬇️' : '⬆️';
  resetPagination();
  return loadPage();
}

function valueOf(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function colorSwatchesHtml(inputId, selectedColor) {
  const swatches = Object.keys(ORGANISATION_COLOR_HEX).map(function(key) {
    const isSelected = selectedColor === key;
    return '<button type="button" class="parcours-color-swatch' + (isSelected ? ' parcours-color-selected' : '') +
      '" style="background:' + ORGANISATION_COLOR_HEX[key] + ';" onclick="pickOrgaColor(\'' + inputId + '\',\'' + key + '\')" title="' + capitalizeFirst(key) + '"></button>';
  }).join('');
  const noneSelected = !selectedColor || !ORGANISATION_COLOR_HEX[selectedColor];
  const noneBtn = '<button type="button" class="parcours-color-swatch parcours-color-none' + (noneSelected ? ' parcours-color-selected' : '') +
    '" onclick="pickOrgaColor(\'' + inputId + '\',\'\')" title="Aucune couleur">✕</button>';
  return swatches + noneBtn;
}

function colorPickerHtml(inputId, selectedColor) {
  return '<div class="parcours-color-picker" id="' + inputId + '-picker">' + colorSwatchesHtml(inputId, selectedColor) + '</div>' +
         '<input type="hidden" id="' + inputId + '" value="' + escapeHtml(selectedColor || '') + '">';
}

export function pickOrgaColor(inputId, colorValue) {
  const hiddenInput = document.getElementById(inputId);
  if (hiddenInput) hiddenInput.value = colorValue;
  const picker = document.getElementById(inputId + '-picker');
  if (picker) picker.innerHTML = colorSwatchesHtml(inputId, colorValue);
}

function capitalizeFirst(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function openCreateOrgaForm() {
  document.getElementById('orga-create-color-container').innerHTML = colorPickerHtml('orga-create-color', '');
  document.getElementById('orga-create-card').style.display = 'block';
}
export function closeCreateOrgaForm() {
  document.getElementById('orga-create-card').style.display = 'none';
}
export async function submitCreateOrga() {
  const fields = {
    name: valueOf('orga-create-name'),
    description: valueOf('orga-create-description'),
    type: valueOf('orga-create-type'),
    logoUrl: valueOf('orga-create-logo'),
    color: valueOf('orga-create-color'),
    country: valueOf('orga-create-country'),
    primaryLanguage: valueOf('orga-create-language'),
    timezone: valueOf('orga-create-timezone'),
  };
  const result = await createOrganisation(fields);
  showOrgaMessage(result.status, result.message);
  if (result.status === 'success') {
    closeCreateOrgaForm();
    ['orga-create-name', 'orga-create-description', 'orga-create-logo', 'orga-create-country', 'orga-create-language', 'orga-create-timezone'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('orga-create-color-container').innerHTML = '';
    await loadPage();
  }
}

export async function selectOrga(id) {
  const o = state.items.find(function(item) { return item.id === id; });
  if (!o) return;
  state.selectedId = id;
  renderList(state.items);

  document.getElementById('orga-detail-placeholder').style.display = 'none';
  const detailEl = document.getElementById('orga-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = detailHtml(o);

  await renderTimeline(o);
}

function detailHtml(o) {
  const badge = STATUS_BADGES[o.status] || STATUS_BADGES.draft;
  const typeLabel = ORGANISATION_TYPE_LABELS[o.type] || o.type || '—';
  const dashboardResult = getOrganisationDashboard(o);
  const stats = dashboardResult.stats || { parcoursCount: 0, questionsCount: 0, usersCount: 0, campaignsCount: 0 };

  let html = '<div class="bank-detail-card">';

  html += '<div class="bank-detail-header">';
  html += '<h3>' + (o.logoUrl ? '<img src="' + escapeHtml(o.logoUrl) + '" alt="" class="orga-logo-thumb"> ' : '') + escapeHtml(o.name) + '</h3>';
  html += '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>';
  html += '</div>';
  html += '<div class="bank-detail-tags-row">';
  html += '<span class="bank-chip">' + escapeHtml(o.id) + '</span>';
  html += '<span class="bank-chip">' + escapeHtml(typeLabel) + '</span>';
  if (o.color) {
    const hex = resolveOrganisationColorHex(o.color);
    const label = ORGANISATION_COLOR_HEX[o.color] ? capitalizeFirst(o.color) : o.color;
    html += '<span class="bank-chip" style="background:' + escapeHtml(hex) + ';color:#fff;">' + escapeHtml(label) + '</span>';
  }
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Description</h4><p>' + escapeHtml(o.description || '—') + '</p></div>';

  html += '<div class="bank-detail-section"><h4>Tableau de bord <span class="orga-simulated-note">(simulé)</span></h4>';
  html += '<div class="orga-dashboard-grid">';
  html += '<div class="orga-dashboard-stat"><span>' + stats.parcoursCount + '</span><label>Parcours</label></div>';
  html += '<div class="orga-dashboard-stat"><span>' + stats.questionsCount + '</span><label>Questions</label></div>';
  html += '<div class="orga-dashboard-stat"><span>' + stats.usersCount + '</span><label>Utilisateurs</label></div>';
  html += '<div class="orga-dashboard-stat"><span>' + stats.campaignsCount + '</span><label>Campagnes</label></div>';
  html += '</div></div>';

  html += '<div class="bank-detail-section"><h4>Métadonnées</h4>';
  html += '<div class="bank-detail-row"><strong>Pays :</strong> ' + escapeHtml(o.country || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Langue principale :</strong> ' + escapeHtml(o.primaryLanguage || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Fuseau horaire :</strong> ' + escapeHtml(o.timezone || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Auteur :</strong> ' + escapeHtml(o.author || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Créée le :</strong> ' + escapeHtml(o.createdAt ? formatDateFr(o.createdAt) : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Modifiée le :</strong> ' + escapeHtml(o.updatedAt ? formatDateFr(o.updatedAt) : '—') + '</div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Actions</h4><div class="bank-actions-row">';
  if (o.status !== 'trash') {
    if (o.status !== 'published') html += '<button class="btn-primary" onclick="requestOrgaAction(\'publish\')">Publier</button>';
    if (o.status !== 'archived') html += '<button class="btn-secondary" onclick="requestOrgaAction(\'archive\')">Archiver</button>';
    if (o.status !== 'draft') html += '<button class="btn-secondary" onclick="requestOrgaAction(\'draft\')">Remettre en brouillon</button>';
  }
  if (o.status === 'archived') {
    html += '<button class="btn-secondary bank-trash-btn" onclick="requestOrgaAction(\'trash\')">🗑️ Mettre à la corbeille</button>';
  }
  if (o.status === 'trash') {
    html += '<button class="btn-secondary" onclick="requestOrgaAction(\'restore\')">↩️ Restaurer</button>';
    if (hasPermission(PERMISSIONS.PURGE_ORGANISATIONS)) {
      html += '<button class="btn-secondary bank-delete-btn" onclick="requestOrgaAction(\'purge\')">Supprimer définitivement</button>';
    }
  }
  html += '</div></div>';

  html += '<div class="bank-detail-section"><h4>Historique</h4><div id="orga-timeline-container" class="bank-timeline">Chargement…</div></div>';

  html += '<div class="bank-detail-section"><h4>Modifier</h4>';
  html += '<label class="bank-edit-label">Nom</label>';
  html += '<input type="text" id="orga-edit-name" class="bank-select" value="' + escapeHtml(o.name) + '">';
  html += '<label class="bank-edit-label">Description</label>';
  html += '<textarea id="orga-edit-description" class="bank-edit-textarea">' + escapeHtml(o.description || '') + '</textarea>';
  html += '<label class="bank-edit-label">Type</label>';
  html += '<select id="orga-edit-type" class="bank-select">' + Object.keys(ORGANISATION_TYPE_LABELS).map(function(key) {
    return '<option value="' + key + '"' + (o.type === key ? ' selected' : '') + '>' + escapeHtml(ORGANISATION_TYPE_LABELS[key]) + '</option>';
  }).join('') + '</select>';
  html += '<label class="bank-edit-label">Logo (URL)</label>';
  html += '<input type="text" id="orga-edit-logo" class="bank-select" value="' + escapeHtml(o.logoUrl || '') + '">';
  html += '<label class="bank-edit-label">Couleur</label>';
  html += colorPickerHtml('orga-edit-color', o.color || '');
  html += '<label class="bank-edit-label">Pays</label>';
  html += '<input type="text" id="orga-edit-country" class="bank-select" value="' + escapeHtml(o.country || '') + '">';
  html += '<label class="bank-edit-label">Langue principale</label>';
  html += '<input type="text" id="orga-edit-language" class="bank-select" value="' + escapeHtml(o.primaryLanguage || '') + '">';
  html += '<label class="bank-edit-label">Fuseau horaire</label>';
  html += '<input type="text" id="orga-edit-timezone" class="bank-select" value="' + escapeHtml(o.timezone || '') + '">';
  html += '<div class="btn-row"><button class="btn-primary" onclick="saveOrgaEdit()">Enregistrer les modifications</button></div>';
  html += '</div>';

  html += '</div>';
  return html;
}

async function renderTimeline(o) {
  const container = document.getElementById('orga-timeline-container');
  if (!container) return;
  const result = await getOrganisationTimeline(o);
  if (!result.authorized) { container.textContent = result.message || 'Accès refusé.'; return; }
  if (result.items.length === 0) { container.textContent = 'Aucun historique disponible pour cette organisation.'; return; }
  let html = '<ul class="bank-timeline-list">' + result.items.map(function(entry) {
    const dateLabel = entry.date ? formatDateFr(entry.date) : '—';
    const who = entry.adminEmail ? ' — ' + escapeHtml(entry.adminEmail) : '';
    return '<li class="bank-timeline-item"><div class="bank-timeline-date">' + escapeHtml(dateLabel) + '</div><div class="bank-timeline-label">' + escapeHtml(entry.label) + who + '</div></li>';
  }).join('') + '</ul>';
  if (result.auditUnavailable) {
    html += '<p class="bank-timeline-partial-note">Historique partiel : le journal détaillé des actions n\u2019a pas pu être chargé pour le moment.</p>';
  }
  container.innerHTML = html;
}

export async function saveOrgaEdit() {
  const o = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!o) return;
  const fields = {
    name: valueOf('orga-edit-name'),
    description: valueOf('orga-edit-description'),
    type: valueOf('orga-edit-type'),
    logoUrl: valueOf('orga-edit-logo'),
    color: valueOf('orga-edit-color'),
    country: valueOf('orga-edit-country'),
    primaryLanguage: valueOf('orga-edit-language'),
    timezone: valueOf('orga-edit-timezone'),
  };
  const result = await editOrganisationMetadata(o, fields);
  showOrgaMessage(result.status, result.message);
  if (result.status === 'success') await loadPage();
}

const ACTION_LABELS = {
  publish: 'publier', archive: 'archiver', draft: 'remettre en brouillon',
  trash: 'mettre à la corbeille', restore: 'restaurer depuis la corbeille', purge: 'supprimer définitivement',
};

export function requestOrgaAction(kind) {
  const o = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!o) return;
  pendingAction = { kind: kind, organisation: o };
  const verb = ACTION_LABELS[kind] || kind;
  let extra = '';
  if (kind === 'purge') extra = ' Cette action est définitive et ne peut pas être annulée.';
  else if (kind === 'trash') extra = ' Cette organisation pourra être restaurée depuis la corbeille, ou supprimée définitivement plus tard.';
  document.getElementById('orga-confirm-message').textContent = 'Voulez-vous vraiment ' + verb + ' l\'organisation « ' + o.name + ' » ?' + extra;
  document.getElementById('orga-confirm-overlay').style.display = 'flex';
}

export function cancelOrgaAction() {
  pendingAction = null;
  document.getElementById('orga-confirm-overlay').style.display = 'none';
}

export async function confirmOrgaAction() {
  document.getElementById('orga-confirm-overlay').style.display = 'none';
  if (!pendingAction) return;
  const action = pendingAction;
  pendingAction = null;

  let result;
  if (action.kind === 'publish') result = await publishOrganisation(action.organisation);
  else if (action.kind === 'archive') result = await archiveOrganisation(action.organisation);
  else if (action.kind === 'draft') result = await revertOrganisationToDraft(action.organisation);
  else if (action.kind === 'trash') result = await moveOrganisationToTrash(action.organisation);
  else if (action.kind === 'restore') result = await restoreOrganisationFromTrash(action.organisation);
  else if (action.kind === 'purge') result = await permanentlyDeleteOrganisation(action.organisation);

  showOrgaMessage(result.status, result.message);
  if (result.status === 'success') {
    if (action.kind === 'purge') {
      state.selectedId = null;
      document.getElementById('orga-detail').style.display = 'none';
      document.getElementById('orga-detail-placeholder').style.display = 'block';
    }
    await loadPage();
  }
}

function showOrgaMessage(status, text) {
  const el = document.getElementById('orga-message');
  if (!el) return;
  el.className = 'admin-message admin-message-' + status;
  el.textContent = text;
  el.style.display = 'block';
}

function escapeHtml(s) {
  return (s === undefined || s === null ? '' : s).toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

window.onOrgaSearchInput = onOrgaSearchInput;
window.onOrgaFilterChange = onOrgaFilterChange;
window.toggleOrgaSortDirection = toggleOrgaSortDirection;
window.goToOrgaPage = goToOrgaPage;
window.openCreateOrgaForm = openCreateOrgaForm;
window.closeCreateOrgaForm = closeCreateOrgaForm;
window.submitCreateOrga = submitCreateOrga;
window.selectOrga = selectOrga;
window.saveOrgaEdit = saveOrgaEdit;
window.pickOrgaColor = pickOrgaColor;
window.requestOrgaAction = requestOrgaAction;
window.cancelOrgaAction = cancelOrgaAction;
window.confirmOrgaAction = confirmOrgaAction;
