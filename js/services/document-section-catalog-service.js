// ===================== SERVICE DE CATALOGUE DES SECTIONS DOCUMENTAIRES (FIRESTORE) — Sprint 20 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `document_sections`. Aucune regle de validation ici
// (voir document-section-metadata-service.js).

import { db, auth } from "../firebase-config.js";
import { doc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

async function fetchDocumentSections(documentSourceId, status) {
  if (!auth.currentUser) return { items: [], error: false };
  const token = await auth.currentUser.getIdToken();
  const params = new URLSearchParams({ documentSourceId });
  if (status) params.set('status', status);
  const res = await fetch(`${API_BASE_URL}/api/document-sections?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { items: [], error: true };
  return await res.json();
}

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
    if (!auth.currentUser) return { success: false, error: true };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/document-sections`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(sectionDocument),
    });
    if (!res.ok) {
      logCatalogError('création de la section ' + sectionDocument.id + ' (API ' + res.status + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('création de la section ' + sectionDocument.id, err);
    return { success: false, error: true };
  }
}

/** @param {string} sectionId @returns {Promise<object|null>} */
export async function getDocumentSectionById(sectionId) {
  try {
    const map = await getDocumentSectionsByIds([sectionId]);
    return map.get(sectionId) || null;
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
  if (unique.length === 0) return new Map();
  try {
    if (!auth.currentUser) return new Map();
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/document-sections-by-ids?ids=${unique.map(encodeURIComponent).join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logCatalogError('lecture groupée des sections (API ' + res.status + ')', null);
      return new Map();
    }
    const body = await res.json();
    return new Map(Object.entries(body));
  } catch (err) {
    logCatalogError('lecture groupée des sections', err);
    return new Map();
  }
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
    return await fetchDocumentSections(documentSourceId, null);
  } catch (err) {
    logCatalogError('liste des sections de la source ' + documentSourceId, err);
    return { items: [], error: true };
  }
}

/**
 * Liste les sections ACTIVES d'une source (memes criteres que
 * listSectionsBySource(), filtre en plus a status=='active') - requete
 * distincte car necessaire a la regle Firestore document_sections
 * ("lecture ouverte a tout utilisateur authentifie pour le contenu ACTIF",
 * voir firestore.rules) : une requete sans ce filtre est refusee pour un
 * utilisateur non-administrateur du catalogue, quel que soit le contenu
 * reellement present.
 * @param {string} documentSourceId
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function listActiveSectionsBySource(documentSourceId) {
  try {
    return await fetchDocumentSections(documentSourceId, 'active');
  } catch (err) {
    logCatalogError('liste des sections actives de la source ' + documentSourceId, err);
    return { items: [], error: true };
  }
}

/** @param {string} sectionId @param {object} fields @returns {Promise<{success:boolean, error:boolean}>} */
export async function updateDocumentSectionFields(sectionId, fields) {
  try {
    if (!auth.currentUser) return { success: false, error: true };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/document-sections/${sectionId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      logCatalogError('mise à jour de la section ' + sectionId + ' (API ' + res.status + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
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
  if (!deltas.directQuestionCount && !deltas.totalQuestionCount && !deltas.childSectionCount) {
    return { success: true, error: false };
  }
  try {
    if (!auth.currentUser) return { success: false, error: true };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/document-sections/${sectionId}/counters`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(deltas),
    });
    if (!res.ok) {
      logCatalogError('mise à jour des compteurs de la section ' + sectionId + ' (API ' + res.status + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('mise à jour des compteurs de la section ' + sectionId, err);
    return { success: false, error: true };
  }
}
