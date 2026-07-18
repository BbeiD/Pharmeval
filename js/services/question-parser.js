// ===================== ANALYSEUR D'IMPORT DE QUESTIONS =====================
// Responsabilite UNIQUE : transformer un fichier JSON deja VALIDE (voir
// question-import-validator.js, appele avant ce fichier par
// import-service.js) en documents Firestore prets a etre ecrits dans la
// collection `questions`. Ne valide rien lui-meme (suppose que l'appelant a
// deja valide via validateImportPayload()) et n'ecrit jamais Firestore
// directement (voir question-catalog-service.js).
//
// Reutilise le modele de metadonnees du Sprint 9 (completeMetadata()) pour
// ne jamais dupliquer les regles de defaut deja etablies.

import { completeMetadata, QUESTION_STATUSES } from "./question-metadata-service.js";
import { normalizeTagList } from "./tag-service.js";

/** Correspondance entre le vocabulaire du format JSON public (voir
 * QUESTION_SCHEMA.md, "questionType") et le vocabulaire interne de
 * Pharmeval (Sprint 9, QUESTION_TYPES) - une seule table de traduction,
 * jamais dupliquee ailleurs. Seul "single-choice" est pris en charge ce
 * sprint (voir question-import-validator.js, SUPPORTED_IMPORT_QUESTION_TYPES). */
const IMPORT_TYPE_TO_INTERNAL_TYPE = Object.freeze({
  'single-choice': 'qcm',
});

/**
 * Analyse (parse) le texte brut d'un fichier importe. Ne leve jamais
 * d'exception non geree : retourne toujours un resultat structure,
 * exploitable directement par l'interface pour afficher une erreur claire
 * si le fichier n'est meme pas un JSON valide.
 *
 * @param {string} rawText
 * @returns {{success:boolean, data:(object|null), error:(string|null)}}
 */
export function parseImportFile(rawText) {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return { success: false, data: null, error: 'Le fichier est vide.' };
  }
  try {
    const data = JSON.parse(rawText);
    return { success: true, data: data, error: null };
  } catch (e) {
    return { success: false, data: null, error: 'Le fichier n\'est pas un JSON valide (' + e.message + ').' };
  }
}

/**
 * Construit le document Firestore complet d'UNE question importee,
 * combinant : le contenu propre a la question (enonce, propositions,
 * bonne reponse, explication), les metadonnees Sprint 9 (via
 * completeMetadata(), jamais dupliquees), et les nouveaux champs du
 * Sprint 10 (visibility, importMeta).
 *
 * REGLE DE SECURITE NON NEGOCIABLE (demandee explicitement) : le statut
 * ecrit est TOUJOURS "draft", quelle que soit la valeur presente dans le
 * fichier importe (meme si le fichier pretend "published") ET quel que
 * soit le statut deja existant en cas de mise a jour. "Ne jamais publier
 * automatiquement" s'applique sans aucune exception a ce mecanisme
 * d'import - republier une question mise a jour reste une decision
 * humaine separee, deliberement hors de ce sprint (voir RAPPORT_SPRINT10.md,
 * "Limites connues").
 *
 * @param {object} rawQuestion - la question telle que presente dans le fichier importe (deja validee)
 * @param {{schemaVersion:string, generator:string, sourceFile:string, importedByUid:string, importedByEmail:string}} importContext
 * @param {object|null} existingDoc - le document Firestore existant pour ce pedagogicalId, ou null si nouvelle question
 * @returns {object} le document Firestore complet, pret a etre ecrit tel quel
 */
