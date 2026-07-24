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

import { auth } from "../firebase-config.js";
import { API_BASE_URL } from "../config.js";

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
    if (!auth.currentUser) return { success: false };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/question-audit-logs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) {
      logQuestionAuditError('enregistrement d\'une action sur une question (API ' + res.status + ')', null);
      return { success: false };
    }
    return await res.json();
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
    if (!auth.currentUser) return { items: [], error: false };
    const token = await auth.currentUser.getIdToken();
    const params = new URLSearchParams({ limit: String(max) });
    if (opts.pedagogicalId) params.set('filterId', opts.pedagogicalId);
    const res = await fetch(`${API_BASE_URL}/api/content-audit-logs/question?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logQuestionAuditError('lecture du journal des actions sur les questions (API ' + res.status + ')', null);
      return { items: [], error: true };
    }
    return await res.json();
  } catch (err) {
    logQuestionAuditError('lecture du journal des actions sur les questions', err);
    return { items: [], error: true };
  }
}
