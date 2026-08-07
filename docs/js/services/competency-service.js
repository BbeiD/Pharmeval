// ===================== SERVICE DE LA BANQUE DES COMPETENCES (ORCHESTRATION) — Sprint 13 =====================
// Point d'entree UNIQUE pour tout ce que fait l'ecran "Banque des
// compétences" (admin/competencies.js) : navigation, creation, actions de
// gestion (changement de statut, suppression securisee, edition), et
// consultation de l'historique. Coordonne :
//   - js/services/competency-catalog-service.js (lecture/ecriture Firestore)
//   - js/services/competency-audit-service.js    (journalisation systematique)
//   - js/services/competency-metadata-service.js (modele de donnees, defauts, validation)
//   - js/services/authorization-service.js       (controle d'acces : reserve aux administrateurs)
//   - js/services/parcours-catalog-service.js     (REUTILISE - mesure de reutilisation d'une competence dans les parcours)
//
// Aucune logique metier dans l'interface : admin/competencies.js ne fait
// qu'appeler les fonctions ci-dessous et afficher le resultat. Miroir
// volontaire de parcours-service.js (Sprint 12), applique a ce nouveau
// type de contenu independant.

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import {
  COMPETENCY_STATUSES,
  COMPETENCY_COLORS,
  COMPETENCY_LEVELS,
  completeCompetencyMetadata,
  validateCompetencyMetadata,
} from "./competency-metadata-service.js";
import {
  createCompetencyDocument,
  getCompetencyById,
  queryCompetenciesPage,
  searchCompetenciesBounded,
  updateCompetencyStatus,
  updateCompetencyFields,
  deleteCompetencyDocument,
  publishAllDraftCompetencies as publishAllDraftCompetenciesInCatalog,
  DEFAULT_COMPETENCY_PAGE_SIZE,
} from "./competency-catalog-service.js";
import { logCompetencyAction, getRecentCompetencyAuditLogs } from "./competency-audit-service.js";
import { searchParcoursBounded } from "./parcours-catalog-service.js";

const MIN_COMPETENCY_NAME_LENGTH = 3;

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
    return denied('Vous devez être connecté pour gérer la banque des compétences.');
  }
  if (!hasPermission(PERMISSIONS.MANAGE_COMPETENCIES)) {
    return denied('La gestion de la banque des compétences est réservée aux administrateurs.');
  }
  return { status: 'authorized' };
}

function matchesSearchText(c, searchText) {
  const needle = (searchText || '').toString().trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [c.id, c.name, c.description, c.category, c.author].concat(c.keywords || []);
  return haystacks.some(function(h) {
    return h && h.toString().toLowerCase().indexOf(needle) !== -1;
  });
}

// ---------------------------------------------------------------------------
// Navigation (recherche, filtres, tri, pagination) - miroir de browseParcours()
// ---------------------------------------------------------------------------

/**
 * @param {{searchText?:string, filters?:object, sortField?:string, sortDirection?:string, pageSize?:number, cursorDoc?:object, page?:number}} options
 * @returns {Promise<object>}
 */
