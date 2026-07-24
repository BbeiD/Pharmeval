// ===================== SERVICE DE CATALOGUE DES SESSIONS D'EVALUATION (FIRESTORE) — Sprint 17 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `evaluation_sessions`. Aucune regle de validation ni
// aucune verification de securite APPLICATIVE ici (voir evaluation-
// session-service.js pour l'orchestration, et firestore.rules pour la
// garantie reelle cote serveur) - ce fichier ne fait que lire/ecrire ce
// qui lui est deja fourni construit et valide, meme principe que tous les
// autres `*-catalog-service.js` du projet.

import { db, auth } from "../firebase-config.js";
import {
  doc, setDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

async function fetchSessionApi(path) {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

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
    const body = await fetchSessionApi(`/api/sessions/${sessionId}`);
    return body ? body.data : null;
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
    const params = new URLSearchParams({ parcoursId: parcoursId || '', competencyId: competencyId || '' });
    const body = await fetchSessionApi(`/api/sessions/active?${params.toString()}`);
    return body ? body.data : null;
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
    const params = new URLSearchParams({ parcoursId: parcoursId || '', competencyId: competencyId || '' });
    const body = await fetchSessionApi(`/api/sessions/attempts-count?${params.toString()}`);
    return body ? body.count : 0;
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
 *
 * CORRECTIF (Défi du jour, 22/07/2026) : le défi du jour réutilise EXACTEMENT
 * le même triplet (sessionType='free_training', parcoursId=null,
 * competencyId=null) que l'entraînement libre - seul `dailyChallengeDate`
 * les distingue (voir evaluation-session-metadata-service.js). Sans ce
 * correctif, cette fonction pouvait retourner une session de DÉFI en cours
 * quand l'utilisateur ouvrait l'entraînement libre (ou l'inverse) - filtre
 * désormais explicitement `dailyChallengeDate == null` CÔTÉ CLIENT (jamais
 * dans la requête elle-même : éviter un nouvel index composite à déployer
 * pour une liste de toute façon minuscule - au plus une poignée de
 * sessions in_progress par utilisateur).
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function findActiveFreeTrainingSession(userId) {
  try {
    const body = await fetchSessionApi('/api/sessions/active-free-training');
    return body ? body.data : null;
  } catch (err) {
    logCatalogError('recherche d\'une session d\'entraînement libre active', err);
    return null;
  }
}

/**
 * AJOUT (Défi du jour) : équivalent EXACT de findActiveFreeTrainingSession()
 * ci-dessus, mais pour LE défi du jour d'UNE date precise - meme requete
 * Firestore (meme index reutilise, voir le correctif ci-dessus), filtre
 * `dailyChallengeDate === dateStr` cote client. Une session de défi d'un
 * jour PASSE ne sera donc jamais confondue avec celle d'aujourd'hui.
 * @param {string} userId
 * @param {string} dateStr - 'AAAA-MM-JJ'
 * @returns {Promise<object|null>}
 */
export async function findActiveDailyChallengeSession(userId, dateStr) {
  try {
    const params = new URLSearchParams({ dailyChallengeDate: dateStr || '' });
    const body = await fetchSessionApi(`/api/sessions/active-free-training?${params.toString()}`);
    return body ? body.data : null;
  } catch (err) {
    logCatalogError('recherche du défi du jour actif', err);
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
    const body = await fetchSessionApi('/api/sessions/free-training-attempts-count');
    return body ? body.count : 0;
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
