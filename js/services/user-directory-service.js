// ===================== SERVICE D'ORCHESTRATION DU MODULE UTILISATEURS (Sprint 14) =====================
// Point d'entree UNIQUE pour l'ecran admin/users.js. Coordonne :
//   - js/services/user-management-service.js (lecture/ecriture Firestore de users/{uid})
//   - js/services/admin-service.js            (changement de statut/role deja existants, edition metier)
//   - js/services/organizations-bank-service.js / profiles-bank-service.js / groups-bank-service.js
//     (resolution des references en libelles affichables)
//   - js/services/audit-service.js            (historique par utilisateur, REUTILISE le journal existant, Sprint 8)
//   - js/services/user-invite-service.js      (pré-provisionnement, voir ce fichier pour "création")
//
// REUTILISE fetchAllUsersBounded() (user-management-service.js, Sprint 8)
// comme source de donnees, EXACTEMENT comme js/admin.js le fait deja pour
// le tableau existant - meme lecture bornee, meme filtrage cote client,
// aucune deuxieme lecture Firestore concurrente de la meme collection.

import { PERMISSIONS, hasPermission, STATUSES } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { fetchAllUsersBounded, getUserByUid } from "./user-management-service.js";
import { changeUserStatus, updateUserBusinessProfile } from "./admin-service.js";
import { getRecentAuditEntries } from "./audit-service.js";
import { getRecentEvaluationsForUid } from "./history-service.js";
import { formatUserFullName } from "./user-profile-metadata-service.js";
import { toComparableDate } from "./date-utils.js";
import { organizationsBank } from "./organizations-bank-service.js";
import { profilesBank } from "./profiles-bank-service.js";
import { groupsBank } from "./groups-bank-service.js";
import { createPendingInvite, createPendingInvitesBulk, listPendingInvites, cancelPendingInvite } from "./user-invite-service.js";

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { status: 'denied', message: 'Vous devez être connecté pour effectuer cette action.' };
  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) return { status: 'denied', message: 'La gestion des utilisateurs est réservée aux administrateurs.' };
  return { status: 'authorized' };
}

