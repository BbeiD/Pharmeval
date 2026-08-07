// ===================== SERVICE DE STATISTIQUES (CALCUL PUR) =====================
// Recoit une liste d'evaluations deja chargees (voir js/services/history-
// service.js) et produit des objets de synthese. Aucun appel Firestore ici,
// aucun rendu HTML : uniquement du calcul, independant de l'interface et
// facilement testable (voir test_statistics_service.js).
//
// Perimetre strict de ce sprint : lecture et calcul uniquement. Aucune
// statistique n'est ecrite dans Firestore, aucun nouveau score n'est
// invente - tout est derive des champs deja enregistres par
// evaluation-service.js (score.percentage, score.correctAnswers,
// score.totalQuestions, space, selection.theme, completedAt).

import { toMillis } from "./date-utils.js";

const SPACE_LABELS = { student: 'Étudiant', pharmacist: 'Pharmacien' };
const UNSPECIFIED_THEME_LABEL = 'Thème non renseigné';

// Seuils de fiabilite documentes (voir RAPPORT_SPRINT6.md) :
const TREND_GROUP_SIZE = 5;         // 5 evaluations les plus recentes vs 5 precedentes
const TREND_MIN_EVALUATIONS = TREND_GROUP_SIZE * 2; // 10 minimum pour calculer une tendance
const TREND_STABILITY_MARGIN = 2;   // +/- 2 points = tendance consideree stable
const THEME_MIN_EVALUATIONS = 2;    // minimum d'evaluations pour qu'un theme soit classe
const MAX_RANKED_THEMES = 3;        // au plus 3 themes forts / 3 a retravailler

function percentageOf(ev) {
  const p = ev && ev.score && ev.score.percentage;
  return (typeof p === 'number' && !isNaN(p)) ? p : null;
}

function average(numbers) {
  if (!numbers.length) return null;
  const sum = numbers.reduce(function(a, b) { return a + b; }, 0);
  return Math.round((sum / numbers.length) * 10) / 10; // 1 decimale, evite les faux airs de precision
}

function sortByDateDesc(evaluations) {
  return evaluations.slice().sort(function(a, b) {
    return toMillis(b.completedAt) - toMillis(a.completedAt);
  });
}

// ---------------------------------------------------------------------------
// Indicateurs generaux
// ---------------------------------------------------------------------------

/**
 * Nombre d'evaluations, score moyen, meilleur score, dernier score (le plus
 * recent par date). Ne recalcule jamais un score question par question :
 * utilise exclusivement score.percentage, deja enregistre par
 * evaluation-service.js.
 *
 * @param {Array<object>} evaluations
 * @returns {{count:number, averageScore:(number|null), bestScore:(number|null), lastScore:(number|null)}}
 */
export function calculateOverview(evaluations) {
  const list = evaluations || [];
  const percentages = list.map(percentageOf).filter(function(p) { return p !== null; });

  if (list.length === 0) {
    return { count: 0, averageScore: null, bestScore: null, lastScore: null };
  }

  const sorted = sortByDateDesc(list);
  const lastScore = percentageOf(sorted[0]);

  return {
    count: list.length,
    averageScore: average(percentages),
    bestScore: percentages.length ? Math.max.apply(null, percentages) : null,
    lastScore: lastScore,
  };
}

// ---------------------------------------------------------------------------
// Tendance recente
// ---------------------------------------------------------------------------

/**
 * Compare la moyenne des TREND_GROUP_SIZE (5) evaluations les plus recentes
 * a la moyenne des TREND_GROUP_SIZE (5) evaluations immediatement
 * precedentes (positions 6 a 10 par ordre de recence). Necessite au moins
 * TREND_MIN_EVALUATIONS (10) evaluations au total ; en-deca, la tendance
 * n'est pas calculee (donnees insuffisantes).
 *
 * Marge de stabilite : une variation dont la valeur absolue est inferieure
 * ou egale a TREND_STABILITY_MARGIN (2 points) est consideree stable
 * plutot que comme une hausse ou une baisse.
 *
 * @param {Array<object>} evaluations
 * @returns {{status:('no_data'|'single'|'insufficient'|'up'|'down'|'stable'), delta:(number|null)}}
 */
