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
import { resolveParcoursCompetenciesDisplay, resolveParcoursDirectContentDisplay } from "./parcours-service.js";
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
 * Estimation du temps de lecture/reponse par question, en minutes.
 * DECLARE ICI, EXPLICITEMENT COMME UNE ESTIMATION (jamais presentee comme
 * une mesure reelle) - voir affichage "≈ X min (estimation)" dans
 * parcours-detail.js. Aucune donnee de temps reel n'existe encore dans
 * Pharmeval (aucun chronometrage de quiz, voir VISION_PHARMEVAL.md) ; cette
 * constante pourra etre remplacee par une vraie moyenne mesuree des qu'un
 * futur sprint collectera cette donnee.
 */
const ESTIMATED_MINUTES_PER_QUESTION = 1.5;

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
  // ATTENTION (constat fait en testant le parcours "Retours", voir message
  // a David) : `resolvedCompetencies` reste ICI volontairement limite aux
  // competences EXPLICITEMENT liees (parcours.competencies) - c'est la
  // SEULE liste que prepareEvaluation() (parcours-evaluation-service.js)
  // sait faire demarrer via le bouton "Commencer" (elle cherche
  // `parcours.competencies.find(c => c.competencyId === ...)` puis lit
  // `c.questionIds`). Une competence "deduite" des questions directement
  // liees n'existerait pas dans ce tableau reel : lui donner une carte
  // "Commencer" ici l'afficherait comme actionnable alors qu'elle
  // echouerait au clic - pas encore fait, voir la discussion en cours.
  const resolvedCompetencies = (await resolveParcoursCompetenciesDisplay(parcours))
    .slice()
    .sort(function(a, b) { return a.order - b.order; });
  const direct = await resolveParcoursDirectContentDisplay(parcours);

  // AJOUT : les questions DIRECTEMENT liees (directQuestionIds) comptent
  // desormais aussi dans le total affiche, en plus des questions nichees
  // sous une competence (competencies[].questionIds) - sans quoi un
  // parcours compose uniquement de questions directes affichait a tort
  // "0 question(s)". Ceci est un compteur INFORMATIF uniquement : voir
  // remarque ci-dessus, ces questions ne sont pas encore jouables via le
  // bouton "Commencer" tant que la compétence n'est pas explicitement liée.
  const questionCount = resolvedCompetencies.reduce(function(acc, c) {
    return acc + (Array.isArray(c.questionIds) ? c.questionIds.length : 0);
  }, 0) + direct.directQuestions.length;
  const competencyCount = resolvedCompetencies.length;
  const sourceCount = direct.sources.length;

  const { category, level, averageLevelNumeric } = computeCategoryAndLevel(resolvedCompetencies);
  const estimatedMinutes = questionCount > 0 ? Math.round(questionCount * ESTIMATED_MINUTES_PER_QUESTION) : null;

  return {
    authorized: true,
    view: {
      parcours: parcours,
      assignment: entry.assignment,
      competencies: resolvedCompetencies,
      sources: direct.sources,
      stats: {
        competencyCount: competencyCount,
        questionCount: questionCount,
        sourceCount: sourceCount,
        averageLevel: level,                 // 'essentiel' | 'approfondi' | 'avance' | null
        averageLevelNumeric: averageLevelNumeric, // valeur brute (1-3), utile pour un futur affichage graphique
        estimatedMinutes: estimatedMinutes,  // ESTIMATION (voir ESTIMATED_MINUTES_PER_QUESTION ci-dessus), jamais une mesure reelle
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
