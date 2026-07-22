// ===================== SERVICE DE CONSULTATION D'UN PARCOURS (Sprint 16) =====================
// Point d'entree UNIQUE pour la page "Parcours" (parcours-detail.html /
// js/parcours-detail.js) - "Créer un service dédié. Ne jamais mettre la
// logique directement dans la page." Coordonne :
//   - js/services/assignment-service.js  (verification que le parcours est
//     bien attribue a l'utilisateur - REUTILISE getAssignedParcoursForUser(),
//     Sprint 15, plutot que de dupliquer une verification d'attribution)
//   - js/services/parcours-service.js    (REUTILISE resolveParcoursCompetenciesDisplay(),
//     Sprint 13, pour les donnees de competences a jour)
//   - js/services/competency-metadata-service.js (echelle de niveau, REUTILISEE
//     pour calculer une difficulte moyenne - jamais une nouvelle echelle)
//
// AUCUNE ECRITURE FIRESTORE ICI (SPRINT16, "Aucune donnee utilisateur ne
// doit encore etre enregistree") : ce service ne fait QUE lire et calculer
// des informations DESCRIPTIVES a partir de donnees deja existantes -
// jamais un score, une progression ou une reponse.
//
// ARCHITECTURE EVOLUTIVE (SPRINT16, "Prevoir une architecture permettant
// d'ajouter ensuite : progression, historique, recommandations, badges,
// certificats") : ce fichier centralise deja TOUT ce qu'une future page de
// progression aurait besoin de reutiliser (verification d'attribution,
// resolution des competences) - un futur sprint ajoutera de nouvelles
// fonctions ICI (ex. getProgressForUser(), getRecommendationsForUser())
// sans jamais devoir toucher a parcours-detail.js pour la logique
// existante.

import { getAssignedParcoursForUser } from "./assignment-service.js";
import {
  resolveParcoursCompetenciesDisplay, resolveParcoursDirectContentDisplay,
  resolvePooledQuestionIds, resolveDerivedCompetenciesFromPool,
} from "./parcours-service.js";
import { COMPETENCY_LEVELS } from "./competency-metadata-service.js";

// Echelle numerique UNIQUEMENT interne a ce fichier (jamais stockee, jamais
// exposee), pour calculer une moyenne a partir de COMPETENCY_LEVELS
// (essentiel/approfondi/avance, deja definie et reutilisee - Sprint 9/13).
const LEVEL_NUMERIC_VALUE = Object.freeze({
  essentiel: 1,
  approfondi: 2,
  avance: 3,
});
const NUMERIC_VALUE_TO_LEVEL = Object.freeze({ 1: 'essentiel', 2: 'approfondi', 3: 'avance' });

/**
 * Calcule la categorie et le niveau "affichables" d'un parcours a partir
 * des competences qui lui sont reellement liees (jamais un champ invente
 * sur le parcours lui-meme - reutilise les donnees deja saisies dans la
 * Banque des competences, Sprint 13, categorie et niveau conseille).
 *
 * @param {Array<object>} resolvedCompetencies - competences deja resolues (voir resolveParcoursCompetenciesDisplay)
 * @returns {{category:(string|null), level:(string|null), averageLevelNumeric:(number|null)}}
 */
function computeCategoryAndLevel(resolvedCompetencies) {
  const categories = {};
  const levelValues = [];

  resolvedCompetencies.forEach(function(c) {
    const bank = c.bankData;
    if (!bank) return;
    if (bank.category) categories[bank.category] = (categories[bank.category] || 0) + 1;
    if (bank.recommendedLevel && LEVEL_NUMERIC_VALUE[bank.recommendedLevel]) {
      levelValues.push(LEVEL_NUMERIC_VALUE[bank.recommendedLevel]);
    }
  });

  // Categorie la plus frequente parmi les competences liees (egalite -> la
  // premiere rencontree, choix arbitraire mais stable, jamais invente).
  let category = null;
  let bestCount = 0;
  Object.keys(categories).forEach(function(cat) {
    if (categories[cat] > bestCount) { category = cat; bestCount = categories[cat]; }
  });

  let averageLevelNumeric = null;
  let level = null;
  if (levelValues.length > 0) {
    averageLevelNumeric = levelValues.reduce(function(a, b) { return a + b; }, 0) / levelValues.length;
    const rounded = Math.round(averageLevelNumeric);
    level = NUMERIC_VALUE_TO_LEVEL[rounded] || null;
  }

  return { category: category, level: level, averageLevelNumeric: averageLevelNumeric };
}

