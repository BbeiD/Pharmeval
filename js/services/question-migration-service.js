// ===================== SERVICE DE MIGRATION PAR LOTS DES QUESTIONS (Correctif Sprint 20) =====================
// "Les quelque 900 questions déjà présentes ne doivent pas être
// réimportées." Ce service NE MODIFIE JAMAIS le contenu d'une question
// (énoncé, propositions, bonne réponse, justification) - il n'écrit QUE
// les champs de classification.
//
// CORRECTIF : la version précédente supposait à tort que toutes les
// questions du lot étaient "non classées" et incrémentait aveuglément la
// destination du nombre total de questions du lot, SANS JAMAIS
// décrémenter les anciennes sources/sections d'origine. Ce fichier est
// intégralement réécrit autour du cycle demandé :
//
//     Préparer → Valider → Appliquer → Vérifier → Rapporter
//
// "Préparer" (prepareMigration()) relit la classification RÉELLE de
// chaque question (jamais une hypothèse) et calcule, via document-count-
// service.js, un delta AGRÉGÉ exact par source/section/ancêtre - un lot
// peut mélanger des questions non classées, déjà dans la destination,
// issues d'une autre section ou d'une autre source : chaque cas produit
// le delta qui lui correspond, jamais un simple +N sur la destination.
//
// Traçabilité par LOT (pas par question) via un job dédié
// (document-migration-job-service.js), conformément à "éviter un
// événement lourd par question".

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { logAction } from "./audit-service.js";
import { searchQuestionsBounded } from "./question-catalog-service.js";
import { getDocumentSourceById } from "./document-source-catalog-service.js";
import { getDocumentSectionById } from "./document-section-catalog-service.js";
import { prepareBulkDeltas, applyBulkClassificationDeltas } from "./document-count-service.js";
import {
  createMigrationJob, updateMigrationJob, completeMigrationJob, failMigrationJob, getMigrationJobById,
} from "./document-migration-job-service.js";

const MIGRATION_SCAN_LIMIT = 1000; // couvre largement les ~900 questions actuelles - voir RAPPORT_CORRECTIF_SPRINT20.md, "Limites connues"

function denied(message) { return { status: 'denied', message: message }; }
function errorResult(message) { return { status: 'error', message: message }; }

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour effectuer une migration.');
  if (!hasPermission(PERMISSIONS.MANAGE_GLOBAL_CATALOG)) return denied('La migration documentaire est réservée aux administrateurs du catalogue global.');
  return { status: 'authorized' };
}

/**
 * Filtre localement (sur un balayage déjà borné) les questions
 * correspondant aux critères de migration.
 * @param {Array<object>} questions
 * @param {{subtheme?:string, onlyUnclassified?:boolean}} filters
 * @returns {Array<object>}
 */
function applyClientSideFilters(questions, filters) {
  return questions.filter(function(q) {
    if (filters.subtheme && q.subtheme !== filters.subtheme) return false;
    if (filters.onlyUnclassified && q.documentSourceId) return false;
    return true;
  });
}

/**
 * Prévisualise un lot de migration (compte de questions correspondantes),
 * SANS calculer les deltas ni rien écrire - étape "filtrer" du cadrage.
 * @param {{theme?:string, subtheme?:string, difficulty?:string, onlyUnclassified?:boolean}} filters
 * @returns {Promise<{authorized:boolean, message?:string, items:Array<object>, truncated:boolean}>}
 */
export async function previewMigrationBatch(filters) {
  const access = checkAccess();
  if (access.status !== 'authorized') return { authorized: false, message: access.message, items: [], truncated: false };

  const bounded = await searchQuestionsBounded({
    filters: { theme: filters.theme, difficulty: filters.difficulty },
    maxScan: MIGRATION_SCAN_LIMIT,
  });
  if (bounded.error) {
    return { authorized: true, error: true, message: 'Impossible de charger les questions pour le moment. Réessayez plus tard.', items: [], truncated: false };
  }

  const matched = applyClientSideFilters(bounded.items, filters);
  return { authorized: true, items: matched, truncated: bounded.truncated };
}

/**
 * ÉTAPE "Préparer" + "Valider" : relit la classification RÉELLE de
 * chaque question déjà sélectionnée, calcule le delta agrégé complet
 * (par source/section/ancêtre) et crée un job au statut `prepared` - rien
 * n'est encore écrit sur les questions ni sur les compteurs.
 *
 * @param {Array<object>} questions - le résultat de previewMigrationBatch()
 * @param {{documentSourceId:string, documentSectionId?:(string|null)}} destination
 * @param {object} originFilters
 * @returns {Promise<object>}
 */
