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
//   1. Un administrateur ne peut JAMAIS modifier son propre role.
//   2. Il y a toujours au moins un administrateur actif : impossible de
//      retrograder OU de suspendre le dernier administrateur actif restant
//      (voir countActiveAdmins() dans user-management-service.js).
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
import { updateUserRole, updateUserStatus, getRequestingAdminIdentity, countActiveAdmins } from "./user-management-service.js";
import { logAction } from "./audit-service.js";

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
    return denied('Vous ne pouvez pas modifier votre propre rôle.');
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
 * reactiver). Un administrateur peut modifier son propre statut (aucune
 * regle equivalente a l'auto-modification de role n'est demandee pour le
 * statut), mais l'action reste journalisee comme toute autre.
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
