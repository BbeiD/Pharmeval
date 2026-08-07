// ===================== VALIDATEUR D'IMPORT DE QUESTIONS — COPIE SERVEUR =====================
// Copie fidele de validateQuestion() (js/services/question-import-
// validator.js), convertie en CommonJS - voir correction-policy-
// service.js (ce dossier) pour l'explication de la copie plutot qu'un
// import relatif hors de functions/.
//
// UTILISATION SERVEUR (defense en profondeur, audit "mauvais
// utilisateur" du 27/07/2026) : POST /api/questions/batch
// (functions/index.js) revalide desormais CHAQUE question avec cette
// meme fonction avant ecriture - jusqu'ici, un compte admin appelant
// l'API directement pouvait ecrire des questions structurellement
// absurdes (energie hors bornes, thèmes inexistants...) malgre le
// commentaire du fichier d'origine qui promettait une "defense en
// profondeur identique" au client.
//
// IMPORTANT : garder cette copie manuellement synchronisee avec
// l'original cote client si une regle de validation change.

const { KNOWN_THEMES } = require("./theme-utils");
const { isRecognizedDifficultyInput } = require("./question-metadata-validation");

// CORRECTIF (28/07/2026, synchronise avec js/services/question-import-
// validator.js) : catalog-sync-engine.js traduit questionType vers 'qcm'
// (vocabulaire interne) AVANT d'envoyer le document a POST /api/questions/
// batch - cette revalidation serveur voyait donc TOUJOURS 'qcm', jamais
// 'single-choice', et rejetait systematiquement toute synchronisation de
// catalogue avec une erreur 400 (le dry-run, qui ne passe pas par ce
// endpoint, reussissait a tort et masquait le probleme).
const SUPPORTED_IMPORT_QUESTION_TYPES = Object.freeze(['single-choice', 'qcm']);
const KNOWN_SPACES = Object.freeze(['student', 'pharmacist', 'both']);

const MIN_QUESTION_LENGTH = 10;
const MIN_ANSWER_LENGTH = 1;
const MIN_EXPLANATION_LENGTH = 10;
const MIN_ANSWERS_COUNT = 2;
const MAX_ANSWERS_COUNT = 8;

