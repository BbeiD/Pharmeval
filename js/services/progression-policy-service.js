// ===================== POLITIQUE DE PROGRESSION (Sprint 19) =====================
// "La règle de calcul doit être centralisée... Ne jamais coder ces
// seuils directement dans les services." Meme principe et meme
// architecture que correction-policy-service.js (Sprint 18) : SEUL
// fichier du projet a contenir un seuil de tendance, une bande de niveau
// ou une formule de score de confiance. Aucun autre fichier ne doit
// jamais coder ces valeurs en dur.
//
// Comme CorrectionPolicy, expose un ETAT MODIFIABLE A L'EXECUTION
// (getProgressionPolicy/setProgressionPolicy), jamais une constante figee
// - une seule politique GLOBALE s'applique aujourd'hui, mais rien
// n'empeche de la faire varier plus tard par organisation/parcours sans
// revoir la forme des objets ni les appelants.

/** Tendances possibles (SPRINT19, "Tendance"). */
export const PROGRESSION_TRENDS = Object.freeze({
  IMPROVING: 'improving',
  STABLE: 'stable',
  DECLINING: 'declining',
});
// CORRECTIF (bibliotheque d'icones, remplace les emojis) : libelles texte
// seuls - ce fichier est une politique metier PURE (aucune dependance DOM,
// voir en-tete), l'icone associee a chaque tendance est desormais choisie
// au rendu par l'appelant (voir TREND_ICONS, js/mes-competences.js), jamais
// codee en dur ici.
export const PROGRESSION_TREND_LABELS = Object.freeze({
  improving: 'En progression',
  stable: 'Stable',
  declining: 'En diminution',
});

/** Niveaux de maitrise d'une competence dans le temps (SPRINT19, "Niveau actuel"). */
export const COMPETENCY_LEVELS = Object.freeze({
  DISCOVERY: 'discovery',
  BEGINNER: 'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
  EXPERT: 'expert',
});
export const COMPETENCY_LEVEL_LABELS = Object.freeze({
  discovery: 'Découverte',
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
  expert: 'Expert',
});
/** Valeur numerique d'un niveau (0-4), pour un affichage graphique (radar) - jamais utilisee pour un calcul metier. */
export const COMPETENCY_LEVEL_NUMERIC_VALUE = Object.freeze({
  discovery: 0, beginner: 1, intermediate: 2, advanced: 3, expert: 4,
});

const DEFAULT_POLICY = Object.freeze({
  // "Tendance" : variation (dernière performance - performance
  // précédente, en points de pourcentage) au-dessus de laquelle la
  // tendance est "En progression", en dessous de laquelle elle est "En
  // diminution" - entre les deux, "Stable". Exemple du cadrage :
  // "Variation > +5 % -> En progression".
  trendImprovingDeltaPercent: 5,
  trendDecliningDeltaPercent: -5,

  // "Niveau actuel" : bandes évaluées de la plus exigeante à la moins
  // exigeante, la PREMIÈRE bande satisfaite l'emporte. Chaque bande exige
  // À LA FOIS un pourcentage moyen minimal ET un nombre minimal
  // d'évaluations - c'est ce second critère qui empêche directement
  // qu'"un pharmacien à 100 % sur une seule évaluation" soit considéré
  // Expert (voir confidenceScore ci-dessous pour la justification
  // complète, demandée explicitement par le donneur d'ordre).
  levelBands: [
    { level: COMPETENCY_LEVELS.EXPERT, minAveragePercent: 90, minEvaluations: 10 },
    { level: COMPETENCY_LEVELS.ADVANCED, minAveragePercent: 75, minEvaluations: 5 },
    { level: COMPETENCY_LEVELS.INTERMEDIATE, minAveragePercent: 50, minEvaluations: 2 },
    { level: COMPETENCY_LEVELS.BEGINNER, minAveragePercent: 25, minEvaluations: 1 },
    { level: COMPETENCY_LEVELS.DISCOVERY, minAveragePercent: 0, minEvaluations: 0 },
  ],

  // "confidenceScore... basé sur le nombre d'évaluations, leur
  // régularité, la récence. Pour l'instant, une formule simple suffit."
  // (demande explicite du donneur d'ordre) - une moyenne pondérée de 3
  // sous-scores (0-100 chacun), voir computeConfidenceScore() ci-dessous
  // pour le detail de chaque sous-score.
  confidence: {
    countTargetForFullScore: 10,   // nombre d'evaluations a partir duquel le sous-score "volume" atteint 100
    recencyFullScoreDays: 30,      // derniere evaluation datant de <= 30 jours -> sous-score "recence" = 100
    recencyZeroScoreDays: 180,     // derniere evaluation datant de >= 180 jours -> sous-score "recence" = 0 (decroissance lineaire entre les deux)
    weightCount: 0.5,
    weightRecency: 0.25,
    weightRegularity: 0.25,
  },
});

let currentPolicy = JSON.parse(JSON.stringify(DEFAULT_POLICY));

