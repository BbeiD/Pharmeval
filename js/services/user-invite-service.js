// ===================== SERVICE DE PRE-PROVISIONNEMENT DES UTILISATEURS (Sprint 14) =====================
// CONTRAINTE DU SPRINT ("Ne pas créer de système d'authentification
// supplémentaire. Utiliser Firebase Authentication déjà présent.") : ce
// module ne peut donc PAS créer de compte de connexion (uid, mot de passe)
// depuis l'interface d'administration - Firebase Authentication reste
// l'unique source de création de comptes (auto-inscription, voir js/auth.js).
//
// La fonctionnalité "création" demandée pour le module Utilisateurs
// (SPRINT14, "Interface") est donc interprétée ainsi : un administrateur
// peut PRÉ-PROVISIONNER la fiche métier d'une personne (nom, prénom,
// organisation, profil, groupes) à partir de son adresse e-mail, AVANT
// même que cette personne se connecte pour la première fois. Dès que
// cette personne se connecte réellement via Firebase Authentication avec
// la même adresse, sa fiche métier est automatiquement complétée à partir
// de cette pré-provision (voir js/services/user-service.js,
// ensureUserDocument(), correctif additif Sprint 14) - jamais l'inverse
// (une pré-provision ne crée jamais de compte de connexion).
//
// Collection dédiée `pending_user_invites`, identifiant de document =
// adresse e-mail normalisée (minuscules, espaces retirés) : garantit
// nativement l'unicité d'une pré-provision par adresse, sans requête
// supplémentaire.

import { db } from "../firebase-config.js";
import { getCurrentUserContext } from "./app-context.js";
import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { completeUserBusinessFields } from "./user-profile-metadata-service.js";
import {
  doc, getDoc, setDoc, deleteDoc, updateDoc,
  collection, query, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const INVITE_COLLECTION = 'pending_user_invites';

function normalizeEmail(email) {
  return (email || '').toString().trim().toLowerCase();
}

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { status: 'denied', message: 'Vous devez être connecté pour effectuer cette action.' };
  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) return { status: 'denied', message: 'Cette action est réservée aux administrateurs.' };
  return { status: 'authorized' };
}

function logError(context, err) {
  console.error('[user-invite-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Crée (ou remplace, si non encore consommée) une pré-provision pour une
 * adresse e-mail donnée.
 * @param {{email:string, firstName?:string, lastName?:string, organizationId?:string, profileId?:string, groupIds?:Array<string>}} fields
 * @returns {Promise<{status:string, message:string}>}
 */
export async function createPendingInvite(fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return { status: 'denied', message: access.message };

  const email = normalizeEmail(fields && fields.email);
  if (!email || email.indexOf('@') === -1) {
    return { status: 'error', message: 'Adresse e-mail invalide.' };
  }

  const ref = doc(db, INVITE_COLLECTION, email);
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists() && existingSnap.data().consumedAt) {
      return { status: 'denied', message: 'Cette adresse e-mail a déjà un compte actif sur Pharmeval (pré-provision déjà consommée).' };
    }
  } catch (err) {
    logError('vérification d\'une pré-provision existante', err);
  }

  const ctx = getCurrentUserContext();
  const businessFields = completeUserBusinessFields(fields);
  const invite = Object.assign(
    { email: email, createdAt: new Date().toISOString(), consumedAt: null, consumedByUid: null },
    businessFields,
    { createdBy: (ctx && ctx.uid) || null }
  );

  try {
    await setDoc(ref, invite);
  } catch (err) {
    logError('création d\'une pré-provision', err);
    return { status: 'error', message: 'La création a échoué. Veuillez réessayer.' };
  }
  return { status: 'success', message: 'Fiche pré-provisionnée avec succès pour ' + email + '. Elle sera automatiquement complétée dès la première connexion de cette personne.', invite: invite };
}

/**
 * Liste les pré-provisions non encore consommées (lecture bornée).
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function listPendingInvites() {
  const access = checkAccess();
  if (access.status !== 'authorized') return { items: [], error: true, message: access.message };
  try {
    const snap = await getDocs(query(collection(db, INVITE_COLLECTION), orderBy('createdAt', 'desc'), limit(200)));
    const items = [];
    snap.forEach(function(d) { const data = d.data(); if (!data.consumedAt) items.push(data); });
    return { items: items, error: false };
  } catch (err) {
    logError('lecture des pré-provisions', err);
    return { items: [], error: true };
  }
}

/**
 * Supprime une pré-provision non encore consommée (annulation par
 * l'administrateur).
 * @param {string} email
 * @returns {Promise<{status:string, message:string}>}
 */
export async function cancelPendingInvite(email) {
  const access = checkAccess();
  if (access.status !== 'authorized') return { status: 'denied', message: access.message };
  try {
    await deleteDoc(doc(db, INVITE_COLLECTION, normalizeEmail(email)));
  } catch (err) {
    logError('suppression d\'une pré-provision', err);
    return { status: 'error', message: 'La suppression a échoué. Veuillez réessayer.' };
  }
  return { status: 'success', message: 'Pré-provision annulée.' };
}

/**
 * Relit une pré-provision non consommée pour une adresse e-mail donnée.
 * Utilisée par user-service.js (ensureUserDocument) au moment de la
 * PREMIÈRE création réelle d'un compte, pour compléter automatiquement la
 * fiche métier - lecture directe par identifiant de document (autorisée à
 * l'utilisateur concerné par les règles Firestore, voir firestore.rules),
 * jamais un balayage de la collection.
 *
 * @param {string} email
 * @returns {Promise<object|null>}
 */
export async function getPendingInviteByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  try {
    const snap = await getDoc(doc(db, INVITE_COLLECTION, normalized));
    if (!snap.exists()) return null;
    const data = snap.data();
    return data.consumedAt ? null : data;
  } catch (err) {
    logError('lecture d\'une pré-provision par e-mail', err);
    return null;
  }
}

/**
 * Marque une pré-provision comme consommée (appelée une seule fois, au
 * moment ou le compte réel est créé - voir user-service.js). N'écrit QUE
 * ces deux champs, jamais le reste de la pré-provision (déjà recopiée dans
 * le nouveau document utilisateur par l'appelant).
 *
 * @param {string} email
 * @param {string} uid
 */
export async function markInviteConsumed(email, uid) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { success: false };
  try {
    await updateDoc(doc(db, INVITE_COLLECTION, normalized), { consumedAt: new Date().toISOString(), consumedByUid: uid });
    return { success: true };
  } catch (err) {
    logError('consommation d\'une pré-provision', err);
    return { success: false };
  }
}
