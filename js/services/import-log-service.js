// ===================== SERVICE DE JOURNAL DES IMPORTS =====================
// Responsabilite UNIQUE : ecrire et lire le journal des imports de
// questions (collection Firestore dediee `importLogs`, distincte a la fois
// de `questions/` et de `audit_logs/` du Sprint 8 - un import de contenu
// pedagogique n'est pas une action de gestion des utilisateurs).
//
// Demande complementaire du Sprint 10 : meme si cette tracabilite n'est
// pas indispensable a l'usage immediat, elle devient precieuse des que
// plusieurs administrateurs importent du contenu (plusieurs universites,
// APB...) - savoir qui a importe quoi, quand, avec quel resultat.
//
// Meme pattern que js/services/audit-service.js (Sprint 8) : ecriture
// "best effort", jamais bloquante pour l'import lui-meme.

import { db, auth } from "../firebase-config.js";
import {
  collection,
  addDoc,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

const IMPORT_LOGS_COLLECTION = 'importLogs';
const DEFAULT_READ_LIMIT = 50;

function logImportLogError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[import-log-service] ' + context + ' : ' + code, err);
}

/**
 * Enregistre une entree dans le journal des imports. Ecriture "best
 * effort" : si elle echoue, l'import lui-meme (deja effectue au moment de
 * cet appel) n'est jamais annule - seule la journalisation est manquee,
 * avec une erreur journalisee en console pour investigation. Un journal
 * imparfait est preferable a un import bloque par une panne de
 * journalisation (meme principe que js/services/audit-service.js).
 *
 * @param {{adminUid:string, adminEmail:string, fileName:string, createdCount:number, updatedCount:number, errorCount:number, durationMs:number, simulated:boolean, schemaVersion:string, competenciesCreated?:number, tagsCreated?:number, sourcesCreated?:number, connectorId?:string}} entry
 *
 * SPRINT 21 (phase 3, CatalogSyncEngine) : 4 champs optionnels additifs -
 * competenciesCreated, tagsCreated, sourcesCreated, connectorId. Absents
 * (undefined) pour tout appelant existant (admin/import.js) : ces champs
 * sont alors simplement enregistres a 0/null, comme avant ce sprint.
 * Voir le rapport de cette phase pour une reflexion sur la pertinence du
 * nom "import-log-service" maintenant que ce service journalise aussi des
 * synchronisations de catalogue plus generales - non tranchee ici.
 * @returns {Promise<{success:boolean}>}
 */
export async function logImport(entry) {
  try {
    const colRef = collection(db, IMPORT_LOGS_COLLECTION);
    await addDoc(colRef, {
      date: new Date().toISOString(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || '',
      fileName: entry.fileName || '',
      createdCount: entry.createdCount || 0,
      updatedCount: entry.updatedCount || 0,
      errorCount: entry.errorCount || 0,
      durationMs: entry.durationMs || 0,
      simulated: !!entry.simulated,
      schemaVersion: entry.schemaVersion || null,
      competenciesCreated: entry.competenciesCreated || 0,
      tagsCreated: entry.tagsCreated || 0,
      sourcesCreated: entry.sourcesCreated || 0,
      connectorId: entry.connectorId || null,
    });
    return { success: true };
  } catch (err) {
    logImportLogError('enregistrement d\'un import dans le journal', err);
    return { success: false };
  }
}

/**
 * Lit les dernieres entrees du journal des imports (les plus recentes en
 * premier). Lecture bornee, jamais toute la collection.
 *
 * @param {{limit?:number}} [options]
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function getRecentImportLogs(options) {
  const max = (options && options.limit) || DEFAULT_READ_LIMIT;
  try {
    if (!auth.currentUser) return { items: [], error: false };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/import-logs?limit=${max}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logImportLogError('lecture du journal des imports (API ' + res.status + ')', null);
      return { items: [], error: true };
    }
    return await res.json();
  } catch (err) {
    logImportLogError('lecture du journal des imports', err);
    return { items: [], error: true };
  }
}
