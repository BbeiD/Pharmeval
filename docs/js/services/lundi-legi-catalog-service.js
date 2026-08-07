// ===================== SERVICE DE CATALOGUE — LUNDI LEGI (FIRESTORE) =====================
// Responsabilite UNIQUE : appels HTTP vers /api/lundi-legi. Aucune regle
// metier ici, tout dans lundi-legi-service.js.
//
// CORRECTIF SECURITE (07/08/2026) : la resolution du calendrier, la
// lecture de la question (avec `correctAnswer`/`explanation` reveles
// UNIQUEMENT apres reponse reelle) et la correction sont desormais
// entierement server-side (voir functions/index.js) - ce fichier ne
// fait plus que relayer les appels, plus aucune donnee de correction
// n'est calculee ni supposee correcte cote client.

import { auth } from "../firebase-config.js";
import { API_BASE_URL } from "../config.js";

function logError(context, err) {
  console.error('[lundi-legi-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Etat complet de la semaine en cours pour cet utilisateur (calendrier,
 * question, progression) - construit entierement cote serveur.
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function fetchLundiLegiState(userId) {
  try {
    if (!auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/lundi-legi/${userId}/state`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logError('lecture de l\'état de ' + userId + ' (API ' + res.status + ')', null);
      return null;
    }
    const body = await res.json();
    return body.data;
  } catch (err) {
    logError('lecture de l\'état de ' + userId, err);
    return null;
  }
}

/**
 * Soumet la reponse de la semaine en cours. Le serveur verifie que
 * `pedagogicalId` correspond bien au calendrier PUIS calcule lui-meme si
 * c'est correct - jamais fourni par le client.
 * @param {string} userId
 * @param {string} weekDate
 * @param {string} pedagogicalId
 * @param {number} selectedAnswer
 * @returns {Promise<{success:boolean, error:boolean, correct?:boolean, correctAnswer?:number, explanation?:string}>}
 */
export async function submitLundiLegiAnswerToServer(userId, weekDate, pedagogicalId, selectedAnswer) {
  try {
    if (!auth.currentUser) return { success: false, error: true };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/lundi-legi/${userId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekDate, pedagogicalId, selectedAnswer }),
    });
    const body = await res.json().catch(function() { return null; });
    if (!res.ok) {
      logError('soumission de la réponse de ' + userId + ' (API ' + res.status + ')', null);
      return Object.assign({ success: false, error: true }, body || {});
    }
    return body || { success: false, error: true };
  } catch (err) {
    logError('soumission de la réponse de ' + userId, err);
    return { success: false, error: true };
  }
}