/** Politique actuellement en vigueur (copie defensive). @returns {object} */
export function getProgressionPolicy() {
  return JSON.parse(JSON.stringify(currentPolicy));
}
/** Modifie la politique (fusion superficielle des cles racine). Reservee a une evolution future. @param {object} overrides */
export function setProgressionPolicy(overrides) {
  currentPolicy = Object.assign({}, currentPolicy, overrides || {});
}
/** Reinitialise la politique par defaut (utile pour les tests). */
export function resetProgressionPolicy() {
  currentPolicy = JSON.parse(JSON.stringify(DEFAULT_POLICY));
}

/**
 * Determine la tendance a partir de la performance precedente et de la
 * nouvelle performance. `null` en `previousPercent` (premiere evaluation
 * d'une competence) retourne toujours "stable" (aucune variation
 * calculable, jamais une tendance inventee).
 * @param {number|null} previousPercent
 * @param {number} newPercent
 * @param {object} [policy]
 * @returns {string} une valeur de PROGRESSION_TRENDS
 */
export function computeTrend(previousPercent, newPercent, policy) {
  const p = policy || getProgressionPolicy();
  if (previousPercent === null || previousPercent === undefined) return PROGRESSION_TRENDS.STABLE;
  const delta = newPercent - previousPercent;
  if (delta > p.trendImprovingDeltaPercent) return PROGRESSION_TRENDS.IMPROVING;
  if (delta < p.trendDecliningDeltaPercent) return PROGRESSION_TRENDS.DECLINING;
  return PROGRESSION_TRENDS.STABLE;
}

/**
 * Determine le niveau actuel a partir de la moyenne des performances et
 * du nombre d'evaluations - SEULE fonction du projet autorisee a comparer
 * ces valeurs a une bande de niveau.
 * @param {number} averagePercent
 * @param {number} evaluationCount
 * @param {object} [policy]
 * @returns {string} une valeur de COMPETENCY_LEVELS
 */
export function computeLevel(averagePercent, evaluationCount, policy) {
  const p = policy || getProgressionPolicy();
  const band = p.levelBands.find(function(b) {
    return averagePercent >= b.minAveragePercent && evaluationCount >= b.minEvaluations;
  });
  return band ? band.level : COMPETENCY_LEVELS.DISCOVERY;
}

/**
 * Calcule le score de confiance (0-100) - "le système ne doit pas
 * considérer immédiatement [1 évaluation à 100 %] comme Expert" (demande
 * explicite). Moyenne ponderee de 3 sous-scores :
 *   - volume    : proportion du nombre d'evaluations par rapport a
 *                 `countTargetForFullScore` (plafonne a 100)
 *   - recence   : 100 si la derniere evaluation date de <=
 *                 `recencyFullScoreDays`, decroit lineairement jusqu'a 0
 *                 a `recencyZeroScoreDays`
 *   - regularite: 100 si les evaluations sont espacees de facon reguliere
 *                 dans le temps (ecart-type des intervalles faible par
 *                 rapport a leur moyenne), 50 par defaut si une seule
 *                 evaluation (rien a mesurer), decroit vers 0 si les
 *                 intervalles sont tres irreguliers
 *
 * @param {{evaluationCount:number, history:Array<{date:string}>, lastEvaluationAt:string}} data
 * @param {object} [policy]
 * @param {Date} [now] - injectable pour les tests
 * @returns {number} un entier 0-100
 */
export function computeConfidenceScore(data, policy, now) {
  const p = policy || getProgressionPolicy();
  const cfg = p.confidence;
  const nowDate = now || new Date();

  const volumeScore = Math.min(100, (data.evaluationCount / cfg.countTargetForFullScore) * 100);

  let recencyScore = 0;
  if (data.lastEvaluationAt) {
    const daysSinceLast = (nowDate.getTime() - new Date(data.lastEvaluationAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast <= cfg.recencyFullScoreDays) recencyScore = 100;
    else if (daysSinceLast >= cfg.recencyZeroScoreDays) recencyScore = 0;
    else {
      const span = cfg.recencyZeroScoreDays - cfg.recencyFullScoreDays;
      recencyScore = 100 * (1 - (daysSinceLast - cfg.recencyFullScoreDays) / span);
    }
  }

  let regularityScore = 50; // neutre par defaut (rien a mesurer avec 0 ou 1 evaluation)
  const dates = (data.history || []).map(function(h) { return new Date(h.date).getTime(); }).sort(function(a, b) { return a - b; });
  if (dates.length >= 3) {
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push(dates[i] - dates[i - 1]);
    const meanGap = gaps.reduce(function(a, b) { return a + b; }, 0) / gaps.length;
    const variance = gaps.reduce(function(a, g) { return a + Math.pow(g - meanGap, 2); }, 0) / gaps.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = meanGap > 0 ? (stdDev / meanGap) : 1;
    regularityScore = Math.max(0, 100 - Math.min(100, coefficientOfVariation * 100));
  }

  const weighted = (volumeScore * cfg.weightCount) + (recencyScore * cfg.weightRecency) + (regularityScore * cfg.weightRegularity);
  return Math.round(Math.max(0, Math.min(100, weighted)));
}