export function buildQuestionDocument(rawQuestion, importContext, existingDoc) {
  const isUpdate = !!existingDoc;

  const internalQuestionType = IMPORT_TYPE_TO_INTERNAL_TYPE[rawQuestion.questionType] || rawQuestion.questionType;

  const metadata = completeMetadata({
    domain: rawQuestion.domain,
    theme: rawQuestion.theme || rawQuestion.domain,
    subtheme: rawQuestion.subtheme,
    difficulty: rawQuestion.difficulty,
    questionType: internalQuestionType,
    source: rawQuestion.source || null,
    sourceVersion: rawQuestion.sourceVersion || null,
    // L'auteur reprend celui explicitement fourni par la question, sinon
    // le generateur declare au niveau du fichier (ex. "Claude") - une
    // attribution honnete de provenance, jamais une invention : le fichier
    // A REELLEMENT ete genere par cet outil.
    author: rawQuestion.author || importContext.generator || null,
    reviewer: rawQuestion.reviewer || null,
    reviewDate: rawQuestion.reviewDate || null,
    // Versionnement (Sprint 9) : une nouvelle question part a la version 1 ;
    // une mise a jour incremente la version EXISTANTE de 1, sans jamais
    // relire une valeur de version fournie par le fichier importe lui-meme
    // (le fichier ne fait pas foi sur ce point - la version est une
    // propriete du cycle de vie cote Pharmeval, pas du fichier source).
    version: isUpdate ? ((existingDoc.version || 1) + 1) : 1,
    // Statut : voir la regle de securite non negociable ci-dessus.
    status: QUESTION_STATUSES.DRAFT,
    createdAt: isUpdate ? (existingDoc.createdAt || null) : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    estimatedTime: rawQuestion.estimatedTime,
    learningObjectives: Array.isArray(rawQuestion.learningObjectives) ? rawQuestion.learningObjectives : [],
    tags: normalizeTagList(rawQuestion.tags || []),
    keywords: normalizeTagList(rawQuestion.keywords || []),
    space: rawQuestion.space,
  });

  metadata.id = rawQuestion.pedagogicalId;
  metadata.pedagogicalId = rawQuestion.pedagogicalId;

  return Object.assign({}, metadata, {
    // Contenu propre a la question (pas des metadonnees Sprint 9 - le
    // contenu pedagogique lui-meme).
    question: rawQuestion.question,
    answers: rawQuestion.answers.slice(), // copie defensive, jamais la reference du fichier importe
    correctAnswer: rawQuestion.correctAnswer,
    explanation: rawQuestion.explanation,

    // Preparation du futur catalogue (Sprint 10, demande complementaire
    // "Preparer le catalogue futur") : aucune interface n'exploite encore
    // ces champs, mais leur presence permet d'accueillir cette
    // fonctionnalite sans devoir migrer les documents existants plus tard.
    // Une mise a jour PRESERVE la visibilite deja definie manuellement
    // (si un futur ecran l'a modifiee) plutot que de l'ecraser a chaque
    // reimport.
    visibility: (isUpdate && existingDoc.visibility) ? existingDoc.visibility : {
      isCatalogVisible: false,
      audiences: [],
      organizationIds: [],
    },

    // Tracabilite de CET import precis (Sprint 10) - distincte du journal
    // d'import global (voir js/services/import-log-service.js), qui
    // trace l'operation d'import dans son ensemble plutot que question par
    // question.
    importMeta: {
      importedAt: new Date().toISOString(),
      importedByUid: importContext.importedByUid || null,
      importedByEmail: importContext.importedByEmail || null,
      sourceFile: importContext.sourceFile || null,
      schemaVersion: importContext.schemaVersion || null,
      generator: importContext.generator || null,
    },
  });
}

/**
 * Determine, pour un lot de questions deja validees, lesquelles
 * correspondent a une CREATION et lesquelles a une MISE A JOUR, a partir
 * d'une correspondance dejaId->documentExistant (voir
 * question-catalog-service.js, getExistingQuestionsByPedagogicalIds()).
 * Fonction pure, ne lit ni n'ecrit Firestore elle-meme.
 *
 * @param {Array<object>} rawQuestions
 * @param {Map<string, object>} existingByIdMap
 * @returns {{creations:Array<object>, updates:Array<object>}}
 */
export function classifyQuestions(rawQuestions, existingByIdMap) {
  const creations = [];
  const updates = [];
  rawQuestions.forEach(function(q) {
    if (existingByIdMap.has(q.pedagogicalId)) {
      updates.push(q);
    } else {
      creations.push(q);
    }
  });
  return { creations: creations, updates: updates };
}
