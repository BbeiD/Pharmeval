// ===================== SERVICE D'ORCHESTRATION DES SECTIONS DOCUMENTAIRES (Sprint 20) =====================
// Point d'entree UNIQUE pour la gestion de l'arborescence d'UNE source
// documentaire (admin/document-sources.js). Coordonne :
//   - js/services/document-section-catalog-service.js  (lecture/ecriture Firestore)
//   - js/services/document-section-metadata-service.js  (modele, validation)
//   - js/services/document-source-catalog-service.js     (REUTILISE - verification
//     que la source parente existe et n'est pas archivee avant toute creation)
//   - js/services/audit-service.js                       (REUTILISE audit_logs, Sprint 8)
//
// "La profondeur de l'arborescence ne doit pas être limitée
// artificiellement à deux niveaux. Cependant, l'interface doit rester
// simple et lisible." : ce service ne limite jamais la profondeur ;
// c'est admin/document-sources.js (l'interface) qui choisit de ne
// presenter qu'une liste hierarchique simple, jamais un editeur graphique.

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { logAction } from "./audit-service.js";
import {
  DOCUMENT_SECTION_STATUSES, completeDocumentSectionMetadata, validateDocumentSection,
} from "./document-section-metadata-service.js";
import {
  createDocumentSectionDoc, getDocumentSectionById, listSectionsBySource,
  updateDocumentSectionFields, incrementDocumentSectionCounters,
} from "./document-section-catalog-service.js";
import { getDocumentSourceById, incrementDocumentSourceCounters } from "./document-source-catalog-service.js";

function denied(message) { return { status: 'denied', message: message }; }
function success(message, extra) { return Object.assign({ status: 'success', message: message }, extra || {}); }
function errorResult(message) { return { status: 'error', message: message }; }
function nowIso() { return new Date().toISOString(); }

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour gérer les sections documentaires.');
  if (!hasPermission(PERMISSIONS.MANAGE_GLOBAL_CATALOG)) return denied('La gestion du catalogue documentaire global est réservée aux administrateurs du catalogue.');
  return { status: 'authorized' };
}

/**
 * Liste l'arborescence COMPLETE d'une source (toutes les sections, quel
 * que soit leur niveau) - l'interface (admin/document-sources.js) la
 * reconstruit ensuite en liste hiérarchique indentée, jamais un
 * organigramme graphique.
 * @param {string} documentSourceId
 * @returns {Promise<object>}
 */
export async function getSectionTree(documentSourceId) {
  const access = checkAccess();
  if (access.status !== 'authorized') return { authorized: false, message: access.message, items: [] };
  const result = await listSectionsBySource(documentSourceId);
  if (result.error) return { authorized: true, error: true, message: 'Impossible de charger les sections pour le moment.', items: [] };
  return { authorized: true, items: result.items };
}

/**
 * Crée une section (racine si `parentSectionId` est `null`, sous-section
 * sinon). Vérifie que la source existe et n'est pas archivée, et que la
 * section parente (le cas échéant) appartient bien à la même source.
 * @param {{documentSourceId:string, parentSectionId:(string|null), name:string, shortCode?:string, description?:string, displayOrder?:number}} fields
 * @returns {Promise<object>}
 */
export async function createDocumentSection(fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);

  const source = await getDocumentSourceById(fields.documentSourceId);
  if (!source) return errorResult('Source documentaire introuvable.');
  if (source.status === 'archived') return denied('Impossible d\'ajouter une section à une source archivée.');

  let parent = null;
  if (fields.parentSectionId) {
    parent = await getDocumentSectionById(fields.parentSectionId);
    if (!parent) return errorResult('Section parente introuvable.');
    if (parent.documentSourceId !== fields.documentSourceId) {
      return errorResult('La section parente n\'appartient pas à la même source documentaire.');
    }
  }

  const ctx = getCurrentUserContext();
  const now = nowIso();
  const section = completeDocumentSectionMetadata({
    documentSourceId: fields.documentSourceId,
    parentSectionId: fields.parentSectionId || null,
    level: parent ? parent.level + 1 : 0,
    name: fields.name,
    shortCode: fields.shortCode,
    description: fields.description,
    path: parent ? parent.path.concat([parent.id]) : [],
    pathLabels: parent ? parent.pathLabels.concat([parent.name]) : [],
    displayOrder: (typeof fields.displayOrder === 'number') ? fields.displayOrder : 0,
    status: DOCUMENT_SECTION_STATUSES.ACTIVE,
    createdAt: now, createdBy: (ctx && ctx.email) || null,
    updatedAt: now, updatedBy: (ctx && ctx.email) || null,
  });

  const validation = validateDocumentSection(section);
  if (!validation.valid) return errorResult(validation.errors.join(' '));

  const result = await createDocumentSectionDoc(section);
  if (!result.success) return errorResult('La création de la section a échoué. Veuillez réessayer.');

  // Compteurs maintenus (jamais un balayage) : +1 section sur la source,
  // et +1 "section enfant" sur le parent direct, le cas échéant.
  incrementDocumentSourceCounters(source.id, { sectionCount: 1 }).catch(function() {});
  if (parent) incrementDocumentSectionCounters(parent.id, { childSectionCount: 1 }).catch(function() {});

  logAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    targetUid: null, targetEmail: null,
    actionType: 'document_section_created', oldValue: null, newValue: section.name + ' (' + source.name + ')',
  }).catch(function() {});

  return success('Section créée avec succès.', { section: section });
}

