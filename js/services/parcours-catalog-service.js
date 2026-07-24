// ===================== SERVICE DE CATALOGUE DE PARCOURS (FIRESTORE) =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `parcours` (jamais sous `users/{uid}` - un parcours
// est commun a tous les utilisateurs, meme principe que `questions/`
// depuis le Sprint 10).
//
// Utilise l'IDENTIFIANT STABLE du parcours (ex. "PARC-a1b2c3d4",
// js/services/parcours-metadata-service.js) DIRECTEMENT comme identifiant
// de document Firestore - jamais un identifiant Firestore genere
// aleatoirement.
//
// Ce fichier ne contient AUCUNE regle de validation (voir
// parcours-metadata-service.js) : il ne fait que lire et ecrire ce qu'on
// lui donne deja construit et valide. Miroir exact de la responsabilite de
// question-catalog-service.js, applique a un type de contenu different.

import { db, auth } from "../firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

async function callParcoursApi(path, options) {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options && options.headers) },
  });
  return res;
}

const PARCOURS_COLLECTION = 'parcours';

export const DEFAULT_PARCOURS_PAGE_SIZE = 25;

// Meme principe que question-catalog-service.js (Sprint 10/11 + correctif) :
// limite de balayage CONFIGURABLE, jamais figee, pour la recherche
// textuelle (Firestore ne supporte pas nativement la recherche plein
// texte). Voir js/services/question-search-provider.js pour le meme
// mecanisme applique aux questions - le meme principe est directement
// repris ici plutot que fige en dur.
let defaultParcoursSearchScanLimit = 500;
export function getDefaultParcoursSearchScanLimit() {
  return defaultParcoursSearchScanLimit;
}
export function setDefaultParcoursSearchScanLimit(n) {
  if (typeof n === 'number' && n > 0) defaultParcoursSearchScanLimit = n;
}

function logCatalogError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[parcours-catalog-service] ' + context + ' : ' + code, err);
}

/**
 * Cree un NOUVEAU parcours (setDoc, jamais utilise pour une mise a jour -
 * voir updateParcoursFields ci-dessous pour toute modification ulterieure).
 *
 * @param {object} parcoursDocument - document complet, deja construit par
 *   completeParcoursMetadata() (voir parcours-metadata-service.js)
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function createParcoursDocument(parcoursDocument) {
  try {
    const res = await callParcoursApi('/api/parcours', { method: 'POST', body: JSON.stringify(parcoursDocument) });
    if (!res || !res.ok) {
      logCatalogError('création du parcours ' + parcoursDocument.id + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('création du parcours ' + parcoursDocument.id, err);
    return { success: false, error: true };
  }
}

/**
 * Relit un parcours existant par son identifiant stable.
 *
 * @param {string} parcoursId
 * @returns {Promise<object|null>}
 */
export async function getParcoursById(parcoursId) {
  try {
    if (!auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/parcours/${parcoursId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logCatalogError('lecture du parcours ' + parcoursId + ' (API ' + res.status + ')', null);
      return null;
    }
    const body = await res.json();
    return body.data;
  } catch (err) {
    logCatalogError('lecture du parcours ' + parcoursId, err);
    return null;
  }
}

function buildFilterClauses(filters) {
  const clauses = [];
  const f = filters || {};
  if (f.status) clauses.push(where('status', '==', f.status));
  if (f.author) clauses.push(where('author', '==', f.author));
  return clauses;
}

/**
 * Charge UNE PAGE de parcours, filtree et triee cote SERVEUR (vraie
 * pagination Firestore par curseur - jamais un chargement de toute la
 * collection). Miroir exact de queryQuestionsPage() (question-catalog-
 * service.js, Sprint 11).
 *
 * @param {{filters:object, sortField:string, sortDirection:string, pageSize:number, cursorDoc:object}} options
 * @returns {Promise<{items:Array<object>, lastDoc:(object|null), hasMore:boolean, error:boolean}>}
 */
export async function queryParcoursPage(options) {
  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_PARCOURS_PAGE_SIZE;
  try {
    const colRef = collection(db, PARCOURS_COLLECTION);
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
    logCatalogError('chargement d\'une page de parcours', err);
    return { items: [], lastDoc: null, hasMore: false, error: true };
  }
}

/**
 * Balayage BORNE pour la recherche textuelle libre (meme limite honnete
 * que searchQuestionsBounded, question-catalog-service.js - voir ce
 * fichier pour la justification complete, non repetee ici).
 *
 * @param {{filters:object, sortField:string, sortDirection:string, maxScan?:number}} options
 * @returns {Promise<{items:Array<object>, truncated:boolean, error:boolean, scanLimit:number}>}
 */
export async function searchParcoursBounded(options) {
  const opts = options || {};
  const scanLimit = (typeof opts.maxScan === 'number' && opts.maxScan > 0) ? opts.maxScan : defaultParcoursSearchScanLimit;
  try {
    const colRef = collection(db, PARCOURS_COLLECTION);
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
    logCatalogError('balayage de recherche des parcours', err);
    return { items: [], truncated: false, error: true, scanLimit: scanLimit };
  }
}

/**
 * Change UNIQUEMENT le statut d'un parcours. Ne modifie jamais aucun autre
 * champ - miroir exact de updateQuestionStatus() (question-catalog-
 * service.js).
 *
 * @param {string} parcoursId
 * @param {string} newStatus
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateParcoursStatus(parcoursId, newStatus) {
  try {
    const res = await callParcoursApi(`/api/parcours/${parcoursId}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    if (!res || !res.ok) {
      logCatalogError('changement de statut du parcours ' + parcoursId + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('changement de statut du parcours ' + parcoursId, err);
    return { success: false, error: true };
  }
}

/**
 * Met a jour les champs editables d'un parcours (nom, description, public
 * cible, couleur, icone) ET/OU le tableau complet des competences (une
 * modification de competence - ajout, edition, suppression, reordonnancement,
 * liaison de questions - reecrit le tableau `competencies` dans son
 * ensemble, plus simple et plus sur qu'une mise a jour partielle d'un
 * element imbrique dans un tableau Firestore).
 *
 * @param {string} parcoursId
 * @param {{name?:string, description?:string, targetAudience?:string, color?:string, icon?:string, competencies?:Array<object>, sourceIds?:Array<string>, directQuestionIds?:Array<string>}} fields
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateParcoursFields(parcoursId, fields) {
  const allowed = ['name', 'description', 'targetAudience', 'color', 'icon', 'competencies', 'sourceIds', 'directQuestionIds'];
  const payload = {};
  allowed.forEach(function(key) {
    if (fields && Object.prototype.hasOwnProperty.call(fields, key)) payload[key] = fields[key];
  });
  try {
    const res = await callParcoursApi(`/api/parcours/${parcoursId}/fields`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (!res || !res.ok) {
      logCatalogError('modification des champs du parcours ' + parcoursId + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('modification des champs du parcours ' + parcoursId, err);
    return { success: false, error: true };
  }
}

/**
 * Supprime DEFINITIVEMENT un parcours (suppression Firestore reelle,
 * irreversible). Miroir exact de deleteQuestionDocument() (question-
 * catalog-service.js) - voir js/services/parcours-service.js pour le
 * workflow de suppression securisee qui protege cet appel.
 *
 * @param {string} parcoursId
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function deleteParcoursDocument(parcoursId) {
  try {
    const res = await callParcoursApi(`/api/parcours/${parcoursId}`, { method: 'DELETE' });
    if (!res || !res.ok) {
      logCatalogError('suppression du parcours ' + parcoursId + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('suppression du parcours ' + parcoursId, err);
    return { success: false, error: true };
  }
}
