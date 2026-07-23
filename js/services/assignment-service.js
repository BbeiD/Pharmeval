// ===================== SERVICE D'ORCHESTRATION DES ATTRIBUTIONS (Sprint 15) =====================
// Point d'entree UNIQUE pour :
//   - la section "Attributions" de la fiche d'un parcours (admin/parcours.js) ;
//   - la resolution "Mes parcours" pour un utilisateur donne (mes-parcours.js).
// Coordonne :
//   - js/services/assignment-catalog-service.js  (lecture/ecriture Firestore)
//   - js/services/assignment-metadata-service.js (modele de donnees, defauts, validation)
//   - js/services/authorization-service.js       (controle d'acces : reutilise MANAGE_PARCOURS, Sprint 12)
//   - js/services/parcours-catalog-service.js    (REUTILISE getParcoursById - jamais de copie du parcours)
//   - js/services/user-management-service.js / organizations-bank / profiles-bank / groups-bank
//     (resolution des cibles en libelles affichables)
//
// PERMISSION REUTILISEE (pas de nouveau systeme de droits, SPRINT15
// "Contraintes" implicite + coherence avec le reste du projet) : gerer les
// attributions d'un parcours est une extension directe de la gestion de ce
// parcours - MANAGE_PARCOURS (Sprint 12) est donc reutilisee telle quelle,
// aucune permission dediee n'est creee.

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { auth } from "../firebase-config.js";
import { API_BASE_URL } from "../config.js";
import {
  ASSIGNMENT_TARGET_TYPES, ASSIGNMENT_TARGET_TYPE_LABELS, ASSIGNMENT_STATUSES,
  completeAssignmentMetadata, validateAssignmentMetadata,
} from "./assignment-metadata-service.js";
import {
  createAssignmentDocument, deleteAssignmentDocument,
  listAssignmentsByParcours,
  assignmentExists,
} from "./assignment-catalog-service.js";
import { getParcoursById } from "./parcours-catalog-service.js";
import { logParcoursAction } from "./parcours-audit-service.js";
import { getUserByUid, fetchAllUsersBounded } from "./user-management-service.js";
import { formatUserFullName } from "./user-profile-metadata-service.js";
import { profilesBank } from "./profiles-bank-service.js";
import { groupsBank } from "./groups-bank-service.js";

function denied(message) { return { status: 'denied', message: message }; }
function success(message, extra) { return Object.assign({ status: 'success', message: message }, extra || {}); }
function errorResult(message) { return { status: 'error', message: message }; }

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour gérer les attributions.');
  if (!hasPermission(PERMISSIONS.MANAGE_PARCOURS)) return denied('La gestion des attributions est réservée aux administrateurs.');
  return { status: 'authorized' };
}

// ---------------------------------------------------------------------------
// Résolution d'une cible en libellé affichable
// ---------------------------------------------------------------------------

async function resolveTargetLabel(type, targetId) {
  if (type === ASSIGNMENT_TARGET_TYPES.USER) {
    const user = await getUserByUid(targetId);
    return user ? formatUserFullName(user) + ' (' + (user.email || targetId) + ')' : targetId + ' (utilisateur introuvable)';
  }
  if (type === ASSIGNMENT_TARGET_TYPES.GROUP) {
    const group = await groupsBank.getById(targetId);
    return group ? group.name : targetId + ' (groupe introuvable)';
  }
  if (type === ASSIGNMENT_TARGET_TYPES.PROFILE) {
    const profile = await profilesBank.getById(targetId);
    return profile ? profile.name : targetId + ' (profil introuvable)';
  }
  return targetId;
}

/**
 * Recherche des cibles possibles pour un type d'attribution donne (utilise
 * par le panneau "+ Attribuer" de la fiche parcours - "Prévoir une
 * recherche", SPRINT15). REUTILISE les banques deja existantes (Sprint 14)
 * plutot que de dupliquer une recherche.
 * @param {string} type
 * @param {string} searchText
 * @returns {Promise<Array<{id:string, label:string}>>}
 */
