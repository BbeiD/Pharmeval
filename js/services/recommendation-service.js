// ===================== MOTEUR DE RECOMMANDATIONS (REGLES) =====================
// Moteur entierement base sur des regles explicites, documentees ici.
// AUCUNE intelligence artificielle, AUCUN apprentissage automatique : chaque
// recommandation resulte d'une condition SI...ALORS lisible et testable.
//
// Ce fichier ne fait aucun appel Firestore, aucun rendu HTML : il recoit une
// liste d'evaluations deja chargees (la meme que celle utilisee par
// js/services/statistics-service.js, voir js/history.js pour le partage
// d'une lecture Firestore unique) et produit au plus 3 recommandations
// prioritisees.
//
// Chaine de responsabilite respectee :
//   Firestore -> history-service -> statistics-service -> recommendation-service -> recommendation.js -> Interface
//
// Philosophie (rappelee du cahier des charges) : le moteur propose, explique,
// et laisse toujours le choix. Chaque recommandation porte un champ `reason`
// (transparence : "Pourquoi cette recommandation ?"), jamais une boite noire.

import {
  calculateProgressTrend,
  getWeakThemes,
  getThemeRecency,
  calculateActivityMetrics,
} from "./statistics-service.js";
import { toMillis } from "./date-utils.js";

// ---------------------------------------------------------------------------
// Seuils centralises - AUCUNE valeur magique ailleurs dans ce fichier.
// Un developpeur souhaitant ajuster une regle ne doit modifier qu'ici.
// ---------------------------------------------------------------------------
export const RECOMMENDATION_THRESHOLDS = Object.freeze({
  weakTheme: 65,              // score moyen d'un theme en-dessous duquel il est juge "a renforcer"
  strongTheme: 85,            // score moyen d'un theme au-dessus duquel il est juge "fort" (reserve a un usage futur, ex. suggestion de niveau superieur)
  inactivityDays: 14,         // jours sans aucune evaluation avant de proposer une reprise
  themeForgottenDays: 21,     // jours sans pratiquer un theme donne avant de le signaler comme "oublie" (seuil ajoute par rapport a l'exemple fourni, documente dans RAPPORT_SPRINT7.md)
  progressionMargin: 5,       // ecart minimal (points) pour qualifier une tendance de "progression"
  regressionMargin: -5,       // ecart maximal (points, negatif) pour qualifier une tendance de "regression"
  exceptionalScoreThreshold: 90,  // score a partir duquel une evaluation compte comme "exceptionnelle" (seuil ajoute, distinct de strongTheme qui est par theme)
  exceptionalStreakCount: 3,      // nombre d'evaluations consecutives exceptionnelles requises
  weeklyGoodRhythmCount: 5,       // nombre d'evaluations dans les 7 derniers jours a partir duquel le rythme est felicite
  minEvaluationsForRecommendations: 5, // en-dessous, le moteur ne genere aucune recommandation (donnees insuffisantes)
  maxRecommendations: 3,          // nombre maximal de recommandations affichees simultanement
});

const T = RECOMMENDATION_THRESHOLDS;

// ---------------------------------------------------------------------------
// Libelles humains des themes (correction post-livraison) : evaluation.
// selection.theme contient l'identifiant technique brut du theme (ex.
// "legislation", "ftm"), pas un libelle affichable. Cette table reprend
// exactement les libelles deja utilises ailleurs dans l'interface (voir les
// onglets de themes dans index.html) ; elle ne modifie aucune donnee, elle
// ne fait que formater le texte affiche dans les recommandations.
const THEME_LABELS = {
  conseil: 'Conseil',
  dermo: 'Dermo-cosmétiques',
  procedures: 'Procédures',
  medicaments: 'Médicaments',
  bppo: 'BPP Officinales',
  ftm: 'Préparations',
  deon: 'Déontologie',
  bapcoc: 'BAPCOC',
  etudiant: 'Pharmacothérapie',
  legislation: 'Législation',
  galenique: 'Galénique',
  adm: 'ADM',
};

