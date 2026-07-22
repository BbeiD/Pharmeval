// ===================== SERVICE DE CATALOGUE — PROGRESSION PAR QUESTION (FIRESTORE) — Sprint 21.5, Phase B0 =====================
// Responsabilite UNIQUE : lecture/ecriture Firestore de `question_progress`
// (un document par couple utilisateur/question) et de
// `question_progress_applied_results` (marqueur d'idempotence, un document
// par resultat d'evaluation deja applique). Aucune regle metier ici (voir
// question-progress-service.js) - meme layering que document-source-
// catalog-service.js / document-source-service.js.
//
// RETROCOMPATIBILITE (cadrage, point 2, documentee ici au plus pres du
// code) : ce mecanisme n'alimente `question_progress` QUE pour les
// evaluations finalisees APRES le deploiement de cette phase. Les
// evaluations anterieures (deja dans `evaluation_results`) ne sont PAS
// reprises automatiquement - aucun backfill n'est effectue par ce fichier
// ni par aucun autre a ce stade. Consequence assumee : une question deja
// repondue par le passe, mais jamais depuis, apparaitra comme "jamais vue"
// dans Entrainement libre tant qu'aucun backfill explicite n'aura ete
// demande et developpe separement (hors perimetre de cette phase).

import { db } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, increment, runTransaction,
  collection, query, where, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const PROGRESS_COLLECTION = 'question_progress';
const APPLIED_RESULTS_COLLECTION = 'question_progress_applied_results';

