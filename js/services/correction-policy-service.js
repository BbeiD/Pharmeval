// ===================== POLITIQUE DE CORRECTION (Sprint 18) =====================
// "Introduire une notion de CorrectionPolicy... Cela évite d'avoir des
// if (score >= 80) dispersés partout dans le code et donnera énormément
// de souplesse à Pharmeval." (demande explicite du donneur d'ordre).
//
// SEUL fichier du projet a contenir un seuil de reussite, un mode
// d'arrondi ou une regle de decompte des questions sans reponse. Aucun
// autre fichier (evaluation-correction-service.js, evaluation-result.js...)
// ne doit jamais coder ces valeurs en dur - toujours lire via
// getCorrectionPolicy().
//
// "Aujourd'hui, ces valeurs seront fixes. Demain, elles pourront être
// différentes selon les organisations, les parcours ou les
// certifications." : la politique est donc exposee comme un ETAT
// MODIFIABLE A L'EXECUTION (getCorrectionPolicy/setCorrectionPolicy),
// jamais une constante figee au chargement du module - meme principe deja
// utilise par question-search-provider.js (Sprint 11, limite de balayage
// configurable) pour une raison similaire. AUCUNE interface ne permet
// encore de la modifier par organisation/parcours/certification ce
// sprint (hors perimetre explicite) : une seule politique GLOBALE
// s'applique a toutes les corrections, mais l'architecture n'aura pas a
// etre revue pour introduire cette granularite plus tard - il suffira de
// faire porter une politique par parcours/organisation plutot que par le
// module global, sans changer la forme de l'objet ni les appelants.

/** Statuts de maitrise d'une competence (SPRINT18, section 4). */
export const COMPETENCY_STATUS = Object.freeze({
  MASTERED: 'mastered',
  TO_REINFORCE: 'to_reinforce',
  NOT_ACQUIRED: 'not_acquired',
});
export const COMPETENCY_STATUS_LABELS = Object.freeze({
  mastered: 'Maîtrisée',
  to_reinforce: 'À renforcer',
  not_acquired: 'Non acquise',
});

/** Statuts possibles d'une question corrigee (SPRINT18, section 3). */
export const QUESTION_RESULT_STATUS = Object.freeze({
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  UNANSWERED: 'unanswered',
});

/** Modes d'arrondi geres pour un pourcentage ("règles d'arrondi", SPRINT18). */
export const ROUNDING_MODES = Object.freeze({
  NEAREST: 'nearest',
  FLOOR: 'floor',
  CEIL: 'ceil',
});

/**
 * Methodes de calcul d'une question a choix multiple ("méthode de calcul
 * des questions multiples", SPRINT18) - PREPAREE, NON EXPLOITEE : aucune
 * question a choix multiple n'existe reellement dans la Banque de
 * questions a ce jour (voir question-renderer-service.js, Sprint 17, meme
 * constat). evaluation-correction-service.js ne lit cette valeur que le
 * jour ou un correcteur "choix multiple" sera reellement ajoute a son
 * registre.
 */
export const MULTI_CHOICE_SCORING_METHODS = Object.freeze({
  EXACT_MATCH: 'exact_match',       // toutes les bonnes options cochees, aucune mauvaise -> correct ; sinon incorrect
  PARTIAL_CREDIT: 'partial_credit', // reserve pour une notation proportionnelle future
});

const DEFAULT_POLICY = Object.freeze({
  // "seuil 'Maîtrisée' (par exemple ≥ 80 %)" / "seuil 'À renforcer'" :
  // un pourcentage >= masteryThresholdPercent -> Maîtrisée ; sinon, >=
  // reinforceThresholdPercent -> À renforcer ; sinon -> Non acquise.
  masteryThresholdPercent: 80,
  reinforceThresholdPercent: 50,

  // "prise en compte ou non des questions non répondues" : `true` =
  // une question sans reponse compte dans le denominateur (comme une
  // reponse incorrecte pour le calcul du pourcentage) - interpretation la
  // plus prudente pedagogiquement (une non-reponse n'est pas une maitrise
  // demontree). `false` reserve une evolution future (exclure les
  // questions sans reponse du denominateur), NON exploitee ce sprint.
  countUnansweredInDenominator: true,

  // "règles d'arrondi"
  roundingMode: ROUNDING_MODES.NEAREST,

  // Prepare, non exploite (voir MULTI_CHOICE_SCORING_METHODS ci-dessus).
  multipleChoiceScoringMethod: MULTI_CHOICE_SCORING_METHODS.EXACT_MATCH,
});

let currentPolicy = Object.assign({}, DEFAULT_POLICY);

/**
 * Politique de correction actuellement en vigueur (copie defensive -
 * jamais la reference interne, pour eviter qu'un appelant ne la modifie
 * par effet de bord sans passer par setCorrectionPolicy()).
 * @returns {object}
 */
export function getCorrectionPolicy() {
  return Object.assign({}, currentPolicy);
}

/**
 * Modifie la politique de correction en vigueur (fusion partielle - les
 * champs non fournis conservent leur valeur actuelle). Reservee a une
 * evolution future (organisation/parcours/certification) ; aucune
 * interface n'appelle cette fonction ce sprint.
 * @param {object} overrides
 */
export function setCorrectionPolicy(overrides) {
  currentPolicy = Object.assign({}, currentPolicy, overrides || {});
}

/** Reinitialise la politique a ses valeurs par defaut (utile pour les tests). */
export function resetCorrectionPolicy() {
  currentPolicy = Object.assign({}, DEFAULT_POLICY);
}

/**
 * Arrondit un pourcentage selon le mode configure par la politique.
 * @param {number} value
 * @param {object} [policy] - politique a utiliser (par defaut, la politique courante)
 * @returns {number}
 */
export function roundPercent(value, policy) {
  const p = policy || getCorrectionPolicy();
  if (p.roundingMode === ROUNDING_MODES.FLOOR) return Math.floor(value);
  if (p.roundingMode === ROUNDING_MODES.CEIL) return Math.ceil(value);
  return Math.round(value);
}

/**
 * Determine le statut de maitrise d'une competence a partir d'un
 * pourcentage, selon les seuils de la politique - LA SEULE fonction du
 * projet autorisee a comparer un pourcentage a un seuil de maitrise.
 * @param {number} percent
 * @param {object} [policy]
 * @returns {string} une valeur de COMPETENCY_STATUS
 */
export function computeCompetencyStatus(percent, policy) {
  const p = policy || getCorrectionPolicy();
  if (percent >= p.masteryThresholdPercent) return COMPETENCY_STATUS.MASTERED;
  if (percent >= p.reinforceThresholdPercent) return COMPETENCY_STATUS.TO_REINFORCE;
  return COMPETENCY_STATUS.NOT_ACQUIRED;
}
