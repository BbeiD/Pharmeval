// ===================== SERVICE DE SUIVI DES JOBS DE MIGRATION (Correctif Sprint 20) =====================
// "Pour les migrations importantes, créer ou compléter une notion de
// job." Nouvelle collection dédiée `document_migration_jobs` : aucune
// collection existante du projet ne modélise un job à états (créé →
// en cours → terminé/terminé avec erreurs/échoué) avec progression -
// `importLogs` (Sprint 10) est structurellement différente (un
// enregistrement immuable après coup, jamais un état qui progresse), la
// détourner aurait mélangé deux domaines distincts. Décision documentée
// dans RAPPORT_CORRECTIF_SPRINT20.md.

import { db, auth } from "../firebase-config.js";
import { doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getCurrentUserContext } from "./app-context.js";
import { API_BASE_URL } from "../config.js";

const JOB_COLLECTION = 'document_migration_jobs';

export const MIGRATION_JOB_STATUSES = Object.freeze({
  PREPARED: 'prepared',
  RUNNING: 'running',
  COMPLETED: 'completed',
  COMPLETED_WITH_ERRORS: 'completed_with_errors',
  FAILED: 'failed',
});

function generateJobId() {
  return 'MIGJOB-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8);
}

/**
 * Crée un job de migration au statut `prepared` - avant toute écriture
 * réelle sur les questions ou les compteurs.
 *
 * CORRECTIF (Sprint 20.2) : plus d'`organizationId` - les jobs de
 * migration documentaire sont désormais globaux, comme le catalogue
 * qu'ils manipulent (voir RAPPORT_CORRECTIF_SPRINT20_2.md).
 * @param {{targetSourceId:string, targetSectionId:(string|null), totalQuestions:number, originFilters:object}} fields
 * @returns {Promise<object>} le job créé
 */
export async function createMigrationJob(fields) {
  const ctx = getCurrentUserContext();
  const now = new Date().toISOString();
  const job = {
    id: generateJobId(),
    type: 'question_classification_migration',
    createdBy: (ctx && ctx.email) || null,
    createdAt: now,
    status: MIGRATION_JOB_STATUSES.PREPARED,
    targetSourceId: fields.targetSourceId,
    targetSectionId: fields.targetSectionId || null,
    originFilters: fields.originFilters || {},
    totalQuestions: fields.totalQuestions || 0,
    processedQuestions: 0,
    skippedQuestions: 0,
    failedQuestions: 0,
    failedIds: [],
    sourceDeltas: {},
    sectionDeltas: {},
    errorSummary: [],
    updatedAt: now,
    completedAt: null,
  };
  await setDoc(doc(db, JOB_COLLECTION, job.id), job);
  return job;
}

/**
 * Met à jour un job en cours (progression, statut). Reécrit uniquement
 * les champs fournis.
 * @param {string} jobId
 * @param {object} fields
 */
export async function updateMigrationJob(jobId, fields) {
  try {
    await updateDoc(doc(db, JOB_COLLECTION, jobId), Object.assign({}, fields, { updatedAt: new Date().toISOString() }));
  } catch (err) {
    console.error('[document-migration-job-service] échec de mise à jour du job ' + jobId, err);
  }
}

/**
 * Marque un job comme terminé (avec ou sans erreurs).
 * @param {string} jobId
 * @param {object} result
 */
export async function completeMigrationJob(jobId, result) {
  const status = result.failedQuestions > 0 ? MIGRATION_JOB_STATUSES.COMPLETED_WITH_ERRORS : MIGRATION_JOB_STATUSES.COMPLETED;
  await updateMigrationJob(jobId, Object.assign({}, result, { status: status, completedAt: new Date().toISOString() }));
}

/**
 * Marque un job comme totalement échoué (avant même d'avoir pu traiter
 * une seule question).
 * @param {string} jobId
 * @param {string} errorMessage
 */
export async function failMigrationJob(jobId, errorMessage) {
  await updateMigrationJob(jobId, { status: MIGRATION_JOB_STATUSES.FAILED, errorSummary: [errorMessage], completedAt: new Date().toISOString() });
}

/**
 * Relit un job par son identifiant.
 * @param {string} jobId
 * @returns {Promise<object|null>}
 */
export async function getMigrationJobById(jobId) {
  try {
    if (!auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/migration-jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.data;
  } catch (err) {
    console.error('[document-migration-job-service] échec de lecture du job ' + jobId, err);
    return null;
  }
}
