// ===================== SERVICE D'ORCHESTRATION DE LA PROGRESSION (Sprint 19) =====================
// Point d'entree UNIQUE pour :
//   - evaluation-result-service.js (Sprint 18) : updateProgressionFromResult(),
//     appelee UNE SEULE FOIS, juste apres la creation d'un EvaluationResult
//     ("La mise à jour de la progression doit avoir lieu uniquement lors
//     de la création d'un nouveau résultat", SPRINT19) ;
//   - mes-competences.js (Sprint 19, page utilisateur) : lecture seule.
//
// "Ne jamais recalculer la progression à partir des résultats à chaque
// ouverture." (SPRINT19, "Séparation des responsabilités") : ce fichier
// ne relit JAMAIS l'ensemble de `evaluation_results` pour reconstruire une
// progression - seule la MISE A JOUR INCREMENTALE (etat precedent + UN
// nouveau resultat -> nouvel etat) est jamais calculee, et uniquement au
// moment ou updateProgressionFromResult() est appelee.

import { getCurrentUserContext } from "./app-context.js";
import { getUserByUid } from "./user-management-service.js";
import {
  progressionIdFor, completeProgressionMetadata, completeHistoryEntry,
} from "./competency-progress-metadata-service.js";
import { getProgressionById, saveProgressionDocument, listProgressionsByUser } from "./competency-progress-catalog-service.js";
import {
  getProgressionPolicy, computeTrend, computeLevel, computeConfidenceScore,
} from "./progression-policy-service.js";
import { computeCompetencyStatus, COMPETENCY_STATUS } from "./correction-policy-service.js";
import { getAllQuestionProgressForUser } from "./question-progress-catalog-service.js";
import { summarizeQuestionMastery } from "./question-progress-logic.js";
import { getExistingQuestionsByPedagogicalIds } from "./question-catalog-service.js";

function nowIso() { return new Date().toISOString(); }

/**
 * Met a jour (ou cree, a la premiere evaluation) la progression d'UNE
 * competence a partir d'UN EvaluationResult tout juste calcule (Sprint
 * 18). Appelee pour CHAQUE CompetencyResult du resultat (aujourd'hui
 * toujours un seul, voir evaluation-correction-service.js, Sprint 18,
 * "NOTE D'ÉVOLUTIVITÉ").
 *
 * Ecriture "best effort" du point de vue de l'appelant (evaluation-
 * result-service.js) : un echec ici n'annule jamais la creation du
 * resultat lui-meme, deja enregistre et definitif - voir la gestion
 * d'erreur cote appelant.
 *
 * @param {object} evaluationResult - un EvaluationResult complet (Sprint 18)
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateProgressionFromResult(evaluationResult) {
  try {
    const user = await getUserByUid(evaluationResult.userId);
    const organizationId = (user && user.organizationId) || evaluationResult.organizationId || null;

    for (const competencyResult of evaluationResult.competencyResults) {
      await updateOneCompetencyProgression(evaluationResult, competencyResult, organizationId);
    }
    return { success: true, error: false };
  } catch (err) {
    console.error('[competency-progress-service] échec de la mise à jour de la progression', err);
    return { success: false, error: true };
  }
}

async function updateOneCompetencyProgression(evaluationResult, competencyResult, organizationId) {
  const progressId = progressionIdFor(evaluationResult.userId, competencyResult.competencyId);
  const existing = await getProgressionById(progressId);
  const policy = getProgressionPolicy();
  const now = nowIso();

  const newHistoryEntry = completeHistoryEntry({
    date: evaluationResult.createdAt || now,
    percent: competencyResult.percent,
    resultId: evaluationResult.id,
  });

  const previous = existing ? completeProgressionMetadata(existing) : null;

  // CORRECTIF (idempotence manquante, decouverte en construisant
  // reconcileProgressForUser(), evaluation-result-service.js) : cette
  // fonction n'avait AUCUNE protection contre un double appel pour le
  // MEME evaluationResult - un simple retry reseau, ou tout appelant futur
  // rejouant un resultat deja applique, aurait compte cette evaluation
  // DEUX FOIS dans l'historique (evaluationCount/averagePercent fausses).
  // `history[].resultId` existe deja (voir newHistoryEntry ci-dessus) -
  // s'il est deja present, on n'ajoute rien de plus, exactement comme
  // applyEvaluationResultIfNew() le fait deja pour question_progress.
  if (previous && previous.history.some(function(h) { return h.resultId === evaluationResult.id; })) {
    return;
  }

  const history = previous ? previous.history.concat([newHistoryEntry]) : [newHistoryEntry]; // "Ne jamais perdre les anciennes valeurs" - toujours un ajout, jamais un remplacement

  const evaluationCount = history.length;
  const bestPercent = Math.max(competencyResult.percent, previous ? previous.bestPercent : 0);
  const lastPercent = competencyResult.percent;
  const averagePercent = Math.round(history.reduce(function(acc, h) { return acc + h.percent; }, 0) / evaluationCount);
  const trend = computeTrend(previous ? previous.lastPercent : null, lastPercent, policy);
  const currentLevel = computeLevel(averagePercent, evaluationCount, policy);
  const masteryStatus = computeCompetencyStatus(lastPercent); // reutilise CorrectionPolicy (Sprint 18), jamais une nouvelle echelle
  const confidenceScore = computeConfidenceScore({
    evaluationCount: evaluationCount, history: history, lastEvaluationAt: now,
  }, policy);

  const events = (previous ? previous.events.slice() : []).concat([{ type: 'competency_progress_updated', at: now }]);

  const progression = completeProgressionMetadata({
    id: progressId,
    userId: evaluationResult.userId,
    competencyId: competencyResult.competencyId,
    organizationId: organizationId,
    evaluationCount: evaluationCount,
    bestPercent: bestPercent,
    lastPercent: lastPercent,
    averagePercent: averagePercent,
    trend: trend,
    firstEvaluationAt: previous ? previous.firstEvaluationAt : now,
    lastEvaluationAt: now,
    updatedAt: now,
    currentLevel: currentLevel,
    masteryStatus: masteryStatus,
    confidenceScore: confidenceScore,
    history: history,
    createdBy: evaluationResult.userId,
    version: previous ? previous.version + 1 : 1,
    events: events,
  });

  return saveProgressionDocument(progression);
}

/**
 * Liste toutes les compétences rencontrées par l'utilisateur courant
 * ("Mes compétences", SPRINT19).
 * @returns {Promise<{authorized:boolean, message?:string, items:Array<object>}>}
 */
