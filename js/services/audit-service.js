// ===================== SERVICE D'AUDIT (JOURNAL DES ACTIONS ADMINISTRATEUR) =====================
// Centralise l'ecriture et la lecture du journal d'audit. Collection dediee
// (audit_logs/), separee de users/{uid} pour ne jamais alterer la structure
// existante des documents utilisateur (voir consigne "ne pas casser la
// structure actuelle").
//
// Chaque action administrateur sensible (changement de role, changement de
// statut) doit passer par logAction() ci-dessous - voir
// js/services/admin-service.js, seul appelant legitime de ce service.

import { db, auth } from "../firebase-config.js";
import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

const AUDIT_COLLECTION = 'audit_logs';
const DEFAULT_READ_LIMIT = 50;

function logAuditError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[audit-service] ' + context + ' : ' + code, err);
}

/**
 * Enregistre une action administrateur dans le journal d'audit. Ecriture
 * "best effort" : si elle echoue (reseau, regles Firestore), l'action
 * elle-meme (deja effectuee par user-management-service.js au moment de
 * l'appel) n'est jamais annulee - seule la journalisation est manquee, et
 * l'erreur est journalisee en console pour investigation. Un journal
 * d'audit imparfait est preferable a une action administrative bloquee par
 * une panne de journalisation.
 *
 * @param {{adminUid:string, adminEmail:string, targetUid:string, targetEmail:string, actionType:string, oldValue:string, newValue:string}} entry
 * @returns {Promise<{success:boolean}>}
 */
export async function logAction(entry) {
  try {
    const colRef = collection(db, AUDIT_COLLECTION);
    await addDoc(colRef, {
      date: serverTimestamp(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || '',
      targetUid: entry.targetUid || null,
      targetEmail: entry.targetEmail || '',
      actionType: entry.actionType || 'unknown',
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : '',
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : '',
    });
    return { success: true };
  } catch (err) {
    logAuditError('enregistrement d\'une action dans le journal d\'audit', err);
    return { success: false };
  }
}

/**
 * Lit les dernieres entrees du journal d'audit (les plus recentes en
 * premier), pour un affichage simple dans le Centre d'administration.
 * Lecture bornee (jamais toute la collection).
 *
 * AJOUT ADDITIF (Sprint 14) : `targetUid` optionnel, pour n'afficher que
 * les actions concernant UN utilisateur precis (fiche detaillee du module
 * Utilisateurs, admin/users.js) - comportement par defaut (sans filtre)
 * strictement inchange, retrocompatible avec tout appelant existant
 * (js/admin.js, Sprint 8).
 *
 * @param {{limit?:number, targetUid?:string}} options
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getRecentAuditEntries(options) {
  const max = (options && options.limit) || DEFAULT_READ_LIMIT;
  try {
    if (!auth.currentUser) return { items: [], error: false };
    const token = await auth.currentUser.getIdToken();
    const params = new URLSearchParams({ limit: String(max) });
    if (options && options.targetUid) params.set('targetUid', options.targetUid);
    const res = await fetch(`${API_BASE_URL}/api/audit-logs?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logAuditError('lecture du journal d\'audit (API ' + res.status + ')', null);
      return { items: [], error: true };
    }
    return await res.json();
  } catch (err) {
    logAuditError('lecture du journal d\'audit', err);
    return { items: [], error: true };
  }
}
