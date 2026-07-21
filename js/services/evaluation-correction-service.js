// ===================== MOTEUR DE CORRECTION AUTOMATIQUE (Sprint 18) =====================
// "Toute la logique métier doit être dans ce service" (SPRINT18, section 1).
// Ce fichier ne fait AUCUN appel Firestore : il transforme une session
// d'évaluation SOUMISE (js/services/evaluation-session-service.js, Sprint
// 17) en un résultat calculé complet - pure fonction de son entrée,
// jamais d'effet de bord, jamais d'écriture. L'écriture réelle du
// résultat dans Firestore est de la responsabilité d'evaluation-result-
// service.js (orchestration) + evaluation-result-catalog-service.js
// (catalogue), séparation identique à tous les autres domaines du projet.
//
// ARCHITECTURE (SPRINT18, section 10) : quatre objets métier distincts,
// jamais un gros objet peu lisible :
//   EvaluationSession (Sprint 17, en entrée, jamais modifiée)
//     -> EvaluationResult (le résultat global, ce fichier)
//        -> CompetencyResult[] (un par compétence couverte par la session -
//           aujourd'hui toujours exactement une seule, voir note ci-dessous)
//           -> QuestionResult[] (un par question)
//
// NOTE D'ÉVOLUTIVITÉ : le Sprint 17 définit qu'"une évaluation correspond
// à un parcours + UNE compétence + les questions associées à cette
// compétence" - une session ne couvre donc aujourd'hui qu'UNE seule
// compétence. `EvaluationResult.competencyResults` est néanmoins un
// TABLEAU (jamais un objet unique) : si un futur sprint fait évoluer une
// session pour couvrir plusieurs compétences à la fois, ce fichier n'aura
// qu'à grouper les questions par compétence avant de construire plusieurs
// `CompetencyResult` - aucune refonte de la forme du résultat.
//
// EXTENSIBILITÉ DES TYPES DE QUESTION (SPRINT18, section 2) : registre
// {questionType -> fonction de correction}, exactement le même principe
// que question-renderer-service.js (Sprint 17). Seul "qcm" (choix unique)
// est implémenté - c'est l'unique type réellement présent dans la Banque
// de questions à ce jour (voir question-renderer-service.js, en-tête,
// pour la vérification déjà faite au Sprint 17). "Ne pas inventer de
// nouveaux types si la banque n'en contient pas" (SPRINT18, section 2) :
// choix multiple et vrai/faux ne sont donc PAS implémentés, uniquement
// réservés dans correction-policy-service.js (MULTI_CHOICE_SCORING_METHODS).

import {
  getCorrectionPolicy, roundPercent, computeCompetencyStatus,
  QUESTION_RESULT_STATUS,
} from "./correction-policy-service.js";

/**
 * Identifiant d'un résultat : TOUJOURS IDENTIQUE à l'identifiant de la
 * session corrigée (voir evaluation-result-catalog-service.js) - un
 * résultat par session, jamais deux, et une simple lecture par
 * identifiant (jamais une requête) suffit à le retrouver.
 * @param {string} sessionId
 * @returns {string}
 */
export function resultIdForSession(sessionId) {
  return sessionId;
}

// ---------------------------------------------------------------------------
// Correcteurs par type de question (registre, jamais un bloc conditionnel)
// ---------------------------------------------------------------------------

/**
 * Corrige une question "qcm" (choix unique) : compare l'index de reponse
 * de l'utilisateur a l'index de la bonne reponse DEJA REMAPPE dans le
 * snapshot (voir parcours-evaluation-service.js, Sprint 17 - le snapshot
 * reflete deja l'ordre exact presente a l'utilisateur, aucun remappage
 * supplementaire n'est necessaire ici).
 * @param {object} snapshot - session.questionSnapshot[pedagogicalId]
 * @param {*} userAnswerValue - session.answers[pedagogicalId]?.value, ou undefined/null
 * @returns {{status:string, isCorrect:boolean}}
 */
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

/**
 * Indique si un type de question peut réellement être corrigé
 * automatiquement par ce sprint.
 * @param {string} questionType
 * @returns {boolean}
 */
export function isQuestionTypeCorrectable(questionType) {
  return Object.prototype.hasOwnProperty.call(CORRECTORS, questionType);
}

// ---------------------------------------------------------------------------
// QuestionResult
// ---------------------------------------------------------------------------

/**
 * Construit le résultat d'UNE question (SPRINT18, section 3) : correcte /
 * incorrecte / non répondue, réponse utilisateur, bonne réponse, statut -
 * "conserver" ces éléments, comme demandé.
 *
 * @param {string} pedagogicalId
 * @param {object} snapshot - session.questionSnapshot[pedagogicalId]
 * @param {object|undefined} answerEntry - session.answers[pedagogicalId] ({value, answeredAt}), ou absent
 * @returns {object} un QuestionResult
 */
