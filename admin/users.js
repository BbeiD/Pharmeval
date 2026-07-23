// ===================== CONTROLEUR DU MODULE UTILISATEURS (Sprint 14) =====================
// Aucune logique metier ici : appelle js/services/user-directory-service.js
// (orchestration) et affiche le resultat - meme discipline que les autres
// ecrans d'administration (admin/competencies.js, admin/parcours.js,
// admin/reference-banks.js).

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument, PROFESSION_OPTIONS, ORGANIZATION_TYPE_OPTIONS } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatDateFr } from "../js/services/date-utils.js";
import { formatUserFullName } from "../js/services/user-profile-metadata-service.js";
import {
  browseUsers, getUserDetail, loadReferenceOptions,
  deactivateUser, reactivateUser, editUserBusinessProfile, getUserTimeline,
  createPendingInvite, createPendingInvitesBulk, listPendingInvites, cancelPendingInvite,
} from "../js/services/user-directory-service.js";
import { parseUserImportWorkbook, buildUserImportTemplateWorkbook } from "../js/services/user-bulk-import-service.js";
import { renderSiteHeader } from "../js/site-header.js";
import { icon, renderAnyIcon } from "../js/icons.js";

// CORRECTIF (bibliotheque d'icones, remplace les emojis) : `emoji` contient
// desormais le SVG inline deja rendu (icon(...)), plus un caractere - les
// sites d'appel (badge.emoji + ' ' + badge.label) restent inchanges.
const STATUS_BADGES = {
  active: { emoji: icon('status-published-active', { size: 14 }), label: 'Actif', cls: 'bank-badge-published' },
  suspended: { emoji: icon('status-archived', { size: 14 }), label: 'Désactivé', cls: 'bank-badge-archived' },
  pending: { emoji: icon('status-draft', { size: 14 }), label: 'En attente', cls: 'bank-badge-draft' },
};

let state = {
  searchText: '', filters: { status: '', organizationId: '', profileId: '', groupId: '' },
  page: 0, items: [], hasMore: false, selectedId: null,
};
let refOptions = { organizations: [], profiles: [], groups: [] };
let pendingAction = null;
let bulkImportRows = [];

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function valueOf(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function optionLabel(options, value) {
  const opt = options.find(function(o) { return o.value === value; });
  return opt ? opt.label : null;
}
function showMessage(status, message) {
  const el = document.getElementById('users-message');
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
  const loadingEl = document.getElementById('users-loading');
  const deniedEl = document.getElementById('users-denied');
  const viewEl = document.getElementById('users-view');

  if (!user) { clearCurrentUserContext(); window.location.href = '../index.html'; return; }
  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) { console.error('Erreur lors de la vérification du compte :', err); }

  if (loadingEl) loadingEl.style.display = 'none';
  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) {
    if (deniedEl) deniedEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    return;
  }
  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('administration');

  await loadReferenceSelectors();
  await loadPage();
});

