// ===================== SERVICE "ACTIVITE RECENTE" (ORCHESTRATION, accueil) =====================
// Point d'entree UNIQUE pour js/home.js. Combine :
//   - evaluation-result-catalog-service.js (getAllResultsForUser(), deja
//     utilisee par reconcileProgressForUser()/getParcoursAttemptSummaryForUser())
//   - assignment-service.js (noms des parcours, pour les libelles)
//   - daily-challenge-catalog-service.js (evenement "serie prolongee")
//   - recent-activity-logic.js (AUCUN appel Firestore - agregation pure)
//
// "Agrège et renseigne" (demande directe de David, 22/07/2026).

import { getAllResultsForUser } from "./evaluation-result-catalog-service.js";
import { getAssignedParcoursForUser } from "./assignment-service.js";
import { getDailyChallengeProgress } from "./daily-challenge-catalog-service.js";
import { todayDateStr, shiftDateStr } from "./date-utils.js";
import { buildRecentActivityFromResults, buildStreakActivityEvent } from "./recent-activity-logic.js";

const DEFAULT_MAX_ITEMS = 8;

/**
 * @param {string} uid
 * @param {number} [maxItems]
 * @returns {Promise<{error:boolean, items:Array<object>}>}
 */
export async function getRecentActivityForUser(uid, maxItems) {
  if (!uid) return { error: false, items: [] };

  const [resultsResult, assignedResult, streakProgress] = await Promise.all([
    getAllResultsForUser(uid),
    getAssignedParcoursForUser(uid),
    getDailyChallengeProgress(uid),
  ]);
  if (resultsResult.error) return { error: true, items: [] };

  const parcoursNameById = new Map();
  (assignedResult.items || []).forEach(function(entry) {
    parcoursNameById.set(entry.parcours.id, entry.parcours.name);
  });

  const events = buildRecentActivityFromResults(resultsResult.items, parcoursNameById);

  const today = todayDateStr();
  const yesterday = shiftDateStr(today, -1);
  const streakEvent = buildStreakActivityEvent(streakProgress, today, yesterday);
  if (streakEvent) events.push(streakEvent);

  events.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

  return { error: false, items: events.slice(0, maxItems || DEFAULT_MAX_ITEMS) };
}
