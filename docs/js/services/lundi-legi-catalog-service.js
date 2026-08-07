// ===================== SERVICE DE CATALOGUE — LUNDI LEGI (FIRESTORE) =====================
// Responsabilite UNIQUE : lecture/ecriture Firestore de
// `lundi_legi_progress/{uid}` (un seul document par utilisateur).
// Structure : { userId, answers: { 'AAAA-MM-JJ': { pedagogicalId,
//   selectedAnswer, correct, answeredAt } } }
// Meme layering que daily-challenge-catalog-service.js : aucune regle
// metier ici, tout dans lundi-legi-service.js.

import { auth } from "../firebase-config.js";
import { API_BASE_URL } from "../config.js";

function logError(context, err) {
  console.error('[lundi-legi-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getLundiLegiProgress(userId) {
  try {
    if (!auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/lundi-legi/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logError('lecture de la progression de ' + userId + ' (API ' + res.status + ')', null);
      return null;
    }
    const body = await res.json();
    return body.data;
  } catch (err) {
    logError('lecture de la progression de ' + userId, err);
    return null;
  }
}

/**
 * Ecrit l'integralite du document de progression.
 * @param {object} progress - { userId, answers: {...} }
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function saveLundiLegiProgress(progress) {
  try {
    if (!auth.currentUser) return { success: false, error: true };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/lundi-legi/${progress.userId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(progress),
    });
    if (!res.ok) {
      logError('ecriture de la progression de ' + progress.userId + ' (API ' + res.status + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logError('ecriture de la progression de ' + progress.userId, err);
    return { success: false, error: true };
  }
}
