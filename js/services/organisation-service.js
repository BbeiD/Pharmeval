// ===================== SERVICE DES ORGANISATIONS (ORCHESTRATION) — Sprint 13 =====================
// Point d'entree UNIQUE pour tout ce que fait l'ecran "Organisations"
// (admin/organisations.js) : navigation, creation, actions de gestion
// (changement de statut, suppression securisee, edition limitee), tableau
// de bord simule, et consultation de l'historique. Coordonne :
//   - js/services/organisation-catalog-service.js  (lecture/ecriture Firestore)
//   - js/services/organisation-audit-service.js     (journalisation systematique)
//   - js/services/organisation-metadata-service.js  (modele de donnees, defauts, validation)
//   - js/services/authorization-service.js          (controle d'acces : reserve aux administrateurs)
//
// Aucune logique metier dans l'interface : admin/organisations.js ne fait
// qu'appeler les fonctions ci-dessous et afficher le resultat.
//
// "Reutiliser exactement les composants deja developpes pour les Questions
// et les Parcours" (regle de developpement n°3) : ce fichier reprend
// fidelement la structure de parcours-service.js (Sprint 12), sans
// competences ni liaison de questions (une organisation n'en a pas) - la
// gestion de statut, la suppression securisee (Archive -> Corbeille ->
// Suppression definitive) et l'historique degrade gracieusement des la
// premiere version (la lecon du correctif Sprint 12 - index Firestore
// composite manquant - a directement ete appliquee ici, voir
// organisation-audit-service.js et firestore.indexes.json).

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import {
  ORGANISATION_STATUSES,
  completeOrganisationMetadata,
  validateOrganisationMetadata,
  simulateOrganisationStats,
} from "./organisation-metadata-service.js";
import {
  createOrganisationDocument,
  queryOrganisationsPage,
  searchOrganisationsBounded,
  updateOrganisationStatus,
  updateOrganisationFields,
  deleteOrganisationDocument,
  DEFAULT_ORGANISATIONS_PAGE_SIZE,
} from "./organisation-catalog-service.js";
import { logOrganisationAction, getRecentOrganisationAuditLogs } from "./organisation-audit-service.js";

const MIN_ORGANISATION_NAME_LENGTH = 3;

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
    return denied('Vous devez être connecté pour gérer les organisations.');
  }
  if (!hasPermission(PERMISSIONS.MANAGE_ORGANISATIONS)) {
    return denied('La gestion des organisations est réservée aux administrateurs.');
  }
  return { status: 'authorized' };
}

function matchesSearchText(o, searchText) {
  const needle = (searchText || '').toString().trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [o.id, o.name, o.description, o.type, o.author, o.country, o.primaryLanguage];
  return haystacks.some(function(h) {
    return h && h.toString().toLowerCase().indexOf(needle) !== -1;
  });
}

// ---------------------------------------------------------------------------
// Navigation (recherche, filtres, tri, pagination) - miroir de browseParcours()
// ---------------------------------------------------------------------------