const REQUIRED_QUESTION_FIELDS = Object.freeze([
  'pedagogicalId', 'domain', 'theme', 'subtheme', 'difficulty',
  'questionType', 'question', 'answers', 'correctAnswer', 'explanation',
]);
const OPTIONAL_QUESTION_FIELDS = Object.freeze([
  'source', 'sourceVersion', 'status', 'author', 'reviewer', 'reviewDate',
  'tags', 'learningObjectives', 'keywords', 'space', 'estimatedTime', 'version',
  'externalIds', 'sourceDocument', 'primaryCompetency', 'pendingResourceRefs',
  // CORRECTIF (28/07/2026, meme cause que le correctif questionType
  // ci-dessus) : catalog-sync-engine.js (js/services/catalog-sync-
  // engine.js, ~ligne 366) construit le document FINAL avec des IDs deja
  // RESOLUS (documentSourceId/documentSectionId/competencyId/tagIds),
  // jamais les objets bruts sourceDocument/primaryCompetency ci-dessus -
  // cette revalidation serveur les rejetait TOUS comme "champs inconnus",
  // ce qui faisait echouer 100% des synchronisations de catalogue, meme
  // apres le correctif questionType.
  'documentSourceId', 'documentSectionId', 'competencyId', 'tagIds',
  'fromEditorialCatalog', 'createdAt', 'updatedAt',
  'editorialOnly',
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

function makeError(scope, message, extra) {
  return Object.assign({ scope: scope, message: message }, extra || {});
}

function validateQuestion(rawQuestion, index) {
  const errors = [];
  const pedagogicalId = (rawQuestion && typeof rawQuestion.pedagogicalId === 'string') ? rawQuestion.pedagogicalId : undefined;

  function err(message, field) {
    errors.push(makeError('question', message, { index: index, pedagogicalId: pedagogicalId, field: field }));
  }

  if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
    err('La question n\'est pas un objet JSON valide.');
    return errors;
  }

  Object.keys(rawQuestion).forEach(function(key) {
    if (ALL_QUESTION_FIELDS.indexOf(key) === -1) {
      err('Champ inconnu : "' + key + '".', key);
    }
  });

  REQUIRED_QUESTION_FIELDS.forEach(function(field) {
    if (rawQuestion[field] === undefined || rawQuestion[field] === null) {
      err('Champ obligatoire manquant : "' + field + '".', field);
    }
  });

  if (isNonEmptyString(rawQuestion.pedagogicalId)) {
    if (!PEDAGOGICAL_ID_PATTERN.test(rawQuestion.pedagogicalId)) {
      err('Identifiant pédagogique mal formé : "' + rawQuestion.pedagogicalId + '" (attendu : PHARM-XXX-000000).', 'pedagogicalId');
    }
  } else if (rawQuestion.pedagogicalId !== undefined) {
    err('Le champ "pedagogicalId" doit être une chaîne non vide.', 'pedagogicalId');
  }

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

  if (rawQuestion.subtheme !== undefined) {
    if (!isNonEmptyString(rawQuestion.subtheme)) {
      err('Le champ "subtheme" doit être une chaîne non vide.', 'subtheme');
    } else if (!SUBTHEME_PATTERN.test(rawQuestion.subtheme)) {
      err('Format de sous-thème invalide : "' + rawQuestion.subtheme + '" (attendu : minuscules, chiffres, underscores, ex. "bapcoc_respi").', 'subtheme');
    }
  }

  if (rawQuestion.difficulty !== undefined) {
    if (!isNonEmptyString(rawQuestion.difficulty)) {
      err('Le champ "difficulty" doit être une chaîne non vide.', 'difficulty');
    } else if (!isRecognizedDifficultyInput(rawQuestion.difficulty)) {
      err('Difficulté non reconnue : "' + rawQuestion.difficulty + '".', 'difficulty');
    }
  }

  if (rawQuestion.questionType !== undefined) {
    if (!isNonEmptyString(rawQuestion.questionType)) {
      err('Le champ "questionType" doit être une chaîne non vide.', 'questionType');
    } else if (SUPPORTED_IMPORT_QUESTION_TYPES.indexOf(rawQuestion.questionType) === -1) {
      err('Type de question non pris en charge par l\'import : "' + rawQuestion.questionType + '" (accepté(s) : ' + SUPPORTED_IMPORT_QUESTION_TYPES.join(', ') + ').', 'questionType');
    }
  }

  if (rawQuestion.question !== undefined) {
    if (!isNonEmptyString(rawQuestion.question)) {
      err('Le champ "question" doit être une chaîne non vide.', 'question');
    } else if (rawQuestion.question.trim().length < MIN_QUESTION_LENGTH) {
      err('L\'énoncé de la question est trop court (minimum ' + MIN_QUESTION_LENGTH + ' caractères).', 'question');
    }
  }

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

  if (rawQuestion.correctAnswer !== undefined) {
    if (typeof rawQuestion.correctAnswer !== 'number' || !Number.isInteger(rawQuestion.correctAnswer)) {
      err('Le champ "correctAnswer" doit être un nombre entier.', 'correctAnswer');
    } else if (Array.isArray(rawQuestion.answers)) {
      if (rawQuestion.correctAnswer < 0 || rawQuestion.correctAnswer >= rawQuestion.answers.length) {
        err('L\'index de la bonne réponse ("correctAnswer" = ' + rawQuestion.correctAnswer + ') est hors des limites du tableau "answers" (0 à ' + (rawQuestion.answers.length - 1) + ').', 'correctAnswer');
      }
    }
  }

  if (rawQuestion.explanation !== undefined) {
    if (!isNonEmptyString(rawQuestion.explanation)) {
      err('Le champ "explanation" doit être une chaîne non vide.', 'explanation');
    } else if (rawQuestion.explanation.trim().length < MIN_EXPLANATION_LENGTH) {
      err('L\'explication est trop courte (minimum ' + MIN_EXPLANATION_LENGTH + ' caractères).', 'explanation');
    }
  }

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
  // CORRECTIF (28/07/2026) : IDs deja resolus par catalog-sync-engine.js -
  // voir OPTIONAL_QUESTION_FIELDS ci-dessus pour le contexte complet.
  ['documentSourceId', 'documentSectionId', 'competencyId'].forEach(function(field) {
    if (rawQuestion[field] !== undefined && rawQuestion[field] !== null && typeof rawQuestion[field] !== 'string') {
      err('Le champ "' + field + '", s\'il est fourni, doit être une chaîne (ou null).', field);
    }
  });
  if (rawQuestion.tagIds !== undefined && !isStringArray(rawQuestion.tagIds)) {
    err('Le champ "tagIds", s\'il est fourni, doit être un tableau de chaînes.', 'tagIds');
  }
  if (rawQuestion.fromEditorialCatalog !== undefined && typeof rawQuestion.fromEditorialCatalog !== 'boolean') {
    err('Le champ "fromEditorialCatalog", s\'il est fourni, doit être un booléen.', 'fromEditorialCatalog');
  }
  ['createdAt', 'updatedAt'].forEach(function(field) {
    if (rawQuestion[field] !== undefined && !isNonEmptyString(rawQuestion[field])) {
      err('Le champ "' + field + '", s\'il est fourni, doit être une chaîne non vide.', field);
    }
  });
  if (rawQuestion.space !== undefined && (typeof rawQuestion.space !== 'string' || KNOWN_SPACES.indexOf(rawQuestion.space) === -1)) {
    err('Le champ "space", s\'il est fourni, doit être l\'un de : ' + KNOWN_SPACES.join(', ') + '.', 'space');
  }
  if (rawQuestion.estimatedTime !== undefined && (typeof rawQuestion.estimatedTime !== 'number' || rawQuestion.estimatedTime <= 0)) {
    err('Le champ "estimatedTime", s\'il est fourni, doit être un nombre positif (secondes).', 'estimatedTime');
  }
  if (rawQuestion.version !== undefined && (typeof rawQuestion.version !== 'number' || !Number.isInteger(rawQuestion.version) || rawQuestion.version < 1)) {
    err('Le champ "version", s\'il est fourni, doit être un entier ≥ 1.', 'version');
  }
  if (rawQuestion.status !== undefined && typeof rawQuestion.status !== 'string') {
    err('Le champ "status", s\'il est fourni, doit être une chaîne.', 'status');
  }

  return errors;
}

module.exports = { validateQuestion };
