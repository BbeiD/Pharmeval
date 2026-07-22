// ===================== SERVICE D'ORCHESTRATION DES RESULTATS D'EVALUATION (Sprint 18) =====================
// Point d'entree UNIQUE pour :
//   - evaluation.js (Sprint 17, page de passage) au moment de la
//     soumission finale : finalizeEvaluation() ;
//   - evaluation-result.js (Sprint 18, page de resultat) : getResultForCurrentUser().
//
// Coordonne :
//   - js/services/evaluation-session-service.js    (REUTILISE submitSession() tel quel, Sprint 17, JAMAIS MODIFIE)
//   - js/services/evaluation-correction-service.js (calcul pur, Sprint 18)
//   - js/services/evaluation-result-catalog-service.js (lecture/ecriture Firestore)
//   - js/services/question-catalog-service.js       (REUTILISE, pour les explications - voir resolveExplanations())
//
// "Le calcul doit être réalisé une seule fois, au moment de la
// soumission. Ne jamais recalculer le résultat à chaque ouverture."
// (SPRINT18, section 12) : finalizeEvaluation() est le SEUL point du
// projet qui appelle correctEvaluationSession() - la page de resultat
// (evaluation-result.js) ne fait jamais que RELIRE un resultat deja
// calcule et enregistre (getResultForCurrentUser()).

import { getCurrentUserContext } from "./app-context.js";
import { submitSession } from "./evaluation-session-service.js";
import { correctEvaluationSession } from "./evaluation-correction-service.js";
import { createResultDocument, getResultById, getAllResultsForUser } from "./evaluation-result-catalog-service.js";
import { getExistingQuestionsByPedagogicalIds } from "./question-catalog-service.js";
import { updateProgressionFromResult } from "./competency-progress-service.js";
import { updateQuestionProgressFromResult } from "./question-progress-service.js";

function success(message, extra) { return Object.assign({ status: 'success', message: message }, extra || {}); }

/**
 * Termine une évaluation : soumission (Sprint 17, inchangée) puis
 * correction et enregistrement du résultat (Sprint 18). Si la soumission
 * échoue, rien n'est corrigé ni enregistré. Si la soumission réussit mais
 * que la correction/l'enregistrement échoue, la session reste
 * définitivement soumise (comportement Sprint 17 non remis en cause -
 * "la soumission est définitive" reste vrai même en cas de panne
 * technique ultérieure) mais un statut distinct (`submitted_no_result`)
 * permet à l'interface d'informer honnêtement l'utilisateur plutôt que de
 * prétendre que tout s'est bien passé.
 *
 * @param {object} session - une session `in_progress` (Sprint 17)
 * @returns {Promise<object>}
 */
export async function finalizeEvaluation(session) {
  const submitResult = await submitSession(session);
  if (submitResult.status !== 'success') return submitResult; // meme forme de retour que Sprint 17, rien de nouveau a gerer cote appelant en cas d'echec

  const correctedSession = Object.assign({}, session, { status: 'submitted', submittedAt: submitResult.submittedAt });

  let evaluationResult;
  try {
    evaluationResult = correctEvaluationSession(correctedSession);
  } catch (err) {
    console.error('[evaluation-result-service] échec du calcul de correction', err);
    return { status: 'submitted_no_result', message: 'Votre évaluation a bien été soumise, mais le rapport n\'a pas pu être généré. Contactez un administrateur si le problème persiste.' };
  }

  const writeResult = await createResultDocument(evaluationResult);
  if (!writeResult.success) {
    return { status: 'submitted_no_result', message: 'Votre évaluation a bien été soumise, mais le rapport n\'a pas pu être enregistré. Contactez un administrateur si le problème persiste.' };
  }

  // SPRINT19 : "La mise à jour de la progression doit avoir lieu
  // uniquement lors de la création d'un nouveau résultat" - c'est ICI,
  // et seulement ici, que ce déclenchement a lieu dans tout le projet.
  // "Best effort" : un échec de la progression ne remet jamais en cause
  // le résultat déjà enregistré (déjà définitif et consultable) - juste
  // journalisé, jamais bloquant pour l'utilisateur.
  //
  // SPRINT 21.5, PHASE B1 : un résultat d'entraînement libre n'a pas de
  // competencyId (voir evaluation-correction-service.js) - la progression
  // par compétence n'a donc rien à mettre à jour pour lui. La progression
  // PAR QUESTION (Phase B0, ci-dessous) reste alimentée dans tous les cas,
  // elle est déjà indépendante de toute notion de compétence.
  // CORRECTIF (bug constate en production, 22/07/2026) : ces deux mises a
  // jour etaient declenchees en "tir et oublie" (jamais attendues) puis
  // evaluation.js redirige IMMEDIATEMENT vers evaluation-result.html une
  // fois finalizeEvaluation() resolu - la navigation coupe la connexion
  // Firestore avant que ces ecritures n'aient eu le temps de partir, en
  // particulier pour un parcours volumineux (ex. 84 questions) ou
  // l'ecriture est plus longue. Resultat constate : le score/l'evaluation
  // etaient bien enregistres (createResultDocument est deja awaited plus
  // haut), mais question_progress restait vide - "Mes parcours" affichait
  // 0% malgre une evaluation reellement terminee. La philosophie "best
  // effort" (un echec ici n'annule jamais le resultat) reste entierement
  // preservee : chaque appel garde son propre .catch() qui absorbe
  // l'erreur - seul le moment ou finalizeEvaluation() RESOUD change
  // (desormais apres que ces ecritures ont eu la chance de se terminer,
  // avec succes ou en echec journalise, jamais interrompues par la
  // navigation qui suit immediatement chez l'appelant).
  const progressionWrites = [];
  if (evaluationResult.competencyId) {
    progressionWrites.push(updateProgressionFromResult(evaluationResult).catch(function(err) {
      console.error('[evaluation-result-service] mise à jour de la progression impossible', err);
    }));
  }

  // SPRINT 21.5, PHASE B0 : même point de déclenchement, même philosophie
  // "best effort", pour la progression PAR QUESTION (jamais vue / jamais
  // réussie - voir question-progress-service.js). Idempotent par
  // construction (voir ce fichier) : un double appel ne peut jamais
  // compter deux fois le même résultat.
  progressionWrites.push(updateQuestionProgressFromResult(evaluationResult).catch(function(err) {
    console.error('[evaluation-result-service] mise à jour de la progression par question impossible', err);
  }));

  await Promise.all(progressionWrites);

  return success('Évaluation soumise et corrigée avec succès.', { resultId: evaluationResult.id, result: evaluationResult });
}

