// ===================== SERVICE DE CATALOGUE DES TAGS (FIRESTORE) — Sprint 21.5, Phase B0 =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `tags`. Aucune regle de validation ici - ce fichier
// ne fait que lire/ecrire ce qui lui est deja fourni (meme principe que
// document-source-catalog-service.js, dont ce fichier reprend
// deliberement les conventions).
//
// REUTILISATION EXPLICITE DU MOTEUR DE SYNCHRONISATION (cadrage, point 4) :
// la cle de document est calculee par normalizeForDedup() (deja livree,
// normalization-utils.js), EXACTEMENT la fonction que catalog-sync-
// engine.js utilise deja pour dedoublonner les tags pendant une
// synchronisation. Consequence directe : le jour ou le moteur de
// synchronisation est cable sur de vrais services Firestore (Sprint 22,
// voir NOTES_INTEGRATION_PRODUCTION.md), les tags qu'il ecrira et ceux
// que ce service lira seront LE MEME document, sans migration, sans
// renommage, sans transformation.

import { db } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, increment,
  collection, query, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { normalizeForDedup } from "./normalization-utils.js";

const TAGS_COLLECTION = 'tags';
const DEFAULT_PAGE_SIZE = 200; // suffisant pour peupler un selecteur de filtre - voir listAllTags()

function logTagError(context, err) {
  console.error('[tag-catalog-service] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

/**
 * Cle de document = cle normalisee (meme fonction que le moteur de
 * synchronisation), en remplacant en plus tout "/" par un "-" : un
 * identifiant de document Firestore ne peut jamais contenir "/" (interprete
 * comme un separateur de segments de chemin) - un libelle comme
 * "Vitamine PP/B6" produirait sinon une reference invalide et ferait
 * echouer silencieusement la resolution de CE tag precis (voir
 * logTagError, catch defensif existant qui masquait ce cas sans le
 * corriger). Volontairement EXPOSEE : tout appelant qui a besoin
 * de savoir "a quel document Firestore un libelle donne correspond-il"
 * (ex. pour filtrer des questions par tag) doit passer par CETTE fonction,
 * jamais recalculer sa propre normalisation.
 * @param {string} label
 * @returns {string}
 */
export function tagIdForLabel(label) {
  return normalizeForDedup(label).replace(/\//g, '-');
}

/**
 * Cree le tag s'il n'existe pas encore, ou incremente son compteur d'usage
 * s'il existe deja. Idempotent au sens metier (memes garanties que
 * findOrCreateDocumentSource cote referentiels documentaires) - N'EST PAS
 * protege par une transaction (meme choix que le reste du projet pour les
 * compteurs non critiques, voir document-source-catalog-service.js) : un
 * double appel concurrent tres rare pourrait, dans le pire cas, sous-
 * compter un usage, jamais dupliquer un document de tag ou corrompre une
 * question - risque juge acceptable et documente, pas cache.
 *
 * @param {string} label - libelle BRUT (non normalise)
 * @returns {Promise<{success:boolean, tagId:string, created:boolean, error:boolean}>}
 */
export async function findOrCreateTag(label) {
  const tagId = tagIdForLabel(label);
  if (!tagId) return { success: false, tagId: '', created: false, error: true };
  try {
    const ref = doc(db, TAGS_COLLECTION, tagId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, { usageCount: increment(1) });
      return { success: true, tagId: tagId, created: false, error: false };
    }
    await setDoc(ref, { id: tagId, label: label, usageCount: 1, createdAt: new Date().toISOString() });
    return { success: true, tagId: tagId, created: true, error: false };
  } catch (err) {
    logTagError('find-or-create du tag "' + label + '"', err);
    return { success: false, tagId: tagId, created: false, error: true };
  }
}

/** @param {string} tagId @returns {Promise<object|null>} */
export async function getTagById(tagId) {
  try {
    const snap = await getDoc(doc(db, TAGS_COLLECTION, tagId));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logTagError('lecture du tag ' + tagId, err);
    return null;
  }
}

/**
 * Relit plusieurs tags par identifiant, en parallele - MEME PATRON que
 * getExistingQuestionsByPedagogicalIds() (question-catalog-service.js) :
 * un getDoc() par identifiant plutot qu'une requete groupee, pour les
 * memes raisons (simplicite, volumes realistes - voir ce fichier pour la
 * justification complete).
 * @param {Array<string>} tagIds
 * @returns {Promise<{map:Map<string,object>, error:boolean}>}
 */
export async function getTagsByIds(tagIds) {
  try {
    const results = await Promise.all(tagIds.map(async function(id) {
      const snap = await getDoc(doc(db, TAGS_COLLECTION, id));
      return { id: id, data: snap.exists() ? snap.data() : null };
    }));
    const map = new Map();
    results.forEach(function(r) { if (r.data) map.set(r.id, r.data); });
    return { map: map, error: false };
  } catch (err) {
    logTagError('lecture groupee des tags', err);
    return { map: new Map(), error: true };
  }
}

/**
 * Liste les tags les plus utilises (pour peupler un selecteur de filtre
 * dans Entrainement libre - Phase B1, pas construite ici). Bornee par
 * construction (DEFAULT_PAGE_SIZE) : jamais un chargement de l'integralite
 * de la collection.
 * @param {{pageSize?:number}} [options]
 * @returns {Promise<{items:Array<object>, error:boolean}>}
 */
export async function listMostUsedTags(options) {
  const pageSize = (options && options.pageSize) || DEFAULT_PAGE_SIZE;
  try {
    const q = query(collection(db, TAGS_COLLECTION), orderBy('usageCount', 'desc'), limit(pageSize));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(function(d) { items.push(d.data()); });
    return { items: items, error: false };
  } catch (err) {
    logTagError('listage des tags les plus utilisés', err);
    return { items: [], error: true };
  }
}
