// ===================== SERVICE DE LA BANQUE DE QUESTIONS (ORCHESTRATION) =====================
// Point d'entree UNIQUE pour tout ce que fait l'ecran "Banque de
// questions" (admin/bank.js) : navigation (recherche, filtres, tri,
// pagination), actions de gestion (changement de statut, suppression
// securisee, edition limitee), et consultation de l'historique d'une
// question. Coordonne :
//   - js/services/question-search-provider.js (recherche - abstraction, voir ce fichier)
//   - js/services/question-catalog-service.js  (lecture/ecriture Firestore hors recherche)
//   - js/services/question-audit-service.js     (journalisation systematique + lecture pour l'historique)
//   - js/services/authorization-service.js      (controle d'acces : reserve aux administrateurs)
//   - js/services/tag-service.js                (normalisation des tags a l'edition)
//
// Aucune logique metier dans l'interface : admin/bank.js ne fait
// qu'appeler les fonctions ci-dessous et afficher le resultat.
//
// CORRECTIF (avant validation du Sprint 11) :
//   1. Suppression securisee : Question -> Archivee -> Corbeille ->
//      Suppression definitive (administrateur uniquement, via la
//      permission dediee PURGE_QUESTIONS). Plus aucune suppression directe
//      depuis un autre statut.
//   2. Historique visuel : getQuestionTimeline() combine la creation/import
//      (deja present sur le document) et le journal d'audit
//      (question_audit_logs) en une chronologie lisible.
//   3. Recherche : passe desormais par question-search-provider.js (une
//      abstraction), plus par un appel direct a question-catalog-
//      service.js - prepare une future integration d'un moteur externe
//      sans devoir modifier ce fichier.

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { formatThemeLabel } from "./theme-utils.js";
import { normalizeTagList } from "./tag-service.js";
import { QUESTION_STATUSES } from "./question-metadata-service.js";
import {
  queryQuestionsPage,
  updateQuestionStatus,
  updateQuestionFields,
  deleteQuestionDocument,
  DEFAULT_BANK_PAGE_SIZE,
} from "./question-catalog-service.js";
import { searchQuestions as searchQuestionsViaProvider } from "./question-search-provider.js";
import { logQuestionAction, getRecentQuestionAuditLogs } from "./question-audit-service.js";

const MIN_EXPLANATION_LENGTH = 10;

function denied(message) {
  return { status: 'denied', message: message };
}
function success(message) {
  return { status: 'success', message: message };
}
function errorResult(message) {
  return { status: 'error', message: message };
}

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return denied('Vous devez être connecté pour gérer la banque de questions.');
  }
  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) {
    return denied('La gestion de la banque de questions est réservée aux administrateurs.');
  }
  return { status: 'authorized' };
}

/**
 * Une question correspond-elle a un texte de recherche libre ? Compare
 * l'identifiant pedagogique, l'enonce, le libelle humain du theme, le
 * sous-theme, la source et les tags - exactement les champs demandes par
 * le Sprint 11 ("identifiant pedagogique, question, theme, sous-theme,
 * tags, source scientifique").
 *
 * @param {object} q
 * @param {string} searchText
 * @returns {boolean}
 */
function matchesSearchText(q, searchText) {
  const needle = (searchText || '').toString().trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [
    q.pedagogicalId,
    q.question,
    formatThemeLabel(q.theme),
    q.theme,
    q.subtheme,
    q.source,
  ].concat(Array.isArray(q.tags) ? q.tags : []);
  return haystacks.some(function(h) {
    return h && h.toString().toLowerCase().indexOf(needle) !== -1;
  });
}

/**
 * Point d'entree principal de navigation dans la Banque de questions :
 * recherche, filtres, tri, pagination. Deux modes distincts :
 *   - SANS texte de recherche : vraie pagination Firestore par curseur,
 *     jamais un chargement complet de la collection (question-catalog-
 *     service.js, queryQuestionsPage).
 *   - AVEC texte de recherche : delegue a js/services/question-search-
 *     provider.js (abstraction - voir ce fichier pour le detail de la
 *     limite, desormais configurable plutot que figee, et de la
 *     preparation a un futur moteur de recherche externe).
 *
 * @param {{searchText?:string, filters?:object, sortField?:string, sortDirection?:string, pageSize?:number, cursorDoc?:object, page?:number}} options
 * @returns {Promise<object>}
 */
