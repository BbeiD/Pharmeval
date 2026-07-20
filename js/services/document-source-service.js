// ===================== SERVICE D'ORCHESTRATION DES SOURCES DOCUMENTAIRES (Sprint 20) =====================
// Point d'entree UNIQUE pour l'ecran d'administration des sources
// documentaires (admin/document-sources.js). Coordonne :
//   - js/services/document-source-catalog-service.js  (lecture/ecriture Firestore)
//   - js/services/document-source-metadata-service.js  (modele, validation)
//   - js/services/authorization-service.js              (REUTILISE MANAGE_QUESTIONS -
//     la classification documentaire est une extension de la gestion de
//     la Banque de questions, aucune nouvelle permission creee)
//   - js/services/audit-service.js                      (REUTILISE audit_logs, Sprint 8 -
//     l'acteur est toujours un administrateur ici, contrairement aux
//     Sprints 17-19 ou l'acteur etait un utilisateur standard : le
//     journal centralise, deja admin-only, est donc directement
//     reutilisable SANS le contournement "evenements embarques" utilise
//     dans ces sprints precedents)
//
// "Ne pas supprimer une source contenant des questions. Utiliser
// l'archivage." (cadrage) : AUCUNE fonction de suppression n'existe dans
// ce fichier, uniquement des transitions de statut.

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { logAction } from "./audit-service.js";
import {
  DOCUMENT_SOURCE_STATUSES, completeDocumentSourceMetadata, validateDocumentSource,
} from "./document-source-metadata-service.js";
import {
  createDocumentSourceDoc, getDocumentSourceById, getDocumentSourcesByIds,
  queryDocumentSources, updateDocumentSourceFields,
} from "./document-source-catalog-service.js";

function denied(message) { return { status: 'denied', message: message }; }
function success(message, extra) { return Object.assign({ status: 'success', message: message }, extra || {}); }
function errorResult(message) { return { status: 'error', message: message }; }

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour gérer les sources documentaires.');
  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) return denied('La gestion des sources documentaires est réservée aux administrateurs.');
  return { status: 'authorized' };
}

function nowIso() { return new Date().toISOString(); }

/**
 * Liste les sources documentaires d'une organisation, avec filtres
 * optionnels (type, statut).
 * @param {{organizationId:string, sourceType?:string, status?:string}} options
 * @returns {Promise<object>}
 */
export async function browseDocumentSources(options) {
  const access = checkAccess();
  if (access.status !== 'authorized') return { authorized: false, message: access.message, items: [] };
  const result = await queryDocumentSources(options);
  if (result.error) return { authorized: true, error: true, message: 'Impossible de charger les sources documentaires pour le moment.', items: [] };
  return { authorized: true, items: result.items };
}

/** @param {string} sourceId @returns {Promise<object|null>} */
export async function getSourceForDisplay(sourceId) {
  return getDocumentSourceById(sourceId);
}

/** @param {Array<string>} sourceIds @returns {Promise<Map<string,object>>} */
export async function getSourcesForDisplay(sourceIds) {
  return getDocumentSourcesByIds(sourceIds);
}

/**
 * Crée une nouvelle source documentaire (toujours au statut "draft").
 * @param {object} fields
 * @returns {Promise<object>}
 */
export async function createDocumentSource(fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);

  const ctx = getCurrentUserContext();
  const now = nowIso();
  const source = completeDocumentSourceMetadata(Object.assign({}, fields, {
    status: DOCUMENT_SOURCE_STATUSES.DRAFT,
    createdAt: now, createdBy: (ctx && ctx.email) || null,
    updatedAt: now, updatedBy: (ctx && ctx.email) || null,
  }));

  const validation = validateDocumentSource(source);
  if (!validation.valid) return errorResult(validation.errors.join(' '));

  const result = await createDocumentSourceDoc(source);
  if (!result.success) return errorResult('La création de la source a échoué. Veuillez réessayer.');

  logAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    targetUid: null, targetEmail: null,
    actionType: 'document_source_created', oldValue: null, newValue: source.name + ' (' + source.sourceType + ')',
  }).catch(function() {});

  return success('Source documentaire créée avec succès.', { source: source, warnings: validation.warnings });
}

/**
 * Édite les champs éditables d'une source (jamais id/organizationId/
 * sourceType/status - voir changeDocumentSourceStatus() pour les
 * transitions de statut, séparées).
 * @param {object} source
 * @param {object} fields
 * @returns {Promise<object>}
 */
export async function editDocumentSource(source, fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!source || !source.id) return errorResult('Source cible introuvable.');

  const editable = ['name', 'shortCode', 'organizationName', 'version', 'academicYear', 'language', 'description', 'metadata', 'display'];
  const payload = {};
  editable.forEach(function(key) {
    if (fields && Object.prototype.hasOwnProperty.call(fields, key)) payload[key] = fields[key];
  });
  if (Object.keys(payload).length === 0) return denied('Aucune modification à enregistrer.');

  const merged = Object.assign({}, source, payload);
  const validation = validateDocumentSource(merged);
  if (!validation.valid) return errorResult(validation.errors.join(' '));

  const ctx = getCurrentUserContext();
  payload.updatedAt = nowIso();
  payload.updatedBy = (ctx && ctx.email) || null;

  const result = await updateDocumentSourceFields(source.id, payload);
  if (!result.success) return errorResult('L\'enregistrement a échoué. Veuillez réessayer.');

  logAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    targetUid: null, targetEmail: null,
    actionType: 'document_source_updated', oldValue: source.name, newValue: merged.name,
  }).catch(function() {});

  return success('Source documentaire mise à jour avec succès.', { warnings: validation.warnings });
}

/**
 * Change le statut d'une source (draft ↔ active, ou active/draft →
 * archived). L'archivage reste possible même si la source contient des
 * questions (elles restent classées ; la source n'est simplement plus
 * proposée pour de nouvelles classifications).
 * @param {object} source
 * @param {string} newStatus
 * @returns {Promise<object>}
 */
export async function changeDocumentSourceStatus(source, newStatus) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!source || !source.id) return errorResult('Source cible introuvable.');
  if (Object.values(DOCUMENT_SOURCE_STATUSES).indexOf(newStatus) === -1) return errorResult('Statut invalide.');
  if (source.status === newStatus) return denied('Cette source a déjà ce statut.');

  const ctx = getCurrentUserContext();
  const now = nowIso();
  const result = await updateDocumentSourceFields(source.id, {
    status: newStatus, isActive: newStatus === DOCUMENT_SOURCE_STATUSES.ACTIVE,
    updatedAt: now, updatedBy: (ctx && ctx.email) || null,
  });
  if (!result.success) return errorResult('Le changement de statut a échoué. Veuillez réessayer.');

  logAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    targetUid: null, targetEmail: null,
    actionType: newStatus === DOCUMENT_SOURCE_STATUSES.ARCHIVED ? 'document_source_archived' : 'document_source_updated',
    oldValue: source.status, newValue: newStatus,
  }).catch(function() {});

  return success('Statut mis à jour avec succès.');
}
