// ===================== SERVICE DE CATALOGUE DES SESSIONS D'EVALUATION (FIRESTORE) — Sprint 17 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `evaluation_sessions`. Aucune regle de validation ni
// aucune verification de securite APPLICATIVE ici (voir evaluation-
// session-service.js pour l'orchestration, et firestore.rules pour la
// garantie reelle cote serveur) - ce fichier ne fait que lire/ecrire ce
// qui lui est deja fourni construit et valide, meme principe que tous les
// autres `*-catalog-service.js` du projet.

import { auth } from "../firebase-config.js";
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

function logCatalogError(context, err) {
  console.error('[evaluation-session-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Demande la creation d'une nouvelle session A PARTIR D'UNE INTENTION
 * (jamais un document de session deja construit - CORRECTIF SECURITE
 * 07/08/2026 : le contenu des questions, y compris `correctAnswer`, est
 * desormais TOUJOURS reconstruit cote serveur a partir de Firestore, plus
 * jamais accepte tel quel du client - voir POST /api/sessions,
 * functions/index.js). En cas de succes, la reponse contient la session
 * COMPLETE telle que creee par le serveur (`result.session`), ainsi que
 * `result.parcours`/`result.competency` le cas echeant ; en cas de refus,
 * `result.reason`/`result.message` expliquent pourquoi.
 * @param {object} intent - {id, userId, sessionType, parcoursId?, competencyId?, dailyChallengeDate?, pedagogicalIds?, attemptNumber?}
 * @returns {Promise<{success:boolean, error:boolean, session?:object, parcours?:object, competency?:object, reason?:string, message?:string}>}
 */
export async function createSessionDocument(intent) {
  try {
    if (!auth.currentUser) return { success: false, error: true };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(intent),
    });
    const body = await res.json().catch(function() { return null; });
    if (!res.ok) {
      logCatalogError('création de la session ' + intent.id + ' (API ' + res.status + ')', null);
      return Object.assign({ success: false, error: true }, body || {});
    }
    return body || { success: false, error: true };
  } catch (err) {
    logCatalogError('création de la session ' + intent.id, err);
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
 * CORRECTIF (couts Firestore, audit fable du 08/08/2026, C-4) : equivalent
 * de findActiveSession() ci-dessus mais pour TOUS les parcours de
 * l'utilisateur en UN seul appel, au lieu d'un appel par parcours affiche
 * (jusqu'a 99 sur "Mes parcours" - c'est ce pattern qui avait declenche
 * l'incident de rate limit F3 cette nuit). Retourne une Map(parcoursId ->
 * session), jamais les sessions d'entrainement libre/defi/lundi-legi
 * (memes filtres serveur que findActiveSession : parcoursId defini,
 * competencyId absent).
 * @param {string} userId - non utilise directement (le serveur infere du jeton), garde pour coherence de signature avec findActiveSession()
 * @returns {Promise<Map<string,object>>}
 */
export async function findAllActiveSessionsByParcours(userId) {
  try {
    const body = await fetchSessionApi('/api/sessions/active-by-parcours');
    const byParcoursId = (body && body.byParcoursId) || {};
    return new Map(Object.entries(byParcoursId));
  } catch (err) {
    logCatalogError('recherche groupee des sessions actives par parcours', err);
    return new Map();
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
    if (!auth.currentUser) return { success: false, error: true };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      logCatalogError('mise à jour de la session ' + sessionId + ' (API ' + res.status + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('mise à jour de la session ' + sessionId, err);
    return { success: false, error: true };
  }
}
