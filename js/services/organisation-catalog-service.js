// ===================== SERVICE DE CATALOGUE DES ORGANISATIONS (FIRESTORE) =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `organisations` (jamais sous `users/{uid}` - une
// organisation est commune a tous les utilisateurs, meme principe que
// `questions/` (Sprint 10) et `parcours/` (Sprint 12)).
//
// Utilise l'IDENTIFIANT STABLE de l'organisation (ex. "ORG-a1b2c3d4",
// js/services/organisation-metadata-service.js) DIRECTEMENT comme
// identifiant de document Firestore - jamais un identifiant Firestore
// genere aleatoirement.
//
// Ce fichier ne contient AUCUNE regle de validation (voir
// organisation-metadata-service.js) : il ne fait que lire et ecrire ce
// qu'on lui donne deja construit et valide. Miroir exact de la
// responsabilite de parcours-catalog-service.js (Sprint 12), applique a
// ce nouveau niveau de gouvernance.

import { db } from "../firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const ORGANISATIONS_COLLECTION = 'organisations';

export const DEFAULT_ORGANISATIONS_PAGE_SIZE = 25;

// Meme principe que parcours-catalog-service.js/question-catalog-service.js :
// limite de balayage CONFIGURABLE, jamais figee, pour la recherche
// textuelle (Firestore ne supporte pas nativement la recherche plein texte).
let defaultOrganisationsSearchScanLimit = 500;
export function getDefaultOrganisationsSearchScanLimit() {
  return defaultOrganisationsSearchScanLimit;
}
export function setDefaultOrganisationsSearchScanLimit(n) {
  if (typeof n === 'number' && n > 0) defaultOrganisationsSearchScanLimit = n;
}

function logCatalogError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[organisation-catalog-service] ' + context + ' : ' + code, err);
}

/**
 * Cree une NOUVELLE organisation (setDoc, jamais utilise pour une mise a
 * jour - voir updateOrganisationFields ci-dessous pour toute modification
 * ulterieure).
 *
 * @param {object} organisationDocument - document complet, deja construit par
 *   completeOrganisationMetadata() (voir organisation-metadata-service.js)
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function createOrganisationDocument(organisationDocument) {
  try {
    const ref = doc(db, ORGANISATIONS_COLLECTION, organisationDocument.id);
    await setDoc(ref, organisationDocument);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('création de l\'organisation ' + organisationDocument.id, err);
    return { success: false, error: true };
  }
}

/**
 * Relit une organisation existante par son identifiant stable.
 *
 * @param {string} organisationId
 * @returns {Promise<object|null>}
 */
export async function getOrganisationById(organisationId) {
  try {
    const ref = doc(db, ORGANISATIONS_COLLECTION, organisationId);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logCatalogError('lecture de l\'organisation ' + organisationId, err);
    return null;
  }
}

function buildFilterClauses(filters) {
  const clauses = [];
  const f = filters || {};
  if (f.status) clauses.push(where('status', '==', f.status));
  if (f.type) clauses.push(where('type', '==', f.type));
  if (f.author) clauses.push(where('author', '==', f.author));
  return clauses;
}

/**
 * Charge UNE PAGE d'organisations, filtree et triee cote SERVEUR (vraie
 * pagination Firestore par curseur - jamais un chargement de toute la
 * collection). Miroir exact de queryParcoursPage() (parcours-catalog-
 * service.js, Sprint 12).
 *
 * @param {{filters:object, sortField:string, sortDirection:string, pageSize:number, cursorDoc:object}} options
 * @returns {Promise<{items:Array<object>, lastDoc:(object|null), hasMore:boolean, error:boolean}>}
 */