export async function browseQuestions(options) {
  const access = checkAccess();
  if (access.status !== 'authorized') {
    return { authorized: false, message: access.message };
  }

  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_BANK_PAGE_SIZE;

  if (opts.searchText && opts.searchText.trim()) {
    const bounded = await searchQuestionsViaProvider({
      filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection,
    });
    if (bounded.error) {
      return { authorized: true, error: true, message: 'Impossible de charger les questions pour le moment. Réessayez plus tard.' };
    }
    const filtered = bounded.items.filter(function(q) { return matchesSearchText(q, opts.searchText); });
    const page = opts.page || 0;
    const pageItems = filtered.slice(page * pageSize, (page + 1) * pageSize);
    return {
      authorized: true, error: false, searchMode: true,
      items: pageItems,
      totalMatched: filtered.length,
      page: page,
      hasMore: (page + 1) * pageSize < filtered.length,
      truncatedScan: bounded.truncated,
      searchProvider: bounded.provider,
      searchScanLimit: bounded.scanLimit,
    };
  }

  const result = await queryQuestionsPage({
    filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection,
    pageSize: pageSize, cursorDoc: opts.cursorDoc,
  });
  if (result.error) {
    return { authorized: true, error: true, message: 'Impossible de charger les questions pour le moment. Réessayez plus tard.' };
  }
  return {
    authorized: true, error: false, searchMode: false,
    items: result.items, lastDoc: result.lastDoc, hasMore: result.hasMore,
  };
}

// ---------------------------------------------------------------------------
// Transitions de statut (Publier / Archiver / Remettre en brouillon)
// ---------------------------------------------------------------------------

async function changeStatus(question, newStatus, actionLabel, disallowedFromStatuses) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!question || !question.pedagogicalId) return errorResult('Question cible introuvable.');
  if (question.status === newStatus) return denied('Cette question a déjà ce statut.');
  if (disallowedFromStatuses && disallowedFromStatuses.indexOf(question.status) !== -1) {
    return denied('Cette action n\'est pas disponible depuis le statut actuel de cette question.');
  }

  const result = await updateQuestionStatus(question.pedagogicalId, newStatus);
  if (!result.success) return errorResult('La mise à jour du statut a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logQuestionAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    pedagogicalId: question.pedagogicalId, actionType: 'status_change',
    oldValue: question.status, newValue: newStatus,
  }).catch(function() { /* deja journalise en console par question-audit-service.js */ });

  return success(actionLabel + ' avec succès.');
}

/** Fait passer une question au statut "published". Indisponible depuis la
 * corbeille : une question a la corbeille doit d'abord etre restauree. */
export function publishQuestion(question) {
  return changeStatus(question, QUESTION_STATUSES.PUBLISHED, 'Question publiée', [QUESTION_STATUSES.TRASH]);
}
/** Fait passer une question au statut "archived". Indisponible depuis la
 * corbeille (utiliser restoreQuestionFromTrash() pour repasser par
 * "archived" d'abord). */
export function archiveQuestion(question) {
  return changeStatus(question, QUESTION_STATUSES.ARCHIVED, 'Question archivée', [QUESTION_STATUSES.TRASH]);
}
/** Remet une question au statut "draft". Indisponible depuis la corbeille. */
export function revertQuestionToDraft(question) {
  return changeStatus(question, QUESTION_STATUSES.DRAFT, 'Question remise en brouillon', [QUESTION_STATUSES.TRASH]);
}

// ---------------------------------------------------------------------------
// CORRECTIF : suppression securisee (Question -> Archivee -> Corbeille -> Suppression definitive)
// ---------------------------------------------------------------------------

/**
 * Met une question ARCHIVEE a la corbeille. Premiere etape du workflow de
 * suppression securisee - n'est disponible QUE depuis le statut "archived"
 * (une question publiee, en brouillon ou en relecture doit d'abord etre
 * archivee).
 *
 * @param {object} question
 * @returns {Promise<object>}
 */
