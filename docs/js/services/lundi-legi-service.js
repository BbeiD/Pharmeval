// ===================== SERVICE LUNDI LEGI (ORCHESTRATION) =====================
// Point d'entree unique pour js/lundi-legi.js et js/home.js.
// Coordonne :
//   - lundi-legi-schedule.js (planning : semaine courante -> pedagogicalId)
//   - question-catalog-service.js (lecture de la question depuis Firestore)
//   - lundi-legi-catalog-service.js (progression utilisateur)

import { getCurrentUserContext } from "./app-context.js";
import { currentWeekEntry } from "./lundi-legi-schedule.js";
import { getExistingQuestionsByPedagogicalIds } from "./question-catalog-service.js";
import { getLundiLegiProgress, saveLundiLegiProgress } from "./lundi-legi-catalog-service.js";

/**
 * Etat complet du Lundi Legi pour la semaine en cours.
 * Retourne : { outOfSeason, weekNumber, date, pedagogicalId, question,
 *   alreadyAnswered, userAnswer }
 * `question` est null si hors calendrier ou si la question n'est pas
 * trouvee dans Firestore.
 */
export async function getLundiLegiStateForUser() {
  const ctx = getCurrentUserContext();
  const entry = currentWeekEntry();

  if (!entry) {
    return { outOfSeason: true, weekNumber: null, date: null, pedagogicalId: null, question: null, alreadyAnswered: false, userAnswer: null };
  }

  const [qResult, progress] = await Promise.all([
    getExistingQuestionsByPedagogicalIds([entry.id]),
    ctx && ctx.uid ? getLundiLegiProgress(ctx.uid) : Promise.resolve(null),
  ]);

  const question = (qResult && !qResult.error && qResult.map) ? (qResult.map.get(entry.id) || null) : null;
  const answers = (progress && progress.answers) || {};
  const userAnswer = answers[entry.date] || null;

  return {
    outOfSeason: false,
    weekNumber: entry.weekNumber,
    date: entry.date,
    pedagogicalId: entry.id,
    question: question,
    alreadyAnswered: !!userAnswer,
    userAnswer: userAnswer,
  };
}

/**
 * Enregistre la reponse de l'utilisateur pour la semaine en cours.
 * Idempotent : une deuxieme soumission pour la meme semaine est ignoree.
 * @param {string} weekDate - lundi de la semaine ('AAAA-MM-JJ')
 * @param {string} pedagogicalId
 * @param {number} selectedAnswer - index 0-3
 * @param {boolean} correct
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function submitLundiLegiAnswer(weekDate, pedagogicalId, selectedAnswer, correct) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { success: false, error: true };

  const existing = await getLundiLegiProgress(ctx.uid);
  const answers = (existing && existing.answers) ? Object.assign({}, existing.answers) : {};

  if (answers[weekDate]) return { success: true, error: false };

  answers[weekDate] = {
    pedagogicalId: pedagogicalId,
    selectedAnswer: selectedAnswer,
    correct: correct,
    answeredAt: new Date().toISOString(),
  };

  return saveLundiLegiProgress({ userId: ctx.uid, answers: answers });
}
