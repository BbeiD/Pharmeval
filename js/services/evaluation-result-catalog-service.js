// ===================== SERVICE DE CATALOGUE DES RESULTATS D'EVALUATION (FIRESTORE) — Sprint 18 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `evaluation_results`. Aucune logique de correction
// ici (voir evaluation-correction-service.js) - ce fichier ne fait que
// lire/ecrire un EvaluationResult deja construit.
//
// "Elle doit contenir uniquement les résultats calculés. Ne pas modifier
// les réponses enregistrées dans evaluation_sessions." (SPRINT18, section
// 6) : ce fichier n'importe et ne touche JAMAIS evaluation-session-
// catalog-service.js.

import { db } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, collection, query, where, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const RESULT_COLLECTION = 'evaluation_results';

function logCatalogError(context, err) {
  console.error('[evaluation-result-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Enregistre un résultat - TOUJOURS une création (jamais une mise à jour,
 * voir firestore.rules : `evaluation_results` est en écriture unique,
 * "Ne jamais recalculer le résultat", SPRINT18 section 12).
 * @param {object} resultDocument - deja construit par evaluation-correction-service.js
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function createResultDocument(resultDocument) {
  try {
    await setDoc(doc(db, RESULT_COLLECTION, resultDocument.id), resultDocument);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('création du résultat ' + resultDocument.id, err);
    return { success: false, error: true };
  }
}

/**
 * Relit un résultat par son identifiant (== identifiant de la session
 * corrigée, voir evaluation-correction-service.js, resultIdForSession()).
 * @param {string} resultId
 * @returns {Promise<object|null>}
 */
export async function getResultById(resultId) {
  try {
    const snap = await getDoc(doc(db, RESULT_COLLECTION, resultId));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logCatalogError('lecture du résultat ' + resultId, err);
    return null;
  }
}

/**
 * Relit TOUS les résultats bruts (documents complets, competencyResults
 * inclus) d'un utilisateur - AJOUT pour permettre de rejouer la
 * progression par question/compétence sur des résultats déjà enregistrés
 * (voir reconcileProgressForUser(), evaluation-result-service.js). Jamais
 * utilisée pour l'affichage courant de l'historique (voir history-
 * service.js, qui normalise dans un format different et plus leger) -
 * uniquement pour ce cas de reconciliation.
 * @param {string} userId
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getAllResultsForUser(userId) {
  try {
    const snap = await getDocs(query(collection(db, RESULT_COLLECTION), where('userId', '==', userId)));
    return { items: snap.docs.map(function(d) { return d.data(); }), error: false };
  } catch (err) {
    logCatalogError('lecture groupée des résultats de ' + userId, err);
    return { items: [], error: true };
  }
}