function matchesFilters(user, filters) {
  const f = filters || {};
  if (f.status && (user.status || STATUSES.ACTIVE) !== f.status) return false;
  if (f.organizationId && user.organizationId !== f.organizationId) return false;
  if (f.profileId && user.profileId !== f.profileId) return false;
  if (f.groupId && (!Array.isArray(user.groupIds) || user.groupIds.indexOf(f.groupId) === -1)) return false;
  return true;
}
function matchesSearchText(user, searchText) {
  const needle = (searchText || '').toString().trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [user.uid, user.email, user.firstName, user.lastName, user.displayName, formatUserFullName(user)];
  return haystacks.some(function(h) { return h && h.toString().toLowerCase().indexOf(needle) !== -1; });
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Charge, filtre et pagine (côté client, sur le lot borné existant) la
 * liste des utilisateurs, avec les libellés d'organisation/profil déjà
 * résolus pour un affichage direct.
 *
 * @param {{searchText?:string, filters?:object, page?:number, pageSize?:number}} options
 * @returns {Promise<object>}
 */
export async function browseUsers(options) {
  const access = checkAccess();
  if (access.status !== 'authorized') return { authorized: false, message: access.message };

  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
  const page = opts.page || 0;

  const result = await fetchAllUsersBounded();
  if (result.error) return { authorized: true, error: true, message: 'Impossible de charger la liste des utilisateurs pour le moment.' };

  const filtered = result.items
    .filter(function(u) { return matchesFilters(u, opts.filters); })
    .filter(function(u) { return matchesSearchText(u, opts.searchText); });

  const pageItems = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // Resolution en lot des references (organisation/profil/groupes) pour
  // CETTE PAGE uniquement - jamais pour l'ensemble du lot borne, afin de
  // ne pas multiplier les lectures Firestore inutilement.
  const orgIds = pageItems.map(function(u) { return u.organizationId; }).filter(Boolean);
  const profileIds = pageItems.map(function(u) { return u.profileId; }).filter(Boolean);
  const groupIds = pageItems.reduce(function(acc, u) { return acc.concat(Array.isArray(u.groupIds) ? u.groupIds : []); }, []);

  const [orgMap, profileMap, groupMap] = await Promise.all([
    organizationsBank.getByIds(orgIds),
    profilesBank.getByIds(profileIds),
    groupsBank.getByIds(groupIds),
  ]);

  const enriched = pageItems.map(function(u) {
    return Object.assign({}, u, {
      organizationLabel: u.organizationId ? ((orgMap[u.organizationId] && orgMap[u.organizationId].name) || null) : null,
      profileLabel: u.profileId ? ((profileMap[u.profileId] && profileMap[u.profileId].name) || null) : null,
      groupLabels: (Array.isArray(u.groupIds) ? u.groupIds : []).map(function(id) { return (groupMap[id] && groupMap[id].name) || null; }).filter(Boolean),
    });
  });

  return {
    authorized: true, error: false,
    items: enriched, totalMatched: filtered.length, page: page,
    hasMore: (page + 1) * pageSize < filtered.length,
    truncatedScan: result.truncated,
  };
}

/**
 * Relit un utilisateur precis et resout ses references pour l'affichage de
 * la fiche detaillee.
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
export async function getUserDetail(uid) {
  const user = await getUserByUid(uid);
  if (!user) return null;
  const [org, profile, groupMap] = await Promise.all([
    user.organizationId ? organizationsBank.getById(user.organizationId) : null,
    user.profileId ? profilesBank.getById(user.profileId) : null,
    groupsBank.getByIds(Array.isArray(user.groupIds) ? user.groupIds : []),
  ]);
  return Object.assign({}, user, {
    organizationLabel: org ? org.name : null,
    profileLabel: profile ? profile.name : null,
    groupLabels: (Array.isArray(user.groupIds) ? user.groupIds : []).map(function(id) { return (groupMap[id] && groupMap[id].name) || null; }).filter(Boolean),
  });
}

/**
 * Listes de reference pour les filtres et le formulaire d'edition
 * (uniquement les elements publies, pour ne jamais proposer une
 * organisation/un profil/un groupe encore en brouillon ou archivé).
 * @returns {Promise<{organizations:Array<object>, profiles:Array<object>, groups:Array<object>}>}
 */
export async function loadReferenceOptions() {
  const [orgResult, profileResult, groupResult] = await Promise.all([
    organizationsBank.browse({ filters: { status: 'published' }, sortField: 'name', sortDirection: 'asc', pageSize: 200 }),
    profilesBank.browse({ filters: { status: 'published' }, sortField: 'name', sortDirection: 'asc', pageSize: 200 }),
    groupsBank.browse({ filters: { status: 'published' }, sortField: 'name', sortDirection: 'asc', pageSize: 200 }),
  ]);
  return {
    organizations: (orgResult && orgResult.items) || [],
    profiles: (profileResult && profileResult.items) || [],
    groups: (groupResult && groupResult.items) || [],
  };
}

/**
 * "Désactiver" / "Réactiver" un utilisateur (SPRINT14, Statut Actif/
 * Désactivé) - REUTILISE directement changeUserStatus() (admin-service.js,
 * Sprint 8) avec STATUSES.SUSPENDED/STATUSES.ACTIVE : aucun nouveau champ
 * de statut n'est créé (voir user-profile-metadata-service.js, en-tête).
 * @param {object} targetUser
 * @returns {Promise<object>}
 */
export function deactivateUser(targetUser) {
  return changeUserStatus(targetUser, STATUSES.SUSPENDED);
}
export function reactivateUser(targetUser) {
  return changeUserStatus(targetUser, STATUSES.ACTIVE);
}

/** Edition des champs métier (voir admin-service.js, updateUserBusinessProfile). */
export function editUserBusinessProfile(targetUser, fields) {
  return updateUserBusinessProfile(targetUser, fields);
}

/**
 * Historique d'un utilisateur : REUTILISE le journal d'audit générique
 * (audit_logs, Sprint 8) filtré par targetUid (ajout additif Sprint 14,
 * voir audit-service.js) - jamais une nouvelle collection.
 *
 * CORRECTIF (demande directe de David, 23/07/2026) : audit_logs ne
 * contient QUE les actions administrateur explicites (role_change,
 * status_change, business_profile_edit_*) - un compte auto-inscrit sur
 * lequel aucun admin n'est encore intervenu y a donc ZERO entree, ce qui
 * se lisait comme "l'historique ne fonctionne pas". Ajoute ici une entree
 * synthetique "Compte créé" a partir de users/{uid}.createdAt (deja lu par
 * getUserByUid, aucune nouvelle ecriture/collection/regle necessaire),
 * fusionnee avec le vrai journal d'audit et triee par date reelle - ainsi
 * TOUT compte a au moins une entree, meme sans jamais avoir ete touche par
 * un administrateur.
 *
 * AJOUT (demande directe de David, 23/07/2026, en vue de rapports
 * partenaires futurs) : les evaluations recentes (getRecentEvaluationsForUid,
 * history-service.js - meme collection evaluation_results que "Mes
 * évaluations", lecture admin deja autorisee par firestore.rules) sont
 * fusionnees dans le meme flux, best-effort comme le reste de cette
 * fonction : une erreur de lecture des evaluations n'empeche jamais
 * d'afficher le reste de l'historique.
 * @param {string} uid
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getUserTimeline(uid) {
  const [auditResult, user, evaluationsResult] = await Promise.all([
    getRecentAuditEntries({ targetUid: uid, limit: 100 }),
    getUserByUid(uid),
    getRecentEvaluationsForUid(uid, { limit: 20 }),
  ]);
  if (auditResult.error) return auditResult;

  const items = auditResult.items.slice();
  if (user && user.createdAt) {
    items.push({ date: user.createdAt, actionType: 'account_created' });
  }
  (evaluationsResult.items || []).forEach(function(ev) {
    items.push({
      date: ev.completedAt,
      actionType: 'evaluation_completed',
      percent: (ev.score && typeof ev.score.percentage === 'number') ? ev.score.percentage : null,
      correct: ev.score ? (ev.score.correctAnswers || 0) : 0,
      total: ev.score ? (ev.score.totalQuestions || 0) : 0,
    });
  });
  items.sort(function(a, b) {
    const da = toComparableDate(a.date);
    const db = toComparableDate(b.date);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });
  return { items: items, error: false };
}

// ---------------------------------------------------------------------------
// "Création" (pré-provisionnement, voir user-invite-service.js)
// ---------------------------------------------------------------------------

export { createPendingInvite, createPendingInvitesBulk, listPendingInvites, cancelPendingInvite };