export async function getMyCompetencyProgress() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { authorized: false, message: 'Vous devez être connecté pour consulter vos compétences.', items: [] };
  const result = await listProgressionsByUser(ctx.uid);
  if (result.error) return { authorized: true, error: true, message: 'Impossible de charger vos compétences pour le moment. Réessayez plus tard.', items: [] };
  return { authorized: true, items: result.items };
}

/**
 * CORRECTIF (demande directe de David, 23/07/2026) : remplace
 * getMyCompetencyProgress() ci-dessus pour "Mes compétences" - cette
 * derniere lit `competency_progress`, qui ne se remplit plus jamais
 * depuis qu'aucun flux d'evaluation ne renseigne `competencyId` sur une
 * session (parcours mixte, entrainement libre, "Test me", defi du jour -
 * voir home.js, meme correctif applique au donut de l'accueil le
 * 22/07/2026). Reconstruit une vue par competence en regroupant la
 * progression PAR QUESTION (question-progress-service.js, reellement
 * alimentee) selon le `competencyId` propre a chaque question (ecrit par
 * le connecteur de synchronisation Excel, voir GUIDE_GENERATION_
 * QUESTIONS_PDF.md et canonical-question-factory.js).
 *
 * LIMITE HONNETE (assumee, jamais cachee) : contrairement a l'ancien
 * systeme, il n'existe plus d'historique de scores dans le temps par
 * competence - une session ne porte plus qu'un decoupage par question,
 * jamais par competence. Cette fonction retourne donc un ETAT PRESENT
 * (repartition maitrisee/en cours/a travailler sur les questions deja
 * rencontrees de cette competence), jamais une serie temporelle
 * fabriquee a partir d'une donnee qui n'existe pas. Une question deja
 * repondue mais dont la competence n'a pas encore ete assignee (import
 * anterieur a ce correctif) est silencieusement ignoree ici - jamais
 * rattachee a une competence inventee.
 *
 * @returns {Promise<{authorized:boolean, error?:boolean, message?:string, items:Array<object>}>}
 */