export async function browseCompetencies(options) {
  const access = checkAccess();
  if (access.status !== 'authorized') {
    return { authorized: false, message: access.message };
  }

  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_COMPETENCY_PAGE_SIZE;

  if (opts.searchText && opts.searchText.trim()) {
    const bounded = await searchCompetenciesBounded({ filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection });
    if (bounded.error) {
      return { authorized: true, error: true, message: 'Impossible de charger la banque des compétences pour le moment. Réessayez plus tard.' };
    }
    const filtered = bounded.items.filter(function(c) { return matchesSearchText(c, opts.searchText); });
    const page = opts.page || 0;
    const pageItems = filtered.slice(page * pageSize, (page + 1) * pageSize);
    return {
      authorized: true, error: false, searchMode: true,
      items: pageItems, totalMatched: filtered.length, page: page,
      hasMore: (page + 1) * pageSize < filtered.length,
      truncatedScan: bounded.truncated,
    };
  }

  const result = await queryCompetenciesPage({
    filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection,
    pageSize: pageSize, cursorDoc: opts.cursorDoc,
  });
  if (result.error) {
    return { authorized: true, error: true, message: 'Impossible de charger la banque des compétences pour le moment. Réessayez plus tard.' };
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
 * Cree une nouvelle fiche de competence. Toujours en statut "draft" -
 * jamais publiee automatiquement (meme principe que parcours/questions).
 * @param {{name:string, description?:string, color?:string, category?:string, keywords?:Array<string>, recommendedLevel?:string}} fields
 * @returns {Promise<object>}
 */
export async function createCompetency(fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);

  const f = fields || {};
  if (!f.name || f.name.toString().trim().length < MIN_COMPETENCY_NAME_LENGTH) {
    return errorResult('Le nom de la compétence doit contenir au moins ' + MIN_COMPETENCY_NAME_LENGTH + ' caractères.');
  }

  const ctx = getCurrentUserContext();
  const now = new Date().toISOString();
  const metadata = completeCompetencyMetadata({
    name: f.name, description: f.description, color: f.color, category: f.category,
    keywords: f.keywords, recommendedLevel: f.recommendedLevel,
    status: COMPETENCY_STATUSES.DRAFT,
    createdAt: now, updatedAt: now,
    author: (ctx && ctx.email) || null,
  });

  const validation = validateCompetencyMetadata(metadata);
  if (!validation.valid) {
    return errorResult(validation.errors.join(' '));
  }

  const result = await createCompetencyDocument(metadata);
  if (!result.success) return errorResult('La création de la compétence a échoué. Veuillez réessayer.');

  logCompetencyAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    competencyId: metadata.id, actionType: 'creation', oldValue: null, newValue: metadata.name,
  }).catch(function() {});

  return success('Compétence créée avec succès.', { competency: metadata });
}

// ---------------------------------------------------------------------------
// Transitions de statut
// ---------------------------------------------------------------------------

async function changeStatus(competency, newStatus, actionLabel, disallowedFromStatuses) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!competency || !competency.id) return errorResult('Compétence cible introuvable.');
  if (competency.status === newStatus) return denied('Cette compétence a déjà ce statut.');
  if (disallowedFromStatuses && disallowedFromStatuses.indexOf(competency.status) !== -1) {
    return denied('Cette action n\'est pas disponible depuis le statut actuel de cette compétence.');
  }

  const result = await updateCompetencyStatus(competency.id, newStatus);
  if (!result.success) return errorResult('La mise à jour du statut a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logCompetencyAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    competencyId: competency.id, actionType: 'status_change',
    oldValue: competency.status, newValue: newStatus,
  }).catch(function() {});

  return success(actionLabel + ' avec succès.');
}

/** Publie une compétence. Indisponible depuis la corbeille. */
export function publishCompetency(competency) {
  return changeStatus(competency, COMPETENCY_STATUSES.PUBLISHED, 'Compétence publiée', [COMPETENCY_STATUSES.TRASH]);
}
/** Archive une compétence. Indisponible depuis la corbeille. */
export function archiveCompetency(competency) {
  return changeStatus(competency, COMPETENCY_STATUSES.ARCHIVED, 'Compétence archivée', [COMPETENCY_STATUSES.TRASH]);
}
/** Remet une compétence en brouillon. Indisponible depuis la corbeille. */
export function revertCompetencyToDraft(competency) {
  return changeStatus(competency, COMPETENCY_STATUSES.DRAFT, 'Compétence remise en brouillon', [COMPETENCY_STATUSES.TRASH]);
}

// ---------------------------------------------------------------------------
// Suppression securisee (workflow identique aux parcours/questions)
// ---------------------------------------------------------------------------

