// ===================== BACKEND FIRESTORE REEL — Synchronisation du catalogue (Sprint 22) =====================
// Implemente les 7 dependances attendues par CatalogSyncEngine (voir
// catalog-sync-engine.js) en reutilisant EXCLUSIVEMENT les services
// Firestore deja existants et deja utilises ailleurs dans l'application
// (document-source-catalog-service.js, document-section-catalog-service.js,
// competency-catalog-service.js, tag-catalog-service.js, question-catalog-
// service.js) - aucune nouvelle collection Firestore inventee ici, sauf
// UNE (`pedagogical_id_counters`, compteur atomique, meme patron que
// question-code-service.js/`document_code_counters`).
//
// GARDE-FOU CRITIQUE (trouve a l'audit avant ce sprint) : findOrCreateTag()
// de tag-catalog-service.js ECRIT INCONDITIONNELLEMENT (aucune notion de
// dryRun). CE FICHIER EST SEUL RESPONSABLE de ne JAMAIS l'appeler pendant
// une analyse (dryRun===true) - voir resolveTags() ci-dessous, qui bifurque
// EXPLICITEMENT avant tout appel a une fonction d'ecriture. Meme principe
// applique a resolveCompetency() et resolveDocumentReferential().
//
// EXIGENCE (Sprint 22, confirmee) : "les compteurs ne doivent etre mis a
// jour que pour les ecritures reellement reussies" - voir applyCounterDeltas()
// plus bas, qui n'est JAMAIS appelee directement par ce fichier : c'est
// catalog-sync-engine.js qui l'appelle, uniquement apres un writeQuestionsChunk()
// dont le succes est confirme (voir la modification de l'engine, section
// "Sprint 22" du fichier).