/**
 * Retourne un libelle humain pour un identifiant de theme. Utilise la table
 * ci-dessus si connue ; sinon, formate legerement l'identifiant technique
 * brut (tirets/underscores remplaces par des espaces, premiere lettre en
 * majuscule) plutot que de l'afficher tel quel. Ne modifie jamais la
 * donnee source (evaluation.selection.theme) : formatage d'affichage
 * uniquement.
 *
 * @param {string} theme
 * @returns {string}
 */
function formatThemeLabel(theme) {
  if (!theme) return theme;
  if (THEME_LABELS[theme]) return THEME_LABELS[theme];
  return theme
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\p{L}/u, function(c) { return c.toUpperCase(); });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value);
}

// ---------------------------------------------------------------------------
// Regle 1 - Faiblesse identifiee (theme le plus faible, sous le seuil)
// ---------------------------------------------------------------------------
// SI un theme dispose de suffisamment de donnees (voir statistics-service.js,
//    THEME_MIN_EVALUATIONS) ET que sa moyenne est strictement inferieure a
//    RECOMMENDATION_THRESHOLDS.weakTheme
// ALORS proposer une evaluation ciblee sur ce theme (le plus faible parmi
//    les eligibles, s'il y en a plusieurs).
function ruleWeakTheme(evaluations) {
  const weakThemes = getWeakThemes(evaluations); // deja triees, deja filtrees par le seuil de fiabilite (min 2 evaluations)
  const worst = weakThemes.find(function(t) { return t.averageScore < T.weakTheme; });
  if (!worst) return null;

  const priority = clamp(round(50 + (T.weakTheme - worst.averageScore)), 50, 90);
  const confidence = clamp(round(40 + worst.count * 15), 40, 95);

  return {
    id: 'weak-theme-' + worst.theme,
    type: 'weakness',
    priority: priority,
    title: formatThemeLabel(worst.theme),
    description: 'Votre taux de réussite sur ce thème (' + round(worst.averageScore) + ' %) est inférieur à votre seuil habituel. Nous vous recommandons une évaluation ciblée.',
    action: { label: 'Commencer une évaluation', actionId: 'start-evaluation', enabled: true },
    confidence: confidence,
    reason: 'Parce que votre moyenne sur « ' + formatThemeLabel(worst.theme) + ' » (' + round(worst.averageScore) + ' %, sur ' + worst.count + ' évaluation' + (worst.count > 1 ? 's' : '') + ') est inférieure au seuil de ' + T.weakTheme + ' %.',
  };
}

// ---------------------------------------------------------------------------
// Regle 2 - Theme oublie
// ---------------------------------------------------------------------------
// SI un theme deja pratique n'a plus ete travaille depuis au moins
//    RECOMMENDATION_THRESHOLDS.themeForgottenDays jours
// ALORS le signaler (le plus ancien parmi les eligibles).
function ruleForgottenTheme(evaluations) {
  const recency = getThemeRecency(evaluations);
  let oldest = null;
  Object.keys(recency).forEach(function(theme) {
    const info = recency[theme];
    if (info.daysSinceLastPracticed === null) return;
    if (info.daysSinceLastPracticed < T.themeForgottenDays) return;
    if (!oldest || info.daysSinceLastPracticed > oldest.days) {
      oldest = { theme: theme, days: info.daysSinceLastPracticed };
    }
  });
  if (!oldest) return null;

  const priority = clamp(round(55 + (oldest.days - T.themeForgottenDays) / 2), 55, 80);

  return {
    id: 'forgotten-theme-' + oldest.theme,
    type: 'forgotten_theme',
    priority: priority,
    title: formatThemeLabel(oldest.theme),
    description: 'Vous n\u2019avez plus travaillé ce thème depuis ' + oldest.days + ' jours.',
    action: { label: 'Reprendre ce thème', actionId: 'start-evaluation', enabled: true },
    confidence: 90,
    reason: 'Parce que vous n\u2019avez pas travaillé « ' + formatThemeLabel(oldest.theme) + ' » depuis ' + oldest.days + ' jours (seuil : ' + T.themeForgottenDays + ' jours).',
  };
}