/**
 * Relit un résultat déjà calculé, pour l'utilisateur actuellement
 * connecté UNIQUEMENT ("Un utilisateur peut consulter uniquement ses
 * résultats", SPRINT18 section 11) - défense en profondeur, en plus des
 * règles Firestore.
 * @param {string} resultId
 * @returns {Promise<{authorized:boolean, message?:string, result?:object}>}
 */
export async function getResultForCurrentUser(resultId) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { authorized: false, message: 'Vous devez être connecté pour consulter ce résultat.' };
  if (!resultId) return { authorized: false, message: 'Résultat introuvable.' };

  const result = await getResultById(resultId);
  if (!result) return { authorized: false, message: 'Ce résultat est introuvable.' };
  if (result.userId !== ctx.uid) return { authorized: false, message: 'Ce résultat ne vous appartient pas.' };

  return { authorized: true, result: result };
}

/**
 * CORRECTIF (bug du 22/07/2026, voir finalizeEvaluation() plus haut) :
 * rejoue la progression (par compétence ET par question) sur TOUS les
 * résultats déjà enregistrés d'un utilisateur - répare les évaluations
 * terminées AVANT le correctif ci-dessus, dont l'écriture de progression
 * avait été interrompue par la redirection immédiate vers la page de
 * résultat (evaluation.js). Sans danger a rejouer plusieurs fois ni sur
 * des resultats deja a jour : updateProgressionFromResult()/
 * updateQuestionProgressFromResult() sont deja idempotents (voir
 * question-progress-catalog-service.js, marqueur applique/deja-applique)
 * - cette fonction ne fait que leur donner, cette fois, le temps de
 * terminer avant que l'appelant ne fasse quoi que ce soit d'autre.
 * "Best effort" de bout en bout : un echec sur UN resultat n'interrompt
 * jamais le traitement des autres.
 * @param {string} uid
 * @returns {Promise<{error:boolean, resultsChecked:number}>}
 */
export async function reconcileProgressForUser(uid) {
  if (!uid) return { error: false, resultsChecked: 0 };
  const { items, error } = await getAllResultsForUser(uid);
  if (error) return { error: true, resultsChecked: 0 };

  await Promise.all(items.map(function(evaluationResult) {
    const writes = [updateQuestionProgressFromResult(evaluationResult).catch(function(err) {
      console.error('[evaluation-result-service] reconciliation (question) impossible pour ' + evaluationResult.id, err);
    })];
    if (evaluationResult.competencyId) {
      writes.push(updateProgressionFromResult(evaluationResult).catch(function(err) {
        console.error('[evaluation-result-service] reconciliation (compétence) impossible pour ' + evaluationResult.id, err);
      }));
    }
    return Promise.all(writes);
  }));

  return { error: false, resultsChecked: items.length };
}

/**
 * Relit, pour chaque question d'un résultat, l'explication pédagogique
 * ACTUELLE si elle existe encore dans la Banque de questions - "Si une
 * explication existe dans la banque de questions : l'afficher. Sinon : ne
 * rien afficher." (SPRINT18, section 8). L'explication n'a JAMAIS ete
 * incluse dans le snapshot de la session (voir evaluation-session-
 * metadata-service.js, Sprint 17, "volontairement exclu") : elle est donc
 * relue ICI, au moment de l'affichage du resultat, depuis le document
 * `questions/{id}` en direct - jamais garantie (une question supprimee ou
 * depubliee depuis n'aura simplement aucune explication disponible).
 *
 * @param {Array<string>} pedagogicalIds
 * @returns {Promise<Map<string,string>>} identifiant -> explication (absente si non disponible)
 */
export async function resolveExplanations(pedagogicalIds) {
  const map = new Map();
  const result = await getExistingQuestionsByPedagogicalIds(pedagogicalIds);
  if (result.error) return map;
  result.map.forEach(function(q, id) {
    if (q && q.explanation) map.set(id, q.explanation);
  });
  return map;
}
