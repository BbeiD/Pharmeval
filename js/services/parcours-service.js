// ===================== SERVICE DES PARCOURS (ORCHESTRATION) — Sprint 12 =====================
// Point d'entree UNIQUE pour tout ce que fait l'ecran "Parcours"
// (admin/parcours.js) : navigation, creation, actions de gestion
// (changement de statut, suppression securisee, edition limitee),
// gestion des competences (ajout/edition/suppression/reordonnancement),
// liaison de questions existantes, et consultation de l'historique.
// Coordonne :
//   - js/services/parcours-catalog-service.js  (lecture/ecriture Firestore)
//   - js/services/parcours-audit-service.js     (journalisation systematique)
//   - js/services/parcours-metadata-service.js  (modele de donnees, defauts, validation)
//   - js/services/authorization-service.js      (controle d'acces : reserve aux administrateurs)
//   - js/services/question-catalog-service.js   (REUTILISE - recherche des questions existantes a lier, Sprint 10/11, jamais duplique)
//
// Aucune logique metier dans l'interface : admin/parcours.js ne fait
// qu'appeler les fonctions ci-dessous et afficher le resultat.
//
// "Workflow identique aux questions" (demande explicite du Sprint 12) :
// memes statuts, meme workflow de suppression securisee (Archive ->
// Corbeille -> Suppression definitive), meme separation entre gestion
// generale (MANAGE_PARCOURS) et purge definitive (PURGE_PARCOURS).

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import {
  PARCOURS_STATUSES,
  completeParcoursMetadata,
  completeCompetency,
  validateParcoursMetadata,
} from "./parcours-metadata-service.js";
import {
  createParcoursDocument,
  queryParcoursPage,
  searchParcoursBounded,
  updateParcoursStatus,
  updateParcoursFields,
  deleteParcoursDocument,
  DEFAULT_PARCOURS_PAGE_SIZE,
} from "./parcours-catalog-service.js";
import { logParcoursAction, getRecentParcoursAuditLogs } from "./parcours-audit-service.js";
import { searchQuestionsBounded } from "./question-catalog-service.js";

const MIN_PARCOURS_NAME_LENGTH = 3;

function denied(message) {
  return { status: 'denied', message: message };
}
function success(message, extra) {
  return Object.assign({ status: 'success', message: message }, extra || {});
}
function errorResult(message) {
  return { status: 'error', message: message };
}

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return denied('Vous devez être connecté pour gérer les parcours.');
  }
  if (!hasPermission(PERMISSIONS.MANAGE_PARCOURS)) {
    return denied('La gestion des parcours est réservée aux administrateurs.');
  }
  return { status: 'authorized' };
}

function matchesSearchText(p, searchText) {
  const needle = (searchText || '').toString().trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [p.id, p.name, p.description, p.targetAudience, p.author]
    .concat((p.competencies || []).map(function(c) { return c.name; }));
  return haystacks.some(function(h) {
    return h && h.toString().toLowerCase().indexOf(needle) !== -1;
  });
}

// ---------------------------------------------------------------------------
// Navigation (recherche, filtres, tri, pagination) - miroir de browseQuestions()
// ---------------------------------------------------------------------------

/**
 * @param {{searchText?:string, filters?:object, sortField?:string, sortDirection?:string, pageSize?:number, cursorDoc?:object, page?:number}} options
 * @returns {Promise<object>}
 */
