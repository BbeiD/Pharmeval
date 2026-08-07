// ===================== LOGIQUE PURE — ACTIVITE RECENTE (accueil) =====================
// Aucune dependance Firestore ici (meme principe que question-progress-
// logic.js/daily-challenge-logic.js) - voir recent-activity-service.js pour
// l'orchestration reelle (Firestore).
//
// "Agrège et renseigne" (demande directe de David, 22/07/2026) : chaque
// evenement est derive de donnees REELLES deja enregistrees, jamais
// invente - "score amélioré" et "nouveau parcours commencé" en particulier
// n'ont de sens qu'en parcourant l'historique COMPLET en ordre
// chronologique (un seul résultat isolé ne suffit pas à savoir si son
// parcours avait déjà été commencé avant, ou si le score précédent était
// plus bas).

/**
 * @param {Array<object>} evaluationResults - TOUS les résultats de
 *   l'utilisateur (voir getAllResultsForUser(), evaluation-result-catalog-
 *   service.js) - n'importe quel ordre, re-triés à l'intérieur.
 * @param {Map<string,string>} parcoursNameById - pour les événements liés à
 *   un parcours (voir getAssignedParcoursForUser())
 * @returns {Array<object>} événements {type, date, label, detail}, TRIÉS du
 *   plus récent au plus ancien
 */
export function buildRecentActivityFromResults(evaluationResults, parcoursNameById) {
  const sorted = (evaluationResults || []).slice().sort(function(a, b) {
    return new Date(a.createdAt) - new Date(b.createdAt); // chronologique ASC - necessaire pour detecter "premiere fois"/amelioration
  });

  const events = [];
  const seenParcoursIds = new Set();
  let previousPercent = null;

  sorted.forEach(function(r) {
    const percent = (r.score && r.score.percent) || 0;

    if (r.parcoursId && !seenParcoursIds.has(r.parcoursId)) {
      seenParcoursIds.add(r.parcoursId);
      events.push({
        type: 'parcours_started',
        date: r.createdAt,
        label: 'Nouveau parcours commencé',
        detail: (parcoursNameById && parcoursNameById.get(r.parcoursId)) || 'Parcours',
      });
    }

    if (previousPercent !== null && percent > previousPercent) {
      events.push({
        type: 'score_improved',
        date: r.createdAt,
        label: 'Score amélioré',
        detail: previousPercent + ' % → ' + percent + ' %',
      });
    }
    previousPercent = percent;

    events.push({
      type: 'evaluation_completed',
      date: r.createdAt,
      label: 'Évaluation terminée',
      detail: r.dailyChallengeDate
        ? 'Défi du jour'
        : ((r.parcoursId && parcoursNameById && parcoursNameById.get(r.parcoursId)) || 'Entraînement libre'),
    });
  });

  return events.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
}

/**
 * Événement "série prolongée" à partir de daily_challenge_progress - UN
 * SEUL événement possible (ce document ne garde pas un historique jour par
 * jour, voir daily-challenge-logic.js), affiché UNIQUEMENT si le défi a été
 * relevé aujourd'hui ou hier - au-delà, ce n'est plus une activité récente.
 * @param {object|null} dailyChallengeProgress
 * @param {string} todayStr - 'AAAA-MM-JJ'
 * @param {string} yesterdayStr - 'AAAA-MM-JJ'
 * @returns {object|null}
 */
export function buildStreakActivityEvent(dailyChallengeProgress, todayStr, yesterdayStr) {
  const p = dailyChallengeProgress;
  if (!p || !p.lastCompletedDate) return null;
  if (p.lastCompletedDate !== todayStr && p.lastCompletedDate !== yesterdayStr) return null;
  return {
    type: 'streak',
    // Heure arbitraire (seule la date est connue) - sert uniquement à situer
    // cet événement PARMI les autres du même jour, jamais pour un tri fin.
    date: p.lastCompletedDate + 'T12:00:00.000Z',
    label: 'Série prolongée',
    detail: p.currentStreak + ' jour(s) consécutif(s)',
  };
}
