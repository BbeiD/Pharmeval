// ===================== SERVICE CENTRALISÉ DES COMPTEURS DOCUMENTAIRES (Correctif Sprint 20) =====================
// PRINCIPE FONDAMENTAL (à documenter explicitement, comme demandé) :
// -------------------------------------------------------------------
// Les QUESTIONS CLASSIFIÉES (leurs champs `documentSourceId`/
// `documentSectionId`) constituent la SEULE vérité métier. Les compteurs
// portés par `document_sources.questionCount` et par
// `document_sections.directQuestionCount`/`totalQuestionCount` sont des
// DONNÉES DÉRIVÉES ET RECONSTRUISIBLES : ils accélèrent l'affichage
// (éviter un comptage en direct à chaque ouverture d'écran), mais ne sont
// JAMAIS une vérité indépendante. En cas de doute, la fonction de
// réconciliation de ce fichier peut TOUJOURS recalculer la valeur exacte
// à partir des questions réellement classifiées - jamais l'inverse.
// -------------------------------------------------------------------
//
// SEUL fichier du projet autorisé à modifier `questionCount` (source),
// `directQuestionCount`/`totalQuestionCount` (section). Aucune page HTML,
// aucun autre service ne doit jamais appeler `increment()` directement
// sur ces trois champs - toujours passer par applyClassificationDelta()
// (une question) ou applyBulkClassificationDeltas() (un lot).
//
// Note : `document_sources.sectionCount` et `document_sections.
// childSectionCount` (nombre de SECTIONS, pas de questions) restent gérés
// par document-section-service.js via les fonctions d'incrément simples
// existantes - HORS PÉRIMÈTRE de ce correctif, qui ne porte que sur les
// compteurs DE QUESTIONS.