export async function browseParcours(options) {
  const access = checkAccess();
  if (access.status !== 'authorized') {
    return { authorized: false, message: access.message };
  }

  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_PARCOURS_PAGE_SIZE;

  if (opts.searchText && opts.searchText.trim()) {
    const bounded = await searchParcoursBounded({ filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection });
    if (bounded.error) {
      return { authorized: true, error: true, message: 'Impossible de charger les parcours pour le moment. Réessayez plus tard.' };
    }
    const filtered = bounded.items.filter(function(p) { return matchesSearchText(p, opts.searchText); });
    const page = opts.page || 0;
    const pageItems = filtered.slice(page * pageSize, (page + 1) * pageSize);
    return {
      authorized: true, error: false, searchMode: true,
      items: pageItems, totalMatched: filtered.length, page: page,
      hasMore: (page + 1) * pageSize < filtered.length,
      truncatedScan: bounded.truncated,
    };
  }

  const result = await queryParcoursPage({
    filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection,
    pageSize: pageSize, cursorDoc: opts.cursorDoc,
  });
  if (result.error) {
    return { authorized: true, error: true, message: 'Impossible de charger les parcours pour le moment. Réessayez plus tard.' };
  }
  return {
    authorized: true, error: false, searchMode: false,
    items: result.items, lastDoc: result.lastDoc, hasMore: result.hasMore,
  };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * Cree un nouveau Parcours. Toujours en statut "draft" - jamais publie
 * automatiquement, meme principe que les questions importees.
 *
 * @param {{name:string, description?:string, targetAudience?:string, color?:string, icon?:string}} fields
 * @returns {Promise<object>}
 */
export async function createParcours(fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);

  const f = fields || {};
  if (!f.name || f.name.toString().trim().length < MIN_PARCOURS_NAME_LENGTH) {
    return errorResult('Le nom du parcours doit contenir au moins ' + MIN_PARCOURS_NAME_LENGTH + ' caractères.');
  }

  const ctx = getCurrentUserContext();
  const now = new Date().toISOString();
  const metadata = completeParcoursMetadata({
    name: f.name, description: f.description, targetAudience: f.targetAudience,
    color: f.color, icon: f.icon,
    status: PARCOURS_STATUSES.DRAFT,
    createdAt: now, updatedAt: now,
    author: (ctx && ctx.email) || null,
    competencies: [],
  });

  const validation = validateParcoursMetadata(metadata);
  if (!validation.valid) {
    return errorResult(validation.errors.join(' '));
  }

  const result = await createParcoursDocument(metadata);
  if (!result.success) return errorResult('La création du parcours a échoué. Veuillez réessayer.');

  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: metadata.id, actionType: 'creation', oldValue: null, newValue: metadata.name,
  }).catch(function() {});

  return success('Parcours créé avec succès.', { parcours: metadata });
}

// ---------------------------------------------------------------------------
// Transitions de statut (Publier / Archiver / Remettre en brouillon)
// ---------------------------------------------------------------------------

async function changeStatus(parcours, newStatus, actionLabel, disallowedFromStatuses) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');
  if (parcours.status === newStatus) return denied('Ce parcours a déjà ce statut.');
  if (disallowedFromStatuses && disallowedFromStatuses.indexOf(parcours.status) !== -1) {
    return denied('Cette action n\'est pas disponible depuis le statut actuel de ce parcours.');
  }

  const result = await updateParcoursStatus(parcours.id, newStatus);
  if (!result.success) return errorResult('La mise à jour du statut a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: parcours.id, actionType: 'status_change',
    oldValue: parcours.status, newValue: newStatus,
  }).catch(function() {});

  return success(actionLabel + ' avec succès.');
}

/** Publie un parcours. Indisponible depuis la corbeille. */
export function publishParcours(parcours) {
  return changeStatus(parcours, PARCOURS_STATUSES.PUBLISHED, 'Parcours publié', [PARCOURS_STATUSES.TRASH]);
}
/** Archive un parcours. Indisponible depuis la corbeille. */
export function archiveParcours(parcours) {
  return changeStatus(parcours, PARCOURS_STATUSES.ARCHIVED, 'Parcours archivé', [PARCOURS_STATUSES.TRASH]);
}
/** Remet un parcours en brouillon. Indisponible depuis la corbeille. */
export function revertParcoursToDraft(parcours) {
  return changeStatus(parcours, PARCOURS_STATUSES.DRAFT, 'Parcours remis en brouillon', [PARCOURS_STATUSES.TRASH]);
}

// ---------------------------------------------------------------------------
// Suppression securisee (workflow identique aux questions, Sprint 11 correctif)
// ---------------------------------------------------------------------------

/**
 * Met un parcours ARCHIVE a la corbeille. Uniquement depuis "archived".
 * @param {object} parcours
 * @returns {Promise<object>}
 */
export async function moveParcoursToTrash(parcours) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');
  if (parcours.status !== PARCOURS_STATUSES.ARCHIVED) {
    return denied('Seul un parcours archivé peut être mis à la corbeille.');
  }
  return changeStatus(parcours, PARCOURS_STATUSES.TRASH, 'Parcours mis à la corbeille');
}

/**
 * Restaure un parcours depuis la corbeille (retour a "archived").
 * @param {object} parcours
 * @returns {Promise<object>}
 */
export async function restoreParcoursFromTrash(parcours) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');
  if (parcours.status !== PARCOURS_STATUSES.TRASH) {
    return denied('Ce parcours n\'est pas à la corbeille.');
  }

  const result = await updateParcoursStatus(parcours.id, PARCOURS_STATUSES.ARCHIVED);
  if (!result.success) return errorResult('La restauration a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: parcours.id, actionType: 'status_change',
    oldValue: PARCOURS_STATUSES.TRASH, newValue: PARCOURS_STATUSES.ARCHIVED,
  }).catch(function() {});

  return success('Parcours restauré depuis la corbeille avec succès.');
}

