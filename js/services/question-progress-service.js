// ===================== SERVICE DE PROGRESSION PAR QUESTION — Sprint 21.5, Phase B0 =====================
// Point d'entree UNIQUE pour :
//   - evaluation-result-service.js : updateQuestionProgressFromResult(),
//     appelee au MEME endroit et selon le MEME principe "best effort" que
//     updateProgressionFromResult() (competency-progress-service.js) -
//     jamais un second point de declenchement dans le projet.
//   - le futur ecran Entrainement libre (Phase B1, pas construit ici) :
//     classifyCandidatePoolForUser(), lecture seule, sur un pool DEJA
//     BORNE (jamais appelee sur l'integralite de `questions`).
//
// La LOGIQUE (definitions, classification) vit entierement dans
// question-progress-logic.js (aucune dependance Firestore, testable
// directement) - ce fichier-ci ne fait qu'orchestrer les appels Firestore
// autour de cette logique, jamais la dupliquer.

import { applyEvaluationResultIfNew, getQuestionProgressForMany } from "./question-progress-catalog-service.js";
import { buildProgressEntriesFromResult, classifyCandidatesByProgress } from "./question-progress-logic.js";

export { buildProgressEntriesFromResult, classifyCandidatesByProgress };

/**
 * Applique UN EvaluationResult a la progression par question. "Best
 * effort" (meme philosophie que updateProgressionFromResult()) : un echec
 * ici n'annule jamais le resultat d'evaluation deja enregistre - voir
 * l'appelant (evaluation-result-service.js), qui l'invoque sans jamais
 * bloquer sur son resultat.
 *
 * IDEMPOTENT (cadrage, point 5) : delegue entierement la garantie a
 * applyEvaluationResultIfNew() (question-progress-catalog-service.js) -
 * un meme evaluationResult.id ne peut jamais etre applique deux fois,
 * meme en cas de nouvel appel (retry reseau, traitement concurrent).
 *
 * @param {object} evaluationResult
 * @returns {Promise<{success:boolean, applied:boolean, error:boolean}>}
 */
export async function updateQuestionProgressFromResult(evaluationResult) {
  const entries = buildProgressEntriesFromResult(evaluationResult);
  if (entries.length === 0) return { success: true, applied: false, error: false };
  return applyEvaluationResultIfNew(evaluationResult.id, entries);
}

/**
 * Combine le chargement de la progression et la classification, pour un
 * pool DEJA BORNE - seul point d'entree recommande pour Entrainement
 * libre (Phase B1). N'accepte jamais un pool non borne (voir l'appelant,
 * qui doit avoir applique searchQuestionsBounded() / le seuil centralise
 * AVANT d'appeler cette fonction).
 *
 * RETROCOMPATIBILITE (cadrage, point 2) : une question repondue AVANT le
 * deploiement de cette phase, mais jamais depuis, apparait ici comme
 * "neverSeen" (aucun document question_progress n'existe pour elle) -
 * comportement CONNU ET ASSUME, pas un defaut a corriger dans cette
 * phase (aucun backfill demande).
 *
 * @param {string} userId @param {Array<string>} candidatePedagogicalIds
 * @returns {Promise<{neverSeen:Array<string>, neverSucceeded:Array<string>, seen:Array<string>, error:boolean}>}
 */
export async function classifyCandidatePoolForUser(userId, candidatePedagogicalIds) {
  const result = await getQuestionProgressForMany(userId, candidatePedagogicalIds);
  const classification = classifyCandidatesByProgress(candidatePedagogicalIds, result.map);
  return Object.assign({}, classification, { error: result.error });
}
