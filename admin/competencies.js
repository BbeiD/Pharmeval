// ===================== CONTROLEUR DE LA BANQUE DES COMPETENCES (Sprint 13) =====================
// Aucune logique metier ici : ce fichier ne fait qu'appeler
// js/services/competency-service.js et afficher le resultat. Reutilise le
// meme style et les memes classes CSS que admin/parcours.js (Sprint 12) /
// admin/bank.js (Sprint 11).
//
// CORRECTIF (post-import reel) : tout le contenu vient desormais
// exclusivement de l'import Excel. Retires : filtres/tri manuels (recherche
// seule conservee), creation manuelle, migration des anciennes competences
// texte, et toute edition (nom/description/categorie/mots-cles/niveau/
// couleur). Le bouton "Mettre a la corbeille" (reserve auparavant au statut
// "archivee") devient "Supprimer", disponible depuis n'importe quel statut -
// voir js/services/competency-service.js#moveCompetencyToTrash.
//
// Double controle d'acces (meme principe qu'ailleurs dans Pharmeval) :
// 1. Interface : #competencies-view reste masque tant que l'acces n'est pas confirme.
// 2. Logique metier : competency-service.js revalide lui-meme la permission.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatDateFr } from "../js/services/date-utils.js";
import { resolveCompetencyColorHex } from "../js/services/competency-metadata-service.js";
import {
  browseCompetencies, publishCompetency, archiveCompetency, revertCompetencyToDraft,
  moveCompetencyToTrash, restoreCompetencyFromTrash, permanentlyDeleteCompetency,
  countCompetencyUsage, getCompetencyTimeline, publishAllDraftCompetencies,
} from "../js/services/competency-service.js";
import { renderSiteHeader } from "../js/site-header.js";

const STATUS_BADGES = {
  draft: { emoji: '🟡', label: 'Brouillon', cls: 'bank-badge-draft' },
  published: { emoji: '🟢', label: 'Publiée', cls: 'bank-badge-published' },
  archived: { emoji: '⚫', label: 'Archivée', cls: 'bank-badge-archived' },
  trash: { emoji: '🔴', label: 'Corbeille', cls: 'bank-badge-trash' },
};

