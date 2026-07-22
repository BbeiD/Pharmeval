// ===================== SERVICE DE CATALOGUE — DEFI DU JOUR (FIRESTORE) =====================
// Responsabilite UNIQUE : lecture/ecriture Firestore de
// `daily_challenge_progress/{uid}` (un seul document par utilisateur, la
// serie en cours) - meme layering que question-progress-catalog-service.js
// (aucune regle metier ici, voir daily-challenge-service.js).
//
// Identifiant de document = uid directement (pas de cle composite : il n'y
// a qu'UNE seule progression de defi par utilisateur, contrairement a
// question_progress qui en a une par question).

import { db } from "../firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const COLLECTION = 'daily_challenge_progress';

function logError(context, err) {
  console.error('[daily-challenge-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getDailyChallengeProgress(userId) {
  try {
    const snap = await getDoc(doc(db, COLLECTION, userId));
    return snap.exists() ? snap.data() : null;
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
    await setDoc(doc(db, COLLECTION, progress.userId), progress);
    return { success: true, error: false };
  } catch (err) {
    logError('écriture de la progression de ' + progress.userId, err);
    return { success: false, error: true };
  }
}
