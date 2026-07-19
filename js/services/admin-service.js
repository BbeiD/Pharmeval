// ===================== SERVICE D'ADMINISTRATION (ORCHESTRATION) =====================
// Point d'entree UNIQUE pour toute action administrative sensible
// (changement de role, changement de statut). Coordonne :
//   - js/services/authorization-service.js (ROLES/STATUSES/PERMISSIONS, verification du role/permission courant)
//   - js/services/app-context.js (identite de l'administrateur courant)
//   - js/services/user-management-service.js (lecture/ecriture Firestore des utilisateurs)
//   - js/services/audit-service.js (journalisation systematique)
//
// Regles metier centrales, imposees ICI (pas seulement par les regles
// Firestore, voir "Securite" ci-dessous) :
//   1. Un administrateur ne peut JAMAIS modifier son propre role NI son
//      propre statut (correctif v1.9.1 - voir RAPPORT_CORRECTIF_1.9.1.md :
//      cette regle couvrait auparavant uniquement le role, pas le statut).
//   2. Il y a toujours au moins un administrateur actif : impossible de
//      retrograder OU de suspendre le dernier administrateur actif restant
//      (voir countActiveAdmins() dans user-management-service.js). Cette
//      protection reste appliquee UNIQUEMENT au niveau applicatif (voir
//      "Limite connue" dans RAPPORT_CORRECTIF_1.9.1.md) : une protection
//      serveur plus robuste (Cloud Function, operation transactionnelle)
//      devra etre mise en place ulterieurement.
// js/admin.js (interface) ne fait qu'appeler les fonctions ci-dessous ;
// aucune logique metier ne doit etre dupliquee dans l'interface.
//
// Note d'architecture (evolutivite - voir RAPPORT_SPRINT8.md "Preparer
// l'avenir") : le controle d'acces general utilise hasPermission(
// PERMISSIONS.MANAGE_USERS) plutot qu'une comparaison directe au role
// "admin". Aujourd'hui, seul ADMIN possede cette permission (comportement
// identique a avant), mais le jour ou SUPER_ADMIN sera reellement attribue
// a un utilisateur, il suffira de lui accorder MANAGE_USERS dans la
// matrice ROLE_PERMISSIONS (authorization-service.js) pour qu'il obtienne
// automatiquement les memes droits ici - sans modifier une seule ligne de
// ce fichier. Les regles VRAIMENT specifiques au role "admin" (auto-
// modification, dernier administrateur actif) restent, elles,
// intentionnellement fondees sur ROLES.ADMIN : ce sont des regles sur le
// role lui-meme, pas sur une permission generique.
//
// Securite : ce fichier constitue une premiere barriere (evite l'erreur ou
// le contournement accidentel via l'interface), mais ne remplace PAS les
// regles Firestore (voir firestore.rules), qui restent la seule source de
// securite reelle - un utilisateur techniquement capable d'appeler
// Firestore directement, en contournant entierement ce code, doit encore
// se heurter aux memes interdictions cote serveur.