/**
 * Renomme/édite une section (nom, code court, description) - jamais son
 * appartenance (source, parent), voir moveDocumentSection() pour cela.
 * @param {object} section
 * @param {{name?:string, shortCode?:string, description?:string, displayOrder?:number}} fields
 * @returns {Promise<object>}
 */
export async function editDocumentSection(section, fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!section || !section.id) return errorResult('Section cible introuvable.');

  const editable = ['name', 'shortCode', 'description', 'displayOrder'];
  const payload = {};
  editable.forEach(function(key) {
    if (fields && Object.prototype.hasOwnProperty.call(fields, key)) payload[key] = fields[key];
  });
  if (Object.keys(payload).length === 0) return denied('Aucune modification à enregistrer.');

  const merged = Object.assign({}, section, payload);
  const validation = validateDocumentSection(merged);
  if (!validation.valid) return errorResult(validation.errors.join(' '));

  const ctx = getCurrentUserContext();
  payload.updatedAt = nowIso();
  payload.updatedBy = (ctx && ctx.email) || null;

  const result = await updateDocumentSectionFields(section.id, payload);
  if (!result.success) return errorResult('L\'enregistrement a échoué. Veuillez réessayer.');

  // Si le nom a changé, propager le libellé dans `pathLabels` des
  // descendants directs/indirects (voir moveDocumentSection() pour la
  // même logique de propagation, réutilisée ici via une fonction commune).
  if (payload.name && payload.name !== section.name) {
    await propagatePathLabelChange(section, payload.name);
  }

  logAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    targetUid: null, targetEmail: null,
    actionType: 'document_section_updated', oldValue: section.name, newValue: merged.name,
  }).catch(function() {});

  return success('Section mise à jour avec succès.');
}

/**
 * Déplace une section vers un nouveau parent (ou vers la racine si
 * `newParentSectionId` est `null`) - recalcule `path`/`pathLabels`/
 * `level` de la section ET de TOUS ses descendants (lecture bornée de
 * l'arborescence complète de la source, déjà limitée à 500 sections, voir
 * document-section-catalog-service.js).
 * @param {object} section
 * @param {string|null} newParentSectionId
 * @returns {Promise<object>}
 */
