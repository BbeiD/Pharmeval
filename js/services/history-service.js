// ===================== SERVICE D'HISTORIQUE (LECTURE SEULE) =====================
// Centralise TOUTE lecture Firestore liee a l'historique des evaluations.
// Aucune interface (js/history.js) ne doit interroger Firestore directement :
// elle passe systematiquement par les fonctions ci-dessous.
//
// Perimetre strict de ce sprint : lecture et pagination uniquement. Aucun
// calcul statistique (moyenne, progression, points forts/faibles...) n'est
// fait ici - conformement a la decision d'architecture demandee, ce service
// ne fait que restituer les donnees telles qu'enregistrees par
// evaluation-service.js. Les statistiques calculees viendront d'un futur
// js/services/statistics-service.js dedie (Sprint 6), qui pourra reutiliser
// getEvaluationsPage() ci-dessous sans que l'historique n'ait a changer.

import { db } from "../firebase-config.js";
import { getCurrentUserContext } from "./app-context.js";
import { computeQuestionId } from "./evaluation-service.js";
import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const DEFAULT_PAGE_SIZE = 20;

function logHistoryError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[history-service] ' + context + ' : ' + code, err);
}

/**
 * Charge une page d'evaluations de l'utilisateur connecte, de la plus
 * recente a la plus ancienne (users/{uid}/evaluations, jamais le
 * localStorage : le cloud est la reference pour cette vue, comme demande).
 *
 * Ne charge jamais toute la collection : une page a la fois (20 par defaut),
 * avec un curseur (`nextCursor`) a fournir a l'appel suivant pour obtenir la
 * page suivante (voir loadMore() dans js/history.js).
 *
 * @param {{pageSize?:number, cursor?:string}} options
 * @returns {Promise<{items:Array<object>, nextCursor:(string|null), hasMore:boolean, error:boolean}>}
 */
export async function getEvaluationsPage(options) {
  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return { items: [], nextCursor: null, hasMore: false, error: false };
  }
  try {
    const colRef = collection(db, 'users', ctx.uid, 'evaluations');
    const clauses = [orderBy('completedAt', 'desc')];
    if (opts.cursor) clauses.push(startAfter(opts.cursor));
    // +1 resultat demande pour savoir s'il reste une page suivante, sans
    // effectuer de requete de comptage separee.
    clauses.push(limit(pageSize + 1));
    const q = query(colRef, ...clauses);
    const snap = await getDocs(q);
    const all = [];
    snap.forEach(function(d) { all.push(d.data()); });

    const hasMore = all.length > pageSize;
    const items = all.slice(0, pageSize);
    const nextCursor = items.length ? items[items.length - 1].completedAt : (opts.cursor || null);

    return { items: items, nextCursor: nextCursor, hasMore: hasMore, error: false };
  } catch (err) {
    logHistoryError('chargement d\'une page d\'historique', err);
    return { items: [], nextCursor: null, hasMore: false, error: true };
  }
}

/**
 * Recherche, dans la banque de questions deja chargee localement (voir
 * window.PharmevalQDB, expose par js/app.js - Sprint 5), la question
 * correspondant a un questionId d'evaluation donne.
 *
 * N'effectue AUCUN acces reseau : la banque de questions est deja en
 * memoire cote client. Cette fonction n'est appelee qu'a l'ouverture du
 * detail d'une evaluation (jamais pour la liste des cartes), conformement a
 * l'exigence de performance du sprint ("ne jamais relire les questions
 * completes tant que l'utilisateur n'ouvre pas le detail").
 *
 * @param {string} questionId
 * @returns {object|null}
 */
export function findQuestionByQuestionId(questionId) {
  const qdb = (typeof window !== 'undefined' && window.PharmevalQDB) || [];
  for (let i = 0; i < qdb.length; i++) {
    if (computeQuestionId(qdb[i]) === questionId) return qdb[i];
  }
  return null;
}

/**
 * Libelle affichable de la bonne reponse d'une question, quel que soit son
 * format parmi ceux geres nativement (QCM classique, arbre decisionnel /
 * flux). Retourne `null` pour les formats non reconnus (Relier, Cas
 * evolutif...) plutot que d'afficher une valeur incorrecte : le detail
 * affiche alors une mention neutre (voir js/history.js).
 *
 * @param {object|null} q
 * @returns {string|null}
 */
export function getCorrectAnswerLabel(q) {
  if (!q) return null;
  if (Array.isArray(q.a) && typeof q.r === 'number') return q.a[q.r];
  if (q.propositions && q.bonne_reponse && q.propositions[q.bonne_reponse]) {
    return q.propositions[q.bonne_reponse];
  }
  return null;
}
