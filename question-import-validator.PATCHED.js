// ===================== VALIDATEUR D'IMPORT DE QUESTIONS =====================
// Responsabilite UNIQUE : valider un fichier JSON d'import de questions,
// AVANT toute ecriture Firestore. Ne lit et n'ecrit jamais Firestore
// lui-meme (voir js/services/question-catalog-service.js pour les lectures/
// ecritures, et js/services/import-service.js pour l'orchestration).
//
// Philosophie (Sprint 10) : "Ne jamais faire confiance au fichier importe."
// Ce fichier ne suppose JAMAIS qu'une valeur est correcte simplement parce
// qu'elle est presente et du bon type superficiel - chaque regle listee
// dans la demande du sprint est verifiee explicitement, et TOUTE erreur
// (meme une seule, meme sur une seule question parmi des centaines) rend
// l'ensemble du fichier invalide : "Aucune ecriture si une erreur est
// detectee" - jamais un import partiel de donnees incoherentes.
//
// Ce fichier n'effectue aucun appel Firestore : utilitaire pur, comme
// question-metadata-service.js.

import { KNOWN_THEMES } from "./theme-utils.js";
import { isRecognizedDifficultyInput } from "./question-metadata-service.js";

// ---------------------------------------------------------------------------
// Constantes de validation (jamais de valeur magique eparpillee dans le code)
// ---------------------------------------------------------------------------

/** Versions de schema JSON actuellement acceptees. Voir "Compatibilite" :
 * une version future pourra etre ajoutee ici sans casser les imports
 * existants, une fois le format future defini et son support ajoute.
 *
 * SPRINT 21 : ajout de "1.1" (extension ADDITIVE de "1.0" - voir
 * OPTIONAL_QUESTION_FIELDS ci-dessous pour les 4 nouveaux champs
 * optionnels introduits par le CatalogSyncEngine : externalIds,
 * sourceDocument, primaryCompetency, pendingResourceRefs). "1.0" reste
 * pleinement supporte et INCHANGE : un fichier "1.0" n'utilisant aucun de
 * ces champs continue de se valider exactement comme avant ce sprint. */
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze(['1.0', '1.1']);

/**
 * CORRECTIF (post-Sprint 10) : nombre maximal de questions autorisees dans
 * un seul fichier d'import. Firestore ne garantit l'atomicite d'un
 * writeBatch() QUE dans les limites d'un seul bloc (500 operations
 * maximum) - au-dela, un import necessiterait plusieurs blocs successifs,
 * et l'echec du second bloc ne pourrait pas annuler le premier deja
 * ecrit. Plutot que de developper un mecanisme de reprise/rollback
 * complexe (explicitement hors perimetre), Pharmeval refuse purement et
 * simplement tout fichier depassant cette limite, AVANT toute ecriture -
 * l'administrateur doit diviser un fichier plus volumineux en plusieurs
 * imports distincts. Voir js/services/question-catalog-service.js, qui
 * reutilise cette meme constante comme derniere ligne de defense avant
 * ecriture (jamais un deuxieme bloc Firestore, meme en cas de contournement
 * du validateur).
 */
export const MAX_QUESTIONS_PER_IMPORT = 500;

/** Types de question acceptes par l'IMPORTEUR (vocabulaire du format JSON
 * public, distinct du vocabulaire interne QUESTION_TYPES de Sprint 9 - voir
 * question-parser.js pour la correspondance). Seul "single-choice" est
 * pris en charge ce sprint (voir "Non-objectifs" : pas d'autres types de
 * question geres par l'import cette version). */
export const SUPPORTED_IMPORT_QUESTION_TYPES = Object.freeze(['single-choice']);

/** Espaces acceptes, si fournis (optionnel - voir REQUIRED/OPTIONAL_FIELDS). */
const KNOWN_SPACES = Object.freeze(['student', 'pharmacist', 'both']);

const MIN_QUESTION_LENGTH = 10;
const MIN_ANSWER_LENGTH = 1;
const MIN_EXPLANATION_LENGTH = 10;
const MIN_ANSWERS_COUNT = 2;
const MAX_ANSWERS_COUNT = 8; // garde-fou raisonnable, evite un fichier corrompu avec un tableau demesure