/**
 * Supprime DEFINITIVEMENT un parcours. Uniquement depuis "trash", et
 * reservee a la permission dediee PURGE_PARCOURS.
 * @param {object} parcours
 * @returns {Promise<object>}
 */
export async function permanentlyDeleteParcours(parcours) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!hasPermission(PERMISSIONS.PURGE_PARCOURS)) {
    return denied('La suppression définitive est réservée aux administrateurs.');
  }
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');
  if (parcours.status !== PARCOURS_STATUSES.TRASH) {
    return denied('Seul un parcours à la corbeille peut être supprimé définitivement.');
  }

  const result = await deleteParcoursDocument(parcours.id);
  if (!result.success) return errorResult('La suppression définitive a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: parcours.id, actionType: 'purge', oldValue: PARCOURS_STATUSES.TRASH, newValue: null,
  }).catch(function() {});

  return success('Parcours supprimé définitivement.');
}

// ---------------------------------------------------------------------------
// Edition limitee des champs du parcours
// ---------------------------------------------------------------------------

/**
 * @param {object} parcours
 * @param {{name?:string, description?:string, targetAudience?:string, color?:string, icon?:string}} fields
 * @returns {Promise<object>}
 */
export async function editParcoursMetadata(parcours, fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');

  const f = fields || {};
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(f, 'name')) {
    const trimmed = (f.name || '').toString().trim();
    if (trimmed.length < MIN_PARCOURS_NAME_LENGTH) {
      return errorResult('Le nom du parcours doit contenir au moins ' + MIN_PARCOURS_NAME_LENGTH + ' caractères.');
    }
    payload.name = trimmed;
  }
  if (Object.prototype.hasOwnProperty.call(f, 'description')) payload.description = (f.description || '').toString().trim();
  if (Object.prototype.hasOwnProperty.call(f, 'targetAudience')) payload.targetAudience = (f.targetAudience || '').toString().trim();
  if (Object.prototype.hasOwnProperty.call(f, 'color')) payload.color = (f.color || '').toString().trim() || null;
  if (Object.prototype.hasOwnProperty.call(f, 'icon')) payload.icon = (f.icon || '').toString().trim() || null;

  if (Object.keys(payload).length === 0) {
    return denied('Aucune modification à enregistrer.');
  }

  const result = await updateParcoursFields(parcours.id, payload);
  if (!result.success) return errorResult('L\'enregistrement des modifications a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  Object.keys(payload).forEach(function(field) {
    logParcoursAction({
      adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
      parcoursId: parcours.id, actionType: 'edit_' + field,
      oldValue: parcours[field], newValue: payload[field],
    }).catch(function() {});
  });

  return success('Modifications enregistrées avec succès.');
}

// ---------------------------------------------------------------------------
// Gestion des competences
// ---------------------------------------------------------------------------

/**
 * Ajoute une nouvelle competence au parcours (ajoutee en derniere
 * position). Reecrit le tableau `competencies` dans son ensemble (voir
 * parcours-catalog-service.js, updateParcoursFields).
 *
 * @param {object} parcours
 * @param {{name:string, description?:string}} fields
 * @returns {Promise<object>}
 */
export async function addCompetency(parcours, fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');

  const f = fields || {};
  if (!f.name || f.name.toString().trim().length === 0) {
    return errorResult('La compétence doit avoir un nom.');
  }

  const existing = Array.isArray(parcours.competencies) ? parcours.competencies : [];
  const newCompetency = completeCompetency({
    name: f.name, description: f.description,
    order: existing.length, questionIds: [],
  });
  const updated = existing.concat([newCompetency]);

  const result = await updateParcoursFields(parcours.id, { competencies: updated });
  if (!result.success) return errorResult('L\'ajout de la compétence a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: parcours.id, actionType: 'add_competency', oldValue: null, newValue: newCompetency.name,
  }).catch(function() {});

  return success('Compétence ajoutée avec succès.', { competencies: updated });
}

/**
 * Supprime une competence du parcours (et donc ses liaisons de questions).
 *
 * @param {object} parcours
 * @param {string} competencyId
 * @returns {Promise<object>}
 */
