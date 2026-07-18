// ===================== SERVICE D'AUDIT DES ORGANISATIONS (Sprint 13) =====================
// Responsabilite UNIQUE : ecrire et lire le journal des actions de gestion
// des Organisations (collection Firestore dediee `organisation_audit_logs`).
// Miroir exact de parcours-audit-service.js (Sprint 12), applique a ce
// nouveau niveau de gouvernance.
//
// IMPORTANT (lecon retenue du correctif Sprint 12) : la requete
// getRecentOrganisationAuditLogs() ci-dessous combine un `where` et un
// `orderBy` sur des champs differents - voir firestore.indexes.json, qui
// DOIT contenir l'index composite correspondant (organisationId + date),
// sans quoi cette lecture echoue silencieusement cote Firestore (c'est
// exactement le bug decouvert et corrige pour les Parcours et les
// Questions au correctif du Sprint 12 - l'index a ete inclus des la
// premiere livraison de ce fichier, pas ajoute apres coup cette fois).

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

const ORGANISATION_AUDIT_COLLECTION = 'organisation_audit_logs';
const DEFAULT_READ_LIMIT = 50;

function logOrganisationAuditError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[organisation-audit-service] ' + context + ' : ' + code, err);
}

/**
 * Enregistre une action de gestion sur une organisation. Ecriture "best
 * effort" : jamais bloquante pour l'action elle-meme.
 *
 * @param {{adminUid:string, adminEmail:string, organisationId:string, actionType:string, oldValue:string, newValue:string}} entry
 * @returns {Promise<{success:boolean}>}
 */
export async function logOrganisationAction(entry) {
  try {
    const colRef = collection(db, ORGANISATION_AUDIT_COLLECTION);
    await addDoc(colRef, {
      date: new Date().toISOString(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || '',
      organisationId: entry.organisationId || null,
      actionType: entry.actionType || 'unknown',
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : '',
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : '',
    });
    return { success: true };
  } catch (err) {
    logOrganisationAuditError('enregistrement d\'une action sur une organisation', err);
    return { success: false };
  }
}

/**
 * Lit les dernieres actions journalisees, optionnellement filtrees sur une
 * organisation precise. Lecture bornee, jamais toute la collection.
 *
 * @param {{organisationId?:string, limit?:number}} [options]
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getRecentOrganisationAuditLogs(options) {
  const opts = options || {};
  const max = opts.limit || DEFAULT_READ_LIMIT;
  try {
    const colRef = collection(db, ORGANISATION_AUDIT_COLLECTION);
    const clauses = [];
    if (opts.organisationId) clauses.push(where('organisationId', '==', opts.organisationId));
    clauses.push(orderBy('date', 'desc'));
    clauses.push(limit(max));
    const q = query(colRef, ...clauses);
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logOrganisationAuditError('lecture du journal des actions sur les organisations', err);
    return { items: [], error: true };
  }
}