import { ROLES, STATUSES, PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { updateUserRole, updateUserStatus, updateUserBusinessFields, getRequestingAdminIdentity, countActiveAdmins } from "./user-management-service.js";
import { validateUserBusinessFields } from "./user-profile-metadata-service.js";
import { logAction } from "./audit-service.js";

// Message unique reutilise pour toute tentative d'auto-modification (role
// OU statut), correctif v1.9.1. Centralise ici pour ne jamais le dupliquer
// entre changeRole() et changeUserStatus().
const SELF_MODIFICATION_MESSAGE = 'Vous ne pouvez pas modifier votre propre rôle ou votre propre statut.';

/**
 * Resultat standard renvoye par toutes les actions ci-dessous, pour un
 * traitement uniforme cote interface (succes / erreur / refus - voir
 * js/admin.js).
 * @typedef {{status:('success'|'error'|'denied'), message:string}} AdminActionResult
 */

function denied(message) {
  return { status: 'denied', message: message };
}
function success(message) {
  return { status: 'success', message: message };
}
function errorResult(message) {
  return { status: 'error', message: message };
}

/**
 * Promeut un utilisateur cible au role administrateur.
 * Refuse systematiquement si la cible est l'administrateur lui-meme.
 *
 * @param {{uid:string, email:string, role:string}} targetUser
 * @returns {Promise<AdminActionResult>}
 */
export async function promoteToAdmin(targetUser) {
  return changeRole(targetUser, ROLES.ADMIN);
}

/**
 * Retire le role administrateur a un utilisateur cible (retour au role
 * standard). Refuse systematiquement si la cible est l'administrateur
 * lui-meme (voir "jamais permettre a un administrateur de modifier son
 * propre role" - ceci s'applique aussi bien a une promotion qu'a un
 * retrait : un administrateur ne peut pas non plus se retirer lui-meme son
 * propre role depuis cette interface).
 *
 * @param {{uid:string, email:string, role:string}} targetUser
 * @returns {Promise<AdminActionResult>}
 */
export async function revokeAdmin(targetUser) {
  return changeRole(targetUser, ROLES.USER);
}

async function changeRole(targetUser, newRole) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return denied('Vous devez être connecté pour effectuer cette action.');
  }
  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) {
    return denied('Cette action est réservée aux administrateurs.');
  }
  if (!targetUser || !targetUser.uid) {
    return errorResult('Utilisateur cible introuvable.');
  }
  if (targetUser.uid === ctx.uid) {
    // Regle absolue, verifiee ici independamment des regles Firestore.
    return denied(SELF_MODIFICATION_MESSAGE);
  }

  const oldRole = targetUser.role || ROLES.USER;
  if (oldRole === newRole) {
    return denied('Cet utilisateur possède déjà ce rôle.');
  }

  // Empecher toute situation critique : retirer le role administrateur du
  // DERNIER administrateur actif rendrait la plateforme inadministrable.
  // Verifie uniquement dans le cas d'une retrogradation d'un administrateur
  // (pas necessaire pour une promotion, qui ne peut qu'AUGMENTER le nombre
  // d'administrateurs).
  if (oldRole === ROLES.ADMIN && newRole !== ROLES.ADMIN) {
    const adminCount = await countActiveAdmins();
    if (adminCount.error) {
      // Fail-safe : en cas d'impossibilite de verifier le nombre
      // d'administrateurs actifs, on refuse plutot que de risquer de
      // retirer par erreur le dernier - voir countActiveAdmins().
      return errorResult('Impossible de vérifier le nombre d\'administrateurs actifs pour le moment. Veuillez réessayer.');
    }
    if (adminCount.count <= 1) {
      return denied('Impossible de retirer ce rôle : il s\'agit du dernier administrateur actif de la plateforme. Désignez d\'abord un autre administrateur.');
    }
  }

  const result = await updateUserRole(targetUser.uid, newRole);
  if (!result.success) {
    return errorResult('La mise à jour du rôle a échoué. Veuillez réessayer.');
  }

  const admin = getRequestingAdminIdentity();
  await logAction({
    adminUid: admin && admin.uid,
    adminEmail: admin && admin.email,
    targetUid: targetUser.uid,
    targetEmail: targetUser.email,
    actionType: 'role_change',
    oldValue: oldRole,
    newValue: newRole,
  });

  return success(
    newRole === ROLES.ADMIN
      ? 'Utilisateur promu administrateur avec succès.'
      : 'Rôle administrateur retiré avec succès.'
  );
}

/**
 * Change le statut d'un utilisateur cible (activer / suspendre /
 * reactiver).
 *
 * CORRECTIF v1.9.1 : un administrateur ne peut plus modifier son PROPRE
 * statut (ce comportement etait auparavant autorise depuis le Sprint 8 -
 * voir RAPPORT_CORRECTIF_1.9.1.md pour le detail du changement). La regle
 * est desormais symetrique a celle du role : ni le role, ni le statut d'un
 * administrateur ne peuvent etre modifies par lui-meme.
 *
 * @param {{uid:string, email:string, status:string}} targetUser
 * @param {string} newStatus - une valeur de STATUSES
 * @returns {Promise<AdminActionResult>}
 */
