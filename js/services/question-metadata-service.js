// ===================== SERVICE DE METADONNEES DES QUESTIONS =====================
// Definit le MODELE DE DONNEES DEFINITIF d'une question Pharmeval (voir
// QUESTION_SCHEMA.md pour la documentation complete de chaque champ) et
// centralise sa lecture, sa validation et sa completion.
//
// PRINCIPE DE COMPATIBILITE (le plus important de ce sprint) : aucune
// question existante dans data/questions.js n'est modifiee, et ne DOIT
// jamais l'etre par ce service. Toute question existante est aujourd'hui un
// simple objet {t, sub, d, q, a, r, e, ...} sans metadonnees etendues.
// getMetadata(q) ci-dessous NE MUTE JAMAIS l'objet `q` recu : elle retourne
// un NOUVEL objet de metadonnees, construit en completant par des valeurs
// par defaut sures tout ce qui manque. Une question qui possederait deja
// certains de ces champs (via une future cle reservee `q._pharmevalMetadata`,
// que produira un futur editeur de questions/import Excel/JSON) voit ces
// valeurs reelles respectees ; tout champ absent recoit un defaut neutre,
// jamais une donnee inventee presentee comme reelle (source, auteur,
// relecteur, date de relecture, objectifs pedagogiques et mots-cles
// restent `null`/`[]` tant qu'ils n'ont pas ete reellement renseignes).
//
// Ce fichier n'effectue aucun appel Firestore : utilitaire pur, comme
// date-utils.js/score-utils.js/theme-utils.js.

import { formatThemeLabel, KNOWN_THEMES } from "./theme-utils.js";
import { normalizeTagList } from "./tag-service.js";

// ---------------------------------------------------------------------------
// Enumerations centralisees (voir QUESTION_SCHEMA.md pour le detail de
// chacune). Aucune chaine de statut/difficulte/type ne doit etre redefinie
// ailleurs dans l'application : toujours importer depuis ce fichier.
// ---------------------------------------------------------------------------

/** Statuts possibles d'une question (cycle de vie editorial). */
export const QUESTION_STATUSES = Object.freeze({
  DRAFT: 'draft',
  REVIEW: 'review',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
});

/** Niveaux de difficulte, deja utilises tels quels par le champ `d` existant. */
export const DIFFICULTY_LEVELS = Object.freeze({
  ESSENTIEL: 'essentiel',
  APPROFONDI: 'approfondi',
  AVANCE: 'avance',
});

// ---------------------------------------------------------------------------
// Normalisation de la difficulte (decouverte de compatibilite, Sprint 9)
// ---------------------------------------------------------------------------
// Un balayage complet des 949 questions existantes revele que le champ `d`
// contient en realite 9 ecritures differentes (essentiel/approfondi/expert/
// Basique/Intermediaire/Expert/intermediaire/avance/debutant - casse et
// mots differents pour des niveaux equivalents), jamais uniformisees
// jusqu'ici puisque seul le moteur de filtrage de difficulte du quiz
// (js/app.js) les comparait entre elles, sans jamais les valider contre une
// liste fermee. Plutot que d'exiger une reprise de data/questions.js (hors
// perimetre : "aucune banque de donnees modifiee"), ce service NORMALISE la
// valeur lue avant de l'utiliser comme metadonnee - ainsi, validateMetadata()
// peut valider une liste fermee et coherente de 3 niveaux, sans jamais
// rejeter une question existante a cause d'une simple variation d'ecriture.
const DIFFICULTY_NORMALIZATION_MAP = Object.freeze({
  essentiel: DIFFICULTY_LEVELS.ESSENTIEL,
  basique: DIFFICULTY_LEVELS.ESSENTIEL,
  'débutant': DIFFICULTY_LEVELS.ESSENTIEL,
  approfondi: DIFFICULTY_LEVELS.APPROFONDI,
  'intermédiaire': DIFFICULTY_LEVELS.APPROFONDI,
  avance: DIFFICULTY_LEVELS.AVANCE,
  'avancé': DIFFICULTY_LEVELS.AVANCE,
  expert: DIFFICULTY_LEVELS.AVANCE,
});