function logProgressError(context, err) {
  console.error('[question-progress-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/** Identifiant deterministe d'un document de progression - un seul par
 * (utilisateur, question), jamais un identifiant genere aleatoirement.
 * @param {string} userId @param {string} pedagogicalId @returns {string} */
export function progressDocIdFor(userId, pedagogicalId) {
  return userId + '_' + pedagogicalId;
}

/** @param {string} userId @param {string} pedagogicalId @returns {Promise<object|null>} */
export async function getQuestionProgress(userId, pedagogicalId) {
  try {
    const snap = await getDoc(doc(db, PROGRESS_COLLECTION, progressDocIdFor(userId, pedagogicalId)));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logProgressError('lecture de la progression ' + userId + '/' + pedagogicalId, err);
    return null;
  }
}

/**
 * Relit la progression de PLUSIEURS questions pour un utilisateur, en
 * parallele - MEME PATRON que getExistingQuestionsByPedagogicalIds()
 * (question-catalog-service.js) : un getDoc() par identifiant, adapte aux
 * volumes realistes d'un pool DEJA BORNE (voir question-progress-
 * service.js, jamais appelee sur un pool non borne).
 * @param {string} userId @param {Array<string>} pedagogicalIds
 * @returns {Promise<{map:Map<string,object>, error:boolean}>}
 */
export async function getQuestionProgressForMany(userId, pedagogicalIds) {
  try {
    const results = await Promise.all(pedagogicalIds.map(async function(pid) {
      const snap = await getDoc(doc(db, PROGRESS_COLLECTION, progressDocIdFor(userId, pid)));
      return { pedagogicalId: pid, data: snap.exists() ? snap.data() : null };
    }));
    const map = new Map();
    results.forEach(function(r) { map.set(r.pedagogicalId, r.data); }); // null explicitement conserve = "jamais vue"
    return { map: map, error: false };
  } catch (err) {
    logProgressError('lecture groupee de progression pour ' + userId, err);
    return { map: new Map(), error: true };
  }
}

/**
 * AJOUT (demande directe de David, 22/07/2026 - "progression globale" de
 * l'accueil/"Mes compétences" jamais alimentée) : relit TOUTES les
 * questions déjà rencontrées par un utilisateur, SANS liste d'identifiants
 * préalable - contrairement à getQuestionProgressForMany() ci-dessus,
 * pensée pour un pool DÉJÀ borné (voir son en-tête). Un seul filtre
 * d'égalité (`userId`), indexé automatiquement par Firestore - aucun index
 * composite à déployer. Volume réaliste pour un usage personnel (jamais
 * plus que le catalogue entier de questions).
 * @param {string} userId
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getAllQuestionProgressForUser(userId) {
  try {
    const snap = await getDocs(query(collection(db, PROGRESS_COLLECTION), where('userId', '==', userId)));
    return { items: snap.docs.map(function(d) { return d.data(); }), error: false };
  } catch (err) {
    logProgressError('lecture complète de la progression de ' + userId, err);
    return { items: [], error: true };
  }
}

/**
 * Incremente (ou cree) UN document de progression pour UNE question deja
 * repondue. N'effectue AUCUNE verification d'idempotence elle-meme (voir
 * applyEvaluationResultIfNew ci-dessous, seul point d'entree qui doit
 * etre utilise par question-progress-service.js).
 * @param {string} userId @param {string} pedagogicalId @param {boolean} isCorrect @param {string} nowIso
 */
async function incrementOneQuestionProgress(userId, pedagogicalId, isCorrect, nowIso) {
  const ref = doc(db, PROGRESS_COLLECTION, progressDocIdFor(userId, pedagogicalId));
  await setDoc(ref, {
    userId: userId,
    pedagogicalId: pedagogicalId,
    timesSeen: increment(1),
    timesCorrect: increment(isCorrect ? 1 : 0),
    lastSeenAt: nowIso,
    lastStatus: isCorrect ? 'correct' : 'not_correct',
  }, { merge: true });
}

/**
 * POINT D'ENTREE UNIQUE pour appliquer un EvaluationResult a la
 * progression par question - garantit l'IDEMPOTENCE (cadrage, point 5) :
 * un meme `evaluationResult.id` ne peut jamais incrementer deux fois.
 *
 * Mecanisme : un document marqueur `question_progress_applied_results/
 * {resultId}` est cree dans une TRANSACTION Firestore avant tout
 * increment - si le marqueur existe deja, la transaction s'arrete
 * immediatement et retourne `{applied:false}` (no-op silencieux, jamais
 * un double comptage). Les incrementations individuelles de
 * `question_progress` ont lieu APRES que la transaction a confirme la
 * creation du marqueur - LIMITE HONNETE (documentee, pas cachee) : ce
 * n'est pas une atomicite parfaite de bout en bout (le marqueur est posé
 * de façon atomique, mais les incréments par question qui suivent ne le
 * sont pas conjointement avec lui) - un échec réseau EXACTEMENT entre la
 * pose du marqueur et la fin des incréments laisserait une progression
 * partiellement appliquée pour ce résultat. Risque jugé acceptable (même
 * niveau de rigueur que updateProgressionFromResult(), déjà "best effort"
 * dans le reste du projet), pas silencieux.
 *
 * @param {string} resultId
 * @param {Array<{userId:string, pedagogicalId:string, isCorrect:boolean}>} entries
 * @returns {Promise<{success:boolean, applied:boolean, error:boolean}>}
 */
export async function applyEvaluationResultIfNew(resultId, entries) {
  const markerRef = doc(db, APPLIED_RESULTS_COLLECTION, resultId);
  let alreadyApplied = false;
  try {
    await runTransaction(db, async function(tx) {
      const markerSnap = await tx.get(markerRef);
      if (markerSnap.exists()) {
        alreadyApplied = true;
        return;
      }
      tx.set(markerRef, { resultId: resultId, appliedAt: new Date().toISOString() });
    });
  } catch (err) {
    logProgressError('pose du marqueur d\'idempotence pour ' + resultId, err);
    return { success: false, applied: false, error: true };
  }

  if (alreadyApplied) {
    return { success: true, applied: false, error: false };
  }

  const nowIso = new Date().toISOString();
  try {
    await Promise.all(entries.map(function(e) {
      return incrementOneQuestionProgress(e.userId, e.pedagogicalId, e.isCorrect, nowIso);
    }));
    return { success: true, applied: true, error: false };
  } catch (err) {
    logProgressError('application des incréments de progression pour ' + resultId, err);
    return { success: false, applied: true, error: true }; // le marqueur EST pose (voir limite honnete ci-dessus) - ne jamais le presenter comme "non applique" a ce stade
  }
}