export async function searchAssignmentTargets(type, searchText) {
  const needle = (searchText || '').toString().trim().toLowerCase();
  if (type === ASSIGNMENT_TARGET_TYPES.GROUP) {
    const result = await groupsBank.browse({ searchText: searchText, filters: { status: 'published' }, pageSize: 20 });
    return (result.items || []).map(function(g) { return { id: g.id, label: g.name }; });
  }
  if (type === ASSIGNMENT_TARGET_TYPES.PROFILE) {
    const result = await profilesBank.browse({ searchText: searchText, filters: { status: 'published' }, pageSize: 20 });
    return (result.items || []).map(function(p) { return { id: p.id, label: p.name }; });
  }
  if (type === ASSIGNMENT_TARGET_TYPES.USER) {
    // Recherche legere directement ici (pas de dependance sur
    // user-directory-service.js/admin-service.js - separation des
    // responsabilites) : reutilise fetchAllUsersBounded() (Sprint 8).
    const result = await fetchAllUsersBounded();
    if (result.error) return [];
    return result.items
      .filter(function(u) {
        if (!needle) return true;
        const hay = [u.uid, u.email, u.firstName, u.lastName, u.displayName].filter(Boolean).join(' ').toLowerCase();
        return hay.indexOf(needle) !== -1;
      })
      .slice(0, 20)
      .map(function(u) { return { id: u.uid, label: formatUserFullName(u) + ' (' + u.email + ')' }; });
  }
  return [];
}

// ---------------------------------------------------------------------------
// Gestion des attributions d'un parcours (admin/parcours.js)
// ---------------------------------------------------------------------------

/**
 * Liste les attributions d'un parcours, avec le libellé de chaque cible
 * déjà résolu pour un affichage direct.
 * @param {string} parcoursId
 * @returns {Promise<{authorized:boolean, message?:string, error?:boolean, items:Array<object>}>}
 */
export async function listParcoursAssignments(parcoursId) {
  const access = checkAccess();
  if (access.status !== 'authorized') return { authorized: false, message: access.message, items: [] };

  const result = await listAssignmentsByParcours(parcoursId);
  if (result.error) return { authorized: true, error: true, message: 'Impossible de charger les attributions pour le moment.', items: [] };

  const items = await Promise.all(result.items.map(async function(a) {
    return Object.assign({}, a, { targetLabel: await resolveTargetLabel(a.type, a.targetId) });
  }));
  return { authorized: true, error: false, items: items };
}

/**
 * Attribue un parcours a une cible (utilisateur, groupe ou profil).
 * Refuse silencieusement (statut "denied", pas une erreur) toute
 * attribution strictement identique deja existante - "Ne jamais dupliquer
 * un parcours" est ici interprete comme "ne jamais dupliquer une
 * attribution non plus", pour un comportement previsible côté interface.
 *
 * @param {{parcoursId:string, type:string, targetId:string, dueDate?:(string|null), priority?:string, mandatory?:boolean}} fields
 * @returns {Promise<object>}
 */
export async function createAssignment(fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);

  const f = fields || {};
  if (!f.parcoursId) return errorResult('Parcours cible introuvable.');

  // "Ne jamais dupliquer un parcours. Toujours travailler par références
  // Firestore." : verifie que le parcours reference existe reellement
  // AVANT toute ecriture - jamais de reference orpheline creee.
  const parcours = await getParcoursById(f.parcoursId);
  if (!parcours) return errorResult('Le parcours référencé est introuvable.');

  const alreadyExists = await assignmentExists(f.parcoursId, f.type, f.targetId);
  if (alreadyExists) return denied('Ce parcours est déjà attribué à cette cible.');

  const ctx = getCurrentUserContext();
  const metadata = completeAssignmentMetadata({
    parcoursId: f.parcoursId, type: f.type, targetId: f.targetId,
    dueDate: f.dueDate || null, priority: f.priority, mandatory: f.mandatory,
    status: ASSIGNMENT_STATUSES.ACTIVE,
    assignedAt: new Date().toISOString(),
    assignedBy: (ctx && ctx.email) || null,
  });

  const validation = validateAssignmentMetadata(metadata);
  if (!validation.valid) return errorResult(validation.errors.join(' '));

  const result = await createAssignmentDocument(metadata);
  if (!result.success) return errorResult('L\'attribution a échoué. Veuillez réessayer.');

  const targetLabel = await resolveTargetLabel(metadata.type, metadata.targetId);

  // CORRECTIF (post-Sprint 15) : "écrire l'action dans l'historique si le
  // système d'audit le permet" - REUTILISE le journal d'audit deja
  // existant des parcours (parcours_audit_logs, Sprint 12), qui alimente
  // deja la section "Historique" de la fiche du parcours. Ecriture "best
  // effort", jamais bloquante pour l'attribution elle-meme (meme principe
  // que tous les autres appels a logParcoursAction() dans le projet).
  const typeLabel = ASSIGNMENT_TARGET_TYPE_LABELS[metadata.type] || metadata.type;
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: metadata.parcoursId, actionType: 'assign',
    oldValue: null, newValue: typeLabel + ' : ' + targetLabel,
  }).catch(function() {});

  return success('Parcours attribué avec succès à ' + targetLabel + '.', { assignment: Object.assign({}, metadata, { targetLabel: targetLabel }) });
}

