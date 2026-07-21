// ===================== SERVICE DE CATALOGUE DES SESSIONS D'EVALUATION (FIRESTORE) — Sprint 17 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `evaluation_sessions`. Aucune regle de validation ni
// aucune verification de securite APPLICATIVE ici (voir evaluation-
// session-service.js pour l'orchestration, et firestore.rules pour la
// garantie reelle cote serveur) - ce fichier ne fait que lire/ecrire ce
// qui lui est deja fourni construit et valide, meme principe que tous les
// autres `*-catalog-service.js` du projet.

import { db } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const SESSION_COLLECTION = 'evaluation_sessions';

function logCatalogError(context, err) {
  console.error('[evaluation-session-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Cree une nouvelle session (jamais pour une mise a jour).
 * @param {object} sessionDocument - deja construit par completeSessionMetadata()
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function createSessionDocument(sessionDocument) {
  try {
    await setDoc(doc(db, SESSION_COLLECTION, sessionDocument.id), sessionDocument);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('création de la session ' + sessionDocument.id, err);
    return { success: false, error: true };
  }
}

/**
 * Relit une session par son identifiant.
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function getSessionById(sessionId) {
  try {
    const snap = await getDoc(doc(db, SESSION_COLLECTION, sessionId));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logCatalogError('lecture de la session ' + sessionId, err);
    return null;
  }
}

/**
 * Recherche la session ACTIVE (in_progress) d'un utilisateur pour un
 * couple (parcours, competence) precis - "une seule session active par
 * utilisateur, parcours et competence" (SPRINT17, section 4). Utilisee
 * AVANT toute creation, pour proposer une reprise plutot qu'une nouvelle
 * session (voir evaluation-session-service.js).
 * @param {string} userId
 * @param {string} parcoursId
 * @param {string} competencyId
 * @returns {Promise<object|null>}
 */
export async function findActiveSession(userId, parcoursId, competencyId) {
  try {
    const snap = await getDocs(query(
      collection(db, SESSION_COLLECTION),
      where('userId', '==', userId),
      where('parcoursId', '==', parcoursId),
      where('competencyId', '==', competencyId),
      where('status', '==', 'in_progress'),
      limit(1)
    ));
    return snap.empty ? null : snap.docs[0].data();
  } catch (err) {
    logCatalogError('recherche d\'une session active', err);
    return null;
  }
}

/**
 * Compte les tentatives déjà existantes (tous statuts confondus) pour un
 * couple (parcours, compétence) - utilisé pour calculer `attemptNumber`
 * (SPRINT17, section 4 : préparé, non exploité fonctionnellement pour
 * bloquer quoi que ce soit, uniquement pour renseigner ce compteur de
 * façon honnête dès la création).
 * @param {string} userId
 * @param {string} parcoursId
 * @param {string} competencyId
 * @returns {Promise<number>}
 */
export async function countPreviousAttempts(userId, parcoursId, competencyId) {
  try {
    const snap = await getDocs(query(
      collection(db, SESSION_COLLECTION),
      where('userId', '==', userId),
      where('parcoursId', '==', parcoursId),
      where('competencyId', '==', competencyId),
      orderBy('startedAt', 'desc'),
      limit(50)
    ));
    return snap.size;
  } catch (err) {
    logCatalogError('comptage des tentatives précédentes', err);
    return 0; // fail-open : ne bloque jamais un demarrage de session sur une simple panne de comptage
  }
}

/**
 * SPRINT 21.5, PHASE B1 : équivalent de findActiveSession() ci-dessus,
 * pour l'entraînement libre - scope par `sessionType`, jamais par
 * parcours/compétence (qui n'existent pas dans ce mode). Nécessite
 * l'index composite (userId, sessionType, status) - voir
 * firestore.indexes.json.
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function findActiveFreeTrainingSession(userId) {
  try {
    const snap = await getDocs(query(
      collection(db, SESSION_COLLECTION),
      where('userId', '==', userId),
      where('sessionType', '==', 'free_training'),
      where('status', '==', 'in_progress'),
      limit(1)
    ));
    return snap.empty ? null : snap.docs[0].data();
  } catch (err) {
    logCatalogError('recherche d\'une session d\'entraînement libre active', err);
    return null;
  }
}

/**
 * Équivalent de countPreviousAttempts() ci-dessus pour l'entraînement
 * libre - même usage (alimenter `attemptNumber` de façon honnête, jamais
 * exploité pour bloquer quoi que ce soit).
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function countPreviousFreeTrainingAttempts(userId) {
  try {
    const snap = await getDocs(query(
      collection(db, SESSION_COLLECTION),
      where('userId', '==', userId),
      where('sessionType', '==', 'free_training'),
      orderBy('startedAt', 'desc'),
      limit(50)
    ));
    return snap.size;
  } catch (err) {
    logCatalogError('comptage des tentatives d\'entraînement libre précédentes', err);
    return 0; // fail-open, meme principe que countPreviousAttempts()
  }
}

/**
 * Reecrit uniquement les champs fournis, jamais l'ensemble du document.
 * @param {string} sessionId
 * @param {object} fields
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateSessionFields(sessionId, fields) {
  try {
    await updateDoc(doc(db, SESSION_COLLECTION, sessionId), fields);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('mise à jour de la session ' + sessionId, err);
    return { success: false, error: true };
  }
}