// Champs de premier niveau du fichier, et par question - toute cle absente
// de ces listes est un "champ inconnu" signale explicitement (voir
// "champs inconnus" dans la demande de validation).
const TOP_LEVEL_FIELDS = Object.freeze(['schemaVersion', 'generator', 'generatedAt', 'questions']);
const REQUIRED_QUESTION_FIELDS = Object.freeze([
  'pedagogicalId', 'domain', 'theme', 'subtheme', 'difficulty',
  'questionType', 'question', 'answers', 'correctAnswer', 'explanation',
]);
const OPTIONAL_QUESTION_FIELDS = Object.freeze([
  'source', 'sourceVersion', 'status', 'author', 'reviewer', 'reviewDate',
  'tags', 'learningObjectives', 'keywords', 'space', 'estimatedTime', 'version',
  // SPRINT 21 (schemaVersion "1.1", additifs — voir CatalogSyncEngine) :
  'externalIds', 'sourceDocument', 'primaryCompetency', 'pendingResourceRefs',
]);
const ALL_QUESTION_FIELDS = Object.freeze(REQUIRED_QUESTION_FIELDS.concat(OPTIONAL_QUESTION_FIELDS));

const PEDAGOGICAL_ID_PATTERN = /^PHARM-[A-Z]+-\d+$/;
const SUBTHEME_PATTERN = /^[a-z][a-z0-9_]*$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function isStringArray(v) {
  return Array.isArray(v) && v.every(function(item) { return typeof item === 'string'; });
}

/**
 * Construit une erreur structuree, toujours sous la meme forme, pour un
 * affichage et un traitement uniformes cote interface (admin/import.js).
 *
 * @param {'file'|'question'} scope
 * @param {string} message
 * @param {object} [extra] - { index, pedagogicalId, field }
 * @returns {{scope:string, message:string, index?:number, pedagogicalId?:string, field?:string}}
 */
function makeError(scope, message, extra) {
  return Object.assign({ scope: scope, message: message }, extra || {});
}

/**
 * Valide la structure de premier niveau du fichier (schemaVersion,
 * generator, generatedAt, questions). Ne valide PAS encore le contenu de
 * chaque question (voir validateQuestion ci-dessous).
 *
 * @param {object} payload - le JSON deja parse (voir question-parser.js pour le parsing lui-meme)
 * @returns {Array<object>} liste d'erreurs (vide si aucune)
 */
export function validateFileStructure(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push(makeError('file', 'Le fichier ne contient pas un objet JSON valide à la racine.'));
    return errors; // rien d'autre a verifier si la racine elle-meme est invalide
  }

  // Champs inconnus au premier niveau
  Object.keys(payload).forEach(function(key) {
    if (TOP_LEVEL_FIELDS.indexOf(key) === -1) {
      errors.push(makeError('file', 'Champ inconnu au premier niveau du fichier : "' + key + '".', { field: key }));
    }
  });

  if (!isNonEmptyString(payload.schemaVersion)) {
    errors.push(makeError('file', 'Le champ "schemaVersion" est obligatoire et doit être une chaîne.', { field: 'schemaVersion' }));
  } else if (SUPPORTED_SCHEMA_VERSIONS.indexOf(payload.schemaVersion) === -1) {
    errors.push(makeError('file', 'Version de schéma non prise en charge : "' + payload.schemaVersion + '" (acceptée(s) : ' + SUPPORTED_SCHEMA_VERSIONS.join(', ') + ').', { field: 'schemaVersion' }));
  }

  if (payload.generator !== undefined && !isNonEmptyString(payload.generator)) {
    errors.push(makeError('file', 'Le champ "generator", s\'il est fourni, doit être une chaîne non vide.', { field: 'generator' }));
  }
  if (payload.generatedAt !== undefined && !isNonEmptyString(payload.generatedAt)) {
    errors.push(makeError('file', 'Le champ "generatedAt", s\'il est fourni, doit être une chaîne non vide.', { field: 'generatedAt' }));
  }

  if (!Array.isArray(payload.questions)) {
    errors.push(makeError('file', 'Le champ "questions" est obligatoire et doit être un tableau.', { field: 'questions' }));
  } else if (payload.questions.length === 0) {
    errors.push(makeError('file', 'Le fichier ne contient aucune question ("questions" est un tableau vide).', { field: 'questions' }));
  } else if (payload.questions.length > MAX_QUESTIONS_PER_IMPORT) {
    // CORRECTIF : rejet explicite au-dela de la limite d'atomicite (voir
    // MAX_QUESTIONS_PER_IMPORT ci-dessus). Message exact demande, pour que
    // l'administrateur sache immediatement quoi faire (diviser le fichier).
    errors.push(makeError('file', 'Ce fichier contient ' + payload.questions.length + ' questions. Un import est limité à ' + MAX_QUESTIONS_PER_IMPORT + ' questions afin de garantir son atomicité. Divisez le fichier en plusieurs imports.', { field: 'questions' }));
  }

  return errors;
}

