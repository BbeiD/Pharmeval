// ===================== SERVICE DE CATALOGUE DE QUESTIONS (FIRESTORE) =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `questions` (jamais sous `users/{uid}` - les
// questions sont communes a tous les utilisateurs, voir RAPPORT_SPRINT10.md).
//
// Utilise l'IDENTIFIANT PEDAGOGIQUE (ex. "PHARM-BAP-000124") DIRECTEMENT
// comme identifiant de document Firestore - jamais un identifiant genere
// aleatoirement par Firestore. Cela permet des mises a jour, une
// synchronisation et des imports incrementaux naturels : reimporter un
// fichier corrige met simplement a jour le MEME document.
//
// Ce fichier ne contient AUCUNE regle de validation (voir
// question-import-validator.js) ni de construction de document (voir
// question-parser.js) : il ne fait que lire et ecrire ce qu'on lui donne
// deja construit et valide.

import { db } from "../firebase-config.js";
import {
  doc,
  getDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { MAX_QUESTIONS_PER_IMPORT } from "./question-import-validator.js";

const QUESTIONS_COLLECTION = 'questions';

function logCatalogError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[question-catalog-service] ' + context + ' : ' + code, err);
}

/**
 * Relit un document existant par son identifiant pedagogique (utilise
 * directement comme identifiant de document Firestore).
 *
 * @param {string} pedagogicalId
 * @returns {Promise<object|null>}
 */
export async function getExistingQuestionByPedagogicalId(pedagogicalId) {
  try {
    const ref = doc(db, QUESTIONS_COLLECTION, pedagogicalId);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    logCatalogError('lecture de la question ' + pedagogicalId, err);
    return null;
  }
}

/**
 * Relit plusieurs documents par leurs identifiants pedagogiques, en
 * parallele. Retourne une correspondance identifiant -> document existant
 * (absent de la Map si la question n'existe pas encore - une CREATION).
 *
 * IMPORTANT (correctif de fiabilite) : effectue ses PROPRES lectures brutes
 * plutot que de reutiliser getExistingQuestionByPedagogicalId() ci-dessus,
 * qui avale ses erreurs individuellement et retourne `null` aussi bien pour
 * "n'existe pas" que pour "la lecture a echoue". Reutiliser cette fonction
 * ici aurait rendu une panne Firestore totale indiscernable d'un import ne
 * comportant que des nouvelles questions - un risque reel d'importer des
 * doublons ou de manquer des mises a jour sans jamais le savoir. Ici, la
 * moindre erreur individuelle fait echouer l'ENSEMBLE de l'operation
 * (error:true), jamais un resultat partiel presente comme fiable.
 *
 * Note de performance (documentee, pas cachee) : effectue un appel
 * getDoc() par identifiant plutot qu'une requete groupee unique
 * (`where(documentId(), 'in', [...])`, limitee a 30 elements par requete
 * selon les versions du SDK Firestore) - plus simple et correct pour les
 * volumes realistes d'un import genere par Claude (voir RAPPORT_SPRINT10.md,
 * "Limites connues" pour une piste d'optimisation si les fichiers
 * importes devenaient tres volumineux).
 *
 * @param {Array<string>} pedagogicalIds
 * @returns {Promise<{map:Map<string,object>, error:boolean}>}
 */
export async function getExistingQuestionsByPedagogicalIds(pedagogicalIds) {
  try {
    const results = await Promise.all(pedagogicalIds.map(async function(id) {
      const ref = doc(db, QUESTIONS_COLLECTION, id);
      const snap = await getDoc(ref); // toute erreur ici remonte au catch englobant, jamais avalee silencieusement
      return { id: id, data: snap.exists() ? snap.data() : null };
    }));
    const map = new Map();
    results.forEach(function(r) {
      if (r.data) map.set(r.id, r.data);
    });
    return { map: map, error: false };
  } catch (err) {
    logCatalogError('lecture groupee des questions existantes', err);
    return { map: new Map(), error: true };
  }
}

/**
 * Ecrit un lot de documents question dans Firestore en UN SEUL bloc
 * atomique (writeBatch).
 *
 * CORRECTIF (post-Sprint 10) : n'accepte plus qu'un unique writeBatch,
 * jamais un decoupage en plusieurs blocs successifs. GARANTIE D'ATOMICITE
 * REELLE : Firestore garantit que TOUTES les ecritures d'un writeBatch
 * reussissent ou qu'AUCUNE n'est appliquee. Comme js/services/question-
 * import-validator.js refuse desormais tout fichier depassant
 * MAX_QUESTIONS_PER_IMPORT (500) AVANT meme d'atteindre cette fonction,
 * cette garantie s'applique desormais a l'integralite de tout import
 * reellement traite - plus de zone grise "atomique par bloc, pas au-dela".
 *
 * DEFENSE EN PROFONDEUR : si cette fonction recevait malgre tout plus de
 * MAX_QUESTIONS_PER_IMPORT documents (ex. appel direct contournant
 * import-service.js/le validateur), elle refuse d'ecrire plutot que de
 * silencieusement decouper en plusieurs blocs comme avant ce correctif -
 * jamais de compromis sur l'atomicite, meme en cas de contournement.
 *
 * @param {Map<string, object>} documentsByPedagogicalId - identifiant -> document Firestore complet
 * @returns {Promise<{success:boolean, writtenCount:number, error:boolean}>}
 */
export async function writeQuestionsBatch(documentsByPedagogicalId) {
  const entries = Array.from(documentsByPedagogicalId.entries());
  if (entries.length === 0) {
    return { success: true, writtenCount: 0, error: false };
  }

  if (entries.length > MAX_QUESTIONS_PER_IMPORT) {
    logCatalogError('ecriture du lot de questions', new Error('Lot de ' + entries.length + ' questions au-dela de la limite d\'atomicite (' + MAX_QUESTIONS_PER_IMPORT + ') - ecriture refusee (defense en profondeur, le validateur aurait deja du bloquer ce fichier).'));
    return { success: false, writtenCount: 0, error: true };
  }

  try {
    const batch = writeBatch(db);
    entries.forEach(function(entry) {
      const ref = doc(db, QUESTIONS_COLLECTION, entry[0]);
      batch.set(ref, entry[1]);
    });
    await batch.commit();
    return { success: true, writtenCount: entries.length, error: false };
  } catch (err) {
    logCatalogError('ecriture du lot de questions', err);
    return { success: false, writtenCount: 0, error: true };
  }
}
