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
const STATISTICS_FETCH_LIMIT = 100;

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
 * Charge, en UNE seule lecture Firestore, jusqu'a STATISTICS_FETCH_LIMIT
 * (100) evaluations les plus recentes de l'utilisateur connecte, destinees
 * a alimenter TOUS les indicateurs de l'Analyse de progression (Sprint 6) -
 * jamais une requete separee par indicateur (apercu general, tendance,
 * performance par espace, par theme, themes forts/faibles utilisent tous
 * le meme resultat, voir js/statistics.js).
 *
 * Choix explicite documente dans RAPPORT_SPRINT6.md (Option B) : cette
 * lecture est INDEPENDANTE de la pagination de la liste (getEvaluationsPage,
 * toujours 20 par page, comportement inchange). Elle ne charge jamais toute
 * la collection : si l'utilisateur possede plus de 100 evaluations,
 * seules les 100 plus recentes sont analysees, et l'interface l'indique
 * explicitement (voir le texte affiche dans js/statistics.js).
 *
 * @returns {Promise<{items:Array<object>, truncated:boolean, error:boolean}>}
 */
export async function getEvaluationsForStatistics() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return { items: [], truncated: false, error: false };
  }
  try {
    const colRef = collection(db, 'users', ctx.uid, 'evaluations');
    // +1 pour detecter si la collection depasse la limite analysee, sans
    // requete de comptage separee.
    const q = query(colRef, orderBy('completedAt', 'desc'), limit(STATISTICS_FETCH_LIMIT + 1));
    const snap = await getDocs(q);
    const all = [];
    snap.forEach(function(d) { all.push(d.data()); });

    const truncated = all.length > STATISTICS_FETCH_LIMIT;
    const items = all.slice(0, STATISTICS_FETCH_LIMIT);

    return { items: items, truncated: truncated, error: false };
  } catch (err) {
    logHistoryError('chargement des evaluations pour l\'analyse de progression', err);
    return { items: [], truncated: false, error: true };
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
