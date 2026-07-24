// ===================== SERVICE GENERIQUE DE "BANQUE DE REFERENCE" (Sprint 14) =====================
// Sprint 13 a introduit la Banque des compétences (competency-metadata-
// service.js + competency-catalog-service.js + competency-audit-service.js
// + competency-service.js : 4 fichiers) et Sprint 12 le meme schema pour
// les Parcours. Le Sprint 14 a besoin d'EXACTEMENT la meme forme d'objet
// (id stable prefixe, nom, description, statut, auteur, dates) pour TROIS
// nouveaux types de contenu independants : Organisations, Profils, Groupes.
//
// DECISION D'ARCHITECTURE (Sprint 14, "ne jamais privilegier une solution
// rapide si une architecture plus robuste evite une refonte") : plutot que
// de tripler le pattern competency-*-service.js (12 fichiers quasi
// identiques), ce fichier factorise UNE SEULE FOIS le modele de donnees, la
// validation, le CRUD Firestore, le workflow de suppression securisee et
// l'audit - parametres par collection. Chaque banque concrete
// (organizations-bank-service.js, profiles-bank-service.js,
// groups-bank-service.js) se contente d'appeler createReferenceBankService()
// avec sa configuration propre (nom de collection, prefixe d'identifiant,
// permissions). Un futur type de contenu structurellement identique (ex.
// "Certifications", "Niveaux") pourra reutiliser cette meme factory sans
// dupliquer a nouveau ce code.
//
// Toute la journalisation d'audit des trois banques partage UNE SEULE
// collection Firestore `reference_bank_audit_logs` (champ `bankType`
// distinguant organization/profile/group) plutot que trois collections
// quasi vides - meme principe de factorisation.

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { db, auth } from "../firebase-config.js";
import {
  doc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, query, where, orderBy, limit, startAfter, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

export const REFERENCE_BANK_STATUSES = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  TRASH: 'trash',
});

const AUDIT_COLLECTION = 'reference_bank_audit_logs';
const DEFAULT_PAGE_SIZE = 25;

function randomIdSuffix() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Construit un service complet de gestion pour UNE banque de reference.
 *
 * @param {{
 *   bankType:string,            // identifiant technique court (ex. "organization"), utilise dans le journal d'audit partage
 *   collectionName:string,      // nom de la collection Firestore dediee (ex. "organizations")
 *   idPrefix:string,            // prefixe de l'identifiant stable (ex. "ORG")
 *   managePermission:string,    // permission requise pour lire/creer/editer (voir authorization-service.js)
 *   purgePermission:string,     // permission requise pour la suppression definitive
 *   labelSingular:string,       // libelle humain, pour des messages generiques ("compétence", "organisation"...)
 *   extraFields?:Array<string>, // noms de champs additionnels propres a cette banque (ex. "organizationType"), lus/ecrits tels quels sans validation dediee
 * }} config
 */