export async function queryOrganisationsPage(options) {
  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_ORGANISATIONS_PAGE_SIZE;
  try {
    const colRef = collection(db, ORGANISATIONS_COLLECTION);
    const clauses = buildFilterClauses(opts.filters);
    clauses.push(orderBy(opts.sortField || 'createdAt', opts.sortDirection || 'desc'));
    clauses.push(limit(pageSize));
    if (opts.cursorDoc) clauses.push(startAfter(opts.cursorDoc));
    const q = query(colRef, ...clauses);
    const snap = await getDocs(q);
    const items = [];
    let lastRawDoc = null;
    snap.forEach(function(d) { items.push(d.data()); lastRawDoc = d; });
    return { items: items, lastDoc: lastRawDoc, hasMore: items.length === pageSize, error: false };
  } catch (err) {
    logCatalogError('chargement d\'une page d\'organisations', err);
    return { items: [], lastDoc: null, hasMore: false, error: true };
  }
}

/**
 * Balayage BORNE pour la recherche textuelle libre (meme limite honnete
 * que searchParcoursBounded/searchQuestionsBounded).
 *
 * @param {{filters:object, sortField:string, sortDirection:string, maxScan?:number}} options
 * @returns {Promise<{items:Array<object>, truncated:boolean, error:boolean, scanLimit:number}>}
 */
export async function searchOrganisationsBounded(options) {
  const opts = options || {};
  const scanLimit = (typeof opts.maxScan === 'number' && opts.maxScan > 0) ? opts.maxScan : defaultOrganisationsSearchScanLimit;
  try {
    const colRef = collection(db, ORGANISATIONS_COLLECTION);
    const clauses = buildFilterClauses(opts.filters);
    clauses.push(orderBy(opts.sortField || 'createdAt', opts.sortDirection || 'desc'));
    clauses.push(limit(scanLimit + 1));
    const q = query(colRef, ...clauses);
    const snap = await getDocs(q);
    const all = [];
    snap.forEach(function(d) { all.push(d.data()); });
    const truncated = all.length > scanLimit;
    return { items: all.slice(0, scanLimit), truncated: truncated, error: false, scanLimit: scanLimit };
  } catch (err) {
    logCatalogError('balayage de recherche des organisations', err);
    return { items: [], truncated: false, error: true, scanLimit: scanLimit };
  }
}

/**
 * Change UNIQUEMENT le statut d'une organisation.
 *
 * @param {string} organisationId
 * @param {string} newStatus
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateOrganisationStatus(organisationId, newStatus) {
  try {
    const ref = doc(db, ORGANISATIONS_COLLECTION, organisationId);
    await updateDoc(ref, { status: newStatus, updatedAt: new Date().toISOString() });
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('changement de statut de l\'organisation ' + organisationId, err);
    return { success: false, error: true };
  }
}

/**
 * Met a jour les champs editables d'une organisation (nom, description,
 * type, logo, couleur, pays, langue, fuseau horaire, relations reservees).
 *
 * @param {string} organisationId
 * @param {object} fields
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateOrganisationFields(organisationId, fields) {
  const allowed = ['name', 'description', 'type', 'logoUrl', 'color', 'country', 'primaryLanguage', 'timezone', 'relations'];
  const payload = {};
  allowed.forEach(function(key) {
    if (fields && Object.prototype.hasOwnProperty.call(fields, key)) payload[key] = fields[key];
  });
  payload.updatedAt = new Date().toISOString();
  try {
    const ref = doc(db, ORGANISATIONS_COLLECTION, organisationId);
    await updateDoc(ref, payload);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('modification des champs de l\'organisation ' + organisationId, err);
    return { success: false, error: true };
  }
}

/**
 * Supprime DEFINITIVEMENT une organisation (suppression Firestore reelle,
 * irreversible). Voir js/services/organisation-service.js pour le workflow
 * de suppression securisee qui protege cet appel.
 *
 * @param {string} organisationId
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function deleteOrganisationDocument(organisationId) {
  try {
    const ref = doc(db, ORGANISATIONS_COLLECTION, organisationId);
    await deleteDoc(ref);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('suppression de l\'organisation ' + organisationId, err);
    return { success: false, error: true };
  }
}