export async function removeCompetency(parcours, competencyId) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');

  const existing = Array.isArray(parcours.competencies) ? parcours.competencies : [];
  const target = existing.find(function(c) { return c.id === competencyId; });
  if (!target) return errorResult('Compétence introuvable.');

  const updated = existing.filter(function(c) { return c.id !== competencyId; })
    .map(function(c, i) { return Object.assign({}, c, { order: i }); });

  const result = await updateParcoursFields(parcours.id, { competencies: updated });
  if (!result.success) return errorResult('La suppression de la compétence a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: parcours.id, actionType: 'remove_competency', oldValue: target.name, newValue: null,
  }).catch(function() {});

  return success('Compétence supprimée avec succès.', { competencies: updated });
}

/**
 * Deplace une competence d'un rang vers le haut ou le bas (reordonnancement
 * simple, sans glisser-deposer - voir RAPPORT_SPRINT12.md).
 *
 * @param {object} parcours
 * @param {string} competencyId
 * @param {number} direction - -1 (vers le haut) ou +1 (vers le bas)
 * @returns {Promise<object>}
 */
export async function moveCompetency(parcours, competencyId, direction) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');

  const existing = (Array.isArray(parcours.competencies) ? parcours.competencies : []).slice().sort(function(a, b) { return a.order - b.order; });
  const index = existing.findIndex(function(c) { return c.id === competencyId; });
  if (index === -1) return errorResult('Compétence introuvable.');
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= existing.length) {
    return denied('Cette compétence est déjà à cette extrémité de la liste.');
  }

  const tmp = existing[index];
  existing[index] = existing[targetIndex];
  existing[targetIndex] = tmp;
  const updated = existing.map(function(c, i) { return Object.assign({}, c, { order: i }); });

  const result = await updateParcoursFields(parcours.id, { competencies: updated });
  if (!result.success) return errorResult('Le réordonnancement a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: parcours.id, actionType: 'reorder_competency', oldValue: index, newValue: targetIndex,
  }).catch(function() {});

  return success('Ordre mis à jour avec succès.', { competencies: updated });
}

/**
 * Lie une question existante a une competence (ajout dans `questionIds`,
 * sans doublon). Ne modifie JAMAIS la question elle-meme (voir "aucune
 * modification des questions elles-memes", Sprint 12).
 *
 * @param {object} parcours
 * @param {string} competencyId
 * @param {string} pedagogicalId - identifiant de la question a lier
 * @returns {Promise<object>}
 */
export async function linkQuestionToCompetency(parcours, competencyId, pedagogicalId) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');
  if (!pedagogicalId) return errorResult('Question cible introuvable.');

  const existing = Array.isArray(parcours.competencies) ? parcours.competencies : [];
  const target = existing.find(function(c) { return c.id === competencyId; });
  if (!target) return errorResult('Compétence introuvable.');
  if (target.questionIds.indexOf(pedagogicalId) !== -1) {
    return denied('Cette question est déjà liée à cette compétence.');
  }

  const updated = existing.map(function(c) {
    if (c.id !== competencyId) return c;
    return Object.assign({}, c, { questionIds: c.questionIds.concat([pedagogicalId]) });
  });

  const result = await updateParcoursFields(parcours.id, { competencies: updated });
  if (!result.success) return errorResult('La liaison a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: parcours.id, actionType: 'link_question', oldValue: target.name, newValue: pedagogicalId,
  }).catch(function() {});

  return success('Question liée avec succès.', { competencies: updated });
}

/**
 * Retire une liaison entre une question et une competence.
 *
 * @param {object} parcours
 * @param {string} competencyId
 * @param {string} pedagogicalId
 * @returns {Promise<object>}
 */
export async function unlinkQuestionFromCompetency(parcours, competencyId, pedagogicalId) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!parcours || !parcours.id) return errorResult('Parcours cible introuvable.');

  const existing = Array.isArray(parcours.competencies) ? parcours.competencies : [];
  const target = existing.find(function(c) { return c.id === competencyId; });
  if (!target) return errorResult('Compétence introuvable.');

  const updated = existing.map(function(c) {
    if (c.id !== competencyId) return c;
    return Object.assign({}, c, { questionIds: c.questionIds.filter(function(id) { return id !== pedagogicalId; }) });
  });

  const result = await updateParcoursFields(parcours.id, { competencies: updated });
  if (!result.success) return errorResult('La suppression de la liaison a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logParcoursAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    parcoursId: parcours.id, actionType: 'unlink_question', oldValue: pedagogicalId, newValue: target.name,
  }).catch(function() {});

  return success('Liaison retirée avec succès.', { competencies: updated });
}