// CORRECTIF : filters/sortField/sortDirection restent figes aux valeurs
// par defaut ci-dessous (plus de controles dans l'interface) car
// browseCompetencies() les attend toujours.
let state = {
  searchText: '', filters: { status: '', category: '' }, sortField: 'createdAt', sortDirection: 'desc',
  page: 0, cursorStack: [null], cursorIndex: 0,
  items: [], hasMore: false, selectedId: null,
};
let pendingAction = null; // { kind, competency }

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function valueOf(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function capitalizeFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function showCompetenciesMessage(status, message) {
  const el = document.getElementById('competencies-message');
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
  const loadingEl = document.getElementById('competencies-loading');
  const deniedEl = document.getElementById('competencies-denied');
  const viewEl = document.getElementById('competencies-view');

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

  if (!hasPermission(PERMISSIONS.MANAGE_COMPETENCIES)) {
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
// Chargement et rendu de la liste
// ---------------------------------------------------------------------------

async function loadPage() {
  const listEl = document.getElementById('competencies-list');
  const emptyEl = document.getElementById('competencies-list-empty');
  if (listEl) listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  if (emptyEl) emptyEl.style.display = 'none';

  const isSearch = !!state.searchText.trim();
  const cursorDoc = isSearch ? null : state.cursorStack[state.cursorIndex];

  const result = await browseCompetencies({
    searchText: state.searchText, filters: state.filters,
    sortField: state.sortField, sortDirection: state.sortDirection,
    page: state.page, cursorDoc: cursorDoc,
  });

  if (!result.authorized) {
    showCompetenciesMessage('denied', result.message);
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

  const disclaimerEl = document.getElementById('competencies-search-disclaimer');
  if (disclaimerEl) {
    if (result.searchMode && result.truncatedScan) {
      disclaimerEl.style.display = 'block';
      disclaimerEl.textContent = 'Recherche limitée aux compétences les plus récentes correspondant aux filtres actifs.';
    } else {
      disclaimerEl.style.display = 'none';
    }
  }

  renderList(state.items);
  renderPagination();
}

function renderList(items) {
  const listEl = document.getElementById('competencies-list');
  const emptyEl = document.getElementById('competencies-list-empty');
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = 'Aucune compétence ne correspond à ces critères.'; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = items.map(rowHtml).join('');
}

function rowHtml(c) {
  const badge = STATUS_BADGES[c.status] || STATUS_BADGES.draft;
  const selected = c.id === state.selectedId ? ' bank-row-selected' : '';
  const hex = resolveCompetencyColorHex(c.color);
  const dot = hex ? '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + escapeHtml(hex) + ';margin-right:6px;"></span>' : '';
  return (
    '<div class="bank-row' + selected + '" onclick="selectCompetency(\'' + escapeHtml(c.id) + '\')">' +
      '<div class="bank-row-top">' +
        '<span class="bank-row-id">' + dot + escapeHtml(c.name) + '</span>' +
        '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>' +
      '</div>' +
      '<div class="bank-row-question">' + escapeHtml((c.description || '').slice(0, 90)) + '</div>' +
      '<div class="bank-row-meta">' + escapeHtml(c.category || '—') + (c.keywords && c.keywords.length ? ' · ' + c.keywords.length + ' mot(s)-clé(s)' : '') + '</div>' +
    '</div>'
  );
}

function renderPagination() {
  const el = document.getElementById('competencies-pagination');
  if (!el) return;
  const isSearch = !!state.searchText.trim();
  const pageLabel = 'Page ' + (state.page + 1);
  el.innerHTML =
    '<button class="btn-secondary" onclick="goToCompetenciesPage(-1)"' + (state.page === 0 ? ' disabled' : '') + '>← Précédent</button>' +
    '<span class="bank-pagination-label">' + pageLabel + (isSearch ? '' : '') + '</span>' +
    '<button class="btn-secondary" onclick="goToCompetenciesPage(1)"' + (!state.hasMore ? ' disabled' : '') + '>Suivant →</button>';
}

export function onCompetenciesSearchInput() {
  state.searchText = valueOf('competencies-search-input');
  state.page = 0; state.cursorIndex = 0; state.cursorStack = [null];
  loadPage();
}
export function goToCompetenciesPage(direction) {
  const isSearch = !!state.searchText.trim();
  if (isSearch) {
    if (direction > 0 && !state.hasMore) return;
    if (direction < 0 && state.page === 0) return;
    state.page += direction;
    loadPage();
    return;
  }
  if (direction > 0 && state.hasMore) {
    state.cursorStack[state.cursorIndex + 1] = state.lastDoc;
    state.cursorIndex++;
    state.page++;
  } else if (direction < 0 && state.cursorIndex > 0) {
    state.cursorIndex--;
    state.page--;
  } else {
    return;
  }
  loadPage();
}

// ---------------------------------------------------------------------------
// Selection et fiche détaillée
// ---------------------------------------------------------------------------

export async function selectCompetency(id) {
  const c = state.items.find(function(item) { return item.id === id; });
  if (!c) return;
  state.selectedId = id;
  renderList(state.items);

  document.getElementById('competencies-detail-placeholder').style.display = 'none';
  const detailEl = document.getElementById('competencies-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = detailHtml(c);

  await renderUsage(c);
  await renderTimeline(c);
}

function detailHtml(c) {
  const badge = STATUS_BADGES[c.status] || STATUS_BADGES.draft;
  let html = '<div class="bank-detail-card">';

  html += '<div class="bank-detail-header">';
  html += '<h3>' + escapeHtml(c.name) + '</h3>';
  html += '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>';
  html += '</div>';
  html += '<div class="bank-detail-tags-row">';
  html += '<span class="bank-chip">' + escapeHtml(c.id) + '</span>';
  if (c.category) html += '<span class="bank-chip">' + escapeHtml(c.category) + '</span>';
  if (c.recommendedLevel) html += '<span class="bank-chip">' + escapeHtml(capitalizeFirst(c.recommendedLevel)) + '</span>';
  if (c.color) {
    const hex = resolveCompetencyColorHex(c.color);
    html += '<span class="bank-chip" style="background:' + escapeHtml(hex) + ';color:#fff;">' + escapeHtml(capitalizeFirst(c.color)) + '</span>';
  }
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Description</h4><p>' + escapeHtml(c.description || '—') + '</p></div>';

  html += '<div class="bank-detail-section"><h4>Mots-clés</h4>';
  html += (c.keywords && c.keywords.length)
    ? c.keywords.map(function(k) { return '<span class="bank-chip">' + escapeHtml(k) + '</span>'; }).join(' ')
    : '<span class="bank-list-empty" style="padding:0;">Aucun mot-clé.</span>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Métadonnées</h4>';
  html += '<div class="bank-detail-row"><strong>Auteur :</strong> ' + escapeHtml(c.author || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Créée le :</strong> ' + escapeHtml(c.createdAt ? formatDateFr(c.createdAt) : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Modifiée le :</strong> ' + escapeHtml(c.updatedAt ? formatDateFr(c.updatedAt) : '—') + '</div>';
  html += '<div class="bank-detail-row" id="competencies-usage-row"><strong>Utilisée dans :</strong> <span id="competencies-usage-value">calcul en cours…</span></div>';
  html += '</div>';

  // Architecture future (Sprint 13, "Préparer le futur") : compteurs en
  // lecture seule uniquement, aucune interface complexe demandee.
  html += '<div class="bank-detail-section"><h4>Contenu associé (architecture préparée, aucune interface complexe pour l\'instant)</h4>';
  html += '<div class="bank-detail-row"><strong>Questions liées :</strong> ' + (c.questionIds ? c.questionIds.length : 0) + '</div>';
  html += '<div class="bank-detail-row"><strong>Ressources (docs/vidéos/procédures) :</strong> ' + (c.resources ? c.resources.length : 0) + '</div>';
  html += '<div class="bank-detail-row"><strong>Niveaux définis :</strong> ' + (c.levels ? c.levels.length : 0) + '</div>';
  html += '<div class="bank-detail-row"><strong>Badges associés :</strong> ' + (c.badges ? c.badges.length : 0) + '</div>';
  html += '<div class="bank-detail-row"><strong>Recommandations :</strong> ' + (c.recommendations ? c.recommendations.length : 0) + '</div>';
  html += '</div>';

  // CORRECTIF : "Supprimer" (masquage non destructif, corbeille) disponible
  // depuis n'importe quel statut de depart - plus reserve au statut
  // "archivee" (voir competency-service.js#moveCompetencyToTrash).
  html += '<div class="bank-detail-section"><h4>Actions</h4><div class="bank-actions-row">';
  if (c.status !== 'trash') {
    if (c.status !== 'published') html += '<button class="btn-primary" onclick="requestCompetencyAction(\'publish\')">Publier</button>';
    if (c.status !== 'archived') html += '<button class="btn-secondary" onclick="requestCompetencyAction(\'archive\')">Archiver</button>';
    if (c.status !== 'draft') html += '<button class="btn-secondary" onclick="requestCompetencyAction(\'draft\')">Remettre en brouillon</button>';
    html += '<button class="btn-secondary bank-delete-btn" onclick="requestCompetencyAction(\'trash\')">🗑️ Supprimer</button>';
  }
  if (c.status === 'trash') {
    html += '<button class="btn-secondary" onclick="requestCompetencyAction(\'restore\')">↩️ Restaurer</button>';
    if (hasPermission(PERMISSIONS.PURGE_COMPETENCIES)) {
      html += '<button class="btn-secondary bank-delete-btn" onclick="requestCompetencyAction(\'purge\')">Supprimer définitivement</button>';
    }
  }
  html += '</div></div>';

  html += '<div class="bank-detail-section"><h4>Historique</h4><div id="competencies-timeline-container" class="bank-timeline">Chargement…</div></div>';

  html += '</div>';
  return html;
}

async function renderUsage(c) {
  const el = document.getElementById('competencies-usage-value');
  if (!el) return;
  const usage = await countCompetencyUsage(c.id);
  if (usage.error) { el.textContent = 'indisponible pour le moment'; return; }
  el.textContent = usage.count + ' parcours' + (usage.truncated ? ' (parmi les plus récents — décompte partiel)' : '');
}

async function renderTimeline(c) {
  const container = document.getElementById('competencies-timeline-container');
  if (!container) return;
  const result = await getCompetencyTimeline(c);
  if (!result.authorized) { container.textContent = result.message || 'Accès refusé.'; return; }
  if (result.items.length === 0) { container.textContent = 'Aucun historique disponible pour cette compétence.'; return; }
  let html = '<ul class="bank-timeline-list">' + result.items.map(function(entry) {
    const dateLabel = entry.date ? formatDateFr(entry.date) : '—';
    const who = entry.adminEmail ? ' — ' + escapeHtml(entry.adminEmail) : '';
    return '<li class="bank-timeline-item"><div class="bank-timeline-date">' + escapeHtml(dateLabel) + '</div><div class="bank-timeline-label">' + escapeHtml(entry.label) + who + '</div></li>';
  }).join('') + '</ul>';
  if (result.auditUnavailable) {
    html += '<p class="bank-timeline-partial-note">Historique partiel : le journal détaillé des actions n’a pas pu être chargé pour le moment.</p>';
  }
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Actions sensibles (avec confirmation)
// ---------------------------------------------------------------------------

const ACTION_LABELS = {
  publish: 'publier cette compétence',
  archive: 'archiver cette compétence',
  draft: 'remettre cette compétence en brouillon',
  trash: 'supprimer cette compétence (masquée, pas supprimée réellement — restauration possible)',
  restore: 'restaurer cette compétence depuis la corbeille',
  purge: 'supprimer DÉFINITIVEMENT cette compétence (irréversible)',
};

export function requestBulkPublishCompetencies() {
  pendingAction = { kind: 'bulk_publish' };
  document.getElementById('competencies-confirm-message').textContent = 'Publier toutes les compétences actuellement en brouillon ? Les compétences déjà publiées, archivées ou à la corbeille ne seront pas touchées.';
  document.getElementById('competencies-confirm-overlay').style.display = 'flex';
}

export function requestCompetencyAction(kind) {
  const c = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!c) return;
  pendingAction = { kind: kind, competency: c };
  document.getElementById('competencies-confirm-message').textContent =
    'Voulez-vous vraiment ' + (ACTION_LABELS[kind] || kind) + ' « ' + c.name + ' » ?';
  document.getElementById('competencies-confirm-overlay').style.display = 'flex';
}
export function cancelCompetencyAction() {
  pendingAction = null;
  document.getElementById('competencies-confirm-overlay').style.display = 'none';
}
export async function confirmCompetencyAction() {
  if (!pendingAction) return;
  const { kind, competency } = pendingAction;
  document.getElementById('competencies-confirm-overlay').style.display = 'none';
  pendingAction = null;

  if (kind === 'bulk_publish') {
    const bulkResult = await publishAllDraftCompetencies();
    showCompetenciesMessage(bulkResult.status, bulkResult.message);
    if (bulkResult.status === 'success') await loadPage();
    return;
  }

  let result;
  if (kind === 'publish') result = await publishCompetency(competency);
  else if (kind === 'archive') result = await archiveCompetency(competency);
  else if (kind === 'draft') result = await revertCompetencyToDraft(competency);
  else if (kind === 'trash') result = await moveCompetencyToTrash(competency);
  else if (kind === 'restore') result = await restoreCompetencyFromTrash(competency);
  else if (kind === 'purge') result = await permanentlyDeleteCompetency(competency);
  else result = { status: 'error', message: 'Action inconnue.' };

  showCompetenciesMessage(result.status, result.message);
  if (result.status === 'success') await loadPage();
}

// ---------------------------------------------------------------------------
// Exposition au HTML (onclick=...)
// ---------------------------------------------------------------------------

window.onCompetenciesSearchInput = onCompetenciesSearchInput;
window.requestBulkPublishCompetencies = requestBulkPublishCompetencies;
window.goToCompetenciesPage = goToCompetenciesPage;
window.selectCompetency = selectCompetency;
window.requestCompetencyAction = requestCompetencyAction;
window.cancelCompetencyAction = cancelCompetencyAction;
window.confirmCompetencyAction = confirmCompetencyAction;
