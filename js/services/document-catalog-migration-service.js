// ===================== MIGRATION DES DONNEES EXISTANTES DU CATALOGUE (Correctif Sprint 20.2) =====================
// "Il existe actuellement peu ou pas de données réelles dans la couche
// documentaire. Prévoir néanmoins une migration propre." Ce service :
//   1) détecte les sources documentaires ayant encore un ancien champ
//      `organizationId` (résidu du Sprint 20, avant que le catalogue ne
//      devienne global) et permet de le retirer proprement ;
//   2) détecte les DOUBLONS POTENTIELS (même type + même code court +
//      même version, ex. deux sources "REF-CBIP-2026" créées séparément
//      pour deux organisations différentes avant ce correctif) - SANS
//      JAMAIS les fusionner automatiquement ("ne pas les fusionner
//      automatiquement sans contrôle", cadrage) : ce service ne fait que
//      RAPPORTER, la fusion réelle reste une décision manuelle de
//      l'administrateur du catalogue.

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { logAction } from "./audit-service.js";
import { db } from "../firebase-config.js";
import { doc, updateDoc, deleteField, collection, getDocs, limit as fsLimit, query } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const SOURCE_COLLECTION = 'document_sources';
const SCAN_LIMIT = 2000; // largement suffisant pour le volume actuel du catalogue

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { authorized: false, message: 'Vous devez être connecté.' };
  if (!hasPermission(PERMISSIONS.MANAGE_GLOBAL_CATALOG)) return { authorized: false, message: 'Réservé aux administrateurs du catalogue global.' };
  return { authorized: true };
}

/**
 * Analyse l'ensemble des sources documentaires existantes et rapporte :
 *   - celles portant encore un ancien champ `organizationId` (résidu
 *     Sprint 20, à nettoyer) ;
 *   - les groupes de doublons potentiels (même sourceType + shortCode +
 *     version), qui existaient potentiellement une fois par organisation
 *     avant ce correctif.
 * Ne modifie RIEN.
 * @returns {Promise<{authorized:boolean, message?:string, legacyOrgFieldSources:Array<object>, duplicateGroups:Array<object>, totalScanned:number, truncated:boolean}>}
 */
export async function analyzeLegacyCatalogData() {
  const access = checkAccess();
  if (!access.authorized) return Object.assign({ legacyOrgFieldSources: [], duplicateGroups: [], totalScanned: 0, truncated: false }, access);

  const snap = await getDocs(query(collection(db, SOURCE_COLLECTION), fsLimit(SCAN_LIMIT)));
  const all = [];
  snap.forEach(function(d) { all.push(d.data()); });

  // 1) Résidus d'organizationId (le champ n'existe plus dans le schéma
  // courant, mais un ANCIEN document Firestore peut encore le porter
  // physiquement tant qu'il n'a pas été explicitement nettoyé).
  const legacyOrgFieldSources = all.filter(function(s) { return Object.prototype.hasOwnProperty.call(s, 'organizationId'); });

  // 2) Doublons potentiels : même (sourceType, shortCode, version).
  const groups = new Map();
  all.forEach(function(s) {
    const key = [s.sourceType, s.shortCode, s.version].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });
  const duplicateGroups = Array.from(groups.entries())
    .filter(function(entry) { return entry[1].length > 1; })
    .map(function(entry) {
      return { key: entry[0], sources: entry[1] };
    });

  return {
    authorized: true,
    legacyOrgFieldSources: legacyOrgFieldSources,
    duplicateGroups: duplicateGroups,
    totalScanned: all.length,
    truncated: all.length >= SCAN_LIMIT,
  };
}

/**
 * Retire le champ `organizationId` résiduel d'UNE source (opération de
 * nettoyage uniquement - conserve identifiant, métadonnées, sections,
 * questions rattachées, compteurs, comme demandé).
 * @param {string} sourceId
 * @returns {Promise<{status:string, message:string}>}
 */
export async function stripLegacyOrganizationField(sourceId) {
  const access = checkAccess();
  if (!access.authorized) return { status: 'denied', message: access.message };

  try {
    await updateDoc(doc(db, SOURCE_COLLECTION, sourceId), { organizationId: deleteField() });
    const ctx = getCurrentUserContext();
    logAction({
      adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
      targetUid: null, targetEmail: null,
      actionType: 'document_source_updated',
      oldValue: sourceId + ' (avec organizationId résiduel)', newValue: sourceId + ' (catalogue global, organizationId retiré)',
    }).catch(function() {});
    return { status: 'success', message: 'Champ organizationId retiré avec succès.' };
  } catch (err) {
    console.error('[document-catalog-migration-service] échec du nettoyage de ' + sourceId, err);
    return { status: 'error', message: 'Le nettoyage a échoué. Réessayez plus tard.' };
  }
}

/**
 * Nettoie TOUTES les sources détectées avec un `organizationId` résiduel
 * (bouton "Nettoyer tout" côté interface, après revue du rapport).
 * @param {Array<string>} sourceIds
 * @returns {Promise<{succeededCount:number, failedIds:Array<string>}>}
 */
export async function stripLegacyOrganizationFieldBulk(sourceIds) {
  const failedIds = [];
  let succeededCount = 0;
  for (const id of sourceIds) {
    const result = await stripLegacyOrganizationField(id);
    if (result.status === 'success') succeededCount++; else failedIds.push(id);
  }
  return { succeededCount: succeededCount, failedIds: failedIds };
}
