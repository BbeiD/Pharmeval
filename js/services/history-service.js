// ===================== SERVICE D'HISTORIQUE — V2 (LECTURE SEULE) =====================
// Lit la collection evaluation_results (V2) et expose des evaluations normalisees
// dans un format compatible avec statistics-service.js, history.js et
// recommendation-service.js.
//
// Correspondances V2 → format interne :
//   createdAt              → completedAt
//   score.percent          → score.percentage
//   score.correctCount     → score.correctAnswers
//   score.totalCount       → score.totalQuestions
//   competencyId           → selection.theme   (proxy pour les stats par competence)
//   competencyResults[].questionResults[]  → questions[]

import { db } from "../firebase-config.js";
import { getCurrentUserContext } from "./app-context.js";
import {
  collection,
  query,
  where,
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

function normalizeResult(raw) {
  const score = raw.score || {};
  const allQuestions = [];
  (raw.competencyResults || []).forEach(function(cr) {
    (cr.questionResults || []).forEach(function(qr) {
      const options = qr.options || [];
      const userIdx = (typeof qr.userAnswer === 'number') ? qr.userAnswer : null;
      const correctIdx = (typeof qr.correctAnswer === 'number') ? qr.correctAnswer : null;
      let answerGivenText = '—';
      if (userIdx !== null && options[userIdx] !== undefined) {
        answerGivenText = String(options[userIdx]);
      } else if (typeof qr.userAnswer === 'string' && qr.userAnswer !== '') {
        answerGivenText = qr.userAnswer;
      }
      allQuestions.push({
        questionId: qr.pedagogicalId,
        question: qr.question || '',
        options: options,
        userAnswer: userIdx,
        correctAnswer: correctIdx,
        answerGiven: answerGivenText,
        correct: qr.status === 'correct',
      });
    });
  });

  return {
    id: raw.id,
    completedAt: raw.createdAt,
    score: {
      percentage: score.percent,
      correctAnswers: score.correctCount,
      totalQuestions: score.totalCount,
    },
    selection: {
      theme: raw.competencyId || null,
    },
    competencyId: raw.competencyId,
    parcoursId: raw.parcoursId,
    questions: allQuestions,
  };
}

/**
 * Charge une page d'evaluations de l'utilisateur connecte, de la plus recente
 * a la plus ancienne (collection evaluation_results, filtre userId).
 * Necessite l'index composite firestore.indexes.json :
 *   evaluation_results — userId ASC + createdAt DESC
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
    const colRef = collection(db, 'evaluation_results');
    const clauses = [
      where('userId', '==', ctx.uid),
      orderBy('createdAt', 'desc'),
    ];
    if (opts.cursor) clauses.push(startAfter(opts.cursor));
    clauses.push(limit(pageSize + 1));
    const q = query(colRef, ...clauses);
    const snap = await getDocs(q);
    const rawAll = [];
    snap.forEach(function(d) {
      const data = d.data();
      if (!data.id) data.id = d.id;
      rawAll.push(data);
    });

    const hasMore = rawAll.length > pageSize;
    const rawPage = rawAll.slice(0, pageSize);
    const nextCursor = rawPage.length ? rawPage[rawPage.length - 1].createdAt : (opts.cursor || null);
    const items = rawPage.map(normalizeResult);

    return { items: items, nextCursor: nextCursor, hasMore: hasMore, error: false };
  } catch (err) {
    logHistoryError('chargement d\'une page d\'historique', err);
    return { items: [], nextCursor: null, hasMore: false, error: true };
  }
}

/**
 * Charge jusqu'a STATISTICS_FETCH_LIMIT (100) evaluations recentes pour
 * alimenter l'Analyse de progression et le moteur de recommandations.
 * Independant de la pagination de la liste.
 *
 * @returns {Promise<{items:Array<object>, truncated:boolean, error:boolean}>}
 */
export async function getEvaluationsForStatistics() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return { items: [], truncated: false, error: false };
  }
  try {
    const colRef = collection(db, 'evaluation_results');
    const q = query(
      colRef,
      where('userId', '==', ctx.uid),
      orderBy('createdAt', 'desc'),
      limit(STATISTICS_FETCH_LIMIT + 1)
    );
    const snap = await getDocs(q);
    const rawAll = [];
    snap.forEach(function(d) {
      const data = d.data();
      if (!data.id) data.id = d.id;
      rawAll.push(data);
    });

    const truncated = rawAll.length > STATISTICS_FETCH_LIMIT;
    const items = rawAll.slice(0, STATISTICS_FETCH_LIMIT).map(normalizeResult);

    return { items: items, truncated: truncated, error: false };
  } catch (err) {
    logHistoryError('chargement des evaluations pour l\'analyse de progression', err);
    return { items: [], truncated: false, error: true };
  }
}
