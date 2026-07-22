// ===================== SERVICE "EVALUATION" PAR PARCOURS (Sprint 17) =====================
// Correspond au "EvaluationService" du cadrage (section 15) : déterminer
// les questions d'une évaluation, vérifier qu'elle peut être démarrée,
// préparer l'ordre des questions. Nommé `parcours-evaluation-service.js`
// plutôt que `evaluation-service.js` (déjà pris par un service Sprint 4
// sans rapport - voir evaluation-session-metadata-service.js, en-tête,
// pour l'explication complète).
//
// AUCUNE ECRITURE FIRESTORE ICI : ce service prépare uniquement les
// données nécessaires à evaluation-session-service.js pour CRÉER une
// session - il ne crée rien lui-même (séparation claire : "déterminer" et
// "vérifier" ici, "créer" et "sauvegarder" dans evaluation-session-
// service.js, comme demandé par le découpage de responsabilités du
// cadrage).

import { getAssignedParcoursForUser } from "./assignment-service.js";
import { getCompetencyById } from "./competency-catalog-service.js";
import { getExistingQuestionsByPedagogicalIds } from "./question-catalog-service.js";
import { resolvePooledQuestionIds } from "./parcours-service.js";
import { completeQuestionSnapshot } from "./evaluation-session-metadata-service.js";

/**
 * Message exact demandé par le cadrage (SPRINT17, section 5) - centralisé
 * ici pour être réutilisé identique par evaluation.js (page) et par tout
 * appelant futur, jamais reformulé à deux endroits différents.
 */
export const NO_QUESTIONS_AVAILABLE_MESSAGE = 'Aucune question n\'est actuellement disponible pour cette évaluation.';

/**
 * Mélange Fisher-Yates - même algorithme que celui déjà utilisé par le
 * moteur de quiz existant (js/app.js, `shuffle()`), réimplémenté ici pour
 * ne pas dépendre d'un script classique (non-module) depuis un service ES
 * module. Pure fonction, ne mute jamais le tableau reçu.
 * @param {Array} arr
 * @returns {Array} une copie mélangée
 */
function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
  }
  return copy;
}

/**
 * Construit le snapshot d'UNE question à partir de son document Firestore
 * réel (`questions/{pedagogicalId}`), en mélangeant SES options une seule
 * fois et en remappant l'index de la bonne réponse sur ce nouvel ordre -
 * "Si un tirage aléatoire est déjà prévu dans l'architecture, enregistrer
 * la liste et l'ordre exact des questions dans la session" (SPRINT17,
 * section 5), appliqué ici également aux options de réponse, dans le même
 * esprit que le mélange déjà pratiqué par le moteur de quiz existant.
 *
 * @param {object} liveQuestion - document Firestore complet
 * @returns {object} snapshot prêt à être stocké dans la session
 */
function buildShuffledSnapshot(liveQuestion) {
  const q = liveQuestion;
  // Seul "qcm" (choix unique) est réellement présent dans la Banque de
  // questions aujourd'hui (voir question-renderer-service.js, en-tête) :
  // le mélange d'options ci-dessous suppose un `correctAnswer` unique
  // (index entier), format actuellement garanti par le seul type importé.
  if (q.questionType === 'qcm' && Array.isArray(q.answers) && typeof q.correctAnswer === 'number') {
    const order = shuffle(q.answers.map(function(_, i) { return i; }));
    const shuffledAnswers = order.map(function(originalIndex) { return q.answers[originalIndex]; });
    const newCorrectIndex = order.indexOf(q.correctAnswer);
    return completeQuestionSnapshot({
      pedagogicalId: q.pedagogicalId, version: q.version, questionType: q.questionType,
      question: q.question, answers: shuffledAnswers, correctAnswer: newCorrectIndex,
    });
  }
  // Repli sûr pour tout type non explicitement pris en charge par ce
  // sprint (voir question-renderer-service.js) : snapshot fidèle, sans
  // mélange (aucune hypothèse risquée sur une structure de réponse non
  // garantie).
  return completeQuestionSnapshot({
    pedagogicalId: q.pedagogicalId, version: q.version, questionType: q.questionType,
    question: q.question, answers: q.answers, correctAnswer: q.correctAnswer,
  });
}

