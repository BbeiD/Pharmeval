// ===================== CENTRE D'ADMINISTRATION =====================
// Sprint 3 : zone minimale (bienvenue, version, utilisateur, role).
// Sprint 8 : veritable Centre d'administration - gestion des utilisateurs
// (tableau, recherche, filtres, roles, statuts), avec confirmation
// systematique avant toute action sensible et journalisation via
// js/services/audit-service.js (indirectement, par js/services/admin-service.js).
//
// Aucune logique metier dans ce fichier : toute decision (qui peut faire
// quoi, journalisation) est deleguee aux services. Ce fichier ne fait
// qu'appeler js/services/admin-service.js, js/services/user-management-
// service.js et js/services/authorization-service.js, et afficher le
// resultat.
//
// Double controle d'acces (inchange depuis le Sprint 3 dans son principe,
// fonde sur une permission nommee depuis ce sprint pour l'evolutivite -
// voir RAPPORT_SPRINT8.md, "Preparer l'avenir") :
// 1. Interface : le bouton d'acces est masque par defaut dans le HTML brut.
// 2. Logique metier : openAdminZone() revérifie hasPermission(MANAGE_USERS) elle-meme.

import { getCurrentRole, ROLES, ROLE_LABELS, STATUSES, STATUS_LABELS, PERMISSIONS, hasPermission } from "./services/authorization-service.js";
import { getCurrentUserContext } from "./services/app-context.js";
import { fetchAllUsersBounded } from "./services/user-management-service.js";
import { promoteToAdmin, revokeAdmin, changeUserStatus } from "./services/admin-service.js";
import { formatDateFr } from "./services/date-utils.js";
import { PROFESSION_OPTIONS, ORGANIZATION_TYPE_OPTIONS } from "./services/user-service.js";

// Version affichee dans la zone d'administration. Mise a jour manuellement a
// chaque nouvelle version (coherent avec VERSION.md).
const APP_VERSION = 'Pharmeval v1.9.0';

const PAGE_SIZE = 20;

const PROFESSION_LABELS = {};
PROFESSION_OPTIONS.forEach(function(o) { PROFESSION_LABELS[o.value] = o.label; });
const ORGANIZATION_TYPE_LABELS = {};
ORGANIZATION_TYPE_OPTIONS.forEach(function(o) { ORGANIZATION_TYPE_LABELS[o.value] = o.label; });

let usersState = {
  allUsers: [],
  truncated: false,
  loaded: false,
  searchText: '',
  roleFilter: 'all',
  statusFilter: 'all',
  page: 0,
};

let pendingAction = null; // { kind: 'role'|'status', targetUser, newValue }
let detailUser = null;    // utilisateur actuellement affiche en fiche detaillee

// ---------------------------------------------------------------------------
// Ouverture / fermeture de la zone d'administration
// ---------------------------------------------------------------------------

/**
 * A appeler apres chaque connexion (voir js/auth.js -> revealApp()) pour
 * afficher ou masquer le bouton d'acces a l'administration selon le role
 * courant. Un utilisateur "user" ne voit jamais ce bouton.
 */
export function updateAdminUI() {
  var btn = document.getElementById('btn-admin-zone');
  if (btn) btn.style.display = hasPermission(PERMISSIONS.MANAGE_USERS) ? '' : 'none';
}

/**
 * Ouvre la zone d'administration. Controle d'acces reel : si l'utilisateur
 * n'est pas administrateur, la fonction s'arrete immediatement et n'affiche
 * rien, meme si elle est invoquee directement (ex. depuis la console du
 * navigateur) en contournant le bouton d'interface masque.
 */
export function openAdminZone() {
  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) {
    console.warn('Acces refuse : la zone d\'administration est reservee aux administrateurs.');
    return;
  }

  var ctx = getCurrentUserContext();

  ['home-view', 'quiz-view', 'results-view', 'history-view'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  var adminEl = document.getElementById('admin-view');
  if (adminEl) adminEl.style.display = 'block';

  var versionEl = document.getElementById('admin-version');
  var userEl = document.getElementById('admin-current-user');
  var roleEl = document.getElementById('admin-current-role');
  if (versionEl) versionEl.textContent = APP_VERSION;
  if (userEl) userEl.textContent = (ctx && ctx.email) || '';
  if (roleEl) roleEl.textContent = ROLE_LABELS[getCurrentRole()] || getCurrentRole();

  closeUserDetail();
  clearAdminMessage();
  loadUsers();
}

/**
 * Retour a l'accueil depuis la zone d'administration.
 */
