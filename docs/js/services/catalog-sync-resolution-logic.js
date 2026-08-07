// ===================== LOGIQUE PURE — RESOLUTION & COMPTEURS (Sprint 22) =====================
// Aucune dependance Firestore ici (meme principe que question-filter-
// utils.js, catalog-sync-helpers.js) - separee du fichier qui appelle
// reellement Firestore (catalog-sync-firestore-backend.js) UNIQUEMENT
// pour permettre un test unitaire reel de cette logique, la plus a
// risque de ce sprint (dedoublonnage, calcul des deltas de compteurs).

import { normalizeForDedup } from "./normalization-utils.js";

/**
 * Cherche, parmi une liste de sources DEJA CHARGEES, celle dont le nom
 * normalise correspond exactement au nom fourni (dedoublonnage
 * TECHNIQUE uniquement, jamais semantique - meme principe que les tags).
 * @param {string} name
 * @param {Array<object>} existingSources - documents `document_sources` deja lus
 * @returns {object|null}
 */
export function findMatchingSource(name, existingSources) {
  const key = normalizeForDedup(name);
  if (!key) return null;
  return (existingSources || []).find(function(s) { return normalizeForDedup(s.name) === key; }) || null;
}

/**
 * Meme principe que findMatchingSource, mais borne aux sections d'UNE
 * source deja resolue (une section ne peut jamais dedoublonner avec une
 * section d'une autre source).
 * @param {string} name
 * @param {Array<object>} existingSections - sections de LA MEME source uniquement
 * @returns {object|null}
 */
export function findMatchingSection(name, existingSections) {
  const key = normalizeForDedup(name);
  if (!key) return null;
  return (existingSections || []).find(function(s) { return normalizeForDedup(s.name) === key; }) || null;
}

/**
 * Meme principe pour une competence (recherche par libelle/`name`).
 * @param {string} label
 * @param {Array<object>} existingCompetencies
 * @returns {object|null}
 */
export function findMatchingCompetency(label, existingCompetencies) {
  const key = normalizeForDedup(label);
  if (!key) return null;
  return (existingCompetencies || []).find(function(c) { return normalizeForDedup(c.name) === key; }) || null;
}

/**
 * Cle de cache STABLE pour une source (utilisee par le cache en memoire
 * du moteur pendant UNE synchronisation - jamais persistee).
 * @param {string} name
 * @returns {string}
 */
export function sourceCacheKey(name) {
  return normalizeForDedup(name);
}

/**
 * Cle de cache pour une section - PREFIXEE par l'id de sa source deja
 * resolue, pour ne jamais dedoublonner deux sections de sources
 * differentes portant le meme nom (ex. "Introduction" dans deux sources).
 * @param {string} sourceId
 * @param {string} name
 * @returns {string}
 */
export function sectionCacheKey(sourceId, name) {
  return String(sourceId) + '::' + normalizeForDedup(name);
}

/**
 * Cle de cache pour une competence.
 * @param {string} label
 * @returns {string}
 */
export function competencyCacheKey(label) {
  return normalizeForDedup(label);
}

/**
 * EXIGENCE EXPLICITE (Sprint 22) : "les compteurs ne doivent être mis à
 * jour que pour les écritures réellement réussies". Calcule les deltas
 * de compteur PAR SOURCE et PAR SECTION, uniquement a partir des
 * questions d'un chunk dont l'ecriture Firestore a REELLEMENT reussi
 * (jamais a partir d'un chunk en echec, meme partiellement).
 *
 * PERIMETRE ASSUME DE CETTE PREMIERE VERSION (documente, pas cache) :
 * ne calcule un delta que pour les questions CREEES (action==='create').
 * Une question MISE A JOUR dont la source/section a change necessite un
 * delta de deplacement (ancien -1 / nouveau +1) que cette fonction ne
 * calcule PAS encore - ce cas (rare : reclassification d'une question
 * deja synchronisee lors d'un resynchronisation ulterieure) reste couvert
 * par la reconciliation manuelle existante (admin/document-sources.js).
 *
 * @param {Array<object>} createdInChunk - questions de action==='create'
 *   dont l'ecriture a reussi, chacune avec {documentSourceId, documentSectionId}
 * @param {Array<object>} allSections - TOUTES les sections connues (pour
 *   propager le total aux sections ancetres, meme logique que
 *   rebuildSectionCounts() de document-count-service.js)
 * @param {function(object):{ancestorIds:Array<string>, anomaly:(string|null)}} getAncestorIdsFn
 *   - INJECTEE (reutilise getSectionAncestorIds() de document-count-
 *   service.js cote appelant reel) : ce fichier reste sans aucune
 *   dependance Firestore, y compris transitive, pour rester testable.
 * @returns {{sourceDeltas: Map<string, number>, sectionDirectDeltas: Map<string, number>, sectionTotalDeltas: Map<string, number>, anomalies: Array<string>}}
 */
export function computeCounterDeltasForSuccessfulCreations(createdInChunk, allSections, getAncestorIdsFn) {
  const sourceDeltas = new Map();
  const sectionDirectDeltas = new Map();
  const sectionTotalDeltas = new Map();
  const anomalies = [];

  const sectionsById = {};
  (allSections || []).forEach(function(s) { sectionsById[s.id] = s; });

  (createdInChunk || []).forEach(function(q) {
    if (q.documentSourceId) {
      sourceDeltas.set(q.documentSourceId, (sourceDeltas.get(q.documentSourceId) || 0) + 1);
    }
    if (q.documentSectionId && sectionsById[q.documentSectionId]) {
      sectionDirectDeltas.set(q.documentSectionId, (sectionDirectDeltas.get(q.documentSectionId) || 0) + 1);
      sectionTotalDeltas.set(q.documentSectionId, (sectionTotalDeltas.get(q.documentSectionId) || 0) + 1);
      const resolved = getAncestorIdsFn(sectionsById[q.documentSectionId]);
      if (resolved.anomaly && anomalies.indexOf(resolved.anomaly) === -1) anomalies.push(resolved.anomaly);
      resolved.ancestorIds.forEach(function(ancId) {
        sectionTotalDeltas.set(ancId, (sectionTotalDeltas.get(ancId) || 0) + 1);
      });
    }
  });

  return { sourceDeltas: sourceDeltas, sectionDirectDeltas: sectionDirectDeltas, sectionTotalDeltas: sectionTotalDeltas, anomalies: anomalies };
}

/**
 * Format standard d'un identifiant pedagogique (jamais duplique en dur
 * ailleurs) - "PHARM-{code 3 lettres}-{sequence 6 chiffres}".
 * @param {string} themeCode3Letters
 * @param {number} sequence
 * @returns {string}
 */
export function formatPedagogicalId(themeCode3Letters, sequence) {
  return 'PHARM-' + String(themeCode3Letters || 'GEN').toUpperCase() + '-' + String(sequence).padStart(6, '0');
}