function buildQuestionResult(pedagogicalId, snapshot, answerEntry) {
  const userValue = answerEntry ? answerEntry.value : null;
  const corrector = CORRECTORS[snapshot.questionType];

  // Type non corrigeable (reserve pour le futur, voir en-tete) : la
  // question est neutralement comptee "non repondue" plutot que de
  // fausser le calcul avec une hypothese de correction non fiable -
  // jamais un plantage, jamais une correction inventee.
  const outcome = corrector ? corrector(snapshot, userValue) : { status: QUESTION_RESULT_STATUS.UNANSWERED, isCorrect: false };

  return {
    pedagogicalId: pedagogicalId,
    questionType: snapshot.questionType,
    question: snapshot.question,
    options: Array.isArray(snapshot.answers) ? snapshot.answers.slice() : [],
    userAnswer: userValue,
    correctAnswer: snapshot.correctAnswer,
    status: outcome.status, // 'correct' | 'incorrect' | 'unanswered'
    answeredAt: answerEntry ? answerEntry.answeredAt : null, // "temps si disponible" (SPRINT18, section 3) - seul horodatage reellement mesure a ce jour (aucun chronometrage de duree, voir hors-perimetre Sprint 17)
  };
}

// ---------------------------------------------------------------------------
// CompetencyResult
// ---------------------------------------------------------------------------

/**
 * Construit le résultat d'UNE compétence (SPRINT18, section 4) à partir
 * de ses QuestionResult déjà calculés.
 * @param {string} competencyId
 * @param {Array<object>} questionResults
 * @param {object} [policy]
 * @returns {object} un CompetencyResult
 */
function buildCompetencyResult(competencyId, questionResults, policy) {
  const p = policy || getCorrectionPolicy();

  const correctCount = questionResults.filter(function(q) { return q.status === QUESTION_RESULT_STATUS.CORRECT; }).length;
  const incorrectCount = questionResults.filter(function(q) { return q.status === QUESTION_RESULT_STATUS.INCORRECT; }).length;
  const unansweredCount = questionResults.filter(function(q) { return q.status === QUESTION_RESULT_STATUS.UNANSWERED; }).length;
  const totalCount = questionResults.length;

  // "prise en compte ou non des questions non répondues" (politique,
  // voir correction-policy-service.js) : le denominateur inclut ou
  // exclut les questions sans reponse selon `countUnansweredInDenominator`.
  const denominator = p.countUnansweredInDenominator ? totalCount : (totalCount - unansweredCount);
  const rawPercent = denominator > 0 ? (correctCount / denominator) * 100 : 0;
  const percent = roundPercent(rawPercent, p);
  // SPRINT 21.5, PHASE B1 : un statut de maitrise ('mastered'/
  // 'to_reinforce'/'not_acquired') n'a de sens que rapporte a UNE
  // competence de reference. Sans competencyId (entrainement libre), le
  // calculer quand meme produirait une etiquette trompeuse ("maitrise" de
  // quoi ?) - laisse explicitement `null` plutot que fabrique.
  const status = competencyId ? computeCompetencyStatus(percent, p) : null;

  return {
    competencyId: competencyId,
    totalCount: totalCount,
    correctCount: correctCount,
    incorrectCount: incorrectCount,
    unansweredCount: unansweredCount,
    percent: percent,
    status: status, // 'mastered' | 'to_reinforce' | 'not_acquired' (voir correction-policy-service.js)
    questionResults: questionResults,
  };
}

// ---------------------------------------------------------------------------
// EvaluationResult (score global)
// ---------------------------------------------------------------------------

/**
 * Construit le score global (SPRINT18, section 5) a partir des
 * CompetencyResult deja calcules. Aujourd'hui, une seule competence par
 * session (voir en-tete) - le score global est donc numeriquement
 * identique au resultat de cette unique competence, mais CALCULE
 * separement (jamais une simple recopie) pour rester correct le jour ou
 * plusieurs competences existeront dans une meme session.
 * @param {Array<object>} competencyResults
 * @param {object} [policy]
 * @returns {object}
 */
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

    // "Prévoir les champs futurs : note, réussite, mention. Même si ces
    // éléments ne sont pas encore exploités." (SPRINT18, section 5) -
    // jamais une valeur inventee : `null` tant qu'aucune echelle de
    // notation ou de mention n'est reellement definie.
    note: null,
    reussite: null,
    mention: null,
  };
}

/**
 * Construit l'EvaluationResult COMPLET d'une session soumise - point
 * d'entrée unique de ce moteur de correction.
 *
 * @param {object} session - une session `evaluation_sessions` au statut `submitted` (Sprint 17)
 * @returns {object} un EvaluationResult, prêt à être enregistré tel quel par evaluation-result-catalog-service.js
 */
export function correctEvaluationSession(session) {
  const policy = getCorrectionPolicy();

  const questionResults = session.questionIds.map(function(pid) {
    const snapshot = session.questionSnapshot[pid];
    const answerEntry = session.answers[pid];
    return buildQuestionResult(pid, snapshot, answerEntry);
  });

  // Regroupement par competence (aujourd'hui toujours une seule -
  // session.competencyId - voir en-tete "NOTE D'ÉVOLUTIVITÉ").
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
    competencyId: session.competencyId, // reference rapide (evite de devoir parcourir competencyResults pour un filtrage simple)
    createdAt: now,
    score: score,
    competencyResults: competencyResults,
    // Snapshot de la politique REELLEMENT appliquee a CE calcul (jamais
    // relue dynamiquement ensuite) - garantit qu'un resultat deja
    // enregistre reste historiquement exact meme si la politique change
    // plus tard (meme principe d'integrite que le snapshot de question,
    // Sprint 17).
    policyApplied: policy,
    events: [{ type: 'evaluation_corrected', at: now }],
  };
}