export async function browseOrganisations(options) {
  const access = checkAccess();
  if (access.status !== 'authorized') {
    return { authorized: false, message: access.message };
  }

  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_ORGANISATIONS_PAGE_SIZE;

  if (opts.searchText && opts.searchText.trim()) {
    const bounded = await searchOrganisationsBounded({ filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection });
    if (bounded.error) {
      return { authorized: true, error: true, message: 'Impossible de charger les organisations pour le moment. Réessayez plus tard.' };
    }
    const filtered = bounded.items.filter(function(o) { return matchesSearchText(o, opts.searchText); });
    const page = opts.page || 0;
    const pageItems = filtered.slice(page * pageSize, (page + 1) * pageSize);
    return {
      authorized: true, error: false, searchMode: true,
      items: pageItems, totalMatched: filtered.length, page: page,
      hasMore: (page + 1) * pageSize < filtered.length,
      truncatedScan: bounded.truncated,
    };
  }

  const result = await queryOrganisationsPage({
    filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection,
    pageSize: pageSize, cursorDoc: opts.cursorDoc,
  });
  if (result.error) {
    return { authorized: true, error: true, message: 'Impossible de charger les organisations pour le moment. Réessayez plus tard.' };
  }
  return {
    authorized: true, error: false, searchMode: false,
    items: result.items, lastDoc: result.lastDoc, hasMore: result.hasMore,
  };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export async function createOrganisation(fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);

  const f = fields || {};
  if (!f.name || f.name.toString().trim().length < MIN_ORGANISATION_NAME_LENGTH) {
    return errorResult('Le nom de l\'organisation doit contenir au moins ' + MIN_ORGANISATION_NAME_LENGTH + ' caractères.');
  }

  const ctx = getCurrentUserContext();
  const now = new Date().toISOString();
  const metadata = completeOrganisationMetadata({
    name: f.name, description: f.description, type: f.type, logoUrl: f.logoUrl, color: f.color,
    country: f.country, primaryLanguage: f.primaryLanguage, timezone: f.timezone,
    status: ORGANISATION_STATUSES.DRAFT,
    createdAt: now, updatedAt: now,
    author: (ctx && ctx.email) || null,
  });

  const validation = validateOrganisationMetadata(metadata);
  if (!validation.valid) {
    return errorResult(validation.errors.join(' '));
  }

  const result = await createOrganisationDocument(metadata);
  if (!result.success) return errorResult('La création de l\'organisation a échoué. Veuillez réessayer.');

  logOrganisationAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    organisationId: metadata.id, actionType: 'creation', oldValue: null, newValue: metadata.name,
  }).catch(function() {});

  return success('Organisation créée avec succès.', { organisation: metadata });
}

// ---------------------------------------------------------------------------
// Transitions de statut (Publier / Archiver / Remettre en brouillon)
// ---------------------------------------------------------------------------

async function changeStatus(organisation, newStatus, actionLabel, disallowedFromStatuses) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!organisation || !organisation.id) return errorResult('Organisation cible introuvable.');
  if (organisation.status === newStatus) return denied('Cette organisation a déjà ce statut.');
  if (disallowedFromStatuses && disallowedFromStatuses.indexOf(organisation.status) !== -1) {
    return denied('Cette action n\'est pas disponible depuis le statut actuel de cette organisation.');
  }

  const result = await updateOrganisationStatus(organisation.id, newStatus);
  if (!result.success) return errorResult('La mise à jour du statut a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logOrganisationAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    organisationId: organisation.id, actionType: 'status_change',
    oldValue: organisation.status, newValue: newStatus,
  }).catch(function() {});

  return success(actionLabel + ' avec succès.');
}

export function publishOrganisation(organisation) {
  return changeStatus(organisation, ORGANISATION_STATUSES.PUBLISHED, 'Organisation publiée', [ORGANISATION_STATUSES.TRASH]);
}
export function archiveOrganisation(organisation) {
  return changeStatus(organisation, ORGANISATION_STATUSES.ARCHIVED, 'Organisation archivée', [ORGANISATION_STATUSES.TRASH]);
}
export function revertOrganisationToDraft(organisation) {
  return changeStatus(organisation, ORGANISATION_STATUSES.DRAFT, 'Organisation remise en brouillon', [ORGANISATION_STATUSES.TRASH]);
}

// ---------------------------------------------------------------------------
// Suppression securisee (workflow identique aux Parcours/Questions)
// ---------------------------------------------------------------------------

export async function moveOrganisationToTrash(organisation) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!organisation || !organisation.id) return errorResult('Organisation cible introuvable.');
  if (organisation.status !== ORGANISATION_STATUSES.ARCHIVED) {
    return denied('Seule une organisation archivée peut être mise à la corbeille.');
  }
  return changeStatus(organisation, ORGANISATION_STATUSES.TRASH, 'Organisation mise à la corbeille');
}