/**
 * Charge les questions REELLEMENT publiees pour une liste de
 * `pedagogicalId`, fige leur ordre et melange les options de chacune -
 * partie ENTIEREMENT GENERIQUE de la preparation d'une evaluation
 * (SPRINT 21.5, Phase B1) : ne sait rien d'un parcours ni d'une
 * competence, prend seulement une liste d'identifiants. Utilisee par
 * prepareEvaluation() (formations, ci-dessous) ET par
 * free-training-service.js (entrainement libre) - AUCUNE duplication de
 * cette logique entre les deux modes, exactement l'objectif du sprint.
 *
 * @param {Array<string>} pedagogicalIds
 * @returns {Promise<{orderedQuestionIds:Array<string>, questionSnapshots:object}|{error:true}>}
 */
export async function buildOrderedQuestionSnapshots(pedagogicalIds) {
  if (!Array.isArray(pedagogicalIds) || pedagogicalIds.length === 0) {
    return { orderedQuestionIds: [], questionSnapshots: {} };
  }
  const questionsResult = await getExistingQuestionsByPedagogicalIds(pedagogicalIds);
  if (questionsResult.error) return { error: true };

  // Seules les questions REELLEMENT publiees sont retenues - une question
  // encore en brouillon, en relecture, archivee ou supprimee de la Banque
  // de questions ne doit jamais atterrir devant un utilisateur.
  const availableQuestions = pedagogicalIds
    .map(function(id) { return questionsResult.map.get(id); })
    .filter(function(q) { return q && q.status === 'published'; });

  const orderedQuestions = shuffle(availableQuestions);
  const orderedQuestionIds = orderedQuestions.map(function(q) { return q.pedagogicalId; });
  const questionSnapshots = {};
  orderedQuestions.forEach(function(q) { questionSnapshots[q.pedagogicalId] = buildShuffledSnapshot(q); });

  return { orderedQuestionIds: orderedQuestionIds, questionSnapshots: questionSnapshots };
}

/**
 * Vérifie qu'une évaluation peut être démarrée pour cet utilisateur et
 * prépare tout ce qu'il faut pour créer la session (ordre des questions
 * figé, snapshots) - SANS RIEN ÉCRIRE. "Réutiliser le moteur d'attribution
 * du Sprint 15. Ne pas se contenter de vérifier que le parcours est
 * publié" (SPRINT17, section 14) : la vérification passe entièrement par
 * `getAssignedParcoursForUser()`, qui vérifie déjà l'attribution réelle
 * (directe, groupe ou profil) ET le statut publié du parcours.
 *
 * SPRINT 21.5, PHASE B1 : la construction des snapshots elle-même est
 * désormais déléguée à buildOrderedQuestionSnapshots() ci-dessus (partie
 * générique, partagée avec l'entraînement libre) - seule la résolution de
 * `linkedQuestionIds` (spécifique aux parcours/compétences) reste ici.
 *
 * @param {string} uid
 * @param {string} parcoursId
 * @param {string} competencyId
 * @returns {Promise<{authorized:boolean, reason?:string, message?:string, parcours?:object, competency?:object, assignmentId?:string, orderedQuestionIds?:Array<string>, questionSnapshots?:object}>}
 */