/**
 * Valide une question individuelle (tous les champs requis/optionnels,
 * types, longueurs, index de bonne reponse, champs inconnus).
 *
 * @param {object} rawQuestion
 * @param {number} index - position dans le tableau "questions" (pour un message d'erreur situe)
 * @returns {Array<object>}
 */
export function validateQuestion(rawQuestion, index) {
  const errors = [];
  const pedagogicalId = (rawQuestion && typeof rawQuestion.pedagogicalId === 'string') ? rawQuestion.pedagogicalId : undefined;

  function err(message, field) {
    errors.push(makeError('question', message, { index: index, pedagogicalId: pedagogicalId, field: field }));
  }

  if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
    err('La question n\'est pas un objet JSON valide.');
    return errors;
  }

  // Champs inconnus
  Object.keys(rawQuestion).forEach(function(key) {
    if (ALL_QUESTION_FIELDS.indexOf(key) === -1) {
      err('Champ inconnu : "' + key + '".', key);
    }
  });

  // Champs obligatoires : presence
  REQUIRED_QUESTION_FIELDS.forEach(function(field) {
    if (rawQuestion[field] === undefined || rawQuestion[field] === null) {
      err('Champ obligatoire manquant : "' + field + '".', field);
    }
  });
  // Si un champ obligatoire manque, certaines verifications suivantes ne
  // peuvent pas s'appliquer utilement - on continue quand meme les
  // verifications independantes (jamais d'exception, toujours un rapport
  // complet).

  // pedagogicalId
  if (isNonEmptyString(rawQuestion.pedagogicalId)) {
    if (!PEDAGOGICAL_ID_PATTERN.test(rawQuestion.pedagogicalId)) {
      err('Identifiant pédagogique mal formé : "' + rawQuestion.pedagogicalId + '" (attendu : PHARM-XXX-000000).', 'pedagogicalId');
    }
  } else if (rawQuestion.pedagogicalId !== undefined) {
    err('Le champ "pedagogicalId" doit être une chaîne non vide.', 'pedagogicalId');
  }

  // domain / theme : doivent exister parmi les themes connus
  ['domain', 'theme'].forEach(function(field) {
    const value = rawQuestion[field];
    if (value !== undefined) {
      if (!isNonEmptyString(value)) {
        err('Le champ "' + field + '" doit être une chaîne non vide.', field);
      } else if (KNOWN_THEMES.indexOf(value) === -1) {
        err((field === 'domain' ? 'Domaine' : 'Thème') + ' inexistant : "' + value + '" (attendu : ' + KNOWN_THEMES.join(', ') + ').', field);
      }
    }
  });

  // subtheme : chaine non vide, format raisonnable (nouveaux sous-themes
  // acceptes - un import est precisement l'un des moyens d'en introduire).
  if (rawQuestion.subtheme !== undefined) {
    if (!isNonEmptyString(rawQuestion.subtheme)) {
      err('Le champ "subtheme" doit être une chaîne non vide.', 'subtheme');
    } else if (!SUBTHEME_PATTERN.test(rawQuestion.subtheme)) {
      err('Format de sous-thème invalide : "' + rawQuestion.subtheme + '" (attendu : minuscules, chiffres, underscores, ex. "bapcoc_respi").', 'subtheme');
    }
  }

  // difficulty : normalisee (accepte les variantes deja connues, voir
  // question-metadata-service.js), mais doit rester reconnaissable -
  // jamais un repli silencieux sur "essentiel" pour une valeur totalement
  // inconnue lors d'un import : on prefere le signaler explicitement.
  if (rawQuestion.difficulty !== undefined) {
    if (!isNonEmptyString(rawQuestion.difficulty)) {
      err('Le champ "difficulty" doit être une chaîne non vide.', 'difficulty');
    } else if (!isRecognizedDifficultyInput(rawQuestion.difficulty)) {
      err('Difficulté non reconnue : "' + rawQuestion.difficulty + '".', 'difficulty');
    }
  }

  // questionType : seul "single-choice" est pris en charge ce sprint
  if (rawQuestion.questionType !== undefined) {
    if (!isNonEmptyString(rawQuestion.questionType)) {
      err('Le champ "questionType" doit être une chaîne non vide.', 'questionType');
    } else if (SUPPORTED_IMPORT_QUESTION_TYPES.indexOf(rawQuestion.questionType) === -1) {
      err('Type de question non pris en charge par l\'import : "' + rawQuestion.questionType + '" (seul "single-choice" est accepté ce sprint).', 'questionType');
    }
  }

  // question : chaine, longueur minimale
  if (rawQuestion.question !== undefined) {
    if (!isNonEmptyString(rawQuestion.question)) {
      err('Le champ "question" doit être une chaîne non vide.', 'question');
    } else if (rawQuestion.question.trim().length < MIN_QUESTION_LENGTH) {
      err('L\'énoncé de la question est trop court (minimum ' + MIN_QUESTION_LENGTH + ' caractères).', 'question');
    }
  }

  // answers : tableau de chaines, longueur minimale du tableau, longueur
  // minimale de chaque reponse, pas de doublon
  if (rawQuestion.answers !== undefined) {
    if (!Array.isArray(rawQuestion.answers)) {
      err('Le champ "answers" doit être un tableau.', 'answers');
    } else if (!isStringArray(rawQuestion.answers)) {
      err('Le champ "answers" doit être un tableau de chaînes de caractères.', 'answers');
    } else {
      if (rawQuestion.answers.length < MIN_ANSWERS_COUNT) {
        err('Le tableau "answers" doit contenir au moins ' + MIN_ANSWERS_COUNT + ' propositions.', 'answers');
      }
      if (rawQuestion.answers.length > MAX_ANSWERS_COUNT) {
        err('Le tableau "answers" contient un nombre de propositions anormalement élevé (' + rawQuestion.answers.length + ', maximum ' + MAX_ANSWERS_COUNT + ').', 'answers');
      }
      rawQuestion.answers.forEach(function(a, i) {
        if (a.trim().length < MIN_ANSWER_LENGTH) {
          err('La proposition n°' + (i + 1) + ' est vide ou trop courte.', 'answers');
        }
      });
      const seenAnswers = new Set();
      let hasDuplicate = false;
      rawQuestion.answers.forEach(function(a) {
        const norm = a.trim().toLowerCase();
        if (seenAnswers.has(norm)) hasDuplicate = true;
        seenAnswers.add(norm);
      });
      if (hasDuplicate) {
        err('Le tableau "answers" contient des propositions en double.', 'answers');
      }
    }
  }

  // correctAnswer : entier, dans les bornes du tableau answers
  if (rawQuestion.correctAnswer !== undefined) {
    if (typeof rawQuestion.correctAnswer !== 'number' || !Number.isInteger(rawQuestion.correctAnswer)) {
      err('Le champ "correctAnswer" doit être un nombre entier.', 'correctAnswer');
    } else if (Array.isArray(rawQuestion.answers)) {
      if (rawQuestion.correctAnswer < 0 || rawQuestion.correctAnswer >= rawQuestion.answers.length) {
        err('L\'index de la bonne réponse ("correctAnswer" = ' + rawQuestion.correctAnswer + ') est hors des limites du tableau "answers" (0 à ' + (rawQuestion.answers.length - 1) + ').', 'correctAnswer');
      }
    }
  }

  // explanation : chaine, longueur minimale
  if (rawQuestion.explanation !== undefined) {
    if (!isNonEmptyString(rawQuestion.explanation)) {
      err('Le champ "explanation" doit être une chaîne non vide.', 'explanation');
    } else if (rawQuestion.explanation.trim().length < MIN_EXPLANATION_LENGTH) {
      err('L\'explication est trop courte (minimum ' + MIN_EXPLANATION_LENGTH + ' caractères).', 'explanation');
    }
  }

  // Champs optionnels : types verifies s'ils sont fournis
  if (rawQuestion.source !== undefined && !isNonEmptyString(rawQuestion.source)) {
    err('Le champ "source", s\'il est fourni, doit être une chaîne non vide.', 'source');
  }
  if (rawQuestion.sourceVersion !== undefined && typeof rawQuestion.sourceVersion !== 'string') {
    err('Le champ "sourceVersion", s\'il est fourni, doit être une chaîne.', 'sourceVersion');
  }
  if (rawQuestion.author !== undefined && typeof rawQuestion.author !== 'string') {
    err('Le champ "author", s\'il est fourni, doit être une chaîne.', 'author');
  }
  if (rawQuestion.reviewer !== undefined && typeof rawQuestion.reviewer !== 'string') {
    err('Le champ "reviewer", s\'il est fourni, doit être une chaîne.', 'reviewer');
  }
  if (rawQuestion.reviewDate !== undefined && typeof rawQuestion.reviewDate !== 'string') {
    err('Le champ "reviewDate", s\'il est fourni, doit être une chaîne.', 'reviewDate');
  }
  if (rawQuestion.tags !== undefined && !isStringArray(rawQuestion.tags)) {
    err('Le champ "tags", s\'il est fourni, doit être un tableau de chaînes.', 'tags');
  }
  if (rawQuestion.keywords !== undefined && !isStringArray(rawQuestion.keywords)) {
    err('Le champ "keywords", s\'il est fourni, doit être un tableau de chaînes.', 'keywords');
  }
  if (rawQuestion.learningObjectives !== undefined && !isStringArray(rawQuestion.learningObjectives)) {
    err('Le champ "learningObjectives", s\'il est fourni, doit être un tableau de chaînes.', 'learningObjectives');
  }
  // SPRINT 21 : validation structurelle des champs additifs "1.1". Comme
  // le reste de ce fichier, "ne jamais faire confiance" - un champ present
  // mais mal forme est signale, jamais ignore silencieusement.
  if (rawQuestion.externalIds !== undefined) {
    if (typeof rawQuestion.externalIds !== 'object' || rawQuestion.externalIds === null || Array.isArray(rawQuestion.externalIds)) {
      err('Le champ "externalIds", s\'il est fourni, doit être un objet.', 'externalIds');
    } else if (rawQuestion.externalIds.editorialCatalog !== undefined && !isNonEmptyString(rawQuestion.externalIds.editorialCatalog)) {
      err('Le champ "externalIds.editorialCatalog", s\'il est fourni, doit être une chaîne non vide.', 'externalIds');
    }
  }
  if (rawQuestion.sourceDocument !== undefined) {
    if (typeof rawQuestion.sourceDocument !== 'object' || rawQuestion.sourceDocument === null || Array.isArray(rawQuestion.sourceDocument)) {
      err('Le champ "sourceDocument", s\'il est fourni, doit être un objet.', 'sourceDocument');
    } else {
      ['name', 'level1', 'level2', 'level3', 'preciseReference'].forEach(function(sub) {
        if (rawQuestion.sourceDocument[sub] !== undefined && typeof rawQuestion.sourceDocument[sub] !== 'string') {
          err('Le champ "sourceDocument.' + sub + '", s\'il est fourni, doit être une chaîne.', 'sourceDocument');
        }
      });
    }
  }
  if (rawQuestion.primaryCompetency !== undefined && rawQuestion.primaryCompetency !== null) {
    if (typeof rawQuestion.primaryCompetency !== 'object' || Array.isArray(rawQuestion.primaryCompetency)) {
      err('Le champ "primaryCompetency", s\'il est fourni, doit être un objet (ou null).', 'primaryCompetency');
    } else if (!isNonEmptyString(rawQuestion.primaryCompetency.label)) {
      err('Le champ "primaryCompetency.label" est obligatoire dès lors que "primaryCompetency" est fourni.', 'primaryCompetency');
    }
  }
  if (rawQuestion.pendingResourceRefs !== undefined && !isStringArray(rawQuestion.pendingResourceRefs)) {
    err('Le champ "pendingResourceRefs", s\'il est fourni, doit être un tableau de chaînes.', 'pendingResourceRefs');
  }
  if (rawQuestion.space !== undefined && (typeof rawQuestion.space !== 'string' || KNOWN_SPACES.indexOf(rawQuestion.space) === -1)) {
    err('Le champ "space", s\'il est fourni, doit être l\'un de : ' + KNOWN_SPACES.join(', ') + '.', 'space');
  }
  if (rawQuestion.estimatedTime !== undefined && (typeof rawQuestion.estimatedTime !== 'number' || rawQuestion.estimatedTime <= 0)) {
    err('Le champ "estimatedTime", s\'il est fourni, doit être un nombre positif (secondes).', 'estimatedTime');
  }
  if (rawQuestion.version !== undefined && (typeof rawQuestion.version !== 'number' || !Number.isInteger(rawQuestion.version) || rawQuestion.version < 1)) {
    err('Le champ "version", s\'il est fourni, doit être un entier ≥ 1.', 'version');
  }
  // status est volontairement ignore a l'ecriture (toujours force a
  // "draft" - voir import-service.js), mais reste valide ici pour
  // signaler une valeur manifestement absurde plutot que de l'ignorer
  // silencieusement.
  if (rawQuestion.status !== undefined && typeof rawQuestion.status !== 'string') {
    err('Le champ "status", s\'il est fourni, doit être une chaîne.', 'status');
  }

  return errors;
}