// ---------------------------------------------------------------------------
// Regle 3 / 4 - Progression / Regression
// ---------------------------------------------------------------------------
// Reutilise calculateProgressTrend() de statistics-service.js (5 evaluations
// recentes vs 5 precedentes, deja calcule au Sprint 6) plutot que de
// dupliquer un calcul de tendance ici. Applique un SEUIL DE DECISION propre
// au moteur de recommandations (progressionMargin / regressionMargin),
// distinct de la marge de stabilite utilisee par l'analyse de progression
// (+/-2, utilisee seulement pour choisir "stable" a l'affichage).
//
// SI le statut de tendance est "up" ET que l'ecart depasse progressionMargin
// ALORS feliciter et encourager a continuer.
//
// SI le statut de tendance est "down" ET que l'ecart depasse (en valeur
//    absolue) regressionMargin
// ALORS conseiller de revoir les fondamentaux.
function ruleProgression(evaluations) {
  const trend = calculateProgressTrend(evaluations);
  if (trend.status !== 'up' || trend.delta < T.progressionMargin) return null;

  const priority = clamp(round(30 + (trend.delta - T.progressionMargin)), 30, 55);

  return {
    id: 'progression',
    type: 'progression',
    priority: priority,
    title: 'Progression continue',
    description: 'Votre score moyen augmente régulièrement (+' + trend.delta + ' points). Continuez sur cette lancée.',
    action: { label: 'Continuer', actionId: 'start-evaluation', enabled: true },
    confidence: 90,
    reason: 'Parce que la moyenne de vos 5 dernières évaluations dépasse de ' + trend.delta + ' points celle des 5 précédentes.',
  };
}

function ruleRegression(evaluations) {
  const trend = calculateProgressTrend(evaluations);
  if (trend.status !== 'down' || trend.delta > T.regressionMargin) return null;

  const priority = clamp(round(70 + (Math.abs(trend.delta) - Math.abs(T.regressionMargin))), 70, 100);

  return {
    id: 'regression',
    type: 'regression',
    priority: priority,
    title: 'Baisse récente',
    description: 'Vos dernières évaluations sont en baisse (' + trend.delta + ' points). Nous vous conseillons de revoir les fondamentaux.',
    action: { label: 'Voir mes erreurs', actionId: 'view-errors', enabled: false },
    confidence: 90,
    reason: 'Parce que la moyenne de vos 5 dernières évaluations est inférieure de ' + Math.abs(trend.delta) + ' points à celle des 5 précédentes.',
  };
}

// ---------------------------------------------------------------------------
// Regle 5 - Regularite (bon rythme ou inactivite)
// ---------------------------------------------------------------------------
// SI au moins weeklyGoodRhythmCount evaluations ont ete realisees dans les 7
//    derniers jours
// ALORS feliciter le rythme.
// SINON SI aucune evaluation depuis au moins inactivityDays jours
// ALORS encourager une reprise.
function ruleRegularityGood(evaluations) {
  const activity = calculateActivityMetrics(evaluations);
  if (activity.evaluationsInLast7Days < T.weeklyGoodRhythmCount) return null;

  return {
    id: 'regularity-good',
    type: 'regularity_good',
    priority: 25,
    title: 'Excellent rythme',
    description: 'Vous avez réalisé ' + activity.evaluationsInLast7Days + ' évaluations cette semaine. Excellent rythme !',
    action: { label: 'Continuer', actionId: 'start-evaluation', enabled: true },
    confidence: 95,
    reason: 'Parce que vous avez réalisé ' + activity.evaluationsInLast7Days + ' évaluations au cours des 7 derniers jours (seuil : ' + T.weeklyGoodRhythmCount + ').',
  };
}

