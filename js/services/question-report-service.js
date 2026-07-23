// ===================== SERVICE DE SIGNALEMENT DES QUESTIONS =====================
// Responsabilite UNIQUE : permettre a un utilisateur connecte de signaler
// un probleme sur une question (reponse fausse, incoherence, doublon...)
// pendant une evaluation ou sur l'ecran de resultat - collection Firestore
// dediee `question_reports`. Demande directe de David, 23/07/2026.
//
// IMPORTANT (meme principe que le retrait de l'edition ponctuelle dans
// admin/bank.js, meme demande) : un signalement ne modifie JAMAIS la
// question elle-meme. Le fichier Excel reste l'unique source authentique
// du contenu editorial (voir GUIDE_GENERATION_QUESTIONS_PDF.md) - un
// signalement alimente uniquement une file de suivi pour
// l'administrateur, qui corrige ensuite via une resynchronisation du
// catalogue.

import { db } from "../firebase-config.js";
import {
  collection, addDoc, doc, updateDoc, query, where, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getCurrentUserContext } from "./app-context.js";
import { hasPermission, PERMISSIONS } from "./authorization-service.js";

const REPORT_COLLECTION = 'question_reports';

/** Motifs de signalement proposes (liste fermee, cadrage demande par David). */
export const REPORT_REASONS = Object.freeze({
  WRONG_ANSWER: 'wrong_answer',
  INCONSISTENCY: 'inconsistency',
  DUPLICATE: 'duplicate',
  TYPO: 'typo',
  OTHER: 'other',
});
export const REPORT_REASON_LABELS = Object.freeze({
  wrong_answer: 'La réponse marquée correcte semble fausse',
  inconsistency: 'Incohérence dans l\'énoncé ou les réponses',
  duplicate: 'Doublon d\'une autre question',
  typo: 'Faute de frappe / erreur de français',
  other: 'Autre',
});

function logReportError(context, err) {
  console.error('[question-report-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Signale un probleme sur une question. Ecriture "best effort" du point
 * de vue de l'appelant (evaluation.js/evaluation-result.js) : un echec ici
 * ne bloque jamais la poursuite de l'evaluation en cours.
 *
 * @param {{pedagogicalId:string, reason:string, comment?:string}} fields
 * @returns {Promise<{success:boolean, message:string}>}
 */
export async function submitQuestionReport(fields) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { success: false, message: 'Vous devez être connecté pour signaler une question.' };

  const f = fields || {};
  if (!f.pedagogicalId) return { success: false, message: 'Question cible introuvable.' };
  if (!f.reason || !Object.values(REPORT_REASONS).includes(f.reason)) {
    return { success: false, message: 'Veuillez sélectionner un motif de signalement.' };
  }

  try {
    await addDoc(collection(db, REPORT_COLLECTION), {
      pedagogicalId: f.pedagogicalId,
      userId: ctx.uid,
      userEmail: ctx.email || '',
      reason: f.reason,
      comment: (f.comment || '').toString().trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
    });
    return { success: true, message: 'Merci, votre signalement a été transmis.' };
  } catch (err) {
    logReportError('envoi d\'un signalement', err);
    return { success: false, message: 'Impossible d\'envoyer le signalement pour le moment. Réessayez plus tard.' };
  }
}

/**
 * Lit les signalements d'UNE question, tries du plus recent au plus
 * ancien - reserve a l'administration (meme permission que la Banque de
 * questions, voir checkAccess() dans question-bank-service.js). Tri
 * effectue COTE CLIENT (jamais un `orderBy` Firestore combine a l'egalite
 * sur pedagogicalId) pour ne pas exiger d'index compose supplementaire a
 * deployer - volumetrie toujours modeste (les signalements d'UNE seule
 * question).
 *
 * @param {string} pedagogicalId
 * @returns {Promise<{items:Array<object>, error:boolean, authorized:boolean}>}
 */
export async function getReportsForQuestion(pedagogicalId) {
  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) return { items: [], error: false, authorized: false };
  try {
    const q = query(collection(db, REPORT_COLLECTION), where('pedagogicalId', '==', pedagogicalId));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(function(d) { items.push(Object.assign({ id: d.id }, d.data())); });
    items.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    return { items: items, error: false, authorized: true };
  } catch (err) {
    logReportError('lecture des signalements de ' + pedagogicalId, err);
    return { items: [], error: true, authorized: true };
  }
}

/**
 * Compte les signalements OUVERTS pour plusieurs questions a la fois -
 * pense pour une page DEJA BORNEE de la Banque de questions (jamais toute
 * la collection), meme principe que getQuestionProgressForMany()
 * (question-progress-catalog-service.js). Reserve a l'administration.
 *
 * @param {Array<string>} pedagogicalIds
 * @returns {Promise<{counts:Map<string,number>, error:boolean}>}
 */
export async function getOpenReportCounts(pedagogicalIds) {
  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) return { counts: new Map(), error: false };
  const ids = pedagogicalIds || [];
  if (ids.length === 0) return { counts: new Map(), error: false };
  try {
    const results = await Promise.all(ids.map(async function(pid) {
      const q = query(collection(db, REPORT_COLLECTION), where('pedagogicalId', '==', pid), where('status', '==', 'open'));
      const snap = await getDocs(q);
      return { pedagogicalId: pid, count: snap.size };
    }));
    const counts = new Map();
    results.forEach(function(r) { if (r.count > 0) counts.set(r.pedagogicalId, r.count); });
    return { counts: counts, error: false };
  } catch (err) {
    logReportError('comptage des signalements ouverts', err);
    return { counts: new Map(), error: true };
  }
}

/**
 * Marque un signalement comme resolu - reserve a l'administration. Ne
 * modifie jamais la question elle-meme (voir en-tete de fichier).
 * @param {string} reportId
 * @returns {Promise<{success:boolean}>}
 */
export async function markReportResolved(reportId) {
  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) return { success: false };
  const ctx = getCurrentUserContext();
  try {
    await updateDoc(doc(db, REPORT_COLLECTION, reportId), {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolvedBy: (ctx && ctx.uid) || null,
    });
    return { success: true };
  } catch (err) {
    logReportError('résolution du signalement ' + reportId, err);
    return { success: false };
  }
}