async function loadReferenceSelectors() {
  refOptions = await loadReferenceOptions();
  fillSelect('users-filter-organization', refOptions.organizations, 'Organisation : Toutes');
  fillSelect('users-filter-profile', refOptions.profiles, 'Profil : Tous');
  fillSelect('users-filter-group', refOptions.groups, 'Groupe : Tous');
  fillSelect('users-invite-organization', refOptions.organizations, '—');
  fillSelect('users-invite-profile', refOptions.profiles, '—');

  const groupsContainer = document.getElementById('users-invite-groups');
  groupsContainer.innerHTML = refOptions.groups.length
    ? refOptions.groups.map(function(g) {
        return '<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;"><input type="checkbox" value="' + escapeHtml(g.id) + '" class="users-invite-group-checkbox"> ' + escapeHtml(g.name) + '</label>';
      }).join('')
    : '<span class="bank-list-empty" style="padding:0;">Aucun groupe publié pour l\'instant.</span>';
}
function fillSelect(elId, items, placeholder) {
  const el = document.getElementById(elId);
  if (!el) return;
  const current = el.value;
  el.innerHTML = '<option value="">' + escapeHtml(placeholder) + '</option>' +
    items.map(function(i) { return '<option value="' + escapeHtml(i.id) + '">' + escapeHtml(i.name) + '</option>'; }).join('');
  el.value = current;
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

async function loadPage() {
  const listEl = document.getElementById('users-list');
  const emptyEl = document.getElementById('users-list-empty');
  listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  emptyEl.style.display = 'none';

  const result = await browseUsers({ searchText: state.searchText, filters: state.filters, page: state.page });
  if (!result.authorized) { showMessage('denied', result.message); return; }
  if (result.error) { listEl.innerHTML = ''; emptyEl.style.display = 'block'; emptyEl.textContent = result.message; return; }

  state.items = result.items;
  state.hasMore = result.hasMore;

  const disclaimerEl = document.getElementById('users-search-disclaimer');
  if (result.truncatedScan) {
    disclaimerEl.style.display = 'block';
    disclaimerEl.textContent = 'Liste limitée aux comptes les plus récents (balayage borné).';
  } else {
    disclaimerEl.style.display = 'none';
  }

  renderList();
  renderPagination();
}

function renderList() {
  const listEl = document.getElementById('users-list');
  const emptyEl = document.getElementById('users-list-empty');
  if (state.items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'Aucun utilisateur ne correspond à ces critères.';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = state.items.map(userTileHtml).join('');
}

// CORRECTIF (demande directe de David, 23/07/2026) : tuile a icone (meme
// composant que admin/document-sources.js, .source-tile) plutot que la
// liste bank-row - n'affiche QUE l'e-mail et le statut (pastille de
// couleur, coin superieur droit), jamais le nom/l'organisation/le profil
// ici (la fiche complete reste accessible au clic, panneau de detail en
// dessous).
const USER_STATUS_DOT = { active: 'dot-green', suspended: 'dot-red', pending: 'dot-orange' };

function userTileHtml(u) {
  const badge = STATUS_BADGES[u.status] || STATUS_BADGES.active;
  const selectedCls = u.uid === state.selectedId ? ' source-tile-selected' : '';
  const dotKey = USER_STATUS_DOT[u.status] || 'dot-white-grey';
  return (
    '<button type="button" class="source-tile' + selectedCls + '" onclick="selectUser(\'' + escapeHtml(u.uid) + '\')" title="' + escapeHtml((u.email || '') + ' · ' + badge.label) + '">' +
      '<span class="source-tile-status-dot" aria-hidden="true">' + renderAnyIcon(dotKey, { size: 12 }) + '</span>' +
      '<span class="source-tile-emoji" aria-hidden="true">' + icon('nav-profile', { size: 24 }) + '</span>' +
      '<span class="source-tile-name">' + escapeHtml(u.email || '(sans e-mail)') + '</span>' +
    '</button>'
  );
}

function renderPagination() {
  const el = document.getElementById('users-pagination');
  el.innerHTML =
    '<button class="btn-secondary" onclick="goToUsersPage(-1)"' + (state.page === 0 ? ' disabled' : '') + '>← Précédent</button>' +
    '<span class="bank-pagination-label">Page ' + (state.page + 1) + '</span>' +
    '<button class="btn-secondary" onclick="goToUsersPage(1)"' + (!state.hasMore ? ' disabled' : '') + '>Suivant →</button>';
}

export function onUsersSearchInput() {
  state.searchText = valueOf('users-search-input');
  state.page = 0; loadPage();
}
export function onUsersFilterChange() {
  state.filters.status = document.getElementById('users-filter-status').value;
  state.filters.organizationId = document.getElementById('users-filter-organization').value;
  state.filters.profileId = document.getElementById('users-filter-profile').value;
  state.filters.groupId = document.getElementById('users-filter-group').value;
  state.page = 0; loadPage();
}
export function goToUsersPage(direction) {
  if (direction > 0 && !state.hasMore) return;
  if (direction < 0 && state.page === 0) return;
  state.page += direction;
  loadPage();
}

// ---------------------------------------------------------------------------
// Fiche détaillée / édition / actions
// ---------------------------------------------------------------------------

export async function selectUser(uid) {
  state.selectedId = uid;
  renderList();
  document.getElementById('users-detail-placeholder').style.display = 'none';
  const detailEl = document.getElementById('users-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  const user = await getUserDetail(uid);
  if (!user) { detailEl.innerHTML = '<p>Utilisateur introuvable.</p>'; return; }
  detailEl.innerHTML = detailHtml(user);
  await renderTimeline(user);
}

function detailHtml(u) {
  const badge = STATUS_BADGES[u.status] || STATUS_BADGES.active;
  let html = '<div class="bank-detail-card">';
  // CORRECTIF (demande directe de David, 23/07/2026) : .bank-detail-header
  // h3 est en police monospace ailleurs dans l'appli (pensee pour des
  // codes) - un nom d'utilisateur est du texte normal, meme correctif que
  // "Mes competences".
  html += '<div class="bank-detail-header"><h3 style="font-family:inherit;">' + escapeHtml(formatUserFullName(u)) + '</h3><span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span></div>';
  html += '<div class="bank-detail-tags-row"><span class="bank-chip">' + escapeHtml(u.uid) + '</span><span class="bank-chip">' + escapeHtml(u.email) + '</span></div>';

  html += '<div class="bank-detail-section"><h4>Fiche</h4>';
  html += '<div class="bank-detail-row"><strong>Organisation :</strong> ' + escapeHtml(u.organizationLabel || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Profil :</strong> ' + escapeHtml(u.profileLabel || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Groupe(s) :</strong> ' + (u.groupLabels && u.groupLabels.length ? u.groupLabels.map(escapeHtml).join(', ') : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Créé le :</strong> ' + escapeHtml(u.createdAt ? formatDateFr(u.createdAt) : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Dernière connexion :</strong> ' + escapeHtml(u.lastLogin ? formatDateFr(u.lastLogin) : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Auteur de création :</strong> ' + escapeHtml(u.createdBy ? u.createdBy : 'Auto-inscription') + '</div>';
  html += '</div>';

  // AJOUT : la fiche n'affichait jusqu'ici que les champs "metier" geres
  // par un administrateur (organisation/profil/groupe(s), via
  // editUserBusinessProfile) - jamais les informations DECLAREES par
  // l'utilisateur lui-meme lors de l'assistant de premiere connexion
  // (js/onboarding.js -> saveOnboardingProfile(), stockees sous le
  // sous-objet Firestore `profile.*`, DISTINCT de organizationId/profileId
  // ci-dessus). Champs obligatoires cote onboarding (voir onboarding.js) :
  // absents ici, une fiche jamais completee doit donc etre visible comme
  // telle, pas seulement silencieusement vide.
  html += '<div class="bank-detail-section"><h4>Profil déclaré (première connexion)</h4>';
  if (u.profileCompleted) {
    const profile = u.profile || {};
    const professionLabel = profile.profession === 'other'
      ? (profile.professionOther || 'Autre')
      : (optionLabel(PROFESSION_OPTIONS, profile.profession) || profile.profession);
    const organizationTypeLabel = profile.organizationType === 'other'
      ? (profile.organizationTypeOther || 'Autre')
      : (optionLabel(ORGANIZATION_TYPE_OPTIONS, profile.organizationType) || profile.organizationType);
    html += '<div class="bank-detail-row"><strong>Profession :</strong> ' + escapeHtml(professionLabel || '—') + '</div>';
    html += '<div class="bank-detail-row"><strong>Type d\'organisation :</strong> ' + escapeHtml(organizationTypeLabel || '—') + '</div>';
    html += '<div class="bank-detail-row"><strong>Nom de l\'organisation (déclaré) :</strong> ' + escapeHtml(profile.organizationName || '—') + '</div>';
  } else {
    html += '<div class="bank-detail-row">Cet utilisateur n\'a pas encore complété l\'assistant de première connexion.</div>';
  }
  html += '</div>';

  // Architecture future (Sprint 14, "Préparer l'avenir") : compteurs en
  // lecture seule uniquement, aucune interface complexe demandee.
  html += '<div class="bank-detail-section"><h4>Contenu associé (architecture préparée, aucune interface complexe pour l\'instant)</h4>';
  html += '<div class="bank-detail-row"><strong>Parcours attribués :</strong> ' + (u.assignedParcoursIds ? u.assignedParcoursIds.length : 0) + '</div>';
  html += '<div class="bank-detail-row"><strong>Compétences validées :</strong> ' + (u.validatedCompetencyIds ? u.validatedCompetencyIds.length : 0) + '</div>';
  html += '<div class="bank-detail-row"><strong>Badges :</strong> ' + (u.badges ? u.badges.length : 0) + '</div>';
  html += '<div class="bank-detail-row"><strong>Certificats :</strong> ' + (u.certificates ? u.certificates.length : 0) + '</div>';
  html += '<div class="bank-detail-row"><strong>Historique de formations :</strong> ' + (u.trainingHistory ? u.trainingHistory.length : 0) + '</div>';
  html += '<div class="bank-detail-row"><strong>Résultats d\'évaluations :</strong> ' + (u.evaluationResults ? u.evaluationResults.length : 0) + '</div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Actions</h4><div class="bank-actions-row">';
  if ((u.status || 'active') === 'suspended') {
    html += '<button class="btn-primary" onclick="requestUserAction(\'reactivate\')">Réactiver</button>';
  } else {
    html += '<button class="btn-secondary bank-trash-btn" onclick="requestUserAction(\'deactivate\')">Désactiver</button>';
  }
  html += '</div></div>';

  html += '<div class="bank-detail-section"><h4>Historique</h4><div id="users-timeline-container" class="bank-timeline">Chargement…</div></div>';

  html += '<div class="bank-detail-section"><h4>Modifier</h4>';
  html += '<label class="bank-edit-label">Prénom</label><input type="text" id="users-edit-firstname" class="bank-select" value="' + escapeHtml(u.firstName || '') + '">';
  html += '<label class="bank-edit-label">Nom</label><input type="text" id="users-edit-lastname" class="bank-select" value="' + escapeHtml(u.lastName || '') + '">';
  html += '<label class="bank-edit-label">Organisation</label><select id="users-edit-organization" class="bank-select"><option value="">—</option>' +
    refOptions.organizations.map(function(o) { return '<option value="' + escapeHtml(o.id) + '"' + (u.organizationId === o.id ? ' selected' : '') + '>' + escapeHtml(o.name) + '</option>'; }).join('') + '</select>';
  html += '<label class="bank-edit-label">Profil</label><select id="users-edit-profile" class="bank-select"><option value="">—</option>' +
    refOptions.profiles.map(function(p) { return '<option value="' + escapeHtml(p.id) + '"' + (u.profileId === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>'; }).join('') + '</select>';
  html += '<label class="bank-edit-label">Groupe(s)</label><div id="users-edit-groups">' +
    refOptions.groups.map(function(g) {
      const checked = Array.isArray(u.groupIds) && u.groupIds.indexOf(g.id) !== -1;
      return '<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;"><input type="checkbox" value="' + escapeHtml(g.id) + '" class="users-edit-group-checkbox"' + (checked ? ' checked' : '') + '> ' + escapeHtml(g.name) + '</label>';
    }).join('') + '</div>';
  html += '<div class="btn-row"><button class="btn-primary" onclick="saveUserEdit()">Enregistrer les modifications</button></div>';
  html += '</div></div>';
  return html;
}

async function renderTimeline(u) {
  const container = document.getElementById('users-timeline-container');
  if (!container) return;
  const result = await getUserTimeline(u.uid);
  if (result.error) { container.textContent = 'Historique indisponible pour le moment.'; return; }
  if (result.items.length === 0) { container.textContent = 'Aucun historique disponible pour cet utilisateur.'; return; }
  container.innerHTML = '<ul class="bank-timeline-list">' + result.items.map(function(entry) {
    const dateLabel = entry.date ? formatDateFr(entry.date) : '—';
    const who = entry.adminEmail ? ' — ' + escapeHtml(entry.adminEmail) : '';
    return '<li class="bank-timeline-item"><div class="bank-timeline-date">' + escapeHtml(dateLabel) + '</div><div class="bank-timeline-label">' + escapeHtml(describeAuditEntry(entry)) + who + '</div></li>';
  }).join('') + '</ul>';
}
function describeAuditEntry(entry) {
  if (entry.actionType === 'account_created') return 'Compte créé';
  if (entry.actionType === 'evaluation_completed') {
    const pct = (typeof entry.percent === 'number') ? entry.percent + ' %' : '—';
    return 'Évaluation terminée — ' + pct + ' (' + entry.correct + '/' + entry.total + ')';
  }
  if (entry.actionType === 'role_change') return 'Changement de rôle (' + entry.oldValue + ' → ' + entry.newValue + ')';
  if (entry.actionType === 'status_change') return 'Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')';
  if (entry.actionType && entry.actionType.indexOf('business_profile_edit_') === 0) return 'Modification (' + entry.actionType.replace('business_profile_edit_', '') + ')';
  return 'Action (' + entry.actionType + ')';
}

export async function saveUserEdit() {
  const u = state.items.find(function(item) { return item.uid === state.selectedId; }) || { uid: state.selectedId };
  const groupIds = Array.from(document.querySelectorAll('.users-edit-group-checkbox:checked')).map(function(cb) { return cb.value; });
  const fields = {
    firstName: valueOf('users-edit-firstname'),
    lastName: valueOf('users-edit-lastname'),
    organizationId: valueOf('users-edit-organization') || null,
    profileId: valueOf('users-edit-profile') || null,
    groupIds: groupIds,
  };
  const result = await editUserBusinessProfile(u, fields);
  showMessage(result.status, result.message);
  if (result.status === 'success') { await loadPage(); await selectUser(u.uid); }
}

const ACTION_LABELS = { deactivate: 'désactiver ce compte', reactivate: 'réactiver ce compte' };
export function requestUserAction(kind) {
  const uid = state.selectedId;
  if (!uid) return;
  pendingAction = { kind: kind, uid: uid };
  document.getElementById('users-confirm-message').textContent = 'Voulez-vous vraiment ' + (ACTION_LABELS[kind] || kind) + ' ?';
  document.getElementById('users-confirm-overlay').style.display = 'flex';
}
export function cancelUserAction() {
  pendingAction = null;
  document.getElementById('users-confirm-overlay').style.display = 'none';
}
export async function confirmUserAction() {
  if (!pendingAction) return;
  const { kind, uid } = pendingAction;
  document.getElementById('users-confirm-overlay').style.display = 'none';
  const user = await getUserDetail(uid);
  let result;
  if (kind === 'deactivate') result = await deactivateUser(user);
  else if (kind === 'reactivate') result = await reactivateUser(user);
  else result = { status: 'error', message: 'Action inconnue.' };
  pendingAction = null;
  showMessage(result.status, result.message);
  if (result.status === 'success') { await loadPage(); await selectUser(uid); }
}

// ---------------------------------------------------------------------------
// Pré-provisionnement ("création", voir user-invite-service.js)
// ---------------------------------------------------------------------------

export async function openInviteForm() {
  document.getElementById('users-invite-email').value = '';
  document.getElementById('users-invite-firstname').value = '';
  document.getElementById('users-invite-lastname').value = '';
  document.getElementById('users-invite-organization').value = '';
  document.getElementById('users-invite-profile').value = '';
  document.querySelectorAll('.users-invite-group-checkbox').forEach(function(cb) { cb.checked = false; });
  document.getElementById('users-invite-card').style.display = 'block';
  await renderPendingInvitesList();
}
export function closeInviteForm() {
  document.getElementById('users-invite-card').style.display = 'none';
}
export async function submitInvite() {
  const groupIds = Array.from(document.querySelectorAll('.users-invite-group-checkbox:checked')).map(function(cb) { return cb.value; });
  const fields = {
    email: valueOf('users-invite-email'),
    firstName: valueOf('users-invite-firstname'),
    lastName: valueOf('users-invite-lastname'),
    organizationId: valueOf('users-invite-organization') || null,
    profileId: valueOf('users-invite-profile') || null,
    groupIds: groupIds,
  };
  const result = await createPendingInvite(fields);
  showMessage(result.status, result.message);
  if (result.status === 'success') { await renderPendingInvitesList(); }
}
async function renderPendingInvitesList() {
  const container = document.getElementById('users-pending-invites-list');
  container.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  const result = await listPendingInvites();
  if (result.error) { container.innerHTML = '<p>Impossible de charger les pré-provisions en attente.</p>'; return; }
  if (result.items.length === 0) { container.innerHTML = '<p class="bank-list-empty" style="padding:0;">Aucune pré-provision en attente.</p>'; return; }
  container.innerHTML = '<h4>Pré-provisions en attente (' + result.items.length + ')</h4>' +
    result.items.map(function(inv) {
      return '<div class="bank-row"><div class="bank-row-top"><span class="users-row-name">' + escapeHtml([inv.firstName, inv.lastName].filter(Boolean).join(' ') || inv.email) + '</span>' +
        '<button class="btn-secondary bank-delete-btn" onclick="cancelInvite(\'' + escapeHtml(inv.email) + '\')">Annuler</button></div>' +
        '<div class="bank-row-question">' + escapeHtml(inv.email) + '</div></div>';
    }).join('');
}
export async function cancelInvite(email) {
  const result = await cancelPendingInvite(email);
  showMessage(result.status, result.message);
  await renderPendingInvitesList();
}

// ---------------------------------------------------------------------------
// Import en masse (Excel) - demande directe de David, 23/07/2026
// ---------------------------------------------------------------------------

export function openBulkImportForm() {
  document.getElementById('users-bulk-file-input').value = '';
  document.getElementById('users-bulk-preview').innerHTML = '';
  bulkImportRows = [];
  document.getElementById('users-bulk-import-card').style.display = 'block';
}
export function closeBulkImportForm() {
  document.getElementById('users-bulk-import-card').style.display = 'none';
}
export function downloadUserImportTemplate() {
  const wb = buildUserImportTemplateWorkbook(window.XLSX, refOptions);
  window.XLSX.writeFile(wb, 'Modele_import_utilisateurs.xlsx');
}
export async function analyzeBulkImportFile() {
  const input = document.getElementById('users-bulk-file-input');
  const previewEl = document.getElementById('users-bulk-preview');
  const file = input.files && input.files[0];
  if (!file) { previewEl.innerHTML = '<p class="admin-message admin-message-error" style="display:block;">Choisissez d\'abord un fichier Excel.</p>'; return; }

  previewEl.innerHTML = '<div class="bank-list-loading">Analyse du fichier…</div>';
  const arrayBuffer = await file.arrayBuffer();
  let parsed;
  try {
    parsed = parseUserImportWorkbook(window.XLSX, arrayBuffer, refOptions);
  } catch (err) {
    console.error('[admin/users] échec de lecture du fichier d\'import', err);
    previewEl.innerHTML = '<p class="admin-message admin-message-error" style="display:block;">Fichier illisible - vérifiez qu\'il s\'agit bien d\'un .xlsx exporté depuis le modèle.</p>';
    bulkImportRows = [];
    return;
  }
  if (parsed.headerError) {
    previewEl.innerHTML = '<p class="admin-message admin-message-error" style="display:block;">' + escapeHtml(parsed.headerError) + '</p>';
    bulkImportRows = [];
    return;
  }
  bulkImportRows = parsed.rows;
  renderBulkPreview();
}
function renderBulkPreview() {
  const previewEl = document.getElementById('users-bulk-preview');
  const validRows = bulkImportRows.filter(function(r) { return r.valid; });
  const errorCount = bulkImportRows.length - validRows.length;

  let html = '<p>' + validRows.length + ' ligne(s) valide(s), ' + errorCount + ' en erreur (sur ' + bulkImportRows.length + ' au total).</p>';
  html += '<div style="max-height:280px;overflow-y:auto;"><table class="bank-table"><thead><tr><th>Ligne</th><th>E-mail</th><th>Statut</th></tr></thead><tbody>';
  html += bulkImportRows.map(function(r) {
    const statusCell = r.valid
      ? '<span class="bank-badge bank-badge-published">OK</span>'
      : '<span class="bank-badge bank-badge-archived">' + escapeHtml(r.errors.join(' ; ')) + '</span>';
    return '<tr><td>' + r.rowNumber + '</td><td>' + escapeHtml(r.email || '—') + '</td><td>' + statusCell + '</td></tr>';
  }).join('') + '</tbody></table></div>';

  if (validRows.length > 0) {
    html += '<div class="btn-row"><button class="btn-primary" onclick="confirmBulkImportClick()">Confirmer l\'import (' + validRows.length + ' ligne(s))</button></div>';
  }
  previewEl.innerHTML = html;
}
export async function confirmBulkImportClick() {
  const validRows = bulkImportRows.filter(function(r) { return r.valid; });
  const previewEl = document.getElementById('users-bulk-preview');
  previewEl.innerHTML = '<div class="bank-list-loading">Import en cours (' + validRows.length + ' fiche(s))…</div>';

  const results = await createPendingInvitesBulk(validRows);
  const successes = results.filter(function(r) { return r.status === 'success'; });
  const failures = results.filter(function(r) { return r.status !== 'success'; });

  let html = '<p class="admin-message admin-message-' + (failures.length ? 'error' : 'success') + '" style="display:block;">' +
    successes.length + ' fiche(s) pré-provisionnée(s) avec succès' + (failures.length ? ', ' + failures.length + ' échec(s) ci-dessous.' : '.') + '</p>';
  if (failures.length) {
    html += '<ul>' + failures.map(function(f) { return '<li>' + escapeHtml(f.email) + ' : ' + escapeHtml(f.message) + '</li>'; }).join('') + '</ul>';
  }
  previewEl.innerHTML = html;
  bulkImportRows = [];
  await renderPendingInvitesList();
}

// ---------------------------------------------------------------------------
// Exposition au HTML
// ---------------------------------------------------------------------------

window.onUsersSearchInput = onUsersSearchInput;
window.onUsersFilterChange = onUsersFilterChange;
window.goToUsersPage = goToUsersPage;
window.selectUser = selectUser;
window.saveUserEdit = saveUserEdit;
window.requestUserAction = requestUserAction;
window.cancelUserAction = cancelUserAction;
window.confirmUserAction = confirmUserAction;
window.openInviteForm = openInviteForm;
window.closeInviteForm = closeInviteForm;
window.submitInvite = submitInvite;
window.cancelInvite = cancelInvite;
window.openBulkImportForm = openBulkImportForm;
window.closeBulkImportForm = closeBulkImportForm;
window.downloadUserImportTemplate = downloadUserImportTemplate;
window.analyzeBulkImportFile = analyzeBulkImportFile;
window.confirmBulkImportClick = confirmBulkImportClick;
