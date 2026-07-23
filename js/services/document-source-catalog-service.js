// ===================== SERVICE DE CATALOGUE DES SOURCES DOCUMENTAIRES (FIRESTORE) — Sprint 20 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `document_sources`. Aucune regle de validation ici
// (voir document-source-metadata-service.js) - ce fichier ne fait que
// lire/ecrire ce qui lui est deja fourni construit et valide.

import { db, auth } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, increment, writeBatch,
  collection, query, where, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

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

/**
 * "Ne pas masquer une erreur Firestore d'index manquant" (cadrage 20.2,
 * "Index Firestore") : détecte le cas précis d'une requête composée dont
 * l'index n'a pas encore été déployé (`firestore.indexes.json` présent
 * dans le ZIP mais pas encore appliqué côté Firebase, cadrage "Déploiement
 * ultérieur des index") et retourne un message EXPLICITE plutôt qu'un
 * message générique de panne réseau - l'erreur d'origine reste, dans tous
 * les cas, intégralement journalisée en console (voir logCatalogError()).
 * @param {*} err
 * @returns {boolean}
 */
function isIndexMissingError(err) {
  return !!err && err.code === 'failed-precondition' && /index/i.test(err.message || '');
}
const INDEX_MISSING_MESSAGE = 'Cette fonctionnalité nécessite un index Firestore qui n\'est pas encore déployé (voir firestore.indexes.json et la procédure de déploiement). Contactez l\'administrateur technique.';

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
 * Liste les sources documentaires GLOBALES, avec filtres optionnels
 * (type, statut) - "filtrer par type : REF, PROC, ETU" (cadrage,
 * "Administration des sources documentaires").
 *
 * CORRECTIF (Sprint 20.2) : ne filtre plus par organisation - une source
 * documentaire est une entité globale de la plateforme (voir
 * RAPPORT_CORRECTIF_SPRINT20_2.md).
 * @param {{sourceType?:string, status?:string, pageSize?:number}} [options]
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function queryDocumentSources(options) {
  const opts = options || {};
  try {
    if (!auth.currentUser) return { items: [], error: false };
    const token = await auth.currentUser.getIdToken();
    const params = new URLSearchParams({ pageSize: String(opts.pageSize || DEFAULT_PAGE_SIZE) });
    if (opts.sourceType) params.set('sourceType', opts.sourceType);
    if (opts.status) params.set('status', opts.status);
    const res = await fetch(`${API_BASE_URL}/api/document-sources?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logCatalogError('liste des sources (API ' + res.status + ')', null);
      return { items: [], error: true, indexMissing: !!body.indexMissing, message: body.message };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('liste des sources', err);
    return { items: [], error: true, indexMissing: isIndexMissingError(err), message: isIndexMissingError(err) ? INDEX_MISSING_MESSAGE : undefined };
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

/**
 * Active EN MASSE toutes les sources actuellement au statut "draft"
 * (bouton "Activer toutes les sources en brouillon", voir
 * document-source-service.js). Ne touche a aucune source dans un autre
 * statut (active/archived/deleted restent inchangees).
 * @returns {Promise<{success:boolean, activatedCount:number, error:boolean}>}
 */
export async function activateAllDraftSources() {
  try {
    const snap = await getDocs(query(collection(db, SOURCE_COLLECTION), where('status', '==', 'draft'), limit(500)));
    const refs = [];
    snap.forEach(function(d) { refs.push(d.ref); });
    if (refs.length === 0) return { success: true, activatedCount: 0, error: false };

    const now = new Date().toISOString();
    const batch = writeBatch(db); // <=500 sources attendues, jamais un volume comparable a `questions`
    refs.forEach(function(ref) { batch.update(ref, { status: 'active', isActive: true, updatedAt: now }); });
    await batch.commit();
    return { success: true, activatedCount: refs.length, error: false };
  } catch (err) {
    logCatalogError('activation en masse des sources en brouillon', err);
    return { success: false, activatedCount: 0, error: true };
  }
}