export function calculateProgressTrend(evaluations) {
  const list = evaluations || [];
  if (list.length === 0) return { status: 'no_data', delta: null };
  if (list.length === 1) return { status: 'single', delta: null };
  if (list.length < TREND_MIN_EVALUATIONS) return { status: 'insufficient', delta: null };

  const sorted = sortByDateDesc(list);
  const recentGroup = sorted.slice(0, TREND_GROUP_SIZE).map(percentageOf).filter(function(p) { return p !== null; });
  const previousGroup = sorted.slice(TREND_GROUP_SIZE, TREND_GROUP_SIZE * 2).map(percentageOf).filter(function(p) { return p !== null; });

  const recentAvg = average(recentGroup);
  const previousAvg = average(previousGroup);

  if (recentAvg === null || previousAvg === null) return { status: 'insufficient', delta: null };

  const delta = Math.round((recentAvg - previousAvg) * 10) / 10;

  if (Math.abs(delta) <= TREND_STABILITY_MARGIN) return { status: 'stable', delta: delta };
  return { status: delta > 0 ? 'up' : 'down', delta: delta };
}

// ---------------------------------------------------------------------------
// Performance par espace (Etudiant / Pharmacien / futurs espaces)
// ---------------------------------------------------------------------------

/**
 * Regroupe les evaluations par `space` (valeur brute du champ, ex.
 * "student"/"pharmacist"). Architecture extensible : un nouvel espace
 * futur apparait automatiquement ici sans modification de ce fichier -
 * seul SPACE_LABELS peut etre complete pour lui donner un libelle lisible,
 * sinon le libelle brut est utilise tel quel.
 *
 * @param {Array<object>} evaluations
 * @returns {Object<string, {label:string, count:number, averageScore:(number|null), bestScore:(number|null)}>}
 */
