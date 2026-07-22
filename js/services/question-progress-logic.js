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
 * chart.js). Une question jamais vue n'a tout simplement pas de document
 * ici, elle n'existe pas dans ce calcul (ce n'est pas "à charge" de ce
 * widget de connaître la taille du catalogue global).
 *
 * TROIS statuts (mockup validé avec David, 22/07/2026), calculés
 * UNIQUEMENT à partir de champs déjà stockés (timesCorrect/lastStatus,
 * voir question-progress-catalog-service.js#incrementOneQuestionProgress) -
 * aucun nouveau champ, aucun seuil invente :
 *   - "mastered"     : déjà réussie ET la dernière tentative était correcte.
 *   - "in_progress"  : déjà réussie au moins une fois, mais la dernière
 *                      tentative a échoué (encore "instable").
 *   - "to_work"      : jamais réussie.
 *
 * @param {Array<object>} progressDocs - voir getAllQuestionProgressForUser()
 * @returns {{total:number, counts:object, percentages:object}}
 */
export function summarizeQuestionMastery(progressDocs) {
  let mastered = 0;
  let inProgress = 0;
  let toWork = 0;
  (progressDocs || []).forEach(function(p) {
    if ((p.timesSeen || 0) === 0) return; // document orphelin/incoherent - jamais compte
    const everCorrect = (p.timesCorrect || 0) > 0;
    if (!everCorrect) { toWork += 1; return; }
    if (p.lastStatus === 'correct') mastered += 1;
    else inProgress += 1;
  });
  const total = mastered + inProgress + toWork;
  const pct = function(n) { return total > 0 ? Math.round((n / total) * 100) : 0; };
  return {
    total: total,
    counts: { mastered: mastered, in_progress: inProgress, to_work: toWork },
    percentages: { mastered: pct(mastered), in_progress: pct(inProgress), to_work: pct(toWork) },
  };
}
