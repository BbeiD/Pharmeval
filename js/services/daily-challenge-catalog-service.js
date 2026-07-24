// ===================== SERVICE DE CATALOGUE — DEFI DU JOUR (FIRESTORE) =====================
// Responsabilite UNIQUE : lecture/ecriture Firestore de
// `daily_challenge_progress/{uid}` (un seul document par utilisateur, la
// serie en cours) - meme layering que question-progress-catalog-service.js
// (aucune regle metier ici, voir daily-challenge-service.js).
//
// Identifiant de document = uid directement (pas de cle composite : il n'y
// a qu'UNE seule progression de defi par utilisateur, contrairement a
// question_progress qui en a une par question).

import { auth } from "../firebase-config.js";
import { API_BASE_URL } from "../config.js";

function logError(context, err) {
  console.error('[daily-challenge-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getDailyChallengeProgress(userId) {
  try {
    if (!auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/daily-challenge/${userId}`, {
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
 * Ecrit l'integralite du document (jamais une ecriture partielle - la
 * progression est TOUJOURS recalculee en entier a partir de l'etat
 * precedent, voir daily-challenge-logic.js#computeDailyChallengeStreak,
 * meme principe que competency-progress-catalog-service.js).
 * @param {object} progress - deja complete (completeDailyChallengeProgress())
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function saveDailyChallengeProgress(progress) {
  try {
    if (!auth.currentUser) return { success: false, error: true };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/daily-challenge/${progress.userId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(progress),
    });
    if (!res.ok) {
      logError('écriture de la progression de ' + progress.userId + ' (API ' + res.status + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logError('écriture de la progression de ' + progress.userId, err);
    return { success: false, error: true };
  }
}