export async function restoreOrganisationFromTrash(organisation) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!organisation || !organisation.id) return errorResult('Organisation cible introuvable.');
  if (organisation.status !== ORGANISATION_STATUSES.TRASH) {
    return denied('Cette organisation n\'est pas à la corbeille.');
  }

  const result = await updateOrganisationStatus(organisation.id, ORGANISATION_STATUSES.ARCHIVED);
  if (!result.success) return errorResult('La restauration a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logOrganisationAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    organisationId: organisation.id, actionType: 'status_change',
    oldValue: ORGANISATION_STATUSES.TRASH, newValue: ORGANISATION_STATUSES.ARCHIVED,
  }).catch(function() {});

  return success('Organisation restaurée depuis la corbeille avec succès.');
}

export async function permanentlyDeleteOrganisation(organisation) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!hasPermission(PERMISSIONS.PURGE_ORGANISATIONS)) {
    return denied('La suppression définitive est réservée aux administrateurs.');
  }
  if (!organisation || !organisation.id) return errorResult('Organisation cible introuvable.');
  if (organisation.status !== ORGANISATION_STATUSES.TRASH) {
    return denied('Seule une organisation à la corbeille peut être supprimée définitivement.');
  }

  const result = await deleteOrganisationDocument(organisation.id);
  if (!result.success) return errorResult('La suppression définitive a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logOrganisationAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    organisationId: organisation.id, actionType: 'purge', oldValue: ORGANISATION_STATUSES.TRASH, newValue: null,
  }).catch(function() {});

  return success('Organisation supprimée définitivement.');
}

// ---------------------------------------------------------------------------
// Edition limitee
// ---------------------------------------------------------------------------

export async function editOrganisationMetadata(organisation, fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!organisation || !organisation.id) return errorResult('Organisation cible introuvable.');

  const f = fields || {};
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(f, 'name')) {
    const trimmed = (f.name || '').toString().trim();
    if (trimmed.length < MIN_ORGANISATION_NAME_LENGTH) {
      return errorResult('Le nom de l\'organisation doit contenir au moins ' + MIN_ORGANISATION_NAME_LENGTH + ' caractères.');
    }
    payload.name = trimmed;
  }
  if (Object.prototype.hasOwnProperty.call(f, 'description')) payload.description = (f.description || '').toString().trim();
  if (Object.prototype.hasOwnProperty.call(f, 'type')) payload.type = (f.type || '').toString().trim();
  if (Object.prototype.hasOwnProperty.call(f, 'logoUrl')) payload.logoUrl = (f.logoUrl || '').toString().trim() || null;
  if (Object.prototype.hasOwnProperty.call(f, 'country')) payload.country = (f.country || '').toString().trim() || null;
  if (Object.prototype.hasOwnProperty.call(f, 'primaryLanguage')) payload.primaryLanguage = (f.primaryLanguage || '').toString().trim() || null;
  if (Object.prototype.hasOwnProperty.call(f, 'timezone')) payload.timezone = (f.timezone || '').toString().trim() || null;

  if (Object.prototype.hasOwnProperty.call(f, 'color')) {
    const trimmedColor = (f.color || '').toString().trim() || null;
    // Meme discipline que le correctif Parcours v2.3.1, appliquee ici des
    // le debut : ne JAMAIS vider silencieusement la couleur - cette cle
    // n'est envoyee par admin/organisations.js QUE si l'administrateur a
    // reellement choisi une nouvelle couleur ou "aucune couleur".
    if (trimmedColor) {
      const validation = validateOrganisationMetadata(Object.assign({}, organisation, { color: trimmedColor, name: organisation.name || 'x' }));
      if (!validation.valid && validation.errors.some(function(e) { return e.indexOf('Couleur invalide') !== -1; })) {
        return errorResult('Couleur invalide : "' + trimmedColor + '".');
      }
    }
    payload.color = trimmedColor;
  }

  if (Object.keys(payload).length === 0) {
    return denied('Aucune modification à enregistrer.');
  }

  const result = await updateOrganisationFields(organisation.id, payload);
  if (!result.success) return errorResult('L\'enregistrement des modifications a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  Object.keys(payload).forEach(function(field) {
    logOrganisationAction({
      adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
      organisationId: organisation.id, actionType: 'edit_' + field,
      oldValue: organisation[field], newValue: payload[field],
    }).catch(function() {});
  });

  return success('Modifications enregistrées avec succès.');
}