/**
 * Construit la fiche de consultation complete d'un parcours pour un
 * utilisateur donne - VERIFIE D'ABORD que ce parcours lui est bien
 * attribue (directement, via son groupe, ou via son profil - Sprint 15),
 * jamais un simple `getParcoursById` non protege. Un utilisateur ne peut
 * donc jamais consulter en detail un parcours qui ne lui a pas ete
 * attribue, meme en devinant son identifiant dans l'URL.
 *
 * @param {string} parcoursId
 * @param {string} uid
 * @returns {Promise<{authorized:boolean, message?:string, error?:boolean, view?:object}>}
 */
export async function getParcoursDetailForUser(parcoursId, uid) {
  if (!parcoursId) return { authorized: false, message: 'Parcours introuvable.' };
  if (!uid) return { authorized: false, message: 'Vous devez être connecté pour consulter un parcours.' };

  const assigned = await getAssignedParcoursForUser(uid);
  if (assigned.error) {
    return { authorized: false, error: true, message: 'Impossible de vérifier vos parcours pour le moment. Réessayez plus tard.' };
  }

  const entry = assigned.items.find(function(e) { return e.parcours.id === parcoursId; });
  if (!entry) {
    return { authorized: false, message: 'Ce parcours ne vous a pas été attribué, ou n\'est plus disponible.' };
  }

  const parcours = entry.parcours;
  // CORRECTIF (constat fait en testant le parcours "Retours", voir message
  // a David) : le total affiche compte desormais TOUTES les questions
  // reellement jouables via le bouton "Commencer" (prepareParcoursMixedEvaluation,
  // parcours-evaluation-service.js), y compris celles des sources
  // documentaires liees (parcours.sourceIds) - voir resolvePooledQuestionIds()
  // dans parcours-service.js, SEULE source de verite partagee par
  // l'affichage ET le demarrage reel, pour ne plus jamais diverger comme
  // avant ce correctif (l'affichage ignorait les questions de source et
  // cachait a tort le bouton "Commencer").
  const resolvedCompetencies = (await resolveParcoursCompetenciesDisplay(parcours))
    .slice()
    .sort(function(a, b) { return a.order - b.order; });
  const direct = await resolveParcoursDirectContentDisplay(parcours);
  const pooledQuestionIds = await resolvePooledQuestionIds(parcours);

  // AJOUT : les competences DEDUITES de TOUTES les questions jouables du
  // parcours (source documentaire comprise, voir resolveDerivedCompetenciesFromPool)
  // s'affichent a la suite des competences explicites - purement
  // informatif, jamais actionnable via un bouton "Commencer" dedie
  // (decision validee avec David : seul le bouton global du parcours reste
  // actionnable pour ce contenu).
  const derivedCompetencies = await resolveDerivedCompetenciesFromPool(parcours, pooledQuestionIds);
  const allCompetenciesForDisplay = resolvedCompetencies.concat(derivedCompetencies);

  const questionCount = pooledQuestionIds.length;
  const competencyCount = allCompetenciesForDisplay.length;
  const sourceCount = direct.sources.length;

  const { category, level } = computeCategoryAndLevel(resolvedCompetencies);

  return {
    authorized: true,
    view: {
      parcours: parcours,
      assignment: entry.assignment,
      competencies: allCompetenciesForDisplay,
      sources: direct.sources,
      stats: {
        competencyCount: competencyCount,
        questionCount: questionCount,
        sourceCount: sourceCount,
      },
      category: category,   // derive des competences liees, jamais un champ invente sur le parcours
      level: level,
    },
  };
}

/**
 * Niveaux possibles, reexportes pour l'affichage (libelles humains) - evite
 * a parcours-detail.js de devoir importer competency-metadata-service.js
 * uniquement pour ce besoin.
 */
export { COMPETENCY_LEVELS };