export function calculatePerformanceBySpace(evaluations) {
  const list = evaluations || [];
  const groups = {};

  list.forEach(function(ev) {
    const key = ev.space;
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(ev);
  });

  const result = {};
  Object.keys(groups).forEach(function(key) {
    const groupList = groups[key];
    const percentages = groupList.map(percentageOf).filter(function(p) { return p !== null; });
    result[key] = {
      label: SPACE_LABELS[key] || key,
      count: groupList.length,
      averageScore: average(percentages),
      bestScore: percentages.length ? Math.max.apply(null, percentages) : null,
    };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Performance par theme
// ---------------------------------------------------------------------------

function themeKeyOf(ev) {
  const theme = ev && ev.selection && ev.selection.theme;
  return (theme && String(theme).trim()) ? String(theme).trim() : UNSPECIFIED_THEME_LABEL;
}

/**
 * Regroupe les evaluations par theme, tel qu'enregistre dans
 * evaluation.selection.theme. Les evaluations sans theme renseigne sont
 * regroupees sous UNSPECIFIED_THEME_LABEL ("Thème non renseigné"), jamais
 * sous un theme invente.
 *
 * @param {Array<object>} evaluations
 * @returns {Object<string, {count:number, averageScore:(number|null), totalQuestions:number}>}
 */
export function calculatePerformanceByTheme(evaluations) {
  const list = evaluations || [];
  const groups = {};

  list.forEach(function(ev) {
    const key = themeKeyOf(ev);
    if (!groups[key]) groups[key] = [];
    groups[key].push(ev);
  });

  const result = {};
  Object.keys(groups).forEach(function(key) {
    const groupList = groups[key];
    const percentages = groupList.map(percentageOf).filter(function(p) { return p !== null; });
    const totalQuestions = groupList.reduce(function(sum, ev) {
      const t = ev && ev.score && typeof ev.score.totalQuestions === 'number' ? ev.score.totalQuestions : 0;
      return sum + t;
    }, 0);
    result[key] = {
      count: groupList.length,
      averageScore: average(percentages),
      totalQuestions: totalQuestions,
    };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Themes forts / a retravailler
// ---------------------------------------------------------------------------

function rankedThemes(evaluations, direction) {
  const byTheme = calculatePerformanceByTheme(evaluations);
  const eligible = Object.keys(byTheme)
    .map(function(theme) { return Object.assign({ theme: theme }, byTheme[theme]); })
    .filter(function(t) { return t.count >= THEME_MIN_EVALUATIONS && t.averageScore !== null; });

  eligible.sort(function(a, b) {
    return direction === 'strong' ? (b.averageScore - a.averageScore) : (a.averageScore - b.averageScore);
  });

  return eligible.slice(0, MAX_RANKED_THEMES);
}

/**
 * Jusqu'a 3 themes ayant les meilleures moyennes, parmi ceux disposant d'au
 * moins THEME_MIN_EVALUATIONS (2) evaluations. Un theme ne peut jamais etre
 * presente comme "fort" sur la base d'une seule evaluation.
 *
 * @param {Array<object>} evaluations
 * @returns {Array<{theme:string, count:number, averageScore:number, totalQuestions:number}>}
 */
export function getStrongThemes(evaluations) {
  return rankedThemes(evaluations, 'strong');
}

/**
 * Jusqu'a 3 themes ayant les moyennes les plus faibles, parmi ceux
 * disposant d'au moins THEME_MIN_EVALUATIONS (2) evaluations. Meme regle de
 * fiabilite que getStrongThemes.
 *
 * @param {Array<object>} evaluations
 * @returns {Array<{theme:string, count:number, averageScore:number, totalQuestions:number}>}
 */
export function getWeakThemes(evaluations) {
  return rankedThemes(evaluations, 'weak');
}

/**
 * Indique si au moins un theme dispose d'assez de donnees pour etre classe
 * (voir THEME_MIN_EVALUATIONS). Utilisee par l'interface pour afficher le
 * message "Pas encore assez de données pour identifier vos thèmes forts et
 * vos thèmes à retravailler." lorsque c'est faux.
 *
 * @param {Array<object>} evaluations
 * @returns {boolean}
 */
export function hasReliableThemeData(evaluations) {
  const byTheme = calculatePerformanceByTheme(evaluations || []);
  return Object.keys(byTheme).some(function(theme) { return byTheme[theme].count >= THEME_MIN_EVALUATIONS; });
}

// ---------------------------------------------------------------------------
// Ajouts Sprint 7 (moteur de recommandations) : purement additifs, aucune
// fonction existante ci-dessus n'a ete modifiee. Ces deux fonctions restent
// des STATISTIQUES au sens large (recence par theme, rythme recent) - elles
// vivent ici plutot que d'etre dupliquees dans recommendation-service.js,
// qui se contente de les consommer.
// ---------------------------------------------------------------------------

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pour chaque theme rencontre (y compris "Thème non renseigné"), calcule le
 * nombre de jours ecoules depuis la derniere evaluation de ce theme.
 * Utilise par recommendation-service.js pour la regle "theme oublie".
 *
 * @param {Array<object>} evaluations
 * @param {Date} [now] - injectable pour les tests, defaut : instant present
 * @returns {Object<string, {daysSinceLastPracticed:number, lastPracticedAt:number}>}
 */
export function getThemeRecency(evaluations, now) {
  const list = evaluations || [];
  const nowMs = (now instanceof Date ? now : new Date()).getTime();
  const mostRecentByTheme = {};

  list.forEach(function(ev) {
    const key = themeKeyOf(ev);
    const ms = toMillis(ev.completedAt);
    if (!mostRecentByTheme[key] || ms > mostRecentByTheme[key]) {
      mostRecentByTheme[key] = ms;
    }
  });

  const result = {};
  Object.keys(mostRecentByTheme).forEach(function(theme) {
    const lastMs = mostRecentByTheme[theme];
    result[theme] = {
      daysSinceLastPracticed: lastMs > 0 ? Math.floor((nowMs - lastMs) / MILLISECONDS_PER_DAY) : null,
      lastPracticedAt: lastMs,
    };
  });
  return result;
}

/**
 * Metriques de rythme global (toutes evaluations confondues, tous themes) :
 * nombre de jours depuis la derniere evaluation, et nombre d'evaluations
 * realisees au cours des 7 derniers jours. Utilise par
 * recommendation-service.js pour la regle "regularite".
 *
 * @param {Array<object>} evaluations
 * @param {Date} [now] - injectable pour les tests
 * @returns {{daysSinceLastEvaluation:(number|null), evaluationsInLast7Days:number}}
 */
export function calculateActivityMetrics(evaluations, now) {
  const list = evaluations || [];
  const nowMs = (now instanceof Date ? now : new Date()).getTime();

  if (list.length === 0) {
    return { daysSinceLastEvaluation: null, evaluationsInLast7Days: 0 };
  }

  let mostRecentMs = 0;
  let count7Days = 0;
  list.forEach(function(ev) {
    const ms = toMillis(ev.completedAt);
    if (ms > mostRecentMs) mostRecentMs = ms;
    if (ms > 0 && (nowMs - ms) <= 7 * MILLISECONDS_PER_DAY) count7Days++;
  });

  return {
    daysSinceLastEvaluation: mostRecentMs > 0 ? Math.floor((nowMs - mostRecentMs) / MILLISECONDS_PER_DAY) : null,
    evaluationsInLast7Days: count7Days,
  };
}

// Exposees pour permettre a l'interface (ou aux tests) de reference les
// seuils sans les redefinir ailleurs.
export const STATISTICS_THRESHOLDS = Object.freeze({
  TREND_GROUP_SIZE: TREND_GROUP_SIZE,
  TREND_MIN_EVALUATIONS: TREND_MIN_EVALUATIONS,
  TREND_STABILITY_MARGIN: TREND_STABILITY_MARGIN,
  THEME_MIN_EVALUATIONS: THEME_MIN_EVALUATIONS,
  MAX_RANKED_THEMES: MAX_RANKED_THEMES,
});
