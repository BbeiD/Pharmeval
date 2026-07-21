// ===================== SERVICE DE CATALOGUE DE LA BANQUE DES COMPETENCES (FIRESTORE) =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `competencies` (jamais sous users/{uid} - une
// competence de la banque est commune a tous les parcours, meme principe
// que `questions/` et `parcours/`). Miroir exact de parcours-catalog-
// service.js, applique a ce nouveau type de contenu (Sprint 13).
//
// Utilise l'IDENTIFIANT STABLE de la competence (ex. "SKILL-a1b2c3d4",
// competency-metadata-service.js) DIRECTEMENT comme identifiant de
// document Firestore.
//
// Aucune regle de validation ici (voir competency-metadata-service.js) :
// ce fichier ne fait que lire/ecrire ce qui lui est deja fourni construit
// et valide.

import { db } from "../firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const COMPETENCY_COLLECTION = 'competencies';

export const DEFAULT_COMPETENCY_PAGE_SIZE = 25;

// Meme principe que parcours-catalog-service.js/question-search-provider.js :
// limite de balayage CONFIGURABLE pour la recherche textuelle (Firestore ne
// supporte pas nativement la recherche plein texte).
let defaultCompetencySearchScanLimit = 500;
export function getDefaultCompetencySearchScanLimit() {
  return defaultCompetencySearchScanLimit;
}
export function setDefaultCompetencySearchScanLimit(n) {
  if (typeof n === 'number' && n > 0) defaultCompetencySearchScanLimit = n;
}

function logCatalogError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[competency-catalog-service] ' + context + ' : ' + code, err);
}

/**
 * Cree une NOUVELLE fiche de competence (setDoc, jamais pour une mise a
 * jour - voir updateCompetencyFields ci-dessous).
 * @param {object} competencyDocument - deja construit par completeCompetencyMetadata()
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function createCompetencyDocument(competencyDocument) {
  try {
    const ref = doc(db, COMPETENCY_COLLECTION, competencyDocument.id);
    await setDoc(ref, competencyDocument);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('création de la compétence ' + competencyDocument.id, err);
    return { success: false, error: true };
  }
}

/**
 * Relit une fiche de competence par son identifiant stable. Utilisee
 * directement par parcours-service.js pour resoudre l'affichage d'une
 * competence liee a un parcours (nom/description/couleur toujours lus
 * "en direct" depuis la banque - jamais une copie figee - voir
 * "Reutilisation", Sprint 13).
 * @param {string} competencyId
 * @returns {Promise<object|null>}
 */
export async function getCompetencyById(competencyId) {
  try {
    const ref = doc(db, COMPETENCY_COLLECTION, competencyId);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logCatalogError('lecture de la compétence ' + competencyId, err);
    return null;
  }
}

/**
 * Relit plusieurs fiches de competence par lot d'identifiants (utilise pour
 * resoudre en une fois toutes les competences liees a un parcours). Aucune
 * requete Firestore "IN" pour eviter la limite de 30 valeurs : lectures
 * individuelles en parallele, plus simple et sans limite artificielle.
 * @param {Array<string>} competencyIds
 * @returns {Promise<object>} map { [competencyId]: competencyDocument }
 */
export async function getCompetenciesByIds(competencyIds) {
  const ids = Array.isArray(competencyIds) ? competencyIds.filter(Boolean) : [];
  const uniqueIds = Array.from(new Set(ids));
  const results = await Promise.all(uniqueIds.map(function(id) { return getCompetencyById(id); }));
  const map = {};
  uniqueIds.forEach(function(id, i) { if (results[i]) map[id] = results[i]; });
  return map;
}

function buildFilterClauses(filters) {
  const clauses = [];
  const f = filters || {};
  if (f.status) clauses.push(where('status', '==', f.status));
  if (f.category) clauses.push(where('category', '==', f.category));
  if (f.author) clauses.push(where('author', '==', f.author));
  return clauses;
}

/**
 * Charge UNE PAGE de competences, filtree et triee cote SERVEUR (vraie
 * pagination Firestore par curseur). Miroir exact de queryParcoursPage().
 * @param {{filters:object, sortField:string, sortDirection:string, pageSize:number, cursorDoc:object}} options
 * @returns {Promise<{items:Array<object>, lastDoc:(object|null), hasMore:boolean, error:boolean}>}
 */