export function createReferenceBankService(config) {
  const {
    bankType, collectionName, idPrefix, managePermission, purgePermission, labelSingular,
    extraFields = [],
  } = config;

  function generateId() {
    return idPrefix + '-' + randomIdSuffix();
  }

  /**
   * Complete une entree partielle avec des defauts surs. Jamais de donnee
   * inventee : les champs manquants restent vides plutot que remplaces par
   * un texte de substitution.
   */
  function completeMetadata(partial) {
    const p = partial || {};
    const base = {
      id: p.id || generateId(),
      name: (p.name || '').toString().trim(),
      description: (p.description || '').toString().trim(),
      status: p.status || REFERENCE_BANK_STATUSES.DRAFT,
      author: p.author || null,
      createdAt: p.createdAt || null,
      updatedAt: p.updatedAt || null,
    };
    extraFields.forEach(function(key) { base[key] = (p[key] !== undefined) ? p[key] : ''; });
    return base;
  }

  function validateMetadata(metadata) {
    const errors = [];
    const m = metadata || {};
    if (Object.values(REFERENCE_BANK_STATUSES).indexOf(m.status) === -1) {
      errors.push('Statut invalide.');
    }
    if (!m.name || m.name.toString().trim().length < 2) {
      errors.push('Le nom doit contenir au moins 2 caractères.');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // -------------------------------------------------------------------
  // Acces / Firestore
  // -------------------------------------------------------------------

  function logCatalogError(context, err) {
    console.error('[reference-bank-service:' + collectionName + '] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
  }

  function checkAccess(requirePurge) {
    const ctx = getCurrentUserContext();
    if (!ctx || !ctx.uid) return { status: 'denied', message: 'Vous devez être connecté pour effectuer cette action.' };
    const perm = requirePurge ? purgePermission : managePermission;
    if (!hasPermission(perm)) return { status: 'denied', message: 'Cette action est réservée aux administrateurs.' };
    return { status: 'authorized' };
  }

  async function logAction(entityId, actionType, oldValue, newValue) {
    const ctx = getCurrentUserContext();
    try {
      await addDoc(collection(db, AUDIT_COLLECTION), {
        date: new Date().toISOString(),
        bankType: bankType,
        entityId: entityId,
        adminUid: (ctx && ctx.uid) || null,
        adminEmail: (ctx && ctx.email) || '',
        actionType: actionType,
        oldValue: (oldValue !== undefined && oldValue !== null) ? String(oldValue) : '',
        newValue: (newValue !== undefined && newValue !== null) ? String(newValue) : '',
      });
    } catch (err) {
      logCatalogError('journalisation de l\'action "' + actionType + '"', err);
    }
  }

  async function getById(id) {
    try {
      const map = await getByIds([id]);
      return map[id] || null;
    } catch (err) {
      logCatalogError('lecture de ' + id, err);
      return null;
    }
  }

  async function getByIds(ids) {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (unique.length === 0) return {};
    try {
      if (!auth.currentUser) return {};
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/reference-bank/${bankType}?ids=${unique.map(encodeURIComponent).join(',')}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        logCatalogError('lecture groupée (API ' + res.status + ')', null);
        return {};
      }
      return await res.json();
    } catch (err) {
      logCatalogError('lecture groupée', err);
      return {};
    }
  }

  function buildFilterClauses(filters) {
    const clauses = [];
    const f = filters || {};
    if (f.status) clauses.push(where('status', '==', f.status));
    return clauses;
  }

  async function queryPage(options) {
    const opts = options || {};
    const pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
    try {
      const clauses = buildFilterClauses(opts.filters);
      clauses.push(orderBy(opts.sortField || 'createdAt', opts.sortDirection || 'desc'));
      clauses.push(limit(pageSize));
      if (opts.cursorDoc) clauses.push(startAfter(opts.cursorDoc));
      const snap = await getDocs(query(collection(db, collectionName), ...clauses));
      const items = []; let lastDoc = null;
      snap.forEach(function(d) { items.push(d.data()); lastDoc = d; });
      return { items: items, lastDoc: lastDoc, hasMore: items.length === pageSize, error: false };
    } catch (err) {
      logCatalogError('chargement d\'une page', err);
      return { items: [], lastDoc: null, hasMore: false, error: true };
    }
  }

  async function searchBounded(options) {
    const opts = options || {};
    const scanLimit = opts.maxScan || 500;
    try {
      const clauses = buildFilterClauses(opts.filters);
      clauses.push(orderBy(opts.sortField || 'createdAt', opts.sortDirection || 'desc'));
      clauses.push(limit(scanLimit + 1));
      const snap = await getDocs(query(collection(db, collectionName), ...clauses));
      const all = []; snap.forEach(function(d) { all.push(d.data()); });
      return { items: all.slice(0, scanLimit), truncated: all.length > scanLimit, error: false };
    } catch (err) {
      logCatalogError('recherche', err);
      return { items: [], truncated: false, error: true };
    }
  }

  function matchesSearchText(item, searchText) {
    const needle = (searchText || '').toString().trim().toLowerCase();
    if (!needle) return true;
    const haystacks = [item.id, item.name, item.description].concat(extraFields.map(function(k) { return item[k]; }));
    return haystacks.some(function(h) { return h && h.toString().toLowerCase().indexOf(needle) !== -1; });
  }

  // -------------------------------------------------------------------
  // API orchestree (equivalent de competency-service.js, generique)
  // -------------------------------------------------------------------

  async function browse(options) {
    const access = checkAccess(false);
    if (access.status !== 'authorized') return { authorized: false, message: access.message };
    const opts = options || {};
    const pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;

    if (opts.searchText && opts.searchText.trim()) {
      const bounded = await searchBounded({ filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection });
      if (bounded.error) return { authorized: true, error: true, message: 'Impossible de charger la liste pour le moment.' };
      const filtered = bounded.items.filter(function(i) { return matchesSearchText(i, opts.searchText); });
      const page = opts.page || 0;
      return {
        authorized: true, error: false, searchMode: true,
        items: filtered.slice(page * pageSize, (page + 1) * pageSize),
        hasMore: (page + 1) * pageSize < filtered.length, truncatedScan: bounded.truncated,
      };
    }
    const result = await queryPage({ filters: opts.filters, sortField: opts.sortField, sortDirection: opts.sortDirection, pageSize: pageSize, cursorDoc: opts.cursorDoc });
    if (result.error) return { authorized: true, error: true, message: 'Impossible de charger la liste pour le moment.' };
    return { authorized: true, error: false, searchMode: false, items: result.items, lastDoc: result.lastDoc, hasMore: result.hasMore };
  }

  async function create(fields) {
    const access = checkAccess(false);
    if (access.status !== 'authorized') return { status: 'denied', message: access.message };
    if (!fields || !fields.name || fields.name.toString().trim().length < 2) {
      return { status: 'error', message: 'Le nom doit contenir au moins 2 caractères.' };
    }
    const ctx = getCurrentUserContext();
    const now = new Date().toISOString();
    const metadata = completeMetadata(Object.assign({}, fields, {
      status: REFERENCE_BANK_STATUSES.DRAFT, createdAt: now, updatedAt: now, author: (ctx && ctx.email) || null,
    }));
    const validation = validateMetadata(metadata);
    if (!validation.valid) return { status: 'error', message: validation.errors.join(' ') };

    try {
      await setDoc(doc(db, collectionName, metadata.id), metadata);
    } catch (err) {
      logCatalogError('création', err);
      return { status: 'error', message: 'La création a échoué. Veuillez réessayer.' };
    }
    await logAction(metadata.id, 'creation', null, metadata.name);
    return { status: 'success', message: capitalize(labelSingular) + ' créé(e) avec succès.', item: metadata };
  }

  async function edit(item, fields) {
    const access = checkAccess(false);
    if (access.status !== 'authorized') return { status: 'denied', message: access.message };
    if (!item || !item.id) return { status: 'error', message: 'Élément cible introuvable.' };

    const payload = {};
    const editableKeys = ['name', 'description'].concat(extraFields);
    editableKeys.forEach(function(key) {
      if (fields && Object.prototype.hasOwnProperty.call(fields, key)) payload[key] = fields[key];
    });
    if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
      const trimmed = (payload.name || '').toString().trim();
      if (trimmed.length < 2) return { status: 'error', message: 'Le nom doit contenir au moins 2 caractères.' };
      payload.name = trimmed;
    }
    if (Object.keys(payload).length === 0) return { status: 'denied', message: 'Aucune modification à enregistrer.' };
    payload.updatedAt = new Date().toISOString();

    try {
      await updateDoc(doc(db, collectionName, item.id), payload);
    } catch (err) {
      logCatalogError('édition', err);
      return { status: 'error', message: 'L\'enregistrement a échoué. Veuillez réessayer.' };
    }
    for (const key of Object.keys(payload)) {
      if (key === 'updatedAt') continue;
      await logAction(item.id, 'edit_' + key, item[key], payload[key]);
    }
    return { status: 'success', message: 'Modifications enregistrées avec succès.' };
  }

  async function changeStatus(item, newStatus, actionLabel, disallowedFrom) {
    const access = checkAccess(false);
    if (access.status !== 'authorized') return { status: 'denied', message: access.message };
    if (!item || !item.id) return { status: 'error', message: 'Élément cible introuvable.' };
    if (item.status === newStatus) return { status: 'denied', message: 'Cet élément a déjà ce statut.' };
    if (disallowedFrom && disallowedFrom.indexOf(item.status) !== -1) {
      return { status: 'denied', message: 'Cette action n\'est pas disponible depuis le statut actuel.' };
    }
    try {
      await updateDoc(doc(db, collectionName, item.id), { status: newStatus, updatedAt: new Date().toISOString() });
    } catch (err) {
      logCatalogError('changement de statut', err);
      return { status: 'error', message: 'La mise à jour du statut a échoué. Veuillez réessayer.' };
    }
    await logAction(item.id, 'status_change', item.status, newStatus);
    return { status: 'success', message: actionLabel + ' avec succès.' };
  }

  function publish(item) { return changeStatus(item, REFERENCE_BANK_STATUSES.PUBLISHED, 'Publié', [REFERENCE_BANK_STATUSES.TRASH]); }
  function archive(item) { return changeStatus(item, REFERENCE_BANK_STATUSES.ARCHIVED, 'Archivé', [REFERENCE_BANK_STATUSES.TRASH]); }
  function revertToDraft(item) { return changeStatus(item, REFERENCE_BANK_STATUSES.DRAFT, 'Remis en brouillon', [REFERENCE_BANK_STATUSES.TRASH]); }

  async function moveToTrash(item) {
    if (!item || item.status !== REFERENCE_BANK_STATUSES.ARCHIVED) {
      return { status: 'denied', message: 'Seul un élément archivé peut être mis à la corbeille.' };
    }
    return changeStatus(item, REFERENCE_BANK_STATUSES.TRASH, 'Mis à la corbeille');
  }
  async function restoreFromTrash(item) {
    if (!item || item.status !== REFERENCE_BANK_STATUSES.TRASH) {
      return { status: 'denied', message: 'Cet élément n\'est pas à la corbeille.' };
    }
    return changeStatus(item, REFERENCE_BANK_STATUSES.ARCHIVED, 'Restauré depuis la corbeille');
  }
  async function permanentlyDelete(item) {
    const access = checkAccess(true);
    if (access.status !== 'authorized') return { status: 'denied', message: access.message };
    if (!item || !item.id) return { status: 'error', message: 'Élément cible introuvable.' };
    if (item.status !== REFERENCE_BANK_STATUSES.TRASH) {
      return { status: 'denied', message: 'Seul un élément à la corbeille peut être supprimé définitivement.' };
    }
    try {
      await deleteDoc(doc(db, collectionName, item.id));
    } catch (err) {
      logCatalogError('suppression définitive', err);
      return { status: 'error', message: 'La suppression a échoué. Veuillez réessayer.' };
    }
    await logAction(item.id, 'purge', REFERENCE_BANK_STATUSES.TRASH, null);
    return { status: 'success', message: 'Élément supprimé définitivement.' };
  }

  async function getTimeline(item) {
    const access = checkAccess(false);
    if (access.status !== 'authorized') return { authorized: false, message: access.message, items: [] };
    if (!item || !item.id) return { authorized: true, items: [] };
    const items = [];
    if (item.createdAt) items.push({ date: item.createdAt, label: 'Création', adminEmail: item.author || null });
    try {
      const snap = await getDocs(query(
        collection(db, AUDIT_COLLECTION),
        where('bankType', '==', bankType), where('entityId', '==', item.id),
        orderBy('date', 'desc'), limit(100)
      ));
      snap.forEach(function(d) {
        const e = d.data();
        if (e.actionType === 'creation') return;
        items.push({ date: e.date, label: describeAction(e), adminEmail: e.adminEmail || null });
      });
      items.sort(function(a, b) { return new Date(a.date).getTime() - new Date(b.date).getTime(); });
      return { authorized: true, auditUnavailable: false, items: items };
    } catch (err) {
      logCatalogError('lecture de l\'historique', err);
      return { authorized: true, auditUnavailable: true, items: items };
    }
  }

  function describeAction(entry) {
    if (entry.actionType === 'status_change') {
      return 'Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')';
    }
    if (entry.actionType && entry.actionType.indexOf('edit_') === 0) return 'Modification (' + entry.actionType.slice(5) + ')';
    if (entry.actionType === 'purge') return 'Suppression définitive';
    return 'Action (' + entry.actionType + ')';
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  return {
    generateId, completeMetadata, validateMetadata,
    getById, getByIds, browse, create, edit,
    publish, archive, revertToDraft, moveToTrash, restoreFromTrash, permanentlyDelete,
    getTimeline,
  };
}