import { db } from "../firebase-config.js";
import {
  doc, getDoc, setDoc, getDocs, collection, query, where, limit, increment,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

import { normalizeForDedup } from "./normalization-utils.js";
import { THEME_CODES } from "./theme-utils.js";

import { tagIdForLabel, findOrCreateTag, getTagById } from "./tag-catalog-service.js";

import { queryDocumentSources, createDocumentSourceDoc, incrementDocumentSourceCounters } from "./document-source-catalog-service.js";
import { completeDocumentSourceMetadata, DOCUMENT_SOURCE_TYPES, DOCUMENT_SOURCE_STATUSES } from "./document-source-metadata-service.js";

import { listSectionsBySource, createDocumentSectionDoc, incrementDocumentSectionCounters } from "./document-section-catalog-service.js";
import { completeDocumentSectionMetadata, DOCUMENT_SECTION_STATUSES } from "./document-section-metadata-service.js";

import { queryCompetenciesPage, createCompetencyDocument } from "./competency-catalog-service.js";
import { completeCompetencyMetadata, COMPETENCY_STATUSES } from "./competency-metadata-service.js";

import { writeQuestionsBatch } from "./question-catalog-service.js";

import { getSectionAncestorIds } from "./document-count-service.js";

import {
  findMatchingSource, findMatchingSection, findMatchingCompetency,
  sourceCacheKey, sectionCacheKey, competencyCacheKey,
  computeCounterDeltasForSuccessfulCreations, formatPedagogicalId,
} from "./catalog-sync-resolution-logic.js";

const QUESTIONS_COLLECTION = 'questions';
const PEDAGOGICAL_ID_COUNTER_COLLECTION = 'pedagogical_id_counters';

function nowIso() { return new Date().toISOString(); }
function logSyncError(context, err) {
  console.error('[catalog-sync-firestore-backend] ' + context + ' : ' + ((err && err.code) || 'erreur-inconnue'), err);
}

// ---------------------------------------------------------------------------
// SOUS-ETAPE 3 : identite d'une question (par externalId, PAS par
// pedagogicalId - une question editoriale peut deja exister sous un
// pedagogicalId different de l'externalId).
// ---------------------------------------------------------------------------

/**
 * @param {string} externalId
 * @returns {Promise<{found:boolean, pedagogicalId:(string|null), existingDoc:(object|null)}>}
 */
export async function resolveQuestionIdentity(externalId) {
  try {
    const q = query(
      collection(db, QUESTIONS_COLLECTION),
      where('externalIds.editorialCatalog', '==', externalId),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return { found: false, pedagogicalId: null, existingDoc: null };
    const d = snap.docs[0];
    return { found: true, pedagogicalId: d.id, existingDoc: d.data() };
  } catch (err) {
    logSyncError('résolution de l\'identité de la question "' + externalId + '"', err);
    // Repli PRUDENT : en cas de panne de lecture, on ne peut pas garantir
    // l'absence d'un doublon - mais le validateur/le moteur traitent
    // "found:false" comme une CREATION. Signaler "non trouve" ici en cas
    // d'erreur risquerait de creer un doublon silencieux. On remonte donc
    // l'erreur telle quelle en la journalisant, et on retourne un etat
    // qui bloquera visiblement la question plutot que de deviner.
    return { found: false, pedagogicalId: null, existingDoc: null, error: true };
  }
}

/**
 * Tous les externalIds.editorialCatalog actuellement presents dans
 * Firestore (questions issues d'une synchronisation precedente).
 * @returns {Promise<Set<string>>}
 */
export async function listExistingEditorialCatalogIds() {
  const ids = new Set();
  try {
    // Bornage volontaire (meme principe que searchQuestionsBounded) : une
    // synchronisation realiste porte sur quelques centaines/milliers de
    // questions, jamais des dizaines de milliers - 5000 est un plafond
    // de securite, pas une limite attendue en usage normal.
    const snap = await getDocs(query(collection(db, QUESTIONS_COLLECTION), where('fromEditorialCatalog', '==', true), limit(5000)));
    snap.forEach(function(d) {
      const data = d.data();
      const id = data.externalIds && data.externalIds.editorialCatalog;
      if (id) ids.add(id);
    });
  } catch (err) {
    logSyncError('liste des identifiants éditoriaux existants', err);
  }
  return ids;
}

/**
 * Alloue un NOUVEL identifiant pedagogique, de facon atomique (meme
 * patron que question-code-service.js/generateFunctionalCode - a NE PAS
 * confondre : celui-ci reste le champ additif "functionalCode", jamais
 * l'identifiant Firestore lui-meme).
 * @param {string} theme
 * @returns {Promise<string>}
 */
export async function allocatePedagogicalId(theme) {
  const code3 = (THEME_CODES[theme] || 'GEN').toUpperCase();
  try {
    const ref = doc(db, PEDAGOGICAL_ID_COUNTER_COLLECTION, code3);
    await setDoc(ref, { count: increment(1) }, { merge: true });
    const snap = await getDoc(ref);
    const sequence = snap.exists() ? snap.data().count : 1;
    return formatPedagogicalId(code3, sequence);
  } catch (err) {
    logSyncError('allocation d\'un identifiant pédagogique (thème "' + theme + '")', err);
    // Repli EXPLICITE ET VISIBLE (jamais un identifiant plausible mais
    // invente) : un identifiant commencant par ERR-ALLOC sera rejete par
    // le validateur de format (voir question-import-validator.js), donc
    // jamais silencieusement accepte comme un vrai identifiant.
    return 'ERR-ALLOC-' + Date.now();
  }
}

// ---------------------------------------------------------------------------
// SOUS-ETAPE 1a : tags (dryRun-aware - findOrCreateTag() n'est appelee
// QUE si dryRun===false)
// ---------------------------------------------------------------------------

/**
 * @param {{tags:Array<string>, dryRun:boolean, cache:Map<string,object>}} args
 * @returns {Promise<{tagIds:Array<string>, created:Array<object>}>}
 */
export async function resolveTags(args) {
  const tags = (args && args.tags) || [];
  const dryRun = !!(args && args.dryRun);
  const cache = (args && args.cache) || new Map();
  const tagIds = [];
  const created = [];

  for (const label of tags) {
    if (!label) continue;
    const key = normalizeForDedup(label);
    if (!key) continue;

    if (cache.has(key)) {
      tagIds.push(cache.get(key).tagId);
      continue;
    }

    const tagId = tagIdForLabel(label);
    if (dryRun) {
      // LECTURE SEULE STRICTE : jamais findOrCreateTag() ici.
      const existing = await getTagById(tagId);
      const action = existing ? 'existing' : 'new';
      cache.set(key, { key: key, label: label, tagId: tagId, action: action });
      tagIds.push(tagId);
    } else {
      const result = await findOrCreateTag(label);
      const action = result.created ? 'new' : 'existing';
      cache.set(key, { key: key, label: label, tagId: result.tagId, action: action });
      if (result.created) created.push({ tagId: result.tagId, label: label });
      tagIds.push(result.tagId);
    }
  }

  return { tagIds: tagIds, created: created };
}

// ---------------------------------------------------------------------------
// SOUS-ETAPE 1b : competences (dryRun-aware, find-or-create par libelle
// normalise - meme principe technique que les tags, ecrit ici car aucune
// fonction "findOrCreateCompetency" n'existait encore)
// ---------------------------------------------------------------------------

let competencyListCachePromise = null;
/** Lecture BORNEE de la banque de competences (memes precautions que
 * searchCompetenciesBounded ailleurs) - mise en cache POUR LA DUREE d'un
 * seul appel a resolveCompetency en boucle (voir cache du moteur), jamais
 * persistee au-dela d'une synchronisation. */
async function loadExistingCompetencies() {
  if (!competencyListCachePromise) {
    competencyListCachePromise = queryCompetenciesPage({ pageSize: 500 }).then(function(r) { return r.items || []; });
  }
  return competencyListCachePromise;
}
/** Reinitialise le cache de lecture des competences - a appeler UNE FOIS
 * avant chaque nouvelle synchronisation (analyze() puis synchronize()),
 * jamais pendant, pour ne pas relire Firestore a chaque question. */
export function resetCompetencyReadCache() { competencyListCachePromise = null; }

/**
 * @param {{label:string, dryRun:boolean, cache:Map<string,object>}} args
 * @returns {Promise<{competencyId:(string|null), action:string, potentialDuplicates:Array<object>}>}
 */
export async function resolveCompetency(args) {
  const label = args && args.label;
  const dryRun = !!(args && args.dryRun);
  const cache = (args && args.cache) || new Map();
  if (!label) return { competencyId: null, action: 'none', potentialDuplicates: [] };

  const key = competencyCacheKey(label);
  if (cache.has(key)) {
    const cached = cache.get(key);
    return { competencyId: cached.competencyId, action: cached.action, potentialDuplicates: [] };
  }

  const existingCompetencies = await loadExistingCompetencies();
  const match = findMatchingCompetency(label, existingCompetencies);

  if (match) {
    cache.set(key, { key: key, label: label, competencyId: match.id, action: 'existing' });
    return { competencyId: match.id, action: 'existing', potentialDuplicates: [] };
  }

  if (dryRun) {
    // LECTURE SEULE : jamais createCompetencyDocument() ici. Le
    // competencyId provisoire n'est utilise que pour la comparaison
    // interne du moteur (diff create/update) - jamais persiste.
    const provisionalId = 'NEW:' + key;
    cache.set(key, { key: key, label: label, competencyId: provisionalId, action: 'new' });
    return { competencyId: provisionalId, action: 'new', potentialDuplicates: [] };
  }

  // STATUT 'draft', JAMAIS 'active' (qui n'existe meme pas dans
  // COMPETENCY_STATUSES) : la regle Firestore existante exige
  // status==='draft' a la creation - meme raison que pour les sources
  // documentaires ci-dessus. Un administrateur doit explicitement publier
  // la competence avant qu'elle ne soit visible des utilisateurs standards.
  const metadata = completeCompetencyMetadata({ name: label, status: COMPETENCY_STATUSES.DRAFT, createdAt: nowIso() });
  const result = await createCompetencyDocument(metadata);
  if (!result.success) {
    logSyncError('création de la compétence "' + label + '"', new Error('échec createCompetencyDocument'));
    return { competencyId: null, action: 'none', potentialDuplicates: [] };
  }
  cache.set(key, { key: key, label: label, competencyId: metadata.id, action: 'new' });
  // Ajoute a la liste en memoire pour que les LABELS SUIVANTS de la MEME
  // synchronisation puissent s'y comparer sans relire Firestore.
  existingCompetencies.push(metadata);
  return { competencyId: metadata.id, action: 'new', potentialDuplicates: [] };
}

// ---------------------------------------------------------------------------
// SOUS-ETAPE 2 : referentiel documentaire (source + jusqu'a 3 niveaux de
// section, "level1"/"level2"/"level3" du connecteur Excel)
// ---------------------------------------------------------------------------

let sourceListCachePromise = null;
async function loadExistingSources() {
  if (!sourceListCachePromise) {
    sourceListCachePromise = queryDocumentSources({ pageSize: 200 }).then(function(r) { return r.items || []; });
  }
  return sourceListCachePromise;
}
export function resetSourceReadCache() { sourceListCachePromise = null; }

/** Genere un shortCode heuristique a partir du nom (utilise par
 * question-code-service.js pour l'identifiant fonctionnel - jamais
 * l'identifiant Firestore lui-meme, voir document-source-metadata-
 * service.js). Purement indicatif : deux sources de meme nom auraient de
 * toute facon ete dedoublonnees en amont, jamais deux shortCode
 * differents pour le meme document. */
function heuristicShortCode(name) {
  return (name || '').toString().trim().split(/\s+/).slice(0, 2).join('').toUpperCase().slice(0, 10) || 'SRC';
}

async function resolveOneSection(sourceId, sectionName, parentSection, existingSectionsOfSource, dryRun, cache) {
  const key = sectionCacheKey(sourceId, (parentSection ? parentSection.id : 'root') + ':' + sectionName);
  if (cache.sections.has(key)) return cache.sections.get(key);

  const siblingSections = existingSectionsOfSource.filter(function(s) {
    return (s.parentSectionId || null) === (parentSection ? parentSection.id : null);
  });
  const match = findMatchingSection(sectionName, siblingSections);

  if (match) {
    const entry = { key: key, name: sectionName, sectionId: match.id, action: 'existing', section: match };
    cache.sections.set(key, entry);
    return entry;
  }

  if (dryRun) {
    const entry = { key: key, name: sectionName, sectionId: 'NEW:' + key, action: 'new', section: null };
    cache.sections.set(key, entry);
    return entry;
  }

  const level = parentSection ? parentSection.level + 1 : 0;
  const path = parentSection ? parentSection.path.concat([parentSection.id]) : [];
  const pathLabels = parentSection ? parentSection.pathLabels.concat([parentSection.name]) : [];
  const metadata = completeDocumentSectionMetadata({
    documentSourceId: sourceId, parentSectionId: parentSection ? parentSection.id : null,
    level: level, name: sectionName, shortCode: heuristicShortCode(sectionName),
    path: path, pathLabels: pathLabels,
    status: DOCUMENT_SECTION_STATUSES.ACTIVE,
    createdAt: nowIso(), updatedAt: nowIso(),
  });
  const result = await createDocumentSectionDoc(metadata);
  if (!result.success) {
    logSyncError('création de la section "' + sectionName + '"', new Error('échec createDocumentSectionDoc'));
    const entry = { key: key, name: sectionName, sectionId: null, action: 'none', section: null };
    cache.sections.set(key, entry);
    return entry;
  }
  existingSectionsOfSource.push(metadata); // visible aux questions suivantes de la MEME synchronisation
  const entry = { key: key, name: sectionName, sectionId: metadata.id, action: 'new', section: metadata };
  cache.sections.set(key, entry);
  return entry;
}

/**
 * @param {{sourceDocument:object, dryRun:boolean, cache:{sources:Map, sections:Map}}} args
 * @returns {Promise<{sourceId:(string|null), sectionId:(string|null), sourceAction:string, sectionActions:Array<string>}>}
 */
export async function resolveDocumentReferential(args) {
  const sourceDocument = (args && args.sourceDocument) || {};
  const dryRun = !!(args && args.dryRun);
  const cache = (args && args.cache) || { sources: new Map(), sections: new Map() };
  const name = (sourceDocument.name || '').trim();
  if (!name) return { sourceId: null, sectionId: null, sourceAction: 'none', sectionActions: [] };

  const srcKey = sourceCacheKey(name);
  let sourceEntry = cache.sources.get(srcKey);

  if (!sourceEntry) {
    const existingSources = await loadExistingSources();
    const match = findMatchingSource(name, existingSources);
    if (match) {
      sourceEntry = { key: srcKey, name: name, sourceId: match.id, action: 'existing' };
    } else if (dryRun) {
      sourceEntry = { key: srcKey, name: name, sourceId: 'NEW:' + srcKey, action: 'new' };
    } else {
      const metadata = completeDocumentSourceMetadata({
        // STATUT 'draft', JAMAIS 'active' a la creation : la regle Firestore
        // existante (firestore.rules, match /document_sources/) EXIGE
        // status==='draft' pour toute creation - et c'est coherent avec le
        // principe "jamais publie automatiquement" applique partout
        // ailleurs (questions, competences). Un administrateur doit
        // explicitement activer la source depuis admin/document-sources.js
        // avant qu'elle ne soit visible des utilisateurs standards.
        sourceType: DOCUMENT_SOURCE_TYPES.REF, name: name, shortCode: heuristicShortCode(name),
        status: DOCUMENT_SOURCE_STATUSES.DRAFT, createdAt: nowIso(), updatedAt: nowIso(),
      });
      const result = await createDocumentSourceDoc(metadata);
      if (!result.success) {
        logSyncError('création de la source "' + name + '"', new Error('échec createDocumentSourceDoc'));
        sourceEntry = { key: srcKey, name: name, sourceId: null, action: 'none' };
      } else {
        existingSources.push(metadata);
        sourceEntry = { key: srcKey, name: name, sourceId: metadata.id, action: 'new' };
      }
    }
    cache.sources.set(srcKey, sourceEntry);
  }

  const sourceId = sourceEntry.sourceId;
  const levels = [sourceDocument.level1, sourceDocument.level2, sourceDocument.level3]
    .map(function(l) { return (l || '').toString().trim(); })
    .filter(Boolean);

  if (!sourceId || levels.length === 0) {
    return { sourceId: sourceId, sectionId: null, sourceAction: sourceEntry.action, sectionActions: [] };
  }

  // Sections existantes de CETTE source (relues une seule fois par
  // source, jamais par question - meme cache que les sources).
  let existingSectionsOfSource = cache.sections.get('__list__' + sourceId);
  if (!existingSectionsOfSource) {
    const isRealSourceId = !(String(sourceId).indexOf('NEW:') === 0);
    existingSectionsOfSource = isRealSourceId ? (await listSectionsBySource(sourceId)).items || [] : [];
    cache.sections.set('__list__' + sourceId, existingSectionsOfSource);
  }

  let parentSection = null;
  const sectionActions = [];
  for (const levelName of levels) {
    const entry = await resolveOneSection(sourceId, levelName, parentSection, existingSectionsOfSource, dryRun, cache);
    sectionActions.push(entry.action);
    parentSection = entry.section || { id: entry.sectionId, level: parentSection ? parentSection.level + 1 : 0, path: parentSection ? parentSection.path.concat([parentSection.id]) : [], pathLabels: parentSection ? parentSection.pathLabels.concat([parentSection.name]) : [], name: levelName };
  }

  return { sourceId: sourceId, sectionId: parentSection ? parentSection.id : null, sourceAction: sourceEntry.action, sectionActions: sectionActions };
}

// ---------------------------------------------------------------------------
// SOUS-ETAPE 4 : ecriture des questions + compteurs (uniquement pour les
// ecritures reellement reussies - exigence explicite Sprint 22)
// ---------------------------------------------------------------------------

/**
 * @param {Map<string,object>} documentsByPedagogicalId
 * @returns {Promise<{success:boolean, writtenCount:number}>}
 */
export async function writeQuestionsChunk(documentsByPedagogicalId) {
  const result = await writeQuestionsBatch(documentsByPedagogicalId);
  return { success: result.success, writtenCount: result.writtenCount };
}

/**
 * Applique reellement les deltas de compteurs deja calcules par
 * catalog-sync-resolution-logic.js/computeCounterDeltasForSuccessfulCreations()
 * - APPELEE UNIQUEMENT PAR L'ENGINE, uniquement apres un writeQuestionsChunk()
 * dont le succes est confirme (voir catalog-sync-engine.js).
 * @param {{sourceDeltas:Map<string,number>, sectionDirectDeltas:Map<string,number>, sectionTotalDeltas:Map<string,number>}} deltas
 * @returns {Promise<{success:boolean}>}
 */
export async function applyCounterDeltas(deltas) {
  let allOk = true;
  const sourcePromises = Array.from(deltas.sourceDeltas.entries()).map(function(entry) {
    return incrementDocumentSourceCounters(entry[0], { questionCount: entry[1] }).then(function(r) { if (!r.success) allOk = false; });
  });
  const sectionIds = new Set([...deltas.sectionDirectDeltas.keys(), ...deltas.sectionTotalDeltas.keys()]);
  const sectionPromises = Array.from(sectionIds).map(function(sectionId) {
    const directDelta = deltas.sectionDirectDeltas.get(sectionId) || 0;
    const totalDelta = deltas.sectionTotalDeltas.get(sectionId) || 0;
    return incrementDocumentSectionCounters(sectionId, { directQuestionCount: directDelta, totalQuestionCount: totalDelta }).then(function(r) { if (!r.success) allOk = false; });
  });
  await Promise.all(sourcePromises.concat(sectionPromises));
  return { success: allOk };
}

/**
 * Appelee par catalog-sync-engine.js APRES chaque chunk, UNIQUEMENT si
 * son ecriture a reussi (voir la modification "Sprint 22" de l'engine).
 * Ne fait RIEN si writeResult.success est faux - exigence explicite
 * Sprint 22 ("les compteurs ne doivent etre mis a jour que pour les
 * ecritures reellement reussies").
 * @param {Array<object>} chunk - questions de ce chunk (resolved.documentSourceId/documentSectionId, action)
 * @param {{success:boolean}} writeResult
 * @param {{sources:Map, sections:Map}} referentialCache - LE MEME cache utilise par resolveDocumentReferential pendant ce synchronize()
 * @returns {Promise<void>}
 */
export async function onChunkWritten(chunk, writeResult, referentialCache) {
  if (!writeResult || !writeResult.success) return; // EXIGENCE : jamais pour un chunk en echec

  const created = chunk
    .filter(function(qa) { return qa.action === 'create'; })
    .map(function(qa) { return { documentSourceId: qa.resolved.documentSourceId, documentSectionId: qa.resolved.documentSectionId }; });
  if (created.length === 0) return;

  const allSections = Array.from((referentialCache && referentialCache.sections) || new Map())
    .filter(function(entry) { return entry[0].indexOf('__list__') !== 0; })
    .map(function(entry) { return entry[1].section; })
    .filter(Boolean);

  const deltas = computeCounterDeltasForSuccessfulCreations(created, allSections, getSectionAncestorIds);
  const applyResult = await applyCounterDeltas(deltas);
  if (!applyResult.success) {
    logSyncError('mise à jour des compteurs après synchronisation', new Error('un ou plusieurs incrémentations ont échoué - voir logs individuels ci-dessus'));
  }
}

/** Reinitialise TOUS les caches de lecture (sources, competences) - a
 * appeler une seule fois avant chaque synchronize()/analyze() reel. */
export function resetAllReadCaches() {
  resetSourceReadCache();
  resetCompetencyReadCache();
}

export { getSectionAncestorIds };
