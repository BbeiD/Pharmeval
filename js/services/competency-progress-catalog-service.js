// ===================== SERVICE DE CATALOGUE DE LA PROGRESSION (FIRESTORE) — Sprint 19 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `competency_progress`. Aucune logique de calcul ici
// (voir competency-progress-service.js) - ce fichier ne fait que
// lire/ecrire un document deja construit.

import { db, auth } from "../firebase-config.js";
import {
  doc, getDoc, setDoc,
  collection, query, where, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

const PROGRESS_COLLECTION = 'competency_progress';

function logCatalogError(context, err) {
  console.error('[competency-progress-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Relit un document de progression par son identifiant deterministe (voir
 * competency-progress-metadata-service.js, progressionIdFor()).
 * @param {string} progressId
 * @returns {Promise<object|null>}
 */
export async function getProgressionById(progressId) {
  try {
    const snap = await getDoc(doc(db, PROGRESS_COLLECTION, progressId));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logCatalogError('lecture de la progression ' + progressId, err);
    return null;
  }
}

/**
 * Enregistre un document de progression (creation OU mise a jour - un
 * `setDoc` complet a chaque fois, car l'appelant relit toujours l'etat
 * existant avant de calculer le nouveau, voir competency-progress-
 * service.js : jamais une ecriture partielle qui risquerait de laisser le
 * document dans un etat incoherent).
 * @param {object} progressDocument
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function saveProgressionDocument(progressDocument) {
  try {
    await setDoc(doc(db, PROGRESS_COLLECTION, progressDocument.id), progressDocument);
    return { success: true, error: false };
  } catch (err) {
    logCatalogError('enregistrement de la progression ' + progressDocument.id, err);
    return { success: false, error: true };
  }
}

/**
 * Liste toutes les progressions d'un utilisateur ("Mes compétences",
 * page utilisateur) - lecture bornee.
 * @param {string} userId
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function listProgressionsByUser(userId) {
  try {
    if (!auth.currentUser) return { items: [], error: false };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/competency-progress/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logCatalogError('lecture des progressions de l\'utilisateur ' + userId + ' (API ' + res.status + ')', null);
      return { items: [], error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('lecture des progressions de l\'utilisateur ' + userId, err);
    return { items: [], error: true };
  }
}