/**
 * "Supprime" une competence (masquage non destructif) : l'envoie a la
 * corbeille depuis N'IMPORTE QUEL statut de depart (brouillon/publiee/
 * archivee) - plus seulement "archivee" comme l'exigeait le workflow
 * d'origine. CORRECTIF (bouton "Supprimer" unique, un seul clic) :
 * firestore.rules n'autorise la transition vers "trash" que depuis
 * "archived" (regle dediee, volontairement conservee inchangee - jamais
 * assouplie pour tout le monde) - cette fonction chaine donc elle-meme un
 * passage par "archived" quand necessaire, plutot que d'toucher a cette
 * regle de securite.
 * @param {object} competency
 * @returns {Promise<object>}
 */
export async function moveCompetencyToTrash(competency) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!competency || !competency.id) return errorResult('Compétence cible introuvable.');
  if (competency.status === COMPETENCY_STATUSES.TRASH) return denied('Cette compétence est déjà à la corbeille.');

  let current = competency;
  if (current.status !== COMPETENCY_STATUSES.ARCHIVED) {
    const archiveResult = await changeStatus(current, COMPETENCY_STATUSES.ARCHIVED, 'Compétence archivée');
    if (archiveResult.status !== 'success') return archiveResult;
    current = Object.assign({}, current, { status: COMPETENCY_STATUSES.ARCHIVED });
  }
  return changeStatus(current, COMPETENCY_STATUSES.TRASH, 'Compétence supprimée');
}

/**
 * Publie EN MASSE toutes les compétences en brouillon (bouton dedie de
 * l'ecran, apres confirmation explicite cote interface).
 * @returns {Promise<object>}
 */
export async function publishAllDraftCompetencies() {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);

  const result = await publishAllDraftCompetenciesInCatalog();
  if (result.error) return errorResult('La publication en masse a échoué. Veuillez réessayer.');
  if (result.publishedCount === 0) return denied('Aucune compétence en brouillon à publier.');

  const ctx = getCurrentUserContext();
  logCompetencyAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    competencyId: null, actionType: 'bulk_publish',
    oldValue: 'draft', newValue: 'published (' + result.publishedCount + ' compétence(s))',
  }).catch(function() {});

  return success(result.publishedCount + ' compétence(s) publiée(s) avec succès.');
}

/**
 * Restaure une competence depuis la corbeille (retour a "archived").
 * @param {object} competency
 * @returns {Promise<object>}
 */
export async function restoreCompetencyFromTrash(competency) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!competency || !competency.id) return errorResult('Compétence cible introuvable.');
  if (competency.status !== COMPETENCY_STATUSES.TRASH) {
    return denied('Cette compétence n\'est pas à la corbeille.');
  }

  const result = await updateCompetencyStatus(competency.id, COMPETENCY_STATUSES.ARCHIVED);
  if (!result.success) return errorResult('La restauration a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logCompetencyAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    competencyId: competency.id, actionType: 'status_change',
    oldValue: COMPETENCY_STATUSES.TRASH, newValue: COMPETENCY_STATUSES.ARCHIVED,
  }).catch(function() {});

  return success('Compétence restaurée depuis la corbeille avec succès.');
}

/**
 * Compte combien de parcours referencent encore cette competence (par
 * `competencyId` dans leur tableau `competencies`). REUTILISE
 * searchParcoursBounded() (parcours-catalog-service.js) plutot que de
 * dupliquer une lecture Firestore - balayage borne, meme limite honnete
 * que la recherche de parcours.
 * @param {string} competencyId
 * @returns {Promise<{count:number, truncated:boolean, error:boolean}>}
 */
export async function countCompetencyUsage(competencyId) {
  const bounded = await searchParcoursBounded({});
  if (bounded.error) return { count: 0, truncated: false, error: true };
  const count = bounded.items.reduce(function(acc, p) {
    const list = Array.isArray(p.competencies) ? p.competencies : [];
    return acc + (list.some(function(c) { return c.competencyId === competencyId; }) ? 1 : 0);
  }, 0);
  return { count: count, truncated: bounded.truncated, error: false };
}

