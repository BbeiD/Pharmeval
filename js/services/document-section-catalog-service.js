// ===================== SERVICE DE CATALOGUE DES SECTIONS DOCUMENTAIRES (FIRESTORE) — Sprint 20 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `document_sections`. Aucune regle de validation ici
// (voir document-section-metadata-service.js).

import { db } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, increment,
  collection, query, where, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const SECTION_COLLECTION = 'document_sections';

/**
 * CORRECTIF (fiabilisation des compteurs) : voir getDocumentSourceRef()
 * dans document-source-catalog-service.js pour la justification complete.
 * @param {string} sectionId
 * @returns {import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js").DocumentReference}
 */
export function getDocumentSectionRef(sectionId) {
  return doc(db, SECTION_COLLECTION, sectionId);
}

function logCatalogError(context, err) {
  console.error('[document-section-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/** @param {object} sectionDocument @returns {Promise<{success:boolean, error:boolean}>} */
export async function createDocumentSectionDoc(sectionDocument) {
  try {
    await setDoc(doc(db, SECTION_COLLECTION, sectionDocument.id), sectionDocument);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('création de la section ' + sectionDocument.id, err);
    return { success: false, error: true };
  }
}

/** @param {string} sectionId @returns {Promise<object|null>} */
export async function getDocumentSectionById(sectionId) {
  try {
    const snap = await getDoc(doc(db, SECTION_COLLECTION, sectionId));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logCatalogError('lecture de la section ' + sectionId, err);
    return null;
  }
}

/**
 * @param {Array<string>} sectionIds
 * @returns {Promise<Map<string,object>>}
 */
export async function getDocumentSectionsByIds(sectionIds) {
  const unique = Array.from(new Set((sectionIds || []).filter(Boolean)));
  const results = await Promise.all(unique.map(getDocumentSectionById));
  const map = new Map();
  unique.forEach(function(id, i) { if (results[i]) map.set(id, results[i]); });
  return map;
}

/**
 * Liste toutes les sections d'UNE source documentaire (utilise pour
 * construire l'arborescence complete cote interface - "prévoir une
 * navigation en arborescence ou en liste hiérarchique", jamais un
 * éditeur graphique complexe). Lecture bornée.
 * @param {string} documentSourceId
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function listSectionsBySource(documentSourceId) {
  try {
    const snap = await getDocs(query(
      collection(db, SECTION_COLLECTION),
      where('documentSourceId', '==', documentSourceId),
      orderBy('displayOrder', 'asc'),
      limit(500)
    ));
    const items = []; snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logCatalogError('liste des sections de la source ' + documentSourceId, err);
    return { items: [], error: true };
  }
}

/**
 * Liste les enfants DIRECTS d'une section (utile pour une navigation
 * paresseuse plutot que de toujours charger l'arborescence complete d'une
 * grosse source).
 * @param {string} documentSourceId
 * @param {string|null} parentSectionId - null pour les sections racines
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function listChildSections(documentSourceId, parentSectionId) {
  try {
    const snap = await getDocs(query(
      collection(db, SECTION_COLLECTION),
      where('documentSourceId', '==', documentSourceId),
      where('parentSectionId', '==', parentSectionId),
      orderBy('displayOrder', 'asc'),
      limit(200)
    ));
    const items = []; snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logCatalogError('liste des sous-sections', err);
    return { items: [], error: true };
  }
}

/** @param {string} sectionId @param {object} fields @returns {Promise<{success:boolean, error:boolean}>} */
export async function updateDocumentSectionFields(sectionId, fields) {
  try {
    await updateDoc(doc(db, SECTION_COLLECTION, sectionId), fields);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('mise à jour de la section ' + sectionId, err);
    return { success: false, error: true };
  }
}

/**
 * Incrémente/décrémente de façon atomique les compteurs maintenus d'UNE
 * section précise (voir document-section-service.js pour la propagation
 * a toute la chaine d'ancetres via `path`).
 * @param {string} sectionId
 * @param {{directQuestionCount?:number, totalQuestionCount?:number, childSectionCount?:number}} deltas
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function incrementDocumentSectionCounters(sectionId, deltas) {
  const payload = {};
  if (deltas.directQuestionCount) payload.directQuestionCount = increment(deltas.directQuestionCount);
  if (deltas.totalQuestionCount) payload.totalQuestionCount = increment(deltas.totalQuestionCount);
  if (deltas.childSectionCount) payload.childSectionCount = increment(deltas.childSectionCount);
  if (Object.keys(payload).length === 0) return { success: true, error: false };
  try {
    await updateDoc(doc(db, SECTION_COLLECTION, sectionId), payload);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('mise à jour des compteurs de la section ' + sectionId, err);
    return { success: false, error: true };
  }
}