function ruleRegularityInactive(evaluations) {
  const activity = calculateActivityMetrics(evaluations);
  if (activity.daysSinceLastEvaluation === null || activity.daysSinceLastEvaluation < T.inactivityDays) return null;

  const priority = clamp(round(50 + (activity.daysSinceLastEvaluation - T.inactivityDays) / 2), 50, 75);

  return {
    id: 'regularity-inactive',
    type: 'regularity_inactive',
    priority: priority,
    title: 'Reprendre le rythme',
    description: 'Aucune évaluation depuis ' + activity.daysSinceLastEvaluation + ' jours. Pourquoi ne pas reprendre aujourd\u2019hui ?',
    action: { label: 'Commencer une évaluation', actionId: 'start-evaluation', enabled: true },
    confidence: 95,
    reason: 'Parce qu\u2019aucune évaluation n\u2019a été enregistrée depuis ' + activity.daysSinceLastEvaluation + ' jours (seuil : ' + T.inactivityDays + ' jours).',
  };
}

// ---------------------------------------------------------------------------
// Regle 6 - Reussite exceptionnelle
// ---------------------------------------------------------------------------
// SI les exceptionalStreakCount (3) evaluations les plus recentes (par
//    date) ont toutes un score >= exceptionalScoreThreshold (90 %)
// ALORS feliciter et suggerer d'essayer un niveau plus difficile.
function ruleExceptional(evaluations) {
  const list = (evaluations || []).slice().sort(function(a, b) {
    return toMillis(b.completedAt) - toMillis(a.completedAt);
  });
  if (list.length < T.exceptionalStreakCount) return null;

  const recentStreak = list.slice(0, T.exceptionalStreakCount);
  const allExceptional = recentStreak.every(function(ev) {
    const p = ev && ev.score && ev.score.percentage;
    return typeof p === 'number' && !isNaN(p) && p >= T.exceptionalScoreThreshold;
  });
  if (!allExceptional) return null;

  return {
    id: 'exceptional-streak',
    type: 'exceptional',
    priority: 20,
    title: 'Réussite exceptionnelle',
    description: 'Trois évaluations consécutives à ' + T.exceptionalScoreThreshold + ' % ou plus. Bravo ! Souhaitez-vous essayer un niveau plus difficile ?',
    action: { label: 'Essayer un niveau plus difficile', actionId: 'increase-difficulty', enabled: false },
    confidence: 90,
    reason: 'Parce que vos ' + T.exceptionalStreakCount + ' dernières évaluations dépassent toutes ' + T.exceptionalScoreThreshold + ' %.',
  };
}

// ---------------------------------------------------------------------------
// Orchestration : execute toutes les regles, trie par priorite, ne garde
// que les maxRecommendations (3) plus pertinentes.
// ---------------------------------------------------------------------------

const ALL_RULES = [
  ruleRegression,
  ruleWeakTheme,
  ruleForgottenTheme,
  ruleProgression,
  ruleRegularityInactive,
  ruleRegularityGood,
  ruleExceptional,
];

/**
 * Point d'entree du moteur. Recoit la meme liste d'evaluations que
 * statistics-service.js (aucune lecture Firestore ici).
 *
 * @param {Array<object>} evaluations
 * @returns {{recommendations:Array<object>, insufficientData:boolean}}
 */
export function generateRecommendations(evaluations) {
  const list = evaluations || [];

  if (list.length < T.minEvaluationsForRecommendations) {
    // Le moteur ne doit jamais inventer de recommandation avec trop peu de
    // donnees (voir "Cas avec peu de donnees" dans la demande).
    return { recommendations: [], insufficientData: true };
  }

  const fired = ALL_RULES
    .map(function(rule) { return rule(list); })
    .filter(function(rec) { return rec !== null; });

  fired.sort(function(a, b) { return b.priority - a.priority; });

  return {
    recommendations: fired.slice(0, T.maxRecommendations),
    insufficientData: false,
  };
}
