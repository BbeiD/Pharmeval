// ===================== SERVICE D'AUDIT DES PARCOURS (Sprint 12) =====================
// Responsabilite UNIQUE : ecrire et lire le journal des actions de gestion
// des Parcours (collection Firestore dediee `parcours_audit_logs`). Miroir
// exact de question-audit-service.js (Sprint 11), applique a ce nouveau
// type de contenu.

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

const PARCOURS_AUDIT_COLLECTION = 'parcours_audit_logs';
const DEFAULT_READ_LIMIT = 50;

function logParcoursAuditError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[parcours-audit-service] ' + context + ' : ' + code, err);
}

/**
 * Enregistre une action de gestion sur un parcours. Ecriture "best
 * effort" : jamais bloquante pour l'action elle-meme (meme principe que
 * question-audit-service.js, audit-service.js, import-log-service.js).
 *
 * @param {{adminUid:string, adminEmail:string, parcoursId:string, actionType:string, oldValue:string, newValue:string}} entry
 * @returns {Promise<{success:boolean}>}
 */
export async function logParcoursAction(entry) {
  try {
    const colRef = collection(db, PARCOURS_AUDIT_COLLECTION);
    await addDoc(colRef, {
      date: new Date().toISOString(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || '',
      parcoursId: entry.parcoursId || null,
      actionType: entry.actionType || 'unknown',
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : '',
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : '',
    });
    return { success: true };
  } catch (err) {
    logParcoursAuditError('enregistrement d\'une action sur un parcours', err);
    return { success: false };
  }
}

/**
 * Lit les dernieres actions journalisees, optionnellement filtrees sur un
 * parcours precis. Lecture bornee, jamais toute la collection.
 *
 * @param {{parcoursId?:string, limit?:number}} [options]
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getRecentParcoursAuditLogs(options) {
  const opts = options || {};
  const max = opts.limit || DEFAULT_READ_LIMIT;
  try {
    const colRef = collection(db, PARCOURS_AUDIT_COLLECTION);
    const clauses = [];
    if (opts.parcoursId) clauses.push(where('parcoursId', '==', opts.parcoursId));
    clauses.push(orderBy('date', 'desc'));
    clauses.push(limit(max));
    const q = query(colRef, ...clauses);
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logParcoursAuditError('lecture du journal des actions sur les parcours', err);
    return { items: [], error: true };
  }
}