export async function getMyCompetencyProgressFromQuestions() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { authorized: false, message: 'Vous devez être connecté pour consulter vos compétences.', items: [] };

  const progressResult = await getAllQuestionProgressForUser(ctx.uid);
  if (progressResult.error) {
    return { authorized: true, error: true, message: 'Impossible de charger vos compétences pour le moment. Réessayez plus tard.', items: [] };
  }
  if (progressResult.items.length === 0) return { authorized: true, items: [] };

  const pedagogicalIds = progressResult.items.map(function(p) { return p.pedagogicalId; });
  const questionsResult = await getExistingQuestionsByPedagogicalIds(pedagogicalIds);
  if (questionsResult.error) {
    return { authorized: true, error: true, message: 'Impossible de charger vos compétences pour le moment. Réessayez plus tard.', items: [] };
  }

  const byCompetency = new Map();
  progressResult.items.forEach(function(p) {
    const q = questionsResult.map.get(p.pedagogicalId);
    if (!q || !q.competencyId) return;
    if (!byCompetency.has(q.competencyId)) byCompetency.set(q.competencyId, []);
    byCompetency.get(q.competencyId).push(p);
  });

  const policy = getProgressionPolicy();
  const items = [];
  byCompetency.forEach(function(group, competencyId) {
    const summary = summarizeQuestionMastery(group);
    const masteredPercent = summary.percentages.mastered;
    const evaluationCount = summary.total;
    const lastEvaluationAt = group.reduce(function(max, p) {
      return (!max || (p.lastSeenAt && p.lastSeenAt > max)) ? p.lastSeenAt : max;
    }, null);

    items.push({
      competencyId: competencyId,
      evaluationCount: evaluationCount,
      masteredCount: summary.counts.mastered,
      inProgressCount: summary.counts.in_progress,
      toWorkCount: summary.counts.to_work,
      masteredPercent: masteredPercent,
      currentLevel: computeLevel(masteredPercent, evaluationCount, policy),
      masteryStatus: computeCompetencyStatus(masteredPercent),
      confidenceScore: computeConfidenceScore({
        evaluationCount: evaluationCount,
        history: group.map(function(p) { return { date: p.lastSeenAt }; }),
        lastEvaluationAt: lastEvaluationAt,
      }, policy),
      lastEvaluationAt: lastEvaluationAt,
      // Detail par question - jamais un historique de pourcentage (voir
      // limite honnete ci-dessus), juste l'etat present de chaque
      // question deja rencontree dans cette competence.
      questions: group.slice().sort(function(a, b) { return (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''); }),
    });
  });

  items.sort(function(a, b) { return b.evaluationCount - a.evaluationCount; });
  return { authorized: true, items: items };
}

/**
 * AJOUT (refonte visuelle, phase 1) : agrège le `masteryStatus` DEJA REEL
 * de chaque competence rencontree en un compte par statut (mastered/
 * to_reinforce/not_acquired) + un pourcentage arrondi - fonction pure,
 * partagee par l'accueil (donut "Votre progression globale") ET "Mes
 * compétences" (meme calcul, jamais duplique a deux endroits). N'invente
 * jamais de donnee : un utilisateur sans aucune competence rencontree
 * retourne `total:0`, a afficher comme un etat vide explicite, jamais
 * "0%" qui laisserait croire a un echec.
 * @param {Array<object>} items - resultat de getMyCompetencyProgress().items
 * @returns {{total:number, counts:Object<string,number>, percentages:Object<string,number>}}
 */
export function summarizeMasteryStatus(items) {
  const list = Array.isArray(items) ? items : [];
  const counts = {
    [COMPETENCY_STATUS.MASTERED]: 0,
    [COMPETENCY_STATUS.TO_REINFORCE]: 0,
    [COMPETENCY_STATUS.NOT_ACQUIRED]: 0,
  };
  list.forEach(function(item) {
    if (Object.prototype.hasOwnProperty.call(counts, item.masteryStatus)) counts[item.masteryStatus]++;
  });
  const total = list.length;
  const percentages = {};
  Object.keys(counts).forEach(function(status) {
    percentages[status] = total > 0 ? Math.round((counts[status] / total) * 100) : 0;
  });
  return { total: total, counts: counts, percentages: percentages };
}

/**
 * Relit la progression d'UNE compétence pour l'utilisateur courant
 * UNIQUEMENT ("L'utilisateur ne peut consulter que sa progression",
 * SPRINT19, "Sécurité") - défense en profondeur, en plus des règles
 * Firestore.
 * @param {string} competencyId
 * @returns {Promise<{authorized:boolean, message?:string, progression?:object}>}
 */
export async function getCompetencyProgressDetail(competencyId) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { authorized: false, message: 'Vous devez être connecté pour consulter cette progression.' };
  const progressId = progressionIdFor(ctx.uid, competencyId);
  const progression = await getProgressionById(progressId);
  if (!progression) return { authorized: false, message: 'Aucune progression enregistrée pour cette compétence.' };
  if (progression.userId !== ctx.uid) return { authorized: false, message: 'Cette progression ne vous appartient pas.' };
  return { authorized: true, progression: progression };
}