export async function moveDocumentSection(section, newParentSectionId) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!section || !section.id) return errorResult('Section cible introuvable.');
  if (newParentSectionId === section.id) return errorResult('Une section ne peut pas devenir sa propre section parente.');

  let newParent = null;
  if (newParentSectionId) {
    newParent = await getDocumentSectionById(newParentSectionId);
    if (!newParent) return errorResult('Section de destination introuvable.');
    if (newParent.documentSourceId !== section.documentSourceId) {
      return errorResult('Impossible de déplacer une section vers une autre source documentaire.');
    }
    // Empêche de déplacer une section dans l'un de ses propres
    // descendants (créerait une boucle dans l'arborescence).
    if (newParent.path.indexOf(section.id) !== -1) {
      return errorResult('Impossible de déplacer une section dans l\'une de ses propres sous-sections.');
    }
  }

  const newPath = newParent ? newParent.path.concat([newParent.id]) : [];
  const newPathLabels = newParent ? newParent.pathLabels.concat([newParent.name]) : [];
  const newLevel = newParent ? newParent.level + 1 : 0;

  const ctx = getCurrentUserContext();
  const now = nowIso();

  const result = await updateDocumentSectionFields(section.id, {
    parentSectionId: newParentSectionId || null,
    path: newPath, pathLabels: newPathLabels, level: newLevel,
    updatedAt: now, updatedBy: (ctx && ctx.email) || null,
  });
  if (!result.success) return errorResult('Le déplacement a échoué. Veuillez réessayer.');

  // Répercute le nouveau chemin sur tous les descendants (lecture bornée
  // de l'arborescence complète de la source, jamais toute la banque de
  // questions).
  await reparentDescendants(section, newPath.concat([section.id]), newPathLabels.concat([section.name]));

  logAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    targetUid: null, targetEmail: null,
    actionType: 'document_section_moved', oldValue: section.pathLabels.join(' > ') || '(racine)', newValue: newPathLabels.join(' > ') || '(racine)',
  }).catch(function() {});

  return success('Section déplacée avec succès.');
}

/**
 * Recalcule `path`/`pathLabels`/`level` de tous les descendants d'une
 * section après un déplacement ou un renommage - relit l'arborescence
 * complète de la source (lecture bornée, déjà limitée par
 * listSectionsBySource) puis ne réécrit QUE les descendants réels
 * (filtrage par présence de l'identifiant dans leur `path`).
 * @param {object} section - la section dont les descendants doivent être recalculés
 * @param {Array<string>} newBasePath - le nouveau `path` de `section` elle-même, complété de son propre id
 * @param {Array<string>} newBasePathLabels
 */
async function reparentDescendants(section, newBasePath, newBasePathLabels) {
  const all = await listSectionsBySource(section.documentSourceId);
  if (all.error) return;
  const descendants = all.items.filter(function(s) { return s.path.indexOf(section.id) !== -1; });

  await Promise.all(descendants.map(function(d) {
    const relativeIndex = d.path.indexOf(section.id);
    const relativeTail = d.path.slice(relativeIndex + 1); // ce qui suit `section` dans le chemin du descendant
    const relativeTailLabels = d.pathLabels.slice(relativeIndex + 1);
    const updatedPath = newBasePath.concat(relativeTail);
    const updatedPathLabels = newBasePathLabels.concat(relativeTailLabels);
    return updateDocumentSectionFields(d.id, {
      path: updatedPath, pathLabels: updatedPathLabels, level: updatedPath.length,
    });
  }));
}

/**
 * Propage un renommage dans `pathLabels` de tous les descendants (même
 * mécanisme que reparentDescendants(), pour le seul libellé).
 * @param {object} section
 * @param {string} newName
 */
async function propagatePathLabelChange(section, newName) {
  const all = await listSectionsBySource(section.documentSourceId);
  if (all.error) return;
  const descendants = all.items.filter(function(s) { return s.path.indexOf(section.id) !== -1; });
  await Promise.all(descendants.map(function(d) {
    const relativeIndex = d.path.indexOf(section.id);
    const updatedLabels = d.pathLabels.slice();
    updatedLabels[relativeIndex] = newName;
    return updateDocumentSectionFields(d.id, { pathLabels: updatedLabels });
  }));
}

/**
 * Archive une section (jamais une suppression - même principe que les
 * sources). Une section archivée n'est plus proposée pour de nouvelles
 * classifications, mais les questions déjà rattachées le restent.
 * @param {object} section
 * @returns {Promise<object>}
 */
export async function archiveDocumentSection(section) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!section || !section.id) return errorResult('Section cible introuvable.');
  if (section.status === DOCUMENT_SECTION_STATUSES.ARCHIVED) return denied('Cette section est déjà archivée.');

  const ctx = getCurrentUserContext();
  const result = await updateDocumentSectionFields(section.id, {
    status: DOCUMENT_SECTION_STATUSES.ARCHIVED, isActive: false,
    updatedAt: nowIso(), updatedBy: (ctx && ctx.email) || null,
  });
  if (!result.success) return errorResult('L\'archivage a échoué. Veuillez réessayer.');

  logAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    targetUid: null, targetEmail: null,
    actionType: 'document_section_archived', oldValue: section.status, newValue: DOCUMENT_SECTION_STATUSES.ARCHIVED,
  }).catch(function() {});

  return success('Section archivée avec succès.');
}
