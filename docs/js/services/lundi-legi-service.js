// ===================== SERVICE LUNDI LEGI (ORCHESTRATION) =====================
// Point d'entree unique pour js/lundi-legi.js et js/home.js.
//
// CORRECTIF SECURITE (07/08/2026) : la resolution du calendrier
// (lundi-legi-schedule.js), la lecture de la question elle-meme et la
// correction sont desormais entierement server-side (voir POST/GET
// /api/lundi-legi, functions/index.js) - ce fichier ne fait plus que
// relayer vers lundi-legi-catalog-service.js, aucune logique de
// correction ici.

import { getCurrentUserContext } from "./app-context.js";
import { fetchLundiLegiState, submitLundiLegiAnswerToServer } from "./lundi-legi-catalog-service.js";

const EMPTY_STATE = Object.freeze({
  outOfSeason: true, weekNumber: null, date: null, pedagogicalId: null,
  question: null, alreadyAnswered: false, userAnswer: null,
});

/**
 * Etat complet du Lundi Legi pour la semaine en cours.
 * `question.correctAnswer`/`question.explanation` ne sont renseignes que
 * si `alreadyAnswered` est vrai (garanti par le serveur).
 * @returns {Promise<object>}
 */
export async function getLundiLegiStateForUser() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return EMPTY_STATE;
  const state = await fetchLundiLegiState(ctx.uid);
  return state || EMPTY_STATE;
}

/**
 * Soumet la reponse de l'utilisateur pour la semaine en cours.
 * @param {string} weekDate
 * @param {string} pedagogicalId
 * @param {number} selectedAnswer
 * @returns {Promise<{success:boolean, error:boolean, correct?:boolean, correctAnswer?:number, explanation?:string}>}
 */
export async function submitLundiLegiAnswer(weekDate, pedagogicalId, selectedAnswer) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { success: false, error: true };
  return submitLundiLegiAnswerToServer(ctx.uid, weekDate, pedagogicalId, selectedAnswer);
}