/**
 * Supprime DEFINITIVEMENT une fiche de competence. Uniquement depuis
 * "trash", et reservee a la permission dediee PURGE_COMPETENCIES. Avertit
 * (sans jamais bloquer techniquement - la decision reste a l'administrateur)
 * si la competence est encore referencee par au moins un parcours : voir
 * `usageWarning` dans le resultat, a afficher AVANT confirmation par
 * admin/competencies.js.
 * @param {object} competency
 * @returns {Promise<object>}
 */
export async function permanentlyDeleteCompetency(competency) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!hasPermission(PERMISSIONS.PURGE_COMPETENCIES)) {
    return denied('La suppression définitive est réservée aux administrateurs.');
  }
  if (!competency || !competency.id) return errorResult('Compétence cible introuvable.');
  if (competency.status !== COMPETENCY_STATUSES.TRASH) {
    return denied('Seule une compétence à la corbeille peut être supprimée définitivement.');
  }

  const result = await deleteCompetencyDocument(competency.id);
  if (!result.success) return errorResult('La suppression définitive a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logCompetencyAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    competencyId: competency.id, actionType: 'purge', oldValue: COMPETENCY_STATUSES.TRASH, newValue: null,
  }).catch(function() {});

  return success('Compétence supprimée définitivement.');
}

// ---------------------------------------------------------------------------
// Edition
// ---------------------------------------------------------------------------

/**
 * @param {object} competency
 * @param {{name?:string, description?:string, color?:string, category?:string, keywords?:Array<string>, recommendedLevel?:string}} fields
 * @returns {Promise<object>}
 */
export async function editCompetencyMetadata(competency, fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!competency || !competency.id) return errorResult('Compétence cible introuvable.');

  const f = fields || {};
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(f, 'name')) {
    const trimmed = (f.name || '').toString().trim();
    if (trimmed.length < MIN_COMPETENCY_NAME_LENGTH) {
      return errorResult('Le nom de la compétence doit contenir au moins ' + MIN_COMPETENCY_NAME_LENGTH + ' caractères.');
    }
    payload.name = trimmed;
  }
  if (Object.prototype.hasOwnProperty.call(f, 'description')) payload.description = (f.description || '').toString().trim();
  if (Object.prototype.hasOwnProperty.call(f, 'category')) payload.category = (f.category || '').toString().trim();
  if (Object.prototype.hasOwnProperty.call(f, 'keywords')) payload.keywords = Array.isArray(f.keywords) ? f.keywords : [];
  if (Object.prototype.hasOwnProperty.call(f, 'color')) {
    const trimmedColor = (f.color || '').toString().trim() || null;
    if (trimmedColor && Object.values(COMPETENCY_COLORS).indexOf(trimmedColor) === -1) {
      return errorResult('Couleur invalide : "' + trimmedColor + '" (attendu : ' + Object.values(COMPETENCY_COLORS).join(', ') + ', ou aucune).');
    }
    payload.color = trimmedColor;
  }
  if (Object.prototype.hasOwnProperty.call(f, 'recommendedLevel')) {
    const trimmedLevel = (f.recommendedLevel || '').toString().trim() || null;
    if (trimmedLevel && Object.values(COMPETENCY_LEVELS).indexOf(trimmedLevel) === -1) {
      return errorResult('Niveau conseillé invalide : "' + trimmedLevel + '".');
    }
    payload.recommendedLevel = trimmedLevel;
  }

  if (Object.keys(payload).length === 0) {
    return denied('Aucune modification à enregistrer.');
  }

  const result = await updateCompetencyFields(competency.id, payload);
  if (!result.success) return errorResult('L\'enregistrement des modifications a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  Object.keys(payload).forEach(function(field) {
    logCompetencyAction({
      adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
      competencyId: competency.id, actionType: 'edit_' + field,
      oldValue: competency[field], newValue: payload[field],
    }).catch(function() {});
  });

  // NOTE IMPORTANTE (Sprint 13, "Réutilisation") : aucune propagation
  // manuelle n'est necessaire ici. Un parcours ne stocke JAMAIS de copie du
  // nom/de la description/de la couleur d'une competence liee - il ne
  // stocke que `competencyId` (voir parcours-metadata-service.js). Toute
  // lecture ulterieure (admin/parcours.js) relit la fiche a jour depuis
  // cette meme collection `competencies` : la modification est donc DEJA
  // "repercutee automatiquement partout" par construction, sans etape
  // supplementaire.
  return success('Modifications enregistrées avec succès.');
}