/**
 * Normalise une valeur brute de difficulte (champ `d` existant, dont
 * l'ecriture varie selon les questions - voir note ci-dessus) vers l'un
 * des 3 niveaux canoniques. Insensible a la casse. Retourne le niveau le
 * plus bas ("essentiel") par defaut si la valeur est totalement inconnue,
 * plutot que de laisser passer une valeur invalide.
 *
 * @param {string} rawDifficulty
 * @returns {string}
 */
export function normalizeDifficulty(rawDifficulty) {
  const key = (rawDifficulty || '').toString().trim().toLowerCase();
  return DIFFICULTY_NORMALIZATION_MAP[key] || DIFFICULTY_LEVELS.ESSENTIEL;
}

/**
 * Liste des ecritures brutes de difficulte reconnues (cles de
 * DIFFICULTY_NORMALIZATION_MAP, insensible a la casse). Utilisee par
 * js/services/question-import-validator.js pour distinguer une variante
 * connue (silencieusement normalisee) d'une valeur totalement inconnue
 * (signalee comme erreur de validation plutot que de se replier
 * silencieusement sur "essentiel" - un import doit etre explicite).
 *
 * @param {string} rawDifficulty
 * @returns {boolean}
 */
export function isRecognizedDifficultyInput(rawDifficulty) {
  const key = (rawDifficulty || '').toString().trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DIFFICULTY_NORMALIZATION_MAP, key);
}

/** Types de question geres par le moteur (voir CHARTE_QUALITE_PHARMEVAL.md, section 8). */
export const QUESTION_TYPES = Object.freeze({
  QCM: 'qcm',
  VRAI_FAUX: 'vrai_faux',
  RELIER: 'relier',
  ARBRE_DECISIONNEL: 'arbre_decisionnel',
  DETECTION_RISQUE: 'detection_risque',
  TROUVER_ERREUR: 'trouver_erreur',
  CAS_EVOLUTIF: 'cas_evolutif',
  FLUX: 'flux',
  QUESTION_SUIVANTE: 'question_suivante',
});

/** Espaces (profils) auxquels une question est destinee. */
export const QUESTION_SPACES = Object.freeze({
  STUDENT: 'student',
  PHARMACIST: 'pharmacist',
  BOTH: 'both',
});

// Temps estime par defaut (secondes), UNIQUEMENT utilise quand aucune
// valeur reelle n'est fournie - une estimation raisonnable par type de
// question, jamais presentee comme une mesure reelle (voir
// QUESTION_SCHEMA.md, "estimatedTime").
const DEFAULT_ESTIMATED_TIME_BY_TYPE = Object.freeze({
  qcm: 20,
  vrai_faux: 15,
  relier: 45,
  arbre_decisionnel: 60,
  detection_risque: 30,
  trouver_erreur: 30,
  cas_evolutif: 90,
  flux: 45,
  question_suivante: 30,
});
const FALLBACK_ESTIMATED_TIME = 30;

function getQdb() {
  return (typeof window !== 'undefined' && window.PharmevalQDB) || [];
}
function getThemeConfig() {
  return (typeof window !== 'undefined' && window.PharmevalThemeConfig) || null;
}
function getThemeOfQuestionFn() {
  return (typeof window !== 'undefined' && window.PharmevalThemeOfQuestion) || null;
}

let cachedKnownSubthemes = null;
/**
 * Ensemble des sous-themes (`sub`) reellement presents dans la banque de
 * questions chargee, calcule une seule fois et mis en cache. Utilise pour
 * valider qu'un `subtheme` de metadonnees correspond a un sous-theme
 * effectivement connu (voir validateMetadata).
 *
 * @returns {Set<string>}
 */
function getKnownSubthemes() {
  if (cachedKnownSubthemes) return cachedKnownSubthemes;
  const qdb = getQdb();
  cachedKnownSubthemes = new Set(qdb.map(function(q) { return q.sub; }).filter(Boolean));
  return cachedKnownSubthemes;
}

/**
 * Determine le type de question a partir du champ existant `type_question`,
 * avec le repli deja etabli par le moteur de quiz : l'absence de ce champ
 * signifie un QCM classique (voir js/app.js, CHARTE_QUALITE_PHARMEVAL.md
 * section 8 : "QCM classique | absent ou 'qcm'").
 *
 * @param {object} q
 * @returns {string}
 */
