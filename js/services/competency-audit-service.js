// ===================== SERVICE D'AUDIT DE LA BANQUE DES COMPETENCES (Sprint 13) =====================
// Responsabilite UNIQUE : ecrire et lire le journal des actions de gestion
// des competences de la banque (collection Firestore dediee
// `competency_audit_logs`). Miroir exact de parcours-audit-service.js
// (Sprint 12) / question-audit-service.js (Sprint 11), applique a ce
// nouveau type de contenu.

import { db, auth } from "../firebase-config.js";
import {
  collection,
  addDoc,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

const COMPETENCY_AUDIT_COLLECTION = 'competency_audit_logs';
const DEFAULT_READ_LIMIT = 50;

function logCompetencyAuditError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[competency-audit-service] ' + context + ' : ' + code, err);
}

/**
 * Enregistre une action de gestion sur une competence de la banque.
 * Ecriture "best effort" : jamais bloquante pour l'action elle-meme (meme
 * principe que tous les autres journaux d'audit du projet).
 * @param {{adminUid:string, adminEmail:string, competencyId:string, actionType:string, oldValue:string, newValue:string}} entry
 * @returns {Promise<{success:boolean}>}
 */
export async function logCompetencyAction(entry) {
  try {
    const colRef = collection(db, COMPETENCY_AUDIT_COLLECTION);
    await addDoc(colRef, {
      date: new Date().toISOString(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || '',
      competencyId: entry.competencyId || null,
      actionType: entry.actionType || 'unknown',
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : '',
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : '',
    });
    return { success: true };
  } catch (err) {
    logCompetencyAuditError('enregistrement d\'une action sur une compétence', err);
    return { success: false };
  }
}

/**
 * Lit les dernieres actions journalisees, optionnellement filtrees sur une
 * competence precise. Lecture bornee, jamais toute la collection.
 * @param {{competencyId?:string, limit?:number}} [options]
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getRecentCompetencyAuditLogs(options) {
  const opts = options || {};
  const max = opts.limit || DEFAULT_READ_LIMIT;
  try {
    if (!auth.currentUser) return { items: [], error: false };
    const token = await auth.currentUser.getIdToken();
    const params = new URLSearchParams({ limit: String(max) });
    if (opts.competencyId) params.set('filterId', opts.competencyId);
    const res = await fetch(`${API_BASE_URL}/api/content-audit-logs/competency?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logCompetencyAuditError('lecture du journal des actions sur les compétences (API ' + res.status + ')', null);
      return { items: [], error: true };
    }
    return await res.json();
  } catch (err) {
    logCompetencyAuditError('lecture du journal des actions sur les compétences', err);
    return { items: [], error: true };
  }
}
