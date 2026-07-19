// ===================== SERVICE DE GESTION DES UTILISATEURS (ADMIN) =====================
// Centralise TOUTE lecture et ecriture Firestore liee a la gestion des
// utilisateurs depuis le Centre d'administration. Distinct de
// js/services/user-service.js (qui gere la creation/mise a jour du PROPRE
// document de l'utilisateur connecte a la connexion - Sprint 2) : ce
// fichier-ci lit et modifie les documents de N'IMPORTE QUEL utilisateur,
// exclusivement a l'initiative d'un administrateur.
//
// Ce fichier ne contient aucune regle metier de securite (ex. "un admin ne
// peut pas changer son propre role") : cette logique vit dans
// js/services/admin-service.js, qui est le seul consommateur legitime de
// ce service. La securite REELLE des donnees repose sur les regles
// Firestore (voir firestore.rules), qui doivent independamment interdire
// les memes operations sensibles.

import { db } from "../firebase-config.js";
import { getCurrentUserContext } from "./app-context.js";
import { ROLES, STATUSES } from "./authorization-service.js";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Ne charge jamais la collection entiere sans controle (meme principe deja
// applique a l'historique des evaluations, voir history-service.js Sprint
// 6). Filtrage (recherche, role, statut) et pagination sont effectues cote
// client sur ce lot borne - suffisant pour la taille attendue de la base
// utilisateurs de Pharmeval a ce stade ; a revoir avec un filtrage
// veritablement cote serveur (index composites) si la base grossit
// significativement (voir RAPPORT_SPRINT8.md, "Limites").
const USER_LIST_FETCH_LIMIT = 500;
const DEFAULT_PAGE_SIZE = 20;

function logUserManagementError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[user-management-service] ' + context + ' : ' + code, err);
}

/**
 * Charge un lot borne d'utilisateurs (au plus USER_LIST_FETCH_LIMIT), trie
 * par date de creation decroissante. Le filtrage (recherche texte, role,
 * statut) et la pagination affichee sont ensuite effectues cote client par
 * js/admin.js - une seule lecture Firestore alimente tous ces indicateurs,
 * jamais une requete separee par filtre.
 *
 * @returns {Promise<{items:Array<object>, truncated:boolean, error:boolean}>}
 */
export async function fetchAllUsersBounded() {
  try {
    const colRef = collection(db, 'users');
    const q = query(colRef, orderBy('createdAt', 'desc'), limit(USER_LIST_FETCH_LIMIT + 1));
    const snap = await getDocs(q);
    const all = [];
    snap.forEach(function(d) { all.push(d.data()); });
    const truncated = all.length > USER_LIST_FETCH_LIMIT;
    const items = all.slice(0, USER_LIST_FETCH_LIMIT);
    return { items: items, truncated: truncated, error: false };
  } catch (err) {
    logUserManagementError('chargement de la liste des utilisateurs', err);
    return { items: [], truncated: false, error: true };
  }
}

/**
 * Relit un utilisateur precis par son uid (ex. avant d'afficher sa fiche
 * detaillee, pour disposer de la donnee la plus fraiche possible).
 *
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
export async function getUserByUid(uid) {
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logUserManagementError('lecture de la fiche utilisateur ' + uid, err);
    return null;
  }
}

/**
 * Met a jour le role d'un utilisateur cible. N'effectue AUCUNE verification
 * de regle metier (ex. auto-modification) : cette responsabilite incombe a
 * l'appelant (js/services/admin-service.js). La protection reelle contre un
 * contournement est assuree par les regles Firestore.
 *
 * @param {string} uid
 * @param {string} newRole
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateUserRole(uid, newRole) {
  try {
    const ref = doc(db, 'users', uid);
    await updateDoc(ref, { role: newRole });
    return { success: true, error: false };
  } catch (err) {
    logUserManagementError('mise a jour du role de l\'utilisateur ' + uid, err);
    return { success: false, error: true };
  }
}

/**
 * Met a jour le statut d'un utilisateur cible. Memes remarques que
 * updateUserRole ci-dessus.
 *
 * @param {string} uid
 * @param {string} newStatus
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateUserStatus(uid, newStatus) {
  try {
    const ref = doc(db, 'users', uid);
    await updateDoc(ref, { status: newStatus });
    return { success: true, error: false };
  } catch (err) {
    logUserManagementError('mise a jour du statut de l\'utilisateur ' + uid, err);
    return { success: false, error: true };
  }
}

/**
 * Compte les administrateurs actuellement ACTIFS (role admin ET statut
 * active). Utilisee par js/services/admin-service.js pour garantir qu'il
 * existe toujours au moins un administrateur actif (voir "Empecher toute
 * situation critique", RAPPORT_SPRINT8.md).
 *
 * Utilise une requete filtree sur un seul champ (`role`, indexee
 * automatiquement par Firestore, sans necessiter d'index composite), puis
 * filtre le statut cote client sur ce lot - en pratique tres restreint
 * (le nombre d'administrateurs reste toujours tres inferieur au nombre
 * total d'utilisateurs).
 *
 * IMPORTANT (fail-safe) : en cas d'erreur Firestore, cette fonction renvoie
 * `error: true` et un compte `null` plutot qu'un chiffre suppose - voir
 * admin-service.js, qui bloque alors l'action par prudence (mieux vaut
 * refuser une action legitime en cas de panne que risquer de retirer par
 * erreur le dernier administrateur actif).
 *
 * @returns {Promise<{count:(number|null), error:boolean}>}
 */
export async function countActiveAdmins() {
  try {
    const colRef = collection(db, 'users');
    const q = query(colRef, where('role', '==', ROLES.ADMIN));
    const snap = await getDocs(q);
    let count = 0;
    snap.forEach(function(d) {
      const data = d.data();
      const status = data.status || STATUSES.ACTIVE;
      if (status === STATUSES.ACTIVE) count++;
    });
    return { count: count, error: false };
  } catch (err) {
    logUserManagementError('comptage des administrateurs actifs', err);
    return { count: null, error: true };
  }
}

/**
 * Met a jour les champs METIER additifs (Sprint 14) d'un utilisateur cible
 * - jamais role/status/uid/email/createdAt (voir changeRole/changeUserStatus
 * dans admin-service.js pour ces champs proteges separement). Reecrit
 * uniquement les cles fournies.
 *
 * @param {string} uid
 * @param {{firstName?:string, lastName?:string, organizationId?:(string|null), profileId?:(string|null), groupIds?:Array<string>}} fields
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateUserBusinessFields(uid, fields) {
  const allowed = ['firstName', 'lastName', 'organizationId', 'profileId', 'groupIds'];
  const payload = {};
  allowed.forEach(function(key) {
    if (fields && Object.prototype.hasOwnProperty.call(fields, key)) payload[key] = fields[key];
  });
  if (Object.keys(payload).length === 0) return { success: false, error: false };
  try {
    const ref = doc(db, 'users', uid);
    await updateDoc(ref, payload);
    return { success: true, error: false };
  } catch (err) {
    logUserManagementError('mise à jour des champs métier de l\'utilisateur ' + uid, err);
    return { success: false, error: true };
  }
}

/**
 * Identifiant de l'administrateur actuellement connecte (pour le journal
 * d'audit, voir js/services/admin-service.js). Simple relai de
 * app-context.js, pour eviter que ce service n'ait besoin d'importer
 * authorization-service.js (separation des responsabilites).
 *
 * @returns {{uid:string, email:string}|null}
 */
export function getRequestingAdminIdentity() {
  const ctx = getCurrentUserContext();
  if (!ctx) return null;
  return { uid: ctx.uid, email: ctx.email };
}