export async function prepareMigration(questions, destination, originFilters) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!Array.isArray(questions) || questions.length === 0) return errorResult('Aucune question à migrer.');

  const source = await getDocumentSourceById(destination.documentSourceId);
  if (!source) return errorResult('Source documentaire introuvable.');
  if (source.status === 'archived') return denied('Impossible de migrer vers une source archivée.');

  let section = null;
  if (destination.documentSectionId) {
    section = await getDocumentSectionById(destination.documentSectionId);
    if (!section) return errorResult('Section documentaire introuvable.');
    if (section.documentSourceId !== destination.documentSourceId) {
      return errorResult('Cette section n\'appartient pas à la source documentaire choisie.');
    }
  }

  const newDest = { sourceId: destination.documentSourceId, sectionId: destination.documentSectionId || null };
  const prepared = await prepareBulkDeltas(questions, newDest);

  const job = await createMigrationJob({
    targetSourceId: newDest.sourceId,
    targetSectionId: newDest.sectionId,
    totalQuestions: questions.length,
    originFilters: originFilters,
  });

  const ctx = getCurrentUserContext();
  logAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    targetUid: null, targetEmail: null,
    actionType: 'question_migration_prepared',
    oldValue: 'lot ' + job.id + ' — filtres : ' + JSON.stringify(originFilters || {}) + ' — ' + questions.length + ' question(s), ' + prepared.alreadyInDestination.length + ' déjà en place',
    newValue: newDest.sourceId + (newDest.sectionId ? ' > ' + newDest.sectionId : ''),
  }).catch(function() {});

  return {
    status: 'success',
    jobId: job.id,
    toApply: prepared.toApply,
    alreadyInDestinationCount: prepared.alreadyInDestination.length,
    aggregated: prepared.aggregated,
    ancestorAnomalies: prepared.ancestorAnomalies,
    destination: newDest,
  };
}

/**
 * ÉTAPE "Appliquer" + "Vérifier" + "Rapporter" : applique réellement le
 * lot déjà préparé par prepareMigration().
 * @param {string} jobId
 * @param {Array<object>} toApply
 * @param {{sourceId:string, sectionId:(string|null)}} destination
 * @param {object} aggregated
 * @returns {Promise<object>}
 */
export async function applyMigration(jobId, toApply, destination, aggregated) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);

  const job = await getMigrationJobById(jobId);
  if (!job) return errorResult('Job de migration introuvable.');

  await updateMigrationJob(jobId, { status: 'running' });

  let result;
  try {
    result = await applyBulkClassificationDeltas(toApply, destination, aggregated);
  } catch (err) {
    console.error('[question-migration-service] échec critique de la migration ' + jobId, err);
    await failMigrationJob(jobId, 'Échec critique : ' + (err && err.message));
    return errorResult('La migration a échoué de façon critique. Consultez le job "' + jobId + '" pour le détail. Lancez une réconciliation avant de retenter.');
  }

  await completeMigrationJob(jobId, {
    processedQuestions: result.succeededIds.length,
    skippedQuestions: 0,
    failedQuestions: result.failedIds.length,
    failedIds: result.failedIds,
    sourceDeltas: aggregated.sourceDeltas,
    sectionDeltas: aggregated.sectionDeltas,
    errorSummary: result.inconsistencies,
  });

  const ctx = getCurrentUserContext();
  logAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    targetUid: null, targetEmail: null,
    actionType: result.failedIds.length === 0 ? 'question_migration_completed' : 'question_migration_completed_with_errors',
    oldValue: 'job ' + jobId + ' — ' + result.succeededIds.length + ' migrée(s), ' + result.failedIds.length + ' échec(s)',
    newValue: destination.sourceId + (destination.sectionId ? ' > ' + destination.sectionId : ''),
  }).catch(function() {});

  return {
    status: result.failedIds.length === 0 ? 'success' : 'partial',
    message: result.failedIds.length === 0
      ? result.succeededIds.length + ' question(s) migrée(s) avec succès. Compteurs mis à jour de façon cohérente.'
      : result.succeededIds.length + ' question(s) migrée(s), ' + result.failedIds.length + ' échec(s) — relancez uniquement sur ces identifiants, ou lancez une réconciliation.',
    jobId: jobId,
    succeededCount: result.succeededIds.length,
    failedCount: result.failedIds.length,
    failedIds: result.failedIds,
    inconsistencies: result.inconsistencies,
  };
}