export function deriveQuestionType(q) {
  return (q && q.type_question) || QUESTION_TYPES.QCM;
}

/**
 * Determine l'espace (student/pharmacist/both) auquel une question est
 * destinee, a partir de THEME_CONFIG (deja existant dans js/app.js, expose
 * via window depuis ce sprint - voir js/app.js). Repli sur 'both' si
 * l'information n'est pas disponible (ex. hors navigateur, tests
 * unitaires sans DOM) plutot que de risquer d'exclure une question a tort.
 *
 * @param {string} domain - identifiant de theme (ex. "bapcoc")
 * @returns {string}
 */
export function deriveSpace(domain) {
  const cfg = getThemeConfig();
  if (!cfg || !domain) return QUESTION_SPACES.BOTH;
  const inStudent = !!(cfg.student && cfg.student.themes && cfg.student.themes.indexOf(domain) !== -1);
  const inPharmacist = !!(cfg.pharmacist && cfg.pharmacist.themes && cfg.pharmacist.themes.indexOf(domain) !== -1);
  if (inStudent && inPharmacist) return QUESTION_SPACES.BOTH;
  if (inStudent) return QUESTION_SPACES.STUDENT;
  if (inPharmacist) return QUESTION_SPACES.PHARMACIST;
  return QUESTION_SPACES.BOTH;
}

/**
 * Determine le domaine/theme d'une question, en reutilisant EXACTEMENT la
 * fonction deja existante et deja correcte de js/app.js (gere notamment le
 * cas particulier "cbip" -> "medicaments"), plutot que de dupliquer cette
 * logique de classification ici.
 *
 * @param {object} q
 * @returns {string|null}
 */
export function deriveDomain(q) {
  const fn = getThemeOfQuestionFn();
  if (fn) return fn(q);
  // Repli minimal si js/app.js n'est pas charge (ex. test unitaire isole) :
  // ne jamais planter, retourner null plutot qu'une classification incertaine.
  return null;
}

/**
 * Construit l'objet de metadonnees COMPLET d'une question, en completant
 * par des valeurs par defaut sures tout champ absent. Ne mute jamais `q`.
 *
 * Si `q._pharmevalMetadata` existe deja (reserve pour un futur editeur de
 * questions ou un futur import Excel/JSON), ses valeurs sont respectees en
 * priorite ; seuls les champs qu'il ne fournit pas sont completes par les
 * defauts ci-dessous. Pour toute question existante aujourd'hui (aucune ne
 * possede ce champ), la totalite des metadonnees est donc calculee par
 * defaut.
 *
 * @param {object} q - objet question tel qu'utilise par le moteur de quiz
 * @returns {object} l'objet de metadonnees complet (voir QUESTION_SCHEMA.md)
 */
export function getMetadata(q) {
  const existing = (q && q._pharmevalMetadata) || {};
  const domain = existing.domain || deriveDomain(q);
  const questionType = existing.questionType || deriveQuestionType(q);

  return {
    id: existing.id || null,
    pedagogicalId: existing.pedagogicalId || null,
    space: existing.space || deriveSpace(domain),
    domain: domain,
    // "theme" reprend aujourd'hui la meme valeur que "domain" (aucune
    // taxonomie de domaine distincte n'existe encore dans Pharmeval - voir
    // QUESTION_SCHEMA.md, note sur l'evolutivite de ce champ).
    theme: existing.theme || domain,
    subtheme: existing.subtheme || (q && q.sub) || null,
    tags: normalizeTagList(existing.tags || []),
    difficulty: existing.difficulty || normalizeDifficulty(q && q.d),
    questionType: questionType,
    source: existing.source || null,
    sourceVersion: existing.sourceVersion || null,
    author: existing.author || null,
    reviewer: existing.reviewer || null,
    reviewDate: existing.reviewDate || null,
    version: existing.version || 1,
    status: existing.status || QUESTION_STATUSES.PUBLISHED,
    createdAt: existing.createdAt || null,
    updatedAt: existing.updatedAt || null,
    estimatedTime: existing.estimatedTime || (DEFAULT_ESTIMATED_TIME_BY_TYPE[questionType] || FALLBACK_ESTIMATED_TIME),
    learningObjectives: Array.isArray(existing.learningObjectives) ? existing.learningObjectives : [],
    keywords: normalizeTagList(existing.keywords || []),
  };
}