export async function queryCompetenciesPage(options) {
  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_COMPETENCY_PAGE_SIZE;
  try {
    const colRef = collection(db, COMPETENCY_COLLECTION);
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
    logCatalogError('chargement d\'une page de compétences', err);
    return { items: [], lastDoc: null, hasMore: false, error: true };
  }
}

/**
 * Balayage BORNE pour la recherche textuelle libre (meme principe honnete
 * que searchParcoursBounded/searchQuestionsBounded).
 * @param {{filters:object, sortField:string, sortDirection:string, maxScan?:number}} options
 * @returns {Promise<{items:Array<object>, truncated:boolean, error:boolean, scanLimit:number}>}
 */
export async function searchCompetenciesBounded(options) {
  const opts = options || {};
  const scanLimit = (typeof opts.maxScan === 'number' && opts.maxScan > 0) ? opts.maxScan : defaultCompetencySearchScanLimit;
  try {
    const colRef = collection(db, COMPETENCY_COLLECTION);
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
    logCatalogError('balayage de recherche des compétences', err);
    return { items: [], truncated: false, error: true, scanLimit: scanLimit };
  }
}

/**
 * Change UNIQUEMENT le statut d'une competence.
 * @param {string} competencyId
 * @param {string} newStatus
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateCompetencyStatus(competencyId, newStatus) {
  try {
    const ref = doc(db, COMPETENCY_COLLECTION, competencyId);
    await updateDoc(ref, { status: newStatus, updatedAt: new Date().toISOString() });
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('changement de statut de la compétence ' + competencyId, err);
    return { success: false, error: true };
  }
}

/**
 * Publie EN MASSE toutes les compétences actuellement au statut "draft"
 * (bouton "Publier toutes les compétences en brouillon", voir
 * competency-service.js). Ne touche a aucune compétence dans un autre
 * statut (published/archived/trash restent inchangees).
 * @returns {Promise<{success:boolean, publishedCount:number, error:boolean}>}
 */
export async function publishAllDraftCompetencies() {
  try {
    const snap = await getDocs(query(collection(db, COMPETENCY_COLLECTION), where('status', '==', 'draft'), limit(2000)));
    const refs = [];
    snap.forEach(function(d) { refs.push(d.ref); });
    if (refs.length === 0) return { success: true, publishedCount: 0, error: false };

    const CHUNK_SIZE = 400; // marge sous la limite de 500 ecritures par writeBatch Firestore
    const now = new Date().toISOString();
    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      refs.slice(i, i + CHUNK_SIZE).forEach(function(ref) { batch.update(ref, { status: 'published', updatedAt: now }); });
      await batch.commit();
    }
    return { success: true, publishedCount: refs.length, error: false };
  } catch (err) {
    logCatalogError('publication en masse des compétences en brouillon', err);
    return { success: false, publishedCount: 0, error: true };
  }
}

/**
 * Met a jour les champs editables d'une fiche de competence. Reecrit les
 * champs fournis uniquement (jamais l'ensemble du document).
 * @param {string} competencyId
 * @param {object} fields
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateCompetencyFields(competencyId, fields) {
  const allowed = ['name', 'description', 'color', 'category', 'keywords', 'recommendedLevel',
    'questionIds', 'resources', 'levels', 'badges', 'recommendations'];
  const payload = {};
  allowed.forEach(function(key) {
    if (fields && Object.prototype.hasOwnProperty.call(fields, key)) payload[key] = fields[key];
  });
  payload.updatedAt = new Date().toISOString();
  try {
    const ref = doc(db, COMPETENCY_COLLECTION, competencyId);
    await updateDoc(ref, payload);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('modification des champs de la compétence ' + competencyId, err);
    return { success: false, error: true };
  }
}

/**
 * Supprime DEFINITIVEMENT une fiche de competence (suppression Firestore
 * reelle, irreversible). Voir competency-service.js pour le workflow de
 * suppression securisee qui protege cet appel.
 * @param {string} competencyId
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function deleteCompetencyDocument(competencyId) {
  try {
    const ref = doc(db, COMPETENCY_COLLECTION, competencyId);
    await deleteDoc(ref);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('suppression de la compétence ' + competencyId, err);
    return { success: false, error: true };
  }
}