/**
 * Relit une competence a jour (utilise par admin/parcours.js pour
 * resoudre l'affichage d'une competence liee).
 * @param {string} competencyId
 * @returns {Promise<object|null>}
 */
export async function getCompetencyForDisplay(competencyId) {
  return getCompetencyById(competencyId);
}

// ---------------------------------------------------------------------------
// Historique (timeline)
// ---------------------------------------------------------------------------

function describeCompetencyAuditEntry(entry) {
  if (entry.actionType === 'creation') return 'Création';
  if (entry.actionType === 'status_change') {
    const key = entry.oldValue + '->' + entry.newValue;
    const LABELS = {
      'draft->published': 'Publication', 'archived->published': 'Publication',
      'published->archived': 'Archivage', 'draft->archived': 'Archivage',
      'archived->trash': 'Mise à la corbeille', 'trash->archived': 'Restauration depuis la corbeille',
      'archived->draft': 'Remise en brouillon', 'published->draft': 'Remise en brouillon',
    };
    return LABELS[key] || ('Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')');
  }
  if (entry.actionType === 'edit_name') return 'Modification du nom';
  if (entry.actionType === 'edit_description') return 'Modification de la description';
  if (entry.actionType === 'edit_category') return 'Modification de la catégorie';
  if (entry.actionType === 'edit_color') return 'Modification de la couleur';
  if (entry.actionType === 'edit_keywords') return 'Modification des mots-clés';
  if (entry.actionType === 'edit_recommendedLevel') return 'Modification du niveau conseillé';
  if (entry.actionType === 'migration_import') return 'Créée automatiquement lors de la migration (Sprint 13)';
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return 'Action (' + entry.actionType + ')';
}

/**
 * @param {object} competency
 * @returns {Promise<{authorized:boolean, message?:string, auditUnavailable:boolean, items:Array<object>}>}
 */
export async function getCompetencyTimeline(competency) {
  const access = checkAccess();
  if (access.status !== 'authorized') {
    return { authorized: false, message: access.message, auditUnavailable: false, items: [] };
  }
  if (!competency || !competency.id) {
    return { authorized: true, auditUnavailable: false, items: [] };
  }

  const logsResult = await getRecentCompetencyAuditLogs({ competencyId: competency.id, limit: 100 });

  const items = [];
  // Toujours calculable depuis le document lui-meme - jamais tributaire de
  // la disponibilite du journal d'audit (meme correctif que les parcours,
  // NOTE_CORRECTIF_SPRINT12.md, applique des l'origine ici).
  if (competency.createdAt) {
    items.push({ date: competency.createdAt, label: 'Création', adminEmail: competency.author || null });
  }

  if (!logsResult.error) {
    (logsResult.items || []).forEach(function(entry) {
      if (entry.actionType === 'creation') return; // deja ajoutee ci-dessus depuis le document
      items.push({ date: entry.date, label: describeCompetencyAuditEntry(entry), adminEmail: entry.adminEmail || null });
    });
  }

  items.sort(function(a, b) { return new Date(a.date).getTime() - new Date(b.date).getTime(); });

  return {
    authorized: true,
    auditUnavailable: !!logsResult.error,
    items: items,
  };
}