// ---------------------------------------------------------------------------
// Recherche de questions existantes a lier (REUTILISE question-catalog-service.js)
// ---------------------------------------------------------------------------

/**
 * Recherche des questions existantes pouvant etre liees a une competence.
 * REUTILISE directement js/services/question-catalog-service.js (Sprint
 * 10/11), sans dupliquer la moindre logique de recherche de questions -
 * exactement la consigne "reutiliser les services existants lorsque c'est
 * pertinent".
 *
 * @param {{searchText?:string, filters?:object}} options
 * @returns {Promise<object>}
 */
export async function searchQuestionsForLinking(options) {
  const access = checkAccess();
  if (access.status !== 'authorized') return { authorized: false, message: access.message, items: [] };

  const opts = options || {};
  const bounded = await searchQuestionsBounded({ filters: opts.filters || {}, sortField: 'createdAt', sortDirection: 'desc' });
  if (bounded.error) {
    return { authorized: true, error: true, message: 'Impossible de rechercher des questions pour le moment.', items: [] };
  }
  const needle = (opts.searchText || '').toString().trim().toLowerCase();
  const filtered = needle
    ? bounded.items.filter(function(q) {
        return (q.pedagogicalId && q.pedagogicalId.toLowerCase().indexOf(needle) !== -1)
          || (q.question && q.question.toLowerCase().indexOf(needle) !== -1);
      })
    : bounded.items;

  return { authorized: true, error: false, items: filtered.slice(0, 20), truncatedScan: bounded.truncated };
}

// ---------------------------------------------------------------------------
// Historique (timeline) - meme principe que getQuestionTimeline()
// ---------------------------------------------------------------------------

function describeParcoursAuditEntry(entry) {
  if (entry.actionType === 'creation') return 'Création';
  if (entry.actionType === 'status_change') {
    const key = entry.oldValue + '->' + entry.newValue;
    const LABELS = {
      'draft->review': 'Envoyé en relecture', 'draft->published': 'Publication',
      'review->published': 'Publication', 'archived->published': 'Publication',
      'published->archived': 'Archivage', 'review->archived': 'Archivage', 'draft->archived': 'Archivage',
      'archived->trash': 'Mise à la corbeille', 'trash->archived': 'Restauration depuis la corbeille',
      'archived->draft': 'Remise en brouillon', 'published->draft': 'Remise en brouillon', 'review->draft': 'Remise en brouillon',
      'archived->review': 'Envoyé en relecture',
    };
    return LABELS[key] || ('Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')');
  }
  if (entry.actionType === 'edit_name') return 'Modification du nom';
  if (entry.actionType === 'edit_description') return 'Modification de la description';
  if (entry.actionType === 'edit_targetAudience') return 'Modification du public cible';
  if (entry.actionType === 'edit_color') return 'Modification de la couleur';
  if (entry.actionType === 'edit_icon') return 'Modification de l\'icône';
  if (entry.actionType === 'add_competency') return 'Ajout d\'une compétence (' + entry.newValue + ')';
  if (entry.actionType === 'remove_competency') return 'Suppression d\'une compétence (' + entry.oldValue + ')';
  if (entry.actionType === 'reorder_competency') return 'Réordonnancement des compétences';
  if (entry.actionType === 'link_question') return 'Question liée à « ' + entry.oldValue + ' »';
  if (entry.actionType === 'unlink_question') return 'Liaison retirée de « ' + entry.newValue + ' »';
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return 'Action (' + entry.actionType + ')';
}

/**
 * @param {object} parcours
 * @returns {Promise<{authorized:boolean, message?:string, error?:boolean, items:Array<object>}>}
 */
export async function getParcoursTimeline(parcours) {
  const access = checkAccess();
  if (access.status !== 'authorized') {
    return { authorized: false, message: access.message, items: [] };
  }
  if (!parcours || !parcours.id) {
    return { authorized: true, error: false, items: [] };
  }

  const logsResult = await getRecentParcoursAuditLogs({ parcoursId: parcours.id, limit: 100 });
  const items = (logsResult.items || []).map(function(entry) {
    return { date: entry.date, label: describeParcoursAuditEntry(entry), adminEmail: entry.adminEmail || null };
  });

  if (parcours.createdAt && !items.some(function(i) { return i.label === 'Création'; })) {
    items.push({ date: parcours.createdAt, label: 'Création', adminEmail: parcours.author || null });
  }

  items.sort(function(a, b) { return new Date(a.date).getTime() - new Date(b.date).getTime(); });
  return { authorized: true, error: !!logsResult.error, items: items };
}