export function closeAdminZone() {
  var adminEl = document.getElementById('admin-view');
  if (adminEl) adminEl.style.display = 'none';
  var homeEl = document.getElementById('home-view');
  if (homeEl) homeEl.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Chargement et rendu du tableau des utilisateurs
// ---------------------------------------------------------------------------

async function loadUsers() {
  renderUsersLoading();
  const result = await fetchAllUsersBounded();
  if (result.error) {
    renderUsersError();
    return;
  }
  usersState.allUsers = result.items;
  usersState.truncated = result.truncated;
  usersState.loaded = true;
  usersState.page = 0;
  renderUsersTable();
}

function renderUsersLoading() {
  const tbody = document.getElementById('admin-users-table-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="admin-users-loading">Chargement des utilisateurs…</td></tr>';
  const empty = document.getElementById('admin-users-empty');
  if (empty) empty.style.display = 'none';
}

function renderUsersError() {
  const tbody = document.getElementById('admin-users-table-body');
  if (tbody) tbody.innerHTML = '';
  const empty = document.getElementById('admin-users-empty');
  if (empty) {
    empty.style.display = 'block';
    empty.textContent = 'Impossible de charger la liste des utilisateurs pour le moment.';
  }
}

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * Architecture volontairement extensible (comme demande) : chaque nouveau
 * filtre (ex. profession, organisation) n'a qu'a ajouter une condition ici.
 */
function matchesUserFilters(user) {
  if (usersState.roleFilter !== 'all' && (user.role || ROLES.USER) !== usersState.roleFilter) return false;
  if (usersState.statusFilter !== 'all' && (user.status || STATUSES.ACTIVE) !== usersState.statusFilter) return false;
  if (usersState.searchText) {
    const haystack = [
      user.displayName || '',
      user.email || '',
      (user.profile && user.profile.organizationName) || '',
    ].join(' ').toLowerCase();
    if (haystack.indexOf(usersState.searchText.toLowerCase()) === -1) return false;
  }
  return true;
}

function professionLabel(user) {
  const p = user.profile && user.profile.profession;
  if (!p) return '—';
  if (p === 'other' && user.profile.professionOther) return user.profile.professionOther;
  return PROFESSION_LABELS[p] || p;
}

function organizationLabel(user) {
  const name = user.profile && user.profile.organizationName;
  if (name) return name;
  const type = user.profile && user.profile.organizationType;
  if (type === 'other' && user.profile.organizationTypeOther) return user.profile.organizationTypeOther;
  if (type) return ORGANIZATION_TYPE_LABELS[type] || type;
  return '—';
}

function renderUsersTable() {
  const tbody = document.getElementById('admin-users-table-body');
  const empty = document.getElementById('admin-users-empty');
  const disclaimer = document.getElementById('admin-users-disclaimer');
  if (!tbody) return;

  if (disclaimer) {
    disclaimer.style.display = usersState.truncated ? 'block' : 'none';
    if (usersState.truncated) {
      disclaimer.textContent = 'Affichage limité aux ' + usersState.allUsers.length + ' comptes les plus récents.';
    }
  }

  const filtered = usersState.allUsers.filter(matchesUserFilters);

  if (usersState.allUsers.length === 0) {
    tbody.innerHTML = '';
    if (empty) { empty.style.display = 'block'; empty.textContent = 'Aucun utilisateur enregistré.'; }
    renderPagination(0, 0);
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (empty) { empty.style.display = 'block'; empty.textContent = 'Aucun utilisateur ne correspond à votre recherche.'; }
    renderPagination(0, 0);
    return;
  }
  if (empty) empty.style.display = 'none';

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (usersState.page >= totalPages) usersState.page = totalPages - 1;
  const start = usersState.page * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageItems.map(userRowHtml).join('');
  renderPagination(usersState.page, totalPages);
}

function userRowHtml(user) {
  const role = user.role || ROLES.USER;
  const status = user.status || STATUSES.ACTIVE;
  const name = user.displayName || '(sans nom)';
  return (
    '<tr class="admin-user-row" onclick="openUserDetail(\'' + escapeHtml(user.uid) + '\')">' +
      '<td>' + escapeHtml(name) + '</td>' +
      '<td>' + escapeHtml(user.email || '') + '</td>' +
      '<td>' + escapeHtml(professionLabel(user)) + '</td>' +
      '<td>' + escapeHtml(organizationLabel(user)) + '</td>' +
      '<td><span class="admin-badge admin-badge-role-' + escapeHtml(role) + '">' + escapeHtml(ROLE_LABELS[role] || role) + '</span></td>' +
      '<td><span class="admin-badge admin-badge-status-' + escapeHtml(status) + '">' + escapeHtml(STATUS_LABELS[status] || status) + '</span></td>' +
      '<td>' + escapeHtml(formatDateFr(user.createdAt)) + '</td>' +
      '<td>' + escapeHtml(user.lastLogin ? formatDateFr(user.lastLogin) : '—') + '</td>' +
    '</tr>'
  );
}

function renderPagination(page, totalPages) {
  const el = document.getElementById('admin-users-pagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML =
    '<button class="btn-secondary" id="admin-page-prev" onclick="goToAdminUsersPage(-1)"' + (page <= 0 ? ' disabled' : '') + '>← Précédent</button>' +
    '<span class="admin-pagination-label">Page ' + (page + 1) + ' / ' + totalPages + '</span>' +
    '<button class="btn-secondary" id="admin-page-next" onclick="goToAdminUsersPage(1)"' + (page >= totalPages - 1 ? ' disabled' : '') + '>Suivant →</button>';
}

// ---------------------------------------------------------------------------
// Recherche, filtres, pagination (attributs onclick/oninput du HTML)
// ---------------------------------------------------------------------------

export function onAdminUsersSearchInput() {
  const input = document.getElementById('admin-users-search');
  usersState.searchText = input ? input.value : '';
  usersState.page = 0;
  renderUsersTable();
}

export function setAdminRoleFilter(role) {
  usersState.roleFilter = role;
  usersState.page = 0;
  document.querySelectorAll('.admin-role-filter-btn').forEach(function(btn) {
    if (btn.getAttribute('data-role') === role) btn.classList.add('active'); else btn.classList.remove('active');
  });
  renderUsersTable();
}

export function setAdminStatusFilter(status) {
  usersState.statusFilter = status;
  usersState.page = 0;
  document.querySelectorAll('.admin-status-filter-btn').forEach(function(btn) {
    if (btn.getAttribute('data-status') === status) btn.classList.add('active'); else btn.classList.remove('active');
  });
  renderUsersTable();
}

export function goToAdminUsersPage(delta) {
  usersState.page = Math.max(0, usersState.page + delta);
  renderUsersTable();
}

// ---------------------------------------------------------------------------
// Fiche utilisateur detaillee
// ---------------------------------------------------------------------------

export function openUserDetail(uid) {
  const user = usersState.allUsers.find(function(u) { return u.uid === uid; });
  if (!user) return;
  detailUser = user;
  clearAdminMessage();

  const overlay = document.getElementById('admin-user-detail-overlay');
  const body = document.getElementById('admin-user-detail-body');
  if (!overlay || !body) return;

  const ctx = getCurrentUserContext();
  const isSelf = ctx && ctx.uid === user.uid;
  const role = user.role || ROLES.USER;
  const status = user.status || STATUSES.ACTIVE;

  let html = '';
  html += '<div class="admin-detail-row"><strong>Nom :</strong> ' + escapeHtml(user.displayName || '(sans nom)') + '</div>';
  html += '<div class="admin-detail-row"><strong>E-mail :</strong> ' + escapeHtml(user.email || '') + '</div>';
  html += '<div class="admin-detail-row"><strong>Profession :</strong> ' + escapeHtml(professionLabel(user)) + '</div>';
  html += '<div class="admin-detail-row"><strong>Organisation :</strong> ' + escapeHtml(organizationLabel(user)) + '</div>';
  html += '<div class="admin-detail-row"><strong>Rôle :</strong> <span class="admin-badge admin-badge-role-' + escapeHtml(role) + '">' + escapeHtml(ROLE_LABELS[role] || role) + '</span></div>';
  html += '<div class="admin-detail-row"><strong>Statut :</strong> <span class="admin-badge admin-badge-status-' + escapeHtml(status) + '">' + escapeHtml(STATUS_LABELS[status] || status) + '</span></div>';
  html += '<div class="admin-detail-row"><strong>Inscription :</strong> ' + escapeHtml(formatDateFr(user.createdAt)) + '</div>';
  html += '<div class="admin-detail-row"><strong>Dernière connexion :</strong> ' + escapeHtml(user.lastLogin ? formatDateFr(user.lastLogin) : 'Non disponible') + '</div>';

  html += '<div class="admin-detail-actions">';
  if (isSelf) {
    html += '<p class="admin-detail-self-note">Vous ne pouvez pas modifier votre propre rôle.</p>';
  } else if (role === ROLES.ADMIN) {
    html += '<button class="btn-secondary" onclick="requestRoleChange(\'revoke\')">Retirer le rôle administrateur</button>';
  } else {
    html += '<button class="btn-primary" onclick="requestRoleChange(\'promote\')">Promouvoir administrateur</button>';
  }

  html += '<div class="admin-status-actions">';
  if (status !== STATUSES.ACTIVE) {
    html += '<button class="btn-secondary" onclick="requestStatusChange(\'active\')">Activer</button>';
  }
  if (status !== STATUSES.SUSPENDED) {
    html += '<button class="btn-secondary" onclick="requestStatusChange(\'suspended\')">Suspendre</button>';
  }
  if (status === STATUSES.SUSPENDED) {
    html += '<button class="btn-secondary" onclick="requestStatusChange(\'active\')">Réactiver</button>';
  }
  html += '</div>';
  html += '</div>';

  body.innerHTML = html;
  overlay.style.display = 'flex';
}

export function closeUserDetail() {
  detailUser = null;
  const overlay = document.getElementById('admin-user-detail-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Confirmation avant toute action sensible
// ---------------------------------------------------------------------------

export function requestRoleChange(action) {
  if (!detailUser) return;
  const isPromote = action === 'promote';
  pendingAction = {
    kind: 'role',
    targetUser: detailUser,
    newValue: isPromote ? ROLES.ADMIN : ROLES.USER,
  };
  showConfirmModal(
    isPromote
      ? 'Voulez-vous vraiment promouvoir « ' + (detailUser.displayName || detailUser.email) + ' » administrateur ?'
      : 'Voulez-vous vraiment retirer le rôle administrateur de « ' + (detailUser.displayName || detailUser.email) + ' » ?'
  );
}

export function requestStatusChange(newStatus) {
  if (!detailUser) return;
  pendingAction = {
    kind: 'status',
    targetUser: detailUser,
    newValue: newStatus,
  };
  const labels = { active: 'activer', suspended: 'suspendre', pending: 'mettre en attente' };
  const verb = labels[newStatus] || ('passer au statut ' + newStatus);
  showConfirmModal('Voulez-vous vraiment ' + verb + ' le compte de « ' + (detailUser.displayName || detailUser.email) + ' » ?');
}

function showConfirmModal(message) {
  const overlay = document.getElementById('admin-confirm-overlay');
  const msgEl = document.getElementById('admin-confirm-message');
  if (msgEl) msgEl.textContent = message;
  if (overlay) overlay.style.display = 'flex';
}

export function cancelPendingAction() {
  pendingAction = null;
  const overlay = document.getElementById('admin-confirm-overlay');
  if (overlay) overlay.style.display = 'none';
}

export async function confirmPendingAction() {
  const overlay = document.getElementById('admin-confirm-overlay');
  if (overlay) overlay.style.display = 'none';
  if (!pendingAction) return;

  const action = pendingAction;
  pendingAction = null;

  let result;
  if (action.kind === 'role') {
    result = action.newValue === ROLES.ADMIN
      ? await promoteToAdmin(action.targetUser)
      : await revokeAdmin(action.targetUser);
  } else {
    result = await changeUserStatus(action.targetUser, action.newValue);
  }

  showAdminMessage(result.status, result.message);
  closeUserDetail();
  loadUsers(); // recharge la liste pour refleter le changement
}

// ---------------------------------------------------------------------------
// Messages (succes / erreur / refus)
// ---------------------------------------------------------------------------

function showAdminMessage(status, text) {
  const el = document.getElementById('admin-message');
  if (!el) return;
  el.className = 'admin-message admin-message-' + status;
  el.textContent = text;
  el.style.display = 'block';
}

function clearAdminMessage() {
  const el = document.getElementById('admin-message');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

// ---------------------------------------------------------------------------
// Pont vers le HTML classique (attributs onclick/oninput).
// ---------------------------------------------------------------------------
window.openAdminZone = openAdminZone;
window.closeAdminZone = closeAdminZone;
window.onAdminUsersSearchInput = onAdminUsersSearchInput;
window.setAdminRoleFilter = setAdminRoleFilter;
window.setAdminStatusFilter = setAdminStatusFilter;
window.goToAdminUsersPage = goToAdminUsersPage;
window.openUserDetail = openUserDetail;
window.closeUserDetail = closeUserDetail;
window.requestRoleChange = requestRoleChange;
window.requestStatusChange = requestStatusChange;
window.cancelPendingAction = cancelPendingAction;
window.confirmPendingAction = confirmPendingAction;