export async function moveQuestionToTrash(question) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!question || !question.pedagogicalId) return errorResult('Question cible introuvable.');
  if (question.status !== QUESTION_STATUSES.ARCHIVED) {
    return denied('Seule une question archivée peut être mise à la corbeille.');
  }
  return changeStatus(question, QUESTION_STATUSES.TRASH, 'Question mise à la corbeille');
}

/**
 * Restaure une question depuis la corbeille (retour au statut "archived").
 * Deuxieme etape du workflow, dans l'autre sens - une question restauree
 * n'est PAS republiee automatiquement, elle redevient simplement archivee,
 * a partir de laquelle toute autre transition redevient possible.
 *
 * @param {object} question
 * @returns {Promise<object>}
 */
export async function restoreQuestionFromTrash(question) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!question || !question.pedagogicalId) return errorResult('Question cible introuvable.');
  if (question.status !== QUESTION_STATUSES.TRASH) {
    return denied('Cette question n\'est pas à la corbeille.');
  }

  const result = await updateQuestionStatus(question.pedagogicalId, QUESTION_STATUSES.ARCHIVED);
  if (!result.success) return errorResult('La restauration a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logQuestionAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    pedagogicalId: question.pedagogicalId, actionType: 'status_change',
    oldValue: QUESTION_STATUSES.TRASH, newValue: QUESTION_STATUSES.ARCHIVED,
  }).catch(function() {});

  return success('Question restaurée depuis la corbeille avec succès.');
}

/**
 * Supprime DEFINITIVEMENT une question (suppression Firestore reelle,
 * irreversible). Derniere etape du workflow de suppression securisee :
 * n'est disponible QUE depuis la corbeille, ET reservee explicitement aux
 * administrateurs via la permission dediee PURGE_QUESTIONS (distincte de
 * MANAGE_QUESTIONS - voir authorization-service.js : un futur role EDITOR
 * pourra gerer/archiver/mettre a la corbeille des questions SANS jamais
 * pouvoir les purger definitivement).
 *
 * L'interface DOIT avoir deja obtenu une confirmation explicite avant
 * d'appeler cette fonction (voir admin/bank.js) - cette fonction elle-meme
 * ne redemande pas de confirmation, mais journalise systematiquement.
 *
 * @param {object} question
 * @returns {Promise<object>}
 */
export async function permanentlyDeleteQuestion(question) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!hasPermission(PERMISSIONS.PURGE_QUESTIONS)) {
    return denied('La suppression définitive est réservée aux administrateurs.');
  }
  if (!question || !question.pedagogicalId) return errorResult('Question cible introuvable.');
  if (question.status !== QUESTION_STATUSES.TRASH) {
    return denied('Seule une question à la corbeille peut être supprimée définitivement.');
  }

  const result = await deleteQuestionDocument(question.pedagogicalId);
  if (!result.success) return errorResult('La suppression définitive a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  logQuestionAction({
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    pedagogicalId: question.pedagogicalId, actionType: 'purge',
    oldValue: QUESTION_STATUSES.TRASH, newValue: null,
  }).catch(function() {});

  return success('Question supprimée définitivement.');
}

// ---------------------------------------------------------------------------
// Edition limitee (explication / tags / source)
// ---------------------------------------------------------------------------

/**
 * Modifie UNIQUEMENT les champs editables limites de ce sprint
 * (explication, tags, source - voir "Aucune edition complete"). Valide et
 * normalise avant d'ecrire ; journalise l'ancienne et la nouvelle valeur
 * de chaque champ reellement modifie.
 *
 * @param {object} question - la question actuelle (avant modification)
 * @param {{explanation?:string, tags?:Array<string>, source?:string}} fields
 * @returns {Promise<object>}
 */