/**
 * Complete un objet de metadonnees PARTIEL (ex. saisi par un futur editeur
 * de questions, ou issu d'un import Excel/JSON incomplet) avec les memes
 * valeurs par defaut que getMetadata(), sans necessiter l'objet question
 * complet.
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeMetadata(partial) {
  const p = partial || {};
  const domain = p.domain || null;
  const questionType = p.questionType || QUESTION_TYPES.QCM;
  return {
    id: p.id || null,
    pedagogicalId: p.pedagogicalId || null,
    space: p.space || deriveSpace(domain),
    domain: domain,
    theme: p.theme || domain,
    subtheme: p.subtheme || null,
    tags: normalizeTagList(p.tags || []),
    // Correctif de coherence (Sprint 10) : applique la meme normalisation
    // que getMetadata() ci-dessus, pour qu'une difficulte fournie sous une
    // variante connue (ex. "Intermédiaire", voir la decouverte de
    // compatibilite du Sprint 9) soit normalisee de la meme facon, que la
    // metadonnee soit calculee pour une question existante OU completee
    // pour une nouvelle question (ex. import - voir question-parser.js).
    difficulty: p.difficulty ? normalizeDifficulty(p.difficulty) : DIFFICULTY_LEVELS.ESSENTIEL,
    questionType: questionType,
    source: p.source || null,
    sourceVersion: p.sourceVersion || null,
    author: p.author || null,
    reviewer: p.reviewer || null,
    reviewDate: p.reviewDate || null,
    version: p.version || 1,
    status: p.status || QUESTION_STATUSES.DRAFT,
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,
    estimatedTime: p.estimatedTime || (DEFAULT_ESTIMATED_TIME_BY_TYPE[questionType] || FALLBACK_ESTIMATED_TIME),
    learningObjectives: Array.isArray(p.learningObjectives) ? p.learningObjectives : [],
    keywords: normalizeTagList(p.keywords || []),
  };
}

/**
 * Valide un objet de metadonnees : statut valide, difficulte valide,
 * domaine existant, theme existant, sous-theme valide. Ne leve jamais
 * d'exception : retourne toujours un resultat structure, exploitable
 * directement par un futur editeur de questions pour afficher les erreurs
 * de saisie.
 *
 * @param {object} metadata
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateMetadata(metadata) {
  const errors = [];
  const m = metadata || {};

  if (Object.values(QUESTION_STATUSES).indexOf(m.status) === -1) {
    errors.push('Statut invalide : "' + m.status + '" (attendu : ' + Object.values(QUESTION_STATUSES).join(', ') + ').');
  }
  if (Object.values(DIFFICULTY_LEVELS).indexOf(m.difficulty) === -1) {
    errors.push('Difficulté invalide : "' + m.difficulty + '" (attendu : ' + Object.values(DIFFICULTY_LEVELS).join(', ') + ').');
  }
  if (!m.domain || KNOWN_THEMES.indexOf(m.domain) === -1) {
    errors.push('Domaine inexistant : "' + m.domain + '".');
  }
  if (!m.theme || KNOWN_THEMES.indexOf(m.theme) === -1) {
    errors.push('Thème inexistant : "' + m.theme + '".');
  }
  if (!m.subtheme) {
    errors.push('Sous-thème manquant.');
  } else {
    const known = getKnownSubthemes();
    if (known.size > 0 && !known.has(m.subtheme)) {
      errors.push('Sous-thème invalide : "' + m.subtheme + '" (introuvable dans la banque de questions chargée).');
    }
  }

  return { valid: errors.length === 0, errors: errors };
}

/**
 * Libelle humain du theme/domaine d'une metadonnee (reutilise
 * formatThemeLabel de theme-utils.js - jamais de duplication de cette
 * logique d'affichage).
 *
 * @param {object} metadata
 * @returns {string}
 */
export function getDomainLabel(metadata) {
  return formatThemeLabel(metadata && metadata.domain);
}
