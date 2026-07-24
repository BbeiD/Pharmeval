// ===================== SERVICE DE CATALOGUE DES ATTRIBUTIONS (FIRESTORE) — Sprint 15 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `assignments`. Miroir du meme principe que
// parcours-catalog-service.js/competency-catalog-service.js : aucune regle
// de validation ici (voir assignment-metadata-service.js), ce fichier ne
// fait que lire/ecrire ce qui lui est deja fourni construit et valide.
//
// PAS de workflow de suppression securisee (brouillon/archive/corbeille)
// ici, contrairement aux banques de contenu (Sprint 12/13/14) : une
// attribution est un simple lien, pas un contenu editorial a faire
// relire/publier - "supprimer une attribution" (SPRINT15) est une
// suppression Firestore reelle et immediate.

import { db, auth } from "../firebase-config.js";
import {
  collection, query, where, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";

const ASSIGNMENT_COLLECTION = 'assignments';

async function callAssignmentApi(path, options) {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options && options.headers) },
  });
  return res;
}

function logCatalogError(context, err) {
  console.error('[assignment-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Cree une nouvelle attribution.
 * @param {object} assignmentDocument - deja construit par completeAssignmentMetadata()
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function createAssignmentDocument(assignmentDocument) {
  try {
    const res = await callAssignmentApi('/api/assignments', { method: 'POST', body: JSON.stringify(assignmentDocument) });
    if (!res || !res.ok) {
      logCatalogError('création de l\'attribution ' + assignmentDocument.id + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('création de l\'attribution ' + assignmentDocument.id, err);
    return { success: false, error: true };
  }
}

/**
 * Supprime définitivement une attribution ("supprimer une attribution",
 * demande explicite - jamais un statut "annulée" a la place, voir en-tete
 * de fichier).
 * @param {string} assignmentId
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function deleteAssignmentDocument(assignmentId) {
  try {
    const res = await callAssignmentApi(`/api/assignments/${assignmentId}`, { method: 'DELETE' });
    if (!res || !res.ok) {
      logCatalogError('suppression de l\'attribution ' + assignmentId + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('suppression de l\'attribution ' + assignmentId, err);
    return { success: false, error: true };
  }
}

/**
 * Liste les attributions d'UN parcours precis (ecran d'administration,
 * fiche du parcours - section "Attributions"). Lecture bornee.
 * @param {string} parcoursId
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function listAssignmentsByParcours(parcoursId) {
  try {
    const snap = await getDocs(query(
      collection(db, ASSIGNMENT_COLLECTION),
      where('parcoursId', '==', parcoursId),
      orderBy('assignedAt', 'desc'),
      limit(200)
    ));
    const items = []; snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logCatalogError('lecture des attributions du parcours ' + parcoursId, err);
    return { items: [], error: true };
  }
}

/**
 * Liste les attributions correspondant EXACTEMENT a un type + une cible
 * (ex. toutes les attributions directes d'un utilisateur, ou toutes les
 * attributions d'un groupe precis). Brique de base de la resolution
 * "Mes parcours" (voir assignment-service.js, getAssignedParcoursForUser).
 * @param {string} type - une valeur de ASSIGNMENT_TARGET_TYPES
 * @param {string} targetId
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function listAssignmentsByTarget(type, targetId) {
  if (!targetId) return { items: [], error: false };
  try {
    const snap = await getDocs(query(
      collection(db, ASSIGNMENT_COLLECTION),
      where('type', '==', type),
      where('targetId', '==', targetId),
      limit(200)
    ));
    const items = []; snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logCatalogError('lecture des attributions (' + type + ' / ' + targetId + ')', err);
    return { items: [], error: true };
  }
}

/**
 * Variante de listAssignmentsByTarget() pour une LISTE de cibles du meme
 * type (ex. tous les groupes d'un utilisateur en une seule requete via
 * l'operateur Firestore `in`, limite native a 30 valeurs - largement
 * suffisant pour un nombre de groupes realiste par utilisateur).
 * @param {string} type
 * @param {Array<string>} targetIds
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function listAssignmentsByTargetIn(type, targetIds) {
  const ids = (targetIds || []).filter(Boolean).slice(0, 30);
  if (ids.length === 0) return { items: [], error: false };
  try {
    const snap = await getDocs(query(
      collection(db, ASSIGNMENT_COLLECTION),
      where('type', '==', type),
      where('targetId', 'in', ids),
      limit(200)
    ));
    const items = []; snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logCatalogError('lecture des attributions (' + type + ' / lot)', err);
    return { items: [], error: true };
  }
}

/**
 * Verifie si une attribution IDENTIQUE (meme parcours, meme type, meme
 * cible) existe deja - utilise avant creation pour eviter tout doublon
 * fonctionnel (voir "Ne jamais dupliquer", SPRINT15 - applique ici a
 * l'attribution elle-meme, en plus du parcours).
 * @param {string} parcoursId
 * @param {string} type
 * @param {string} targetId
 * @returns {Promise<boolean>}
 */
export async function assignmentExists(parcoursId, type, targetId) {
  try {
    const snap = await getDocs(query(
      collection(db, ASSIGNMENT_COLLECTION),
      where('parcoursId', '==', parcoursId),
      where('type', '==', type),
      where('targetId', '==', targetId),
      limit(1)
    ));
    return !snap.empty;
  } catch (err) {
    logCatalogError('vérification de doublon d\'attribution', err);
    return false; // fail-open volontaire : mieux vaut laisser assignment-service.js retenter que bloquer une attribution legitime sur une panne de lecture
  }
}