export async function changeUserStatus(targetUser, newStatus) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return denied('Vous devez être connecté pour effectuer cette action.');
  }
  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) {
    return denied('Cette action est réservée aux administrateurs.');
  }
  if (!targetUser || !targetUser.uid) {
    return errorResult('Utilisateur cible introuvable.');
  }
  if (targetUser.uid === ctx.uid) {
    // Regle absolue (correctif v1.9.1), verifiee ici independamment des
    // regles Firestore - symetrique a celle de changeRole() ci-dessus.
    return denied(SELF_MODIFICATION_MESSAGE);
  }
  const validStatuses = Object.values(STATUSES);
  if (validStatuses.indexOf(newStatus) === -1) {
    return errorResult('Statut demandé invalide.');
  }

  const oldStatus = targetUser.status || STATUSES.ACTIVE;
  if (oldStatus === newStatus) {
    return denied('Cet utilisateur possède déjà ce statut.');
  }

  // Empecher toute situation critique : suspendre le DERNIER administrateur
  // actif rendrait la plateforme inadministrable, exactement comme le
  // retrait de son role (voir changeRole ci-dessus). Ne concerne que la
  // suspension d'un compte actuellement administrateur et actif.
  const targetRole = targetUser.role || ROLES.USER;
  if (targetRole === ROLES.ADMIN && oldStatus === STATUSES.ACTIVE && newStatus === STATUSES.SUSPENDED) {
    const adminCount = await countActiveAdmins();
    if (adminCount.error) {
      return errorResult('Impossible de vérifier le nombre d\'administrateurs actifs pour le moment. Veuillez réessayer.');
    }
    if (adminCount.count <= 1) {
      return denied('Impossible de suspendre ce compte : il s\'agit du dernier administrateur actif de la plateforme. Désignez d\'abord un autre administrateur.');
    }
  }

  const result = await updateUserStatus(targetUser.uid, newStatus);
  if (!result.success) {
    return errorResult('La mise à jour du statut a échoué. Veuillez réessayer.');
  }

  const admin = getRequestingAdminIdentity();
  await logAction({
    adminUid: admin && admin.uid,
    adminEmail: admin && admin.email,
    targetUid: targetUser.uid,
    targetEmail: targetUser.email,
    actionType: 'status_change',
    oldValue: oldStatus,
    newValue: newStatus,
  });

  return success('Statut mis à jour avec succès.');
}

// ---------------------------------------------------------------------------
// NOUVEAU (Sprint 14) : édition des champs métier du module Utilisateurs
// (firstName/lastName/organizationId/profileId/groupIds). Distinct de
// changeRole()/changeUserStatus() ci-dessus : aucune règle de "dernier
// administrateur actif" ne s'applique ici (ces champs n'ont aucune
// incidence sur les permissions), mais la même discipline générale
// s'applique (permission requise, cible existante, résultat structuré,
// journalisation systématique).
// ---------------------------------------------------------------------------

/**
 * Met à jour les champs métier (Sprint 14) d'un utilisateur cible.
 * Autorise l'auto-édition (contrairement à changeRole/changeUserStatus) :
 * modifier son propre nom/prénom/organisation n'a aucune incidence sur les
 * permissions ou la sécurité de la plateforme, la restriction "jamais sur
 * soi-même" ne se justifie donc pas ici.
 *
 * @param {{uid:string, email:string}} targetUser
 * @param {{firstName?:string, lastName?:string, organizationId?:(string|null), profileId?:(string|null), groupIds?:Array<string>}} fields
 * @returns {Promise<AdminActionResult>}
 */
export async function updateUserBusinessProfile(targetUser, fields) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return denied('Vous devez être connecté pour effectuer cette action.');
  }
  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) {
    return denied('Cette action est réservée aux administrateurs.');
  }
  if (!targetUser || !targetUser.uid) {
    return errorResult('Utilisateur cible introuvable.');
  }

  const validation = validateUserBusinessFields(fields);
  if (!validation.valid) {
    return errorResult(validation.errors.join(' '));
  }

  const result = await updateUserBusinessFields(targetUser.uid, fields);
  if (!result.success) {
    return errorResult('L\'enregistrement des modifications a échoué. Veuillez réessayer.');
  }

  const admin = getRequestingAdminIdentity();
  const editedKeys = Object.keys(fields || {});
  for (const key of editedKeys) {
    await logAction({
      adminUid: admin && admin.uid, adminEmail: admin && admin.email,
      targetUid: targetUser.uid, targetEmail: targetUser.email,
      actionType: 'business_profile_edit_' + key,
      oldValue: targetUser[key], newValue: fields[key],
    });
  }

  return success('Fiche utilisateur mise à jour avec succès.');
}