export async function editQuestionMetadata(question, fields) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!question || !question.pedagogicalId) return errorResult('Question cible introuvable.');

  const f = fields || {};
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(f, 'explanation')) {
    const trimmed = (f.explanation || '').toString().trim();
    if (trimmed.length < MIN_EXPLANATION_LENGTH) {
      return errorResult('L\'explication doit contenir au moins ' + MIN_EXPLANATION_LENGTH + ' caractères.');
    }
    payload.explanation = trimmed;
  }
  if (Object.prototype.hasOwnProperty.call(f, 'tags')) {
    payload.tags = normalizeTagList(f.tags);
  }
  if (Object.prototype.hasOwnProperty.call(f, 'source')) {
    payload.source = (f.source || '').toString().trim() || null;
  }

  if (Object.keys(payload).length === 0) {
    return denied('Aucune modification à enregistrer.');
  }

  const result = await updateQuestionFields(question.pedagogicalId, payload);
  if (!result.success) return errorResult('L\'enregistrement des modifications a échoué. Veuillez réessayer.');

  const ctx = getCurrentUserContext();
  Object.keys(payload).forEach(function(field) {
    logQuestionAction({
      adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
      pedagogicalId: question.pedagogicalId, actionType: 'edit_' + field,
      oldValue: question[field], newValue: payload[field],
    }).catch(function() {});
  });

  return success('Modifications enregistrées avec succès.');
}

// ---------------------------------------------------------------------------
// CORRECTIF : historique visuel (timeline) - consultable depuis la fiche
// ---------------------------------------------------------------------------

/**
 * Traduit une entree du journal d'audit en libelle humain pour la
 * chronologie. Centralise ici pour ne jamais dupliquer cette traduction
 * ailleurs (ex. si un futur ecran dedie au journal est construit).
 *
 * @param {object} entry - une entree de question_audit_logs
 * @returns {string}
 */
function describeAuditEntry(entry) {
  if (entry.actionType === 'status_change') {
    const key = entry.oldValue + '->' + entry.newValue;
    const STATUS_TRANSITION_LABELS = {
      'draft->review': 'Envoyée en relecture',
      'draft->published': 'Publication',
      'review->published': 'Publication',
      'archived->published': 'Publication',
      'published->archived': 'Archivage',
      'review->archived': 'Archivage',
      'draft->archived': 'Archivage',
      'archived->trash': 'Mise à la corbeille',
      'trash->archived': 'Restauration depuis la corbeille',
      'archived->draft': 'Remise en brouillon',
      'published->draft': 'Remise en brouillon',
      'review->draft': 'Remise en brouillon',
      'archived->review': 'Envoyée en relecture',
    };
    return STATUS_TRANSITION_LABELS[key] || ('Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')');
  }
  if (entry.actionType === 'edit_explanation') return 'Modification de l\'explication';
  if (entry.actionType === 'edit_tags') return 'Modification des tags';
  if (entry.actionType === 'edit_source') return 'Modification de la source';
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return 'Action (' + entry.actionType + ')';
}

/**
 * Construit la chronologie complete d'une question : creation/import
 * (deja presente sur le document lui-meme, aucune lecture Firestore
 * supplementaire necessaire pour cette partie) + toutes les actions
 * journalisees (question_audit_logs), triees chronologiquement. Consultee
 * directement depuis la fiche de la question, sans quitter l'ecran (voir
 * admin/bank.js).
 *
 * @param {object} question
 * @returns {Promise<{authorized:boolean, message?:string, error?:boolean, items:Array<object>}>}
 */
export async function getQuestionTimeline(question) {
  const access = checkAccess();
  if (access.status !== 'authorized') {
    return { authorized: false, message: access.message, items: [] };
  }
  if (!question || !question.pedagogicalId) {
    return { authorized: true, error: false, items: [] };
  }

  const logsResult = await getRecentQuestionAuditLogs({ pedagogicalId: question.pedagogicalId, limit: 100 });

  const items = (logsResult.items || []).map(function(entry) {
    return {
      date: entry.date,
      label: describeAuditEntry(entry),
      adminEmail: entry.adminEmail || null,
    };
  });

  if (question.createdAt) {
    items.push({
      date: question.createdAt,
      label: question.importMeta ? 'Import (création)' : 'Création',
      adminEmail: (question.importMeta && question.importMeta.importedByEmail) || question.author || null,
      detail: question.importMeta ? ('Fichier : ' + (question.importMeta.sourceFile || '—')) : null,
    });
  }

  items.sort(function(a, b) { return new Date(a.date).getTime() - new Date(b.date).getTime(); });

  return { authorized: true, error: !!logsResult.error, items: items };
}
