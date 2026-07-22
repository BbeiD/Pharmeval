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

/**
 * AJOUT (demande directe de David, 22/07/2026) : "progression globale" par
 * QUESTION plutôt que par compétence - remplace le donut mastered/
 * to_reinforce/not_acquired (competency-progress-service.js), qui ne se
 * remplit plus jamais depuis que plus aucun flux d'évaluation ne renseigne
 * `competencyId` (parcours mixte, entraînement libre, "Test me", défi du
 * jour - tous `competencyId: null`, voir evaluation-session-metadata-
 * service.js). Même forme de retour QUE summarizeMasteryStatus()
 * (competency-progress-service.js) - {total, counts, percentages} - pour
 * rester compatible avec le composant de rendu partagé (mastery-donut-
 * chart.js), simplement DEUX statuts au lieu de trois : une question
 * jamais vue n'a tout simplement pas de document ici, elle n'existe pas
 * dans ce calcul (ce n'est pas "à charge" de ce widget de connaître la
 * taille du catalogue global).
 *
 * @param {Array<object>} progressDocs - voir getAllQuestionProgressForUser()
 * @returns {{total:number, counts:{mastered:number,to_reinforce:number}, percentages:{mastered:number,to_reinforce:number}}}
 */
export function summarizeQuestionMastery(progressDocs) {
  let mastered = 0;
  let toReinforce = 0;
  (progressDocs || []).forEach(function(p) {
    if ((p.timesSeen || 0) === 0) return; // document orphelin/incoherent - jamais compte
    if ((p.timesCorrect || 0) > 0) mastered += 1;
    else toReinforce += 1;
  });
  const total = mastered + toReinforce;
  const pct = function(n) { return total > 0 ? Math.round((n / total) * 100) : 0; };
  return {
    total: total,
    counts: { mastered: mastered, to_reinforce: toReinforce },
    percentages: { mastered: pct(mastered), to_reinforce: pct(toReinforce) },
  };
}
