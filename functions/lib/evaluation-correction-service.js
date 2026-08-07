// ===================== MOTEUR DE CORRECTION AUTOMATIQUE — COPIE SERVEUR =====================
// Copie fidele de js/services/evaluation-correction-service.js (fonction
// PURE, aucun appel Firestore/reseau), convertie en CommonJS - voir
// correction-policy-service.js (ce dossier) pour l'explication de la
// copie plutot qu'un import relatif hors de functions/.
//
// UTILISATION SERVEUR (defense en profondeur, audit "mauvais utilisateur"
// du 27/07/2026) : POST /api/evaluation-results (functions/index.js)
// n'accepte plus le score fourni par le client - il recalcule le
// resultat COMPLET a partir de la session stockee (deja ecrite
// server-side, jamais modifiable par le client une fois soumise), via
// correctEvaluationSession() ci-dessous. Un score falsifie par appel API
// direct n'a donc plus aucun effet : il est entierement ignore.
//
// IMPORTANT : garder cette copie manuellement synchronisee avec
// l'original cote client si la logique de correction change un jour.

const {
  getCorrectionPolicy, roundPercent, computeCompetencyStatus, QUESTION_RESULT_STATUS,
} = require("./correction-policy-service");

function resultIdForSession(sessionId) {
  return sessionId;
}

function correctQcmAnswer(snapshot, userAnswerValue) {
  if (userAnswerValue === null || userAnswerValue === undefined) {
    return { status: QUESTION_RESULT_STATUS.UNANSWERED, isCorrect: false };
  }
  const isCorrect = userAnswerValue === snapshot.correctAnswer;
  return { status: isCorrect ? QUESTION_RESULT_STATUS.CORRECT : QUESTION_RESULT_STATUS.INCORRECT, isCorrect: isCorrect };
}

const CORRECTORS = {
  qcm: correctQcmAnswer,
};

function buildQuestionResult(pedagogicalId, snapshot, answerEntry) {
  const userValue = answerEntry ? answerEntry.value : null;
  const corrector = CORRECTORS[snapshot.questionType];
  const outcome = corrector ? corrector(snapshot, userValue) : { status: QUESTION_RESULT_STATUS.UNANSWERED, isCorrect: false };

  return {
    pedagogicalId: pedagogicalId,
    questionType: snapshot.questionType,
    question: snapshot.question,
    options: Array.isArray(snapshot.answers) ? snapshot.answers.slice() : [],
    userAnswer: userValue,
    correctAnswer: snapshot.correctAnswer,
    status: outcome.status,
    answeredAt: answerEntry ? answerEntry.answeredAt : null,
  };
}

function buildCompetencyResult(competencyId, questionResults, policy) {
  const p = policy || getCorrectionPolicy();

  const correctCount = questionResults.filter(function(q) { return q.status === QUESTION_RESULT_STATUS.CORRECT; }).length;
  const incorrectCount = questionResults.filter(function(q) { return q.status === QUESTION_RESULT_STATUS.INCORRECT; }).length;
  const unansweredCount = questionResults.filter(function(q) { return q.status === QUESTION_RESULT_STATUS.UNANSWERED; }).length;
  const totalCount = questionResults.length;

  const denominator = p.countUnansweredInDenominator ? totalCount : (totalCount - unansweredCount);
  const rawPercent = denominator > 0 ? (correctCount / denominator) * 100 : 0;
  const percent = roundPercent(rawPercent, p);
  const status = competencyId ? computeCompetencyStatus(percent, p) : null;

  return {
    competencyId: competencyId,
    totalCount: totalCount,
    correctCount: correctCount,
    incorrectCount: incorrectCount,
    unansweredCount: unansweredCount,
    percent: percent,
    status: status,
    questionResults: questionResults,
  };
}

function buildGlobalScore(competencyResults, policy) {
  const p = policy || getCorrectionPolicy();

  const totalCount = competencyResults.reduce(function(acc, c) { return acc + c.totalCount; }, 0);
  const correctCount = competencyResults.reduce(function(acc, c) { return acc + c.correctCount; }, 0);
  const incorrectCount = competencyResults.reduce(function(acc, c) { return acc + c.incorrectCount; }, 0);
  const unansweredCount = competencyResults.reduce(function(acc, c) { return acc + c.unansweredCount; }, 0);

  const denominator = p.countUnansweredInDenominator ? totalCount : (totalCount - unansweredCount);
  const rawPercent = denominator > 0 ? (correctCount / denominator) * 100 : 0;
  const percent = roundPercent(rawPercent, p);

  return {
    totalCount: totalCount,
    correctCount: correctCount,
    incorrectCount: incorrectCount,
    unansweredCount: unansweredCount,
    percent: percent,
    note: null,
    reussite: null,
    mention: null,
  };
}

function correctEvaluationSession(session) {
  const policy = getCorrectionPolicy();

  const questionResults = session.questionIds.map(function(pid) {
    const snapshot = session.questionSnapshot[pid];
    const answerEntry = session.answers[pid];
    return buildQuestionResult(pid, snapshot, answerEntry);
  });

  const competencyResult = buildCompetencyResult(session.competencyId, questionResults, policy);
  const competencyResults = [competencyResult];

  const score = buildGlobalScore(competencyResults, policy);

  const now = new Date().toISOString();
  return {
    id: resultIdForSession(session.id),
    sessionId: session.id,
    userId: session.userId,
    organizationId: session.organizationId || null,
    parcoursId: session.parcoursId,
    dailyChallengeDate: session.dailyChallengeDate || null,
    competencyId: session.competencyId,
    createdAt: now,
    score: score,
    competencyResults: competencyResults,
    policyApplied: policy,
    events: [{ type: 'evaluation_corrected', at: now }],
  };
}

module.exports = { correctEvaluationSession, resultIdForSession };
