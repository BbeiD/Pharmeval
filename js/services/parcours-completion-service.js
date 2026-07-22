// ===================== SERVICE DE PROGRESSION PAR PARCOURS =====================
// Point d'entree UNIQUE pour la section "Mes parcours" de l'ecran "Mes
// evaluations" (voir js/mes-parcours-completion.js + js/history.js).
// AUCUNE ECRITURE FIRESTORE ICI : lecture et calcul uniquement, memes
// garanties que parcours-view-service.js.
//
// Metrique retenue (validee avec David) : le "% complete" d'un parcours,
// et de chacun de ses buckets (competence / source documentaire /
// questions directement liees), est le pourcentage de questions DEJA
// REPONDUES CORRECTEMENT AU MOINS UNE FOIS - jamais juste "vues" - a
// partir de `question_progress.timesCorrect` (deja alimente par le moteur
// d'evaluation a chaque soumission, voir evaluation-result-service.js).
//
// Le resultat d'une evaluation ne porte pas la source/competence de
// chaque question repondue (voir cadrage) : ce fichier reconstitue donc
// l'appartenance A LA LECTURE, en croisant les identifiants de questions
// de chaque bucket avec `question_progress` - jamais denormalise a
// l'ecriture (volume actuel largement compatible, voir RAPPORT correspondant).

import { getAssignedParcoursForUser } from "./assignment-service.js";
import { resolveParcoursCompetenciesDisplay, resolveParcoursDirectContentDisplay } from "./parcours-service.js";
import { getPublishedQuestionIdsBySourceIds } from "./question-catalog-service.js";
import { getQuestionProgressForMany } from "./question-progress-catalog-service.js";

/**
 * % de `ids` deja repondues CORRECTEMENT au moins une fois, d'apres
 * `progressMap` (voir getQuestionProgressForMany). `null` si `ids` est
 * vide - jamais "0 %", qui laisserait croire a un echec plutot qu'a une
 * absence de contenu.
 * @param {Array<string>} ids
 * @param {Map<string,object>} progressMap
 * @returns {number|null}
 */
function percentCorrect(ids, progressMap) {
  if (!ids || ids.length === 0) return null;
  const correct = ids.filter(function(id) {
    const p = progressMap.get(id);
    return !!(p && p.timesCorrect > 0);
  }).length;
  return Math.round((correct / ids.length) * 100);
}

/**
 * Construit l'arborescence de progression d'UN parcours (buckets
 * compétence(s) / source(s) / questions directes, chacun avec son propre
 * %), puis le % global du parcours. Un seul appel `getQuestionProgressForMany`
 * pour TOUT le parcours (jamais un par bucket) - c'est la lecture la plus
 * couteuse (elle grandit avec le nombre de questions), contrairement a la
 * resolution des sources (qui grandit avec le nombre de sources, toujours
 * tres modeste - quelques appels paralleles, jamais un balayage global).
 *
 * @param {string} uid
 * @param {object} parcours
 * @returns {Promise<{parcoursId:string, name:string, percent:(number|null), questionCount:number, buckets:Array<object>}>}
 */
async function buildParcoursCompletion(uid, parcours) {
  const sourceIds = Array.isArray(parcours.sourceIds) ? parcours.sourceIds : [];
  const directQuestionIds = Array.isArray(parcours.directQuestionIds) ? parcours.directQuestionIds : [];

  const [resolvedCompetencies, direct, perSourceIdsList] = await Promise.all([
    resolveParcoursCompetenciesDisplay(parcours),
    resolveParcoursDirectContentDisplay(parcours),
    Promise.all(sourceIds.map(function(id) { return getPublishedQuestionIdsBySourceIds([id]); })),
  ]);

  const buckets = [];
  resolvedCompetencies.forEach(function(c) {
    const ids = Array.isArray(c.questionIds) ? c.questionIds : [];
    if (ids.length === 0) return;
    buckets.push({ type: 'competency', label: (c.bankData && c.bankData.name) || c.name || 'Compétence sans nom', ids: ids });
  });
  sourceIds.forEach(function(id, i) {
    const ids = perSourceIdsList[i] || [];
    if (ids.length === 0) return;
    const sourceEntry = direct.sources[i];
    const label = (sourceEntry && sourceEntry.bankData && sourceEntry.bankData.name) || id;
    buckets.push({ type: 'source', label: label, ids: ids });
  });
  if (directQuestionIds.length > 0) {
    buckets.push({ type: 'question', label: 'Questions directement liées', ids: directQuestionIds });
  }

  const allIds = Array.from(new Set(buckets.reduce(function(acc, b) { return acc.concat(b.ids); }, [])));
  let progressMap = new Map();
  if (allIds.length > 0) {
    const progressResult = await getQuestionProgressForMany(uid, allIds);
    progressMap = progressResult.map;
  }

  const resolvedBuckets = buckets.map(function(b) {
    return { type: b.type, label: b.label, count: b.ids.length, percent: percentCorrect(b.ids, progressMap) };
  });

  return {
    parcoursId: parcours.id,
    name: parcours.name,
    percent: percentCorrect(allIds, progressMap),
    questionCount: allIds.length,
    buckets: resolvedBuckets,
  };
}

/**
 * Progression de TOUS les parcours attribués à l'utilisateur (directement,
 * via son groupe, ou via son profil - réutilise getAssignedParcoursForUser(),
 * Sprint 15, jamais une revérification indépendante de l'attribution).
 * @param {string} uid
 * @returns {Promise<{error:boolean, items:Array<object>}>}
 */
export async function getParcoursCompletionForUser(uid) {
  if (!uid) return { error: false, items: [] };

  const assigned = await getAssignedParcoursForUser(uid);
  if (assigned.error) return { error: true, items: [] };

  const items = await Promise.all(
    assigned.items.map(function(entry) { return buildParcoursCompletion(uid, entry.parcours); })
  );

  return { error: false, items: items };
}
