// ===================== SERVICE "DEFI DU JOUR" (ORCHESTRATION) =====================
// Point d'entree UNIQUE pour js/defi.js. Coordonne :
//   - js/services/parcours-service.js (getSelfServiceCatalogParcours() —
//     CORRECTIF 02/08/2026 : remplace browseActiveDocumentSources() dont le
//     catalogue document_sources etait vide ; le pool eligible est desormais
//     l'union des directQuestionIds de tous les parcours d'entrainement libre
//     publies (non editoriaux), identique au pool de l'entrainement libre)
//   - js/services/daily-challenge-logic.js (selection deterministe + calcul
//     de serie - AUCUN appel Firestore dans ce fichier-la)
//   - js/services/daily-challenge-catalog-service.js (lecture/ecriture du
//     document de progression)
//   - js/services/evaluation-session-service.js (creation reelle de la
//     session - reutilise le meme moteur que l'entrainement libre/les
//     parcours, jamais une logique de session dupliquee)
//
// APPLICATION DE LA STREAK : voir applyDailyChallengeResultIfNew(),
// appelee UNIQUEMENT par evaluation-result-service.js#finalizeEvaluation(),
// au MEME endroit et selon la MEME philosophie "best effort, mais attendue
// avant de rendre la main" que updateProgressionFromResult()/
// updateQuestionProgressFromResult() (voir le correctif du 22/07/2026 sur
// ce fichier) - jamais un second point de declenchement dans le projet.

import { getCurrentUserContext } from "./app-context.js";
import { getSelfServiceCatalogParcours } from "./parcours-service.js";
import { todayDateStr } from "./date-utils.js";
import { pickDailyChallengeIds, computeDailyChallengeStreak, completeDailyChallengeProgress } from "./daily-challenge-logic.js";
import { getDailyChallengeProgress, saveDailyChallengeProgress } from "./daily-challenge-catalog-service.js";
import { startDailyChallengeSession as createDailyChallengeSession, getActiveDailyChallengeSession } from "./evaluation-session-service.js";

/**
 * Pool ELIGIBLE au défi du jour : union des directQuestionIds de tous les
 * parcours d'entraînement libre publiés (editorialOnly absent ou false),
 * identique au pool utilisé par l'entraînement libre (même source de vérité,
 * getSelfServiceCatalogParcours() — correctif 02/08/2026, browseActive
 * DocumentSources() renvoyait un pool vide car aucune source n'était active).
 * @returns {Promise<{ids:Array<string>, error:boolean}>}
 */
async function getEligibleQuestionIds() {
  const result = await getSelfServiceCatalogParcours();
  if (!result || result.error) return { ids: [], error: true };
  const allIds = new Set();
  (result.items || []).forEach(function(p) {
    if (p.editorialOnly) return; // exclure ALAUNE, Lundi Légi
    (p.directQuestionIds || []).forEach(function(id) { allIds.add(id); });
  });
  return { ids: Array.from(allIds), error: false };
}

/**
 * Etat complet du défi du jour pour l'ecran "Défi" : deja releve
 * aujourd'hui ou non, serie en cours/meilleure serie, et le pool eligible
 * du jour (pour savoir combien de questions comportera le prochain défi).
 * @returns {Promise<{error:boolean, dateStr:string, alreadyCompletedToday:boolean, progress:object, eligibleCount:number}>}
 */
export async function getDailyChallengeStateForUser() {
  const ctx = getCurrentUserContext();
  const dateStr = todayDateStr();
  if (!ctx || !ctx.uid) {
    return { error: true, dateStr: dateStr, alreadyCompletedToday: false, progress: completeDailyChallengeProgress(null), eligibleCount: 0 };
  }

  // getActiveDailyChallengeSession est limité à 4 s via Promise.race :
  // s'il ne répond pas (endpoint lent ou absent), il renvoie null et la page
  // charge quand même en état "non commencé" — jamais de blocage.
  const timeout = new Promise(function(resolve) { setTimeout(function() { resolve(null); }, 4000); });
  const [rawProgress, eligible, activeSession] = await Promise.all([
    getDailyChallengeProgress(ctx.uid),
    getEligibleQuestionIds(),
    Promise.race([
      getActiveDailyChallengeSession(dateStr).catch(function() { return null; }),
      timeout,
    ]),
  ]);

  const progress = completeDailyChallengeProgress(rawProgress);
  return {
    error: !!eligible.error,
    dateStr: dateStr,
    alreadyCompletedToday: progress.lastCompletedDate === dateStr,
    progress: progress,
    eligibleCount: eligible.ids.length,
    activeSession: activeSession || null,
  };
}

/**
 * Démarre réellement le défi du jour - même principe de navigation que
 * parcours-detail.js#startParcoursEvaluation() (AUCUNE écriture ici tant
 * que la session n'est pas créée par evaluation-session-service.js, qui
 * fait le travail réel). Forme de retour ALIGNEE sur celle de
 * startDailyChallengeSession() (evaluation-session-service.js) - `status`
 * ('success'/'denied'/'error'), jamais `authorized` (convention differente
 * utilisee ailleurs, ex. parcours-evaluation-service.js) : cette fonction
 * delegue directement a l'autre pour le cas de succes, elles doivent donc
 * partager EXACTEMENT la meme forme, jamais deux conventions melangees
 * pour un seul appelant (js/defi.js).
 * @returns {Promise<{status:string, message:string, reason?:string, session?:object}>}
 */
export async function startTodaysChallenge() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { status: 'denied', reason: 'not_authenticated', message: 'Vous devez être connecté pour relever le défi du jour.' };

  const dateStr = todayDateStr();
  const eligible = await getEligibleQuestionIds();
  if (eligible.error) return { status: 'error', reason: 'error', message: 'Impossible de préparer le défi du jour pour le moment. Réessayez plus tard.' };
  if (eligible.ids.length === 0) return { status: 'denied', reason: 'no_questions', message: 'Aucune question n\'est actuellement disponible pour le défi du jour.' };

  const todaysIds = pickDailyChallengeIds(eligible.ids, dateStr);
  return createDailyChallengeSession(todaysIds, dateStr);
}

/**
 * CORRECTIF (meme famille que le bug du 22/07/2026 sur question_progress/
 * competency_progress) : appelee UNIQUEMENT par finalizeEvaluation()
 * (evaluation-result-service.js), et ATTENDUE par lui avant de rendre la
 * main - jamais en "tir et oublié". IDEMPOTENT par construction
 * (computeDailyChallengeStreak() renvoie l'etat INCHANGE si ce jour a deja
 * ete compte) : rejouer ce resultat (retry, ou reconciliation future) ne
 * peut jamais compter le meme jour deux fois.
 * @param {object} evaluationResult - doit porter `dailyChallengeDate`
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function applyDailyChallengeResultIfNew(evaluationResult) {
  const dateStr = evaluationResult.dailyChallengeDate;
  if (!dateStr) return { success: true, error: false };

  const existing = await getDailyChallengeProgress(evaluationResult.userId);
  const { progress, changed } = computeDailyChallengeStreak(
    existing ? Object.assign({}, existing, { userId: evaluationResult.userId }) : { userId: evaluationResult.userId },
    dateStr,
    evaluationResult.id,
    new Date().toISOString()
  );
  if (!changed) return { success: true, error: false };

  return saveDailyChallengeProgress(progress);
}