export async function prepareEvaluation(uid, parcoursId, competencyId) {
  if (!uid) return { authorized: false, reason: 'not_authenticated', message: 'Vous devez être connecté pour démarrer une évaluation.' };

  const assigned = await getAssignedParcoursForUser(uid);
  if (assigned.error) {
    return { authorized: false, reason: 'error', message: 'Impossible de vérifier votre accès à ce parcours pour le moment. Réessayez plus tard.' };
  }
  const entry = assigned.items.find(function(e) { return e.parcours.id === parcoursId; });
  if (!entry) {
    return { authorized: false, reason: 'not_assigned', message: 'Ce parcours ne vous a pas été attribué, ou n\'est plus disponible.' };
  }
  const parcours = entry.parcours;

  const parcoursCompetencyLink = (parcours.competencies || []).find(function(c) { return c.competencyId === competencyId; });
  if (!parcoursCompetencyLink) {
    return { authorized: false, reason: 'competency_not_found', message: 'Cette compétence est introuvable dans ce parcours.' };
  }

  const competency = await getCompetencyById(competencyId);
  if (!competency) {
    return { authorized: false, reason: 'competency_not_found', message: 'Cette compétence est introuvable.' };
  }

  const linkedQuestionIds = Array.isArray(parcoursCompetencyLink.questionIds) ? parcoursCompetencyLink.questionIds : [];
  if (linkedQuestionIds.length === 0) {
    return { authorized: false, reason: 'no_questions', message: NO_QUESTIONS_AVAILABLE_MESSAGE };
  }

  const snapshots = await buildOrderedQuestionSnapshots(linkedQuestionIds);
  if (snapshots.error) {
    return { authorized: false, reason: 'error', message: 'Impossible de charger les questions de cette évaluation pour le moment. Réessayez plus tard.' };
  }
  if (snapshots.orderedQuestionIds.length === 0) {
    return { authorized: false, reason: 'no_questions', message: NO_QUESTIONS_AVAILABLE_MESSAGE };
  }

  return {
    authorized: true,
    parcours: parcours,
    competency: competency,
    assignmentId: (entry.assignment && entry.assignment.id) || null,
    orderedQuestionIds: snapshots.orderedQuestionIds,
    questionSnapshots: snapshots.questionSnapshots,
  };
}

/**
 * Meme role que prepareEvaluation() ci-dessus, mais pour UN SEUL bouton
 * "Commencer" couvrant TOUT le contenu du parcours (competences + sources
 * documentaires + questions directement liees - voir parcours-service.js,
 * sourceIds/directQuestionIds) plutot qu'une competence a la fois. Le pool
 * est l'UNION dedoublonnee des trois origines ; buildOrderedQuestionSnapshots()
 * (deja partagee avec l'entrainement libre) filtre ensuite lui-meme sur
 * les questions reellement publiees - aucune duplication de cette regle.
 *
 * @param {string} uid
 * @param {string} parcoursId
 * @returns {Promise<{authorized:boolean, reason?:string, message?:string, parcours?:object, assignmentId?:string, orderedQuestionIds?:Array<string>, questionSnapshots?:object}>}
 */
export async function prepareParcoursMixedEvaluation(uid, parcoursId) {
  if (!uid) return { authorized: false, reason: 'not_authenticated', message: 'Vous devez être connecté pour démarrer une évaluation.' };

  const assigned = await getAssignedParcoursForUser(uid);
  if (assigned.error) {
    return { authorized: false, reason: 'error', message: 'Impossible de vérifier votre accès à ce parcours pour le moment. Réessayez plus tard.' };
  }
  const entry = assigned.items.find(function(e) { return e.parcours.id === parcoursId; });
  if (!entry) {
    return { authorized: false, reason: 'not_assigned', message: 'Ce parcours ne vous a pas été attribué, ou n\'est plus disponible.' };
  }
  const parcours = entry.parcours;

  const pooledIds = await resolvePooledQuestionIds(parcours);
  if (pooledIds.length === 0) {
    return { authorized: false, reason: 'no_questions', message: NO_QUESTIONS_AVAILABLE_MESSAGE };
  }

  const snapshots = await buildOrderedQuestionSnapshots(pooledIds);
  if (snapshots.error) {
    return { authorized: false, reason: 'error', message: 'Impossible de charger les questions de cette évaluation pour le moment. Réessayez plus tard.' };
  }
  if (snapshots.orderedQuestionIds.length === 0) {
    return { authorized: false, reason: 'no_questions', message: NO_QUESTIONS_AVAILABLE_MESSAGE };
  }

  return {
    authorized: true,
    parcours: parcours,
    assignmentId: (entry.assignment && entry.assignment.id) || null,
    orderedQuestionIds: snapshots.orderedQuestionIds,
    questionSnapshots: snapshots.questionSnapshots,
  };
}