// ---------------------------------------------------------------------------
// Tableau de bord (indicateurs simules)
// ---------------------------------------------------------------------------

export function getOrganisationDashboard(organisation) {
  const access = checkAccess();
  if (access.status !== 'authorized') return { authorized: false, message: access.message };
  if (!organisation || !organisation.id) return { authorized: true, stats: null };
  return { authorized: true, stats: simulateOrganisationStats(organisation.id), simulated: true };
}

// ---------------------------------------------------------------------------
// Historique (timeline) - degradation gracieuse DES LE DEPART
// ---------------------------------------------------------------------------

function describeOrganisationAuditEntry(entry) {
  if (entry.actionType === 'creation') return 'Création';
  if (entry.actionType === 'status_change') {
    const key = entry.oldValue + '->' + entry.newValue;
    const LABELS = {
      'draft->review': 'Envoyée en relecture', 'draft->published': 'Publication',
      'review->published': 'Publication', 'archived->published': 'Publication',
      'published->archived': 'Archivage', 'review->archived': 'Archivage', 'draft->archived': 'Archivage',
      'archived->trash': 'Mise à la corbeille', 'trash->archived': 'Restauration depuis la corbeille',
      'archived->draft': 'Remise en brouillon', 'published->draft': 'Remise en brouillon', 'review->draft': 'Remise en brouillon',
      'archived->review': 'Envoyée en relecture',
    };
    return LABELS[key] || ('Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')');
  }
  if (entry.actionType === 'edit_name') return 'Modification du nom';
  if (entry.actionType === 'edit_description') return 'Modification de la description';
  if (entry.actionType === 'edit_type') return 'Modification du type';
  if (entry.actionType === 'edit_logoUrl') return 'Modification du logo';
  if (entry.actionType === 'edit_color') return 'Modification de la couleur';
  if (entry.actionType === 'edit_country') return 'Modification du pays';
  if (entry.actionType === 'edit_primaryLanguage') return 'Modification de la langue principale';
  if (entry.actionType === 'edit_timezone') return 'Modification du fuseau horaire';
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return 'Action (' + entry.actionType + ')';
}

export async function getOrganisationTimeline(organisation) {
  const access = checkAccess();
  if (access.status !== 'authorized') {
    return { authorized: false, message: access.message, auditUnavailable: false, items: [] };
  }
  if (!organisation || !organisation.id) {
    return { authorized: true, auditUnavailable: false, items: [] };
  }

  const logsResult = await getRecentOrganisationAuditLogs({ organisationId: organisation.id, limit: 100 });

  const items = [];
  if (organisation.createdAt) {
    items.push({ date: organisation.createdAt, label: 'Création', adminEmail: organisation.author || null });
  }

  if (!logsResult.error) {
    (logsResult.items || []).forEach(function(entry) {
      if (entry.actionType === 'creation') return;
      items.push({ date: entry.date, label: describeOrganisationAuditEntry(entry), adminEmail: entry.adminEmail || null });
    });
  }

  items.sort(function(a, b) { return new Date(a.date).getTime() - new Date(b.date).getTime(); });

  return {
    authorized: true,
    auditUnavailable: !!logsResult.error,
    items: items,
  };
}