/**
 * Valide le fichier complet : structure de premier niveau, chaque
 * question individuellement, ET l'unicite des identifiants pedagogiques
 * au sein du fichier. Ne s'arrete jamais a la premiere erreur trouvee :
 * rapporte TOUJOURS l'ensemble des problemes en une seule passe.
 *
 * @param {object} payload - le JSON deja parse
 * @returns {{valid:boolean, errors:Array<object>}}
 */
export function validateImportPayload(payload) {
  const fileErrors = validateFileStructure(payload);
  // Si la structure de base est invalide au point qu'il n'y a meme pas de
  // tableau "questions" exploitable, inutile d'aller plus loin.
  if (!payload || !Array.isArray(payload.questions)) {
    return { valid: fileErrors.length === 0, errors: fileErrors };
  }

  // CORRECTIF : un fichier depassant la limite d'atomicite est rejete
  // immediatement, sans perdre de temps a valider chaque question d'un
  // fichier qui sera de toute facon refuse - l'erreur precise est deja
  // dans fileErrors (voir validateFileStructure ci-dessus).
  if (payload.questions.length > MAX_QUESTIONS_PER_IMPORT) {
    return { valid: false, errors: fileErrors };
  }

  const questionErrors = [];
  payload.questions.forEach(function(q, i) {
    questionErrors.push.apply(questionErrors, validateQuestion(q, i));
  });

  // Unicite des identifiants pedagogiques AU SEIN du fichier lui-meme
  // (l'unicite par rapport a l'existant Firestore - creation vs mise a
  // jour - est geree separement par question-catalog-service.js, ce n'est
  // pas une erreur de validation mais un cas d'usage normal).
  const seenIds = new Map(); // pedagogicalId -> premiere position rencontree
  payload.questions.forEach(function(q, i) {
    const id = q && q.pedagogicalId;
    if (typeof id !== 'string' || !id) return; // deja signale par validateQuestion
    if (seenIds.has(id)) {
      questionErrors.push(makeError('question', 'Identifiant pédagogique en double dans le fichier : "' + id + '" (déjà utilisé à la position ' + (seenIds.get(id) + 1) + ').', { index: i, pedagogicalId: id, field: 'pedagogicalId' }));
    } else {
      seenIds.set(id, i);
    }
  });

  const allErrors = fileErrors.concat(questionErrors);
  return { valid: allErrors.length === 0, errors: allErrors };
}