/**
 * Supprime une attribution ("supprimer une attribution" - suppression
 * réelle et immédiate, voir assignment-catalog-service.js en-tête).
 * Ne supprime JAMAIS le parcours lui-même - uniquement le document
 * `assignments/{id}` correspondant. Fonctionne indifféremment pour une
 * attribution utilisateur, groupe ou profil (la suppression ne dépend pas
 * du `type`).
 *
 * @param {object} assignment - l'attribution complète à retirer (au minimum {id, parcoursId, type, targetId}, idéalement avec `targetLabel` déjà résolu pour un historique lisible)
 * @returns {Promise<object>}
 */
export async function removeAssignment(assignment) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!assignment || !assignment.id) return errorResult('Attribution cible introuvable.');

  const result = await deleteAssignmentDocument(assignment.id);
  if (!result.success) return errorResult('La suppression de l\'attribution a échoué. Veuillez réessayer.');

  // CORRECTIF (post-Sprint 15) : meme journalisation "best effort" que la
  // creation ci-dessus, dans le meme historique de parcours (jamais une
  // nouvelle collection - voir RAPPORT_SPRINT15.md, limite 5, desormais
  // levee par reutilisation de l'audit existant plutot que par invention
  // d'un nouveau systeme).
  const ctx = getCurrentUserContext();
  const typeLabel = ASSIGNMENT_TARGET_TYPE_LABELS[assignment.type] || assignment.type;
  const targetLabel = assignment.targetLabel || assignment.targetId;
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: assignment.parcoursId, actionType: 'unassign',
    oldValue: typeLabel + ' : ' + targetLabel, newValue: null,
  }).catch(function() {});

  return success('Attribution retirée avec succès.');
}

// ---------------------------------------------------------------------------
// Résolution "Mes parcours" (SPRINT15, "Priorité d'affichage")
// ---------------------------------------------------------------------------

/**
 * Retrouve TOUS les parcours attribués à un utilisateur, qu'ils lui soient
 * attribués directement, via son groupe, ou via son profil - avec
 * DÉDUPLICATION AUTOMATIQUE par parcours ("Le pharmacien ne doit le voir
 * qu'une seule fois", exemple du cadrage).
 *
 * Accessible a TOUT utilisateur authentifié pour SA PROPRE fiche
 * uniquement (pas de permission d'administration requise ici - c'est
 * l'espace utilisateur, pas un écran d'administration ; voir
 * firestore.rules pour la garantie réelle côté serveur).
 *
 * Seuls les parcours au statut `published` sont retournés : un parcours
 * encore en brouillon ou archivé ne doit jamais apparaître dans l'espace
 * d'un utilisateur, même s'il lui a été attribué par erreur avant
 * publication.
 *
 * @param {string} uid
 * @returns {Promise<{items:Array<{parcours:object, assignment:object}>, error:boolean}>}
 */
export async function getAssignedParcoursForUser(uid) {
  if (!uid) return { items: [], error: false };
  try {
    if (!auth.currentUser) return { items: [], error: false };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/assigned-parcours`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { items: [], error: true };
    return await res.json();
  } catch {
    return { items: [], error: true };
  }
}
