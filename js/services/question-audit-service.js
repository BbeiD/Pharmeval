// ===================== SERVICE D'AUDIT DES QUESTIONS =====================
// Responsabilite UNIQUE : ecrire et lire le journal des actions de gestion
// de la Banque de questions (collection Firestore dediee
// `question_audit_logs`), demande explicitement par le Sprint 11
// ("Les actions doivent etre journalisees. Creer les logs necessaires.").
//
// Distincte de `audit_logs` (Sprint 8, actions sur les UTILISATEURS) et de
// `importLogs` (Sprint 10, operations d'IMPORT completes) : ce journal-ci
// trace les actions individuelles sur UNE question precise (changement de
// statut, modification de metadonnees, suppression) - un grain plus fin,
// necessaire pour repondre demain a "qui a modifie cette question, et
// quand ?" independamment de savoir si elle provient d'un import ou d'une
// action manuelle dans la Banque de questions.
//
// Meme pattern que audit-service.js et import-log-service.js : ecriture
// "best effort", jamais bloquante pour l'action elle-meme.

import { db } from "../firebase-config.js";
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const QUESTION_AUDIT_COLLECTION = 'question_audit_logs';
const DEFAULT_READ_LIMIT = 50;

function logQuestionAuditError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[question-audit-service] ' + context + ' : ' + code, err);
}

/**
 * Enregistre une action de gestion sur une question. Ecriture "best
 * effort" : si elle echoue, l'action elle-meme (deja effectuee au moment
 * de cet appel par question-bank-service.js) n'est jamais annulee - seule
 * la journalisation est manquee, avec une erreur journalisee en console
 * pour investigation.
 *
 * @param {{adminUid:string, adminEmail:string, pedagogicalId:string, actionType:string, oldValue:string, newValue:string}} entry
 * @returns {Promise<{success:boolean}>}
 */
export async function logQuestionAction(entry) {
  try {
    const colRef = collection(db, QUESTION_AUDIT_COLLECTION);
    await addDoc(colRef, {
      date: new Date().toISOString(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || '',
      pedagogicalId: entry.pedagogicalId || null,
      actionType: entry.actionType || 'unknown',
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : '',
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : '',
    });
    return { success: true };
  } catch (err) {
    logQuestionAuditError('enregistrement d\'une action sur une question', err);
    return { success: false };
  }
}

/**
 * Lit les dernieres actions journalisees, optionnellement filtrees sur une
 * question precise (utile pour un futur onglet "historique" sur la fiche
 * d'une question). Lecture bornee, jamais toute la collection.
 *
 * @param {{pedagogicalId?:string, limit?:number}} [options]
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getRecentQuestionAuditLogs(options) {
  const opts = options || {};
  const max = opts.limit || DEFAULT_READ_LIMIT;
  try {
    const colRef = collection(db, QUESTION_AUDIT_COLLECTION);
    const clauses = [];
    if (opts.pedagogicalId) clauses.push(where('pedagogicalId', '==', opts.pedagogicalId));
    clauses.push(orderBy('date', 'desc'));
    clauses.push(limit(max));
    const q = query(colRef, ...clauses);
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logQuestionAuditError('lecture du journal des actions sur les questions', err);
    return { items: [], error: true };
  }
}
