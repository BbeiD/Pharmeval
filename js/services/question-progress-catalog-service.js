// ===================== SERVICE DE CATALOGUE — PROGRESSION PAR QUESTION (API) =====================
// Responsabilite UNIQUE : appel de l'API (Cloud Functions) pour la lecture
// et l'ecriture de `question_progress` (un document par couple
// utilisateur/question) et l'application idempotente d'un resultat
// d'evaluation. Aucune regle metier ici (voir question-progress-service.js)
// - meme layering que document-source-catalog-service.js / document-source-
// service.js.
//
// MIGRATION (Phase A.4, 24/07/2026) : toute la logique (lecture, increment,
// transaction d'idempotence) est desormais executee cote serveur
// (functions/index.js), qui reproduit a l'identique les regles de
// firestore.rules - le SDK Admin cote serveur les contourne, la
// verification y est donc refaite explicitement. `getQuestionProgress()`
// (lecture d'UNE seule question) a ete retiree a cette occasion : aucun
// appelant nulle part dans le code (voir git history pour l'ancienne
// implementation directe Firestore).
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

import { auth } from "../firebase-config.js";
import { API_BASE_URL } from "../config.js";

function logProgressError(context, err) {
  console.error('[question-progress-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Relit la progression de PLUSIEURS questions pour l'utilisateur courant,
 * en un seul appel API - MEME PATRON que getExistingQuestionsByPedagogicalIds()
 * (question-catalog-service.js), adapte aux volumes realistes d'un pool
 * DEJA BORNE (voir question-progress-service.js, jamais appelee sur un pool
 * non borne).
 * @param {string} userId - conserve pour compatibilite de signature (toujours l'utilisateur courant en pratique, verifie cote serveur)
 * @param {Array<string>} pedagogicalIds
 * @returns {Promise<{map:Map<string,object>, error:boolean}>}
 */
export async function getQuestionProgressForMany(userId, pedagogicalIds) {
  const unique = Array.from(new Set((pedagogicalIds || []).filter(Boolean)));
  if (unique.length === 0) return { map: new Map(), error: false };
  try {
    if (!auth.currentUser) return { map: new Map(), error: false };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/question-progress/many?ids=${unique.map(encodeURIComponent).join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logProgressError('lecture groupee de progression pour ' + userId + ' (API ' + res.status + ')', null);
      return { map: new Map(), error: true };
    }
    const body = await res.json();
    return { map: new Map(Object.entries(body)), error: false };
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
 * pensée pour un pool DÉJÀ borné (voir son en-tête). Volume réaliste pour
 * un usage personnel (jamais plus que le catalogue entier de questions).
 * @param {string} userId
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getAllQuestionProgressForUser(userId) {
  try {
    if (!auth.currentUser) return { items: [], error: false };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/question-progress`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logProgressError('lecture complète de la progression de ' + userId + ' (API ' + res.status + ')', null);
      return { items: [], error: true };
    }
    return await res.json();
  } catch (err) {
    logProgressError('lecture complète de la progression de ' + userId, err);
    return { items: [], error: true };
  }
}

/**
 * POINT D'ENTREE UNIQUE pour appliquer un EvaluationResult a la
 * progression par question - garantit l'IDEMPOTENCE (cadrage, point 5) :
 * un meme `evaluationResult.id` ne peut jamais incrementer deux fois (voir
 * functions/index.js pour le mecanisme de marqueur transactionnel, execute
 * desormais cote serveur).
 * @param {string} resultId
 * @param {Array<{userId:string, pedagogicalId:string, isCorrect:boolean}>} entries
 * @returns {Promise<{success:boolean, applied:boolean, error:boolean}>}
 */
export async function applyEvaluationResultIfNew(resultId, entries) {
  try {
    if (!auth.currentUser) return { success: false, applied: false, error: true };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/question-progress/apply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultId, entries }),
    });
    if (!res.ok) {
      logProgressError('application des incréments de progression pour ' + resultId + ' (API ' + res.status + ')', null);
      return { success: false, applied: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logProgressError('application des incréments de progression pour ' + resultId, err);
    return { success: false, applied: false, error: true };
  }
}