import { db, auth } from "../firebase-config.js";
import {
  query, collection, where, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { API_BASE_URL } from "../config.js";
import { getCurrentUserContext } from "./app-context.js";
import { logAction } from "./audit-service.js";
import { updateQuestionClassification } from "./question-catalog-service.js";
import { getDocumentSourceById, updateDocumentSourceFields, queryDocumentSources } from "./document-source-catalog-service.js";
import { getDocumentSectionById, listSectionsBySource, updateDocumentSectionFields } from "./document-section-catalog-service.js";

async function callClassificationApi(path, body) {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

/** Garde-fou contre une arborescence corrompue - jamais une hypothèse de
 * profondeur "raisonnable" non vérifiée. */
const MAX_SECTION_DEPTH = 50;

/** Nombre de questions dont la classification d'ORIGINE est relue en une
 * seule fois lors de la préparation d'un lot - lecture par lot, jamais un
 * balayage complet de la banque. */
const PREP_CHUNK_SIZE = 30;

/** Nombre d'écritures de questions traitées en parallèle borné lors de
 * l'application d'un lot. */
const APPLY_CHUNK_SIZE = 25;

// ---------------------------------------------------------------------------
// Résolution des ancêtres (avec garde-fous explicites)
// ---------------------------------------------------------------------------

/**
 * Retourne la chaîne d'ancêtres d'une section (racine → ... → parent
 * direct), à partir de son champ `path` déjà maintenu (voir
 * document-section-service.js, moveDocumentSection()). Détecte - sans
 * jamais planter - une arborescence corrompue : cycle (un identifiant
 * apparaissant plusieurs fois) ou profondeur anormale.
 * @param {object} section
 * @returns {{ancestorIds:Array<string>, anomaly:(string|null)}}
 */
export function getSectionAncestorIds(section) {
  const path = Array.isArray(section && section.path) ? section.path : [];
  const unique = new Set(path);
  if (unique.size !== path.length) {
    return { ancestorIds: [], anomaly: 'Cycle détecté dans le chemin de la section "' + section.id + '" (un ancêtre apparaît plusieurs fois) — réconciliation recommandée.' };
  }
  if (path.length > MAX_SECTION_DEPTH) {
    return { ancestorIds: [], anomaly: 'Profondeur anormale (' + path.length + ' > ' + MAX_SECTION_DEPTH + ') pour la section "' + section.id + '" — réconciliation recommandée.' };
  }
  return { ancestorIds: path.slice(), anomaly: null };
}

// ---------------------------------------------------------------------------
// Calcul pur des deltas (aucun accès Firestore ici)
// ---------------------------------------------------------------------------

/**
 * Compare deux destinations (`{sourceId, sectionId}` ou `null`).
 * @returns {boolean}
 */
export function isSameDestination(a, b) {
  const aSource = (a && a.sourceId) || null;
  const aSection = (a && a.sectionId) || null;
  const bSource = (b && b.sourceId) || null;
  const bSection = (b && b.sectionId) || null;
  return aSource === bSource && aSection === bSection;
}

/**
 * Calcule le delta EXACT à appliquer aux compteurs pour UNE question qui
 * passe d'une ancienne destination à une nouvelle - la fonction centrale
 * de ce correctif. Pure (aucun accès Firestore) : les ancêtres de chaque
 * section doivent être résolus AU PRÉALABLE par l'appelant et fournis ici
 * via `getAncestorIdsFn`, pour permettre de calculer un delta agrégé sur
 * tout un lot sans relire vingt fois la même section.
 *
 * "Attention aux ancêtres communs... Calculer un delta net par document."
 * (cadrage) : obtenu NATURELLEMENT par la sommation algébrique ci-dessous
 * (un ancêtre commun reçoit -1 puis +1, qui s'annulent directement dans
 * le même objet accumulateur) - aucune détection explicite d'intersection
 * n'est nécessaire.
 *
 * @param {{sourceId:string, sectionId:(string|null)}|null} oldDest
 * @param {{sourceId:string, sectionId:(string|null)}|null} newDest
 * @param {function(string):Array<string>} getAncestorIdsFn
 * @returns {{sourceDeltas:Object<string,number>, sectionDeltas:Object<string,{direct:number,total:number}>}}
 */
export function computeClassificationDelta(oldDest, newDest, getAncestorIdsFn) {
  const sourceDeltas = {};
  const sectionDeltas = {};

  function addSource(id, delta) {
    if (!id) return;
    sourceDeltas[id] = (sourceDeltas[id] || 0) + delta;
  }
  function addSection(id, direct, total) {
    if (!id) return;
    if (!sectionDeltas[id]) sectionDeltas[id] = { direct: 0, total: 0 };
    sectionDeltas[id].direct += direct;
    sectionDeltas[id].total += total;
  }

  if (oldDest && oldDest.sourceId) {
    addSource(oldDest.sourceId, -1);
    if (oldDest.sectionId) {
      addSection(oldDest.sectionId, -1, -1);
      getAncestorIdsFn(oldDest.sectionId).forEach(function(ancId) { addSection(ancId, 0, -1); });
    }
  }
  if (newDest && newDest.sourceId) {
    addSource(newDest.sourceId, 1);
    if (newDest.sectionId) {
      addSection(newDest.sectionId, 1, 1);
      getAncestorIdsFn(newDest.sectionId).forEach(function(ancId) { addSection(ancId, 0, 1); });
    }
  }

  Object.keys(sourceDeltas).forEach(function(id) { if (sourceDeltas[id] === 0) delete sourceDeltas[id]; });
  Object.keys(sectionDeltas).forEach(function(id) {
    if (sectionDeltas[id].direct === 0 && sectionDeltas[id].total === 0) delete sectionDeltas[id];
  });

  return { sourceDeltas: sourceDeltas, sectionDeltas: sectionDeltas };
}

/**
 * Additionne deux structures de deltas ("construire une structure
 * agrégée", cadrage).
 * @param {object} accumulator
 * @param {object} delta
 * @returns {object} l'accumulateur, modifié en place
 */
function mergeDeltas(accumulator, delta) {
  Object.keys(delta.sourceDeltas).forEach(function(id) {
    accumulator.sourceDeltas[id] = (accumulator.sourceDeltas[id] || 0) + delta.sourceDeltas[id];
  });
  Object.keys(delta.sectionDeltas).forEach(function(id) {
    if (!accumulator.sectionDeltas[id]) accumulator.sectionDeltas[id] = { direct: 0, total: 0 };
    accumulator.sectionDeltas[id].direct += delta.sectionDeltas[id].direct;
    accumulator.sectionDeltas[id].total += delta.sectionDeltas[id].total;
  });
  return accumulator;
}

// ---------------------------------------------------------------------------
// Application INDIVIDUELLE (transaction Firestore, cote serveur)
// ---------------------------------------------------------------------------

/**
 * Applique un changement de classification pour UNE question, de façon
 * transactionnelle : la question elle-même ET tous les compteurs affectés
 * (ancienne/nouvelle source, ancienne/nouvelle section + tous leurs
 * ancêtres) sont lus et écrits dans LA MÊME transaction Firestore.
 *
 * "Cas 5 — Destination identique" : no-op idempotent (aucune écriture,
 * aucun audit) si la nouvelle destination est strictement identique.
 *
 * @param {string} pedagogicalId
 * @param {{sourceId:string, sectionId:(string|null)}} newDest
 * @param {{functionalCode?:string}} [extraFields]
 * @returns {Promise<{status:string, message:string, inconsistencies:Array<string>}>}
 */
export async function applyClassificationDelta(pedagogicalId, newDest, extraFields) {
  try {
    const res = await callClassificationApi('/api/document-classification/apply-single', { pedagogicalId, newDest, extraFields });
    if (!res) return { status: 'error', message: 'Vous devez être connecté.', inconsistencies: [] };
    return await res.json();
  } catch (err) {
    console.error('[document-count-service] échec de applyClassificationDelta pour ' + pedagogicalId, err);
    return { status: 'error', message: 'La mise à jour transactionnelle a échoué (' + (err && err.message) + ').', inconsistencies: [] };
  }
}

// ---------------------------------------------------------------------------
// Application EN MASSE (préparer → valider → appliquer → vérifier → rapporter)
// ---------------------------------------------------------------------------

/**
 * ÉTAPE "Préparer" : relit la classification ACTUELLE de chaque question
 * du lot (jamais une hypothèse "toutes non classées") et calcule le delta
 * agrégé complet du lot, sans rien écrire.
 * @param {Array<object>} questions
 * @param {{sourceId:string, sectionId:(string|null)}} newDest
 * @returns {Promise<{toApply:Array<object>, alreadyInDestination:Array<string>, aggregated:object, ancestorAnomalies:Array<string>}>}
 */
export async function prepareBulkDeltas(questions, newDest) {
  const aggregated = { sourceDeltas: {}, sectionDeltas: {} };
  const toApply = [];
  const alreadyInDestination = [];
  const ancestorAnomalies = [];
  const sectionCache = new Map();

  async function getSectionCached(id) {
    if (!id) return null;
    if (sectionCache.has(id)) return sectionCache.get(id);
    const sec = await getDocumentSectionById(id);
    sectionCache.set(id, sec);
    return sec;
  }

  for (let i = 0; i < questions.length; i += PREP_CHUNK_SIZE) {
    const chunk = questions.slice(i, i + PREP_CHUNK_SIZE);
    for (const q of chunk) {
      const oldDest = q.documentSourceId ? { sourceId: q.documentSourceId, sectionId: q.documentSectionId || null } : null;
      if (isSameDestination(oldDest, newDest)) { alreadyInDestination.push(q.pedagogicalId); continue; }

      if (oldDest && oldDest.sectionId) await getSectionCached(oldDest.sectionId);
      if (newDest && newDest.sectionId) await getSectionCached(newDest.sectionId);

      const ancestorFn = function(sectionId) {
        const sec = sectionCache.get(sectionId);
        if (!sec) return [];
        const resolved = getSectionAncestorIds(sec);
        if (resolved.anomaly && ancestorAnomalies.indexOf(resolved.anomaly) === -1) ancestorAnomalies.push(resolved.anomaly);
        return resolved.ancestorIds;
      };

      const delta = computeClassificationDelta(oldDest, newDest, ancestorFn);
      mergeDeltas(aggregated, delta);
      toApply.push({ pedagogicalId: q.pedagogicalId, classificationVersion: q.classificationVersion || 0, oldDest: oldDest });
    }
  }

  return { toApply: toApply, alreadyInDestination: alreadyInDestination, aggregated: aggregated, ancestorAnomalies: ancestorAnomalies };
}

/**
 * ÉTAPE "Appliquer" : écrit les questions du lot (par petits chunks, champs
 * de classification uniquement) PUIS applique le delta AGRÉGÉ (un seul
 * ajustement net par source/section concernée, jamais un ajustement par
 * question) via des transactions individuelles gardées contre les valeurs
 * négatives.
 * @param {Array<object>} toApply
 * @param {{sourceId:string, sectionId:(string|null)}} newDest
 * @param {object} aggregated
 * @returns {Promise<{succeededIds:Array<string>, failedIds:Array<string>, inconsistencies:Array<string>}>}
 */
export async function applyBulkClassificationDeltas(toApply, newDest, aggregated) {
  const succeededIds = [];
  const failedIds = [];

  for (let i = 0; i < toApply.length; i += APPLY_CHUNK_SIZE) {
    const chunk = toApply.slice(i, i + APPLY_CHUNK_SIZE);
    const results = await Promise.all(chunk.map(async function(item) {
      try {
        const result = await updateQuestionClassification(item.pedagogicalId, {
          documentSourceId: (newDest && newDest.sourceId) || null,
          documentSectionId: (newDest && newDest.sectionId) || null,
          classificationVersion: (item.classificationVersion || 0) + 1,
        });
        return { pedagogicalId: item.pedagogicalId, ok: result.success };
      } catch (err) {
        console.error('[document-count-service] échec d\'écriture sur ' + item.pedagogicalId, err);
        return { pedagogicalId: item.pedagogicalId, ok: false };
      }
    }));
    results.forEach(function(r) { (r.ok ? succeededIds : failedIds).push(r.pedagogicalId); });
  }

  // Application du delta AGRÉGÉ - TOUJOURS appliqué, même en cas d'échecs
  // partiels sur l'écriture des questions : le rapport final signale
  // alors une divergence explicite plutôt que de la masquer, et
  // recommande une réconciliation ciblée.
  const inconsistencies = await applyAggregatedCounterDeltas(aggregated);

  return { succeededIds: succeededIds, failedIds: failedIds, inconsistencies: inconsistencies };
}

/**
 * Applique une structure de deltas déjà agrégée aux documents de
 * compteurs concernés - une petite transaction PAR DOCUMENT affecté,
 * jamais une transaction unique portant sur tout le lot. Chaque
 * transaction est protégée contre un passage sous zéro.
 * @param {{sourceDeltas:Object<string,number>, sectionDeltas:Object<string,{direct:number,total:number}>}} aggregated
 * @returns {Promise<Array<string>>}
 */
export async function applyAggregatedCounterDeltas(aggregated) {
  try {
    const res = await callClassificationApi('/api/document-classification/apply-aggregated-counters', { aggregated });
    if (!res) return ['Vous devez être connecté.'];
    const body = await res.json();
    return body.inconsistencies || [];
  } catch (err) {
    console.error('[document-count-service] échec de l\'application des deltas agrégés', err);
    return ['Impossible de mettre à jour les compteurs agrégés — réconciliation recommandée.'];
  }
}

// ---------------------------------------------------------------------------
// Réconciliation ("recalculer à partir de la vérité réelle des questions")
// ---------------------------------------------------------------------------

const RECONCILE_SCAN_LIMIT = 2000; // largement suffisant pour ~900 questions - voir RAPPORT_CORRECTIF_SPRINT20.md, "Limites connues"

async function fetchAllQuestionsOfSource(sourceId) {
  const snap = await getDocs(query(collection(db, 'questions'), where('documentSourceId', '==', sourceId), limit(RECONCILE_SCAN_LIMIT)));
  const items = [];
  snap.forEach(function(d) { items.push(d.data()); });
  return items;
}

/**
 * Recalcule le compteur `questionCount` RÉEL d'une source - ne modifie
 * RIEN (prévisualisation uniquement), voir applyReconciliation().
 * @param {string} sourceId
 * @returns {Promise<{sourceId:string, storedCount:number, actualCount:number, diff:number, truncated:boolean}>}
 */
export async function rebuildSourceCounts(sourceId) {
  const [source, questions] = await Promise.all([getDocumentSourceById(sourceId), fetchAllQuestionsOfSource(sourceId)]);
  const storedCount = (source && source.questionCount) || 0;
  const actualCount = questions.length; // "une question ne doit compter qu'une seule fois dans sa source" - garanti nativement par le filtre d'egalite Firestore
  return { sourceId: sourceId, storedCount: storedCount, actualCount: actualCount, diff: actualCount - storedCount, truncated: questions.length >= RECONCILE_SCAN_LIMIT };
}

/**
 * Recalcule les compteurs `directQuestionCount`/`totalQuestionCount`
 * RÉELS de TOUTES les sections d'une source - ne modifie RIEN.
 * @param {string} sourceId
 * @returns {Promise<{items:Array<object>, truncated:boolean, anomalies:Array<string>}>}
 */
export async function rebuildSectionCounts(sourceId) {
  const [sectionsResult, questions] = await Promise.all([listSectionsBySource(sourceId), fetchAllQuestionsOfSource(sourceId)]);
  const sections = sectionsResult.items || [];
  const sectionsById = {};
  sections.forEach(function(s) { sectionsById[s.id] = s; });

  const actualDirect = {};
  const actualTotal = {};
  sections.forEach(function(s) { actualDirect[s.id] = 0; actualTotal[s.id] = 0; });

  const anomalies = [];
  questions.forEach(function(q) {
    if (!q.documentSectionId || !sectionsById[q.documentSectionId]) return;
    actualDirect[q.documentSectionId] = (actualDirect[q.documentSectionId] || 0) + 1;
    actualTotal[q.documentSectionId] = (actualTotal[q.documentSectionId] || 0) + 1;
    const resolved = getSectionAncestorIds(sectionsById[q.documentSectionId]);
    if (resolved.anomaly && anomalies.indexOf(resolved.anomaly) === -1) anomalies.push(resolved.anomaly);
    resolved.ancestorIds.forEach(function(ancId) { actualTotal[ancId] = (actualTotal[ancId] || 0) + 1; });
  });

  const items = sections.map(function(s) {
    const aDirect = actualDirect[s.id] || 0;
    const aTotal = actualTotal[s.id] || 0;
    return {
      sectionId: s.id, name: s.name,
      storedDirect: s.directQuestionCount || 0, actualDirect: aDirect, diffDirect: aDirect - (s.directQuestionCount || 0),
      storedTotal: s.totalQuestionCount || 0, actualTotal: aTotal, diffTotal: aTotal - (s.totalQuestionCount || 0),
    };
  });

  return { items: items, truncated: questions.length >= RECONCILE_SCAN_LIMIT, anomalies: anomalies };
}

/**
 * Applique réellement les corrections calculées par rebuildSourceCounts()/
 * rebuildSectionCounts() - JAMAIS appelée sans confirmation explicite de
 * l'administrateur (voir admin/document-sources.js).
 * @param {string} sourceId
 * @param {{sourceCounts:object, sectionCounts:{items:Array<object>}}} rebuilt
 * @returns {Promise<{status:string, message:string}>}
 */
export async function applyReconciliation(sourceId, rebuilt) {
  const ctx = getCurrentUserContext();
  try {
    if (rebuilt.sourceCounts.diff !== 0) {
      await updateDocumentSourceFields(sourceId, { questionCount: rebuilt.sourceCounts.actualCount });
    }
    for (const item of rebuilt.sectionCounts.items) {
      if (item.diffDirect !== 0 || item.diffTotal !== 0) {
        await updateDocumentSectionFields(item.sectionId, { directQuestionCount: item.actualDirect, totalQuestionCount: item.actualTotal });
      }
    }

    logAction({
      adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email, targetUid: null, targetEmail: null,
      actionType: 'document_counts_reconciled',
      oldValue: sourceId, newValue: 'source: ' + rebuilt.sourceCounts.diff + ' ; sections corrigées : ' + rebuilt.sectionCounts.items.filter(function(i) { return i.diffDirect !== 0 || i.diffTotal !== 0; }).length,
    }).catch(function() {});

    return { status: 'success', message: 'Compteurs réconciliés avec succès.' };
  } catch (err) {
    console.error('[document-count-service] échec de la réconciliation de ' + sourceId, err);
    return { status: 'error', message: 'La réconciliation a échoué. Réessayez plus tard.' };
  }
}

/**
 * Réconcilie TOUTES les sources du catalogue GLOBAL (boucle sur
 * rebuildSourceCounts()/rebuildSectionCounts(), sans rien appliquer).
 *
 * CORRECTIF (Sprint 20.2) : ne prend plus d'organisation en paramètre -
 * le catalogue documentaire est global, une seule réconciliation
 * complète couvre désormais l'ensemble des sources de la plateforme
 * (alias demandé par le cadrage : reconcileSource() ci-dessous pour une
 * source unique).
 * @returns {Promise<{items:Array<object>}>}
 */
export async function reconcileAllDocumentCounts() {
  const result = await queryDocumentSources({});
  const sources = result.items || [];

  const items = [];
  for (const source of sources) {
    const [sourceCounts, sectionCounts] = await Promise.all([rebuildSourceCounts(source.id), rebuildSectionCounts(source.id)]);
    items.push({ source: source, sourceCounts: sourceCounts, sectionCounts: sectionCounts });
  }
  return { items: items };
}

/**
 * Alias explicite demandé par le cadrage (Sprint 20.2, "Réconciliation
 * des compteurs") : réconcilie (prévisualisation) UNE seule source -
 * combine rebuildSourceCounts()/rebuildSectionCounts() en un seul appel,
 * dans la forme directement consommée par applyReconciliation().
 * @param {string} sourceId
 * @returns {Promise<{sourceCounts:object, sectionCounts:object}>}
 */
export async function reconcileSource(sourceId) {
  const [sourceCounts, sectionCounts] = await Promise.all([rebuildSourceCounts(sourceId), rebuildSectionCounts(sourceId)]);
  return { sourceCounts: sourceCounts, sectionCounts: sectionCounts };
}
