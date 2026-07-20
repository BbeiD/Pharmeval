// ===================== SERVICE DE CATALOGUE DES SOURCES DOCUMENTAIRES (FIRESTORE) — Sprint 20 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `document_sources`. Aucune regle de validation ici
// (voir document-source-metadata-service.js) - ce fichier ne fait que
// lire/ecrire ce qui lui est deja fourni construit et valide.

import { db } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, increment,
  collection, query, where, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const SOURCE_COLLECTION = 'document_sources';

/**
 * CORRECTIF (fiabilisation des compteurs) : expose une reference de
 * document Firestore brute, pour permettre a document-count-service.js
 * de construire ses propres transactions (`runTransaction`) sans dupliquer
 * le nom de la collection ni contourner ce fichier - seul point du projet
 * a connaitre le nom reel de la collection `document_sources`.
 * @param {string} sourceId
 * @returns {import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js").DocumentReference}
 */
export function getDocumentSourceRef(sourceId) {
  return doc(db, SOURCE_COLLECTION, sourceId);
}
const DEFAULT_PAGE_SIZE = 50;

function logCatalogError(context, err) {
  console.error('[document-source-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/** @param {object} sourceDocument @returns {Promise<{success:boolean, error:boolean}>} */
export async function createDocumentSourceDoc(sourceDocument) {
  try {
    await setDoc(doc(db, SOURCE_COLLECTION, sourceDocument.id), sourceDocument);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('création de la source ' + sourceDocument.id, err);
    return { success: false, error: true };
  }
}

/** @param {string} sourceId @returns {Promise<object|null>} */
export async function getDocumentSourceById(sourceId) {
  try {
    const snap = await getDoc(doc(db, SOURCE_COLLECTION, sourceId));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logCatalogError('lecture de la source ' + sourceId, err);
    return null;
  }
}

/**
 * Relit plusieurs sources par lot (utilise pour resoudre l'affichage de
 * plusieurs questions/sections a la fois).
 * @param {Array<string>} sourceIds
 * @returns {Promise<Map<string,object>>}
 */
export async function getDocumentSourcesByIds(sourceIds) {
  const unique = Array.from(new Set((sourceIds || []).filter(Boolean)));
  const results = await Promise.all(unique.map(getDocumentSourceById));
  const map = new Map();
  unique.forEach(function(id, i) { if (results[i]) map.set(id, results[i]); });
  return map;
}

/**
 * Liste les sources d'une organisation, avec filtres optionnels (type,
 * statut) - "filtrer par type : REF, PROC, ETU" (cadrage, "Administration
 * des sources documentaires").
 * @param {{organizationId:string, sourceType?:string, status?:string, pageSize?:number}} options
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function queryDocumentSources(options) {
  const opts = options || {};
  try {
    const clauses = [where('organizationId', '==', opts.organizationId)];
    if (opts.sourceType) clauses.push(where('sourceType', '==', opts.sourceType));
    if (opts.status) clauses.push(where('status', '==', opts.status));
    clauses.push(orderBy('display.order', 'asc'));
    clauses.push(limit(opts.pageSize || DEFAULT_PAGE_SIZE));
    const snap = await getDocs(query(collection(db, SOURCE_COLLECTION), ...clauses));
    const items = []; snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logCatalogError('liste des sources', err);
    return { items: [], error: true };
  }
}

/** @param {string} sourceId @param {object} fields @returns {Promise<{success:boolean, error:boolean}>} */
export async function updateDocumentSourceFields(sourceId, fields) {
  try {
    await updateDoc(doc(db, SOURCE_COLLECTION, sourceId), fields);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('mise à jour de la source ' + sourceId, err);
    return { success: false, error: true };
  }
}

/**
 * Incrémente (ou décrémente, avec une valeur négative) de façon ATOMIQUE
 * les compteurs maintenus d'une source ("Prévoir des compteurs
 * maintenus", cadrage "Performance") - jamais un recalcul par balayage.
 * @param {string} sourceId
 * @param {{sectionCount?:number, questionCount?:number}} deltas
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function incrementDocumentSourceCounters(sourceId, deltas) {
  const payload = {};
  if (deltas.sectionCount) payload.sectionCount = increment(deltas.sectionCount);
  if (deltas.questionCount) payload.questionCount = increment(deltas.questionCount);
  if (Object.keys(payload).length === 0) return { success: true, error: false };
  try {
    await updateDoc(doc(db, SOURCE_COLLECTION, sourceId), payload);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('mise à jour des compteurs de la source ' + sourceId, err);
    return { success: false, error: true };
  }
}
