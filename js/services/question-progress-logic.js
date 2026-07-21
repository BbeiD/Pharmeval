// ===================== LOGIQUE PURE — PROGRESSION PAR QUESTION (Sprint 21.5, Phase B0) =====================
// Aucune dependance Firestore - voir question-progress-service.js pour
// l'orchestration reelle (Firestore) qui s'appuie sur ce fichier. Extrait
// dans son propre fichier UNIQUEMENT pour permettre un test unitaire reel.
//
// DEFINITIONS EXACTES (cadrage) :
//   - "jamais vue"     = aucun document de progression, OU timesSeen === 0.
//   - "jamais réussie" = timesSeen > 0 ET timesCorrect === 0.
//   - "unanswered" compte comme VUE mais jamais comme correcte.

/**
 * @param {object} evaluationResult
 * @returns {Array<{userId:string, pedagogicalId:string, isCorrect:boolean}>}
 */
export function buildProgressEntriesFromResult(evaluationResult) {
  const entries = [];
  const userId = evaluationResult.userId;
  (evaluationResult.competencyResults || []).forEach(function(cr) {
    (cr.questionResults || []).forEach(function(qr) {
      entries.push({ userId: userId, pedagogicalId: qr.pedagogicalId, isCorrect: qr.status === 'correct' });
    });
  });
  return entries;
}

/**
 * @param {Array<string>} candidatePedagogicalIds - pool DEJA borne
 * @param {Map<string, object|null|undefined>} progressMap
 * @returns {{neverSeen:Array<string>, neverSucceeded:Array<string>, seen:Array<string>}}
 */
export function classifyCandidatesByProgress(candidatePedagogicalIds, progressMap) {
  const neverSeen = [];
  const neverSucceeded = [];
  const seen = [];
  candidatePedagogicalIds.forEach(function(pid) {
    const progress = progressMap.get(pid);
    const timesSeen = progress ? (progress.timesSeen || 0) : 0;
    const timesCorrect = progress ? (progress.timesCorrect || 0) : 0;
    if (!progress || timesSeen === 0) {
      neverSeen.push(pid);
      return;
    }
    seen.push(pid);
    if (timesCorrect === 0) neverSucceeded.push(pid);
  });
  return { neverSeen: neverSeen, neverSucceeded: neverSucceeded, seen: seen };
}
