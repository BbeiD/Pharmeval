// ===================== SERVICE D'IDENTIFIANTS FONCTIONNELS (Sprint 20) =====================
// "Créer un service centralisé... aucune logique de génération dispersée
// dans l'interface." (cadrage) : SEUL fichier du projet a savoir
// construire ou valider un identifiant fonctionnel du type
// "REF-CBIP-HTA-000001".
//
// A NE JAMAIS CONFONDRE avec l'identifiant Firestore technique
// (`pedagogicalId`) : l'identifiant fonctionnel (`functionalCode`) est un
// champ ADDITIF sur la question, lisible par un humain, JAMAIS utilisé
// comme identifiant de document Firestore - "séparé de l'identifiant
// Firestore" (cadrage).
//
// "Ne pas renommer automatiquement les identifiants déjà existants sans
// validation" : ce service ne modifie JAMAIS `pedagogicalId` - il assigne
// uniquement une VALEUR SUPPLEMENTAIRE (`functionalCode`), sur demande
// explicite (voir question-classification-service.js).

import { db } from "../firebase-config.js";
import { doc, setDoc, getDoc, increment } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const COUNTER_COLLECTION = 'document_code_counters';
const SEQUENCE_DIGITS = 6;

/**
 * Construit la CLE DE PERIMETRE d'un compteur séquentiel - un périmètre =
 * un type de source + un code court de source + (optionnellement) un
 * code court de section.
 * @param {string} sourceType
 * @param {string} sourceShortCode
 * @param {string} [sectionShortCode]
 * @returns {string}
 */
export function buildScopeKey(sourceType, sourceShortCode, sectionShortCode) {
  return [sourceType, sourceShortCode, sectionShortCode].filter(Boolean).join('-').toUpperCase();
}

/**
 * Alloue le PROCHAIN numéro séquentiel d'un périmètre, de façon atomique.
 * @param {string} scopeKey
 * @returns {Promise<{success:boolean, sequence:(number|null), error:boolean}>}
 */
async function allocateNextSequence(scopeKey) {
  try {
    const ref = doc(db, COUNTER_COLLECTION, scopeKey);
    await setDoc(ref, { count: increment(1) }, { merge: true });
    const snap = await getDoc(ref);
    return { success: true, sequence: snap.exists() ? snap.data().count : 1, error: false };
  } catch (err) {
    console.error('[question-code-service] allocation du compteur ' + scopeKey + ' impossible', err);
    return { success: false, sequence: null, error: true };
  }
}

function padSequence(n) {
  return String(n).padStart(SEQUENCE_DIGITS, '0');
}

/**
 * Génère un NOUVEL identifiant fonctionnel, unique au sein de son
 * périmètre (source + section).
 * @param {{sourceType:string, sourceShortCode:string, sectionShortCode?:string}} scope
 * @returns {Promise<{success:boolean, code:(string|null), error:boolean}>}
 */
export async function generateFunctionalCode(scope) {
  const scopeKey = buildScopeKey(scope.sourceType, scope.sourceShortCode, scope.sectionShortCode);
  const allocation = await allocateNextSequence(scopeKey);
  if (!allocation.success) return { success: false, code: null, error: true };

  const segments = [scope.sourceType, scope.sourceShortCode, scope.sectionShortCode].filter(Boolean).map(function(s) { return s.toUpperCase(); });
  const code = segments.join('-') + '-' + padSequence(allocation.sequence);
  return { success: true, code: code, error: false };
}

/**
 * Valide la FORME d'un identifiant fonctionnel - ne vérifie pas son
 * unicité réelle en base.
 * @param {string} code
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateFunctionalCodeFormat(code) {
  const errors = [];
  if (!code || typeof code !== 'string') {
    errors.push('L\'identifiant fonctionnel est vide.');
    return { valid: false, errors: errors };
  }
  const pattern = /^[A-Z]{2,6}(-[A-Z0-9]{1,12}){1,4}-[0-9]{6}$/;
  if (!pattern.test(code)) {
    errors.push('L\'identifiant fonctionnel "' + code + '" ne respecte pas le format attendu (ex. "REF-CBIP-HTA-000001").');
  }
  return { valid: errors.length === 0, errors: errors };
}
