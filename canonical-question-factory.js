// ===================== HELPERS PARTAGES ENTRE CONNECTEURS (Sprint 21) =====================
// Petites fonctions pures, sans dependance a une source specifique (Excel,
// Sheets...), reutilisables par tout futur connecteur. Aucun appel
// Firestore ici - voir catalog-connector.js pour les regles completes.

const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Convertit une lettre de bonne reponse ("A".."H") en index base 0. Non
 * sensible a la casse, tolere les espaces. Retourne null si la lettre
 * n'est pas reconnue - a l'appelant de produire l'erreur de ligne.
 * @param {string} letter
 * @returns {number|null}
 */
export function answerLetterToIndex(letter) {
  const normalized = (letter || '').toString().trim().toUpperCase();
  const idx = ANSWER_LETTERS.indexOf(normalized);
  return idx === -1 ? null : idx;
}

/**
 * Construit la liste des reponses NON VIDES, dans l'ordre d'origine (les
 * cellules vides en fin de liste - ex. Reponse D absente pour un format a
 * 3 propositions - sont simplement omises, jamais remplacees par une
 * chaine vide qui ferait echouer la validation IMPORT_FORMAT.md).
 * @param {Array<string|null|undefined>} rawAnswers
 * @returns {Array<string>}
 */
export function buildNonEmptyAnswerList(rawAnswers) {
  return (rawAnswers || [])
    .map(function(a) { return (a || '').toString().trim(); })
    .filter(function(a) { return a.length > 0; });
}

/**
 * Decoupe la colonne "Tags" (chaine "tag1; tag2; tag3") en tableau de
 * chaines brutes, non normalisees (la normalisation/dedoublonnage est une
 * responsabilite du moteur - voir tag-catalog-service.js - jamais du
 * connecteur, voir catalog-connector.js).
 * @param {string} rawTagsCell
 * @returns {Array<string>}
 */
export function splitTagsCell(rawTagsCell) {
  return (rawTagsCell || '').toString().split(';')
    .map(function(t) { return t.trim(); })
    .filter(function(t) { return t.length > 0; });
}

/**
 * Construit UNE question canonique (voir catalog-connector.js pour le
 * modele complet) a partir de valeurs deja extraites par le connecteur
 * concret. Ne valide PAS le contenu metier (longueur minimale, index de
 * bonne reponse dans les bornes...) - cette validation reste la
 * responsabilite de question-import-validator.js, jamais dupliquee ici
 * (voir cadrage Sprint 21, "reutiliser imperativement les services
 * existants").
 *
 * @param {object} fields
 * @returns {object} question canonique (schemaVersion 1.1)
 */
export function buildCanonicalQuestion(fields) {
  const result = {
    pedagogicalId: null,
    domain: fields.domain,
    theme: fields.theme,
    subtheme: fields.subtheme,
    difficulty: fields.difficulty,
    questionType: 'single-choice',
    question: fields.question,
    answers: fields.answers,
    correctAnswer: fields.correctAnswer,
    explanation: fields.explanation,
    tags: fields.tags || [],
    status: 'draft',
    externalIds: { editorialCatalog: fields.editorialCatalogId },
    sourceDocument: fields.sourceDocument || { name: '', level1: '', level2: '', level3: '', preciseReference: '' },
    primaryCompetency: fields.primaryCompetencyLabel ? { label: fields.primaryCompetencyLabel } : null,
    pendingResourceRefs: fields.pendingResourceRefs || [],
  };
  // `source` (champ 1.0) doit être ABSENT si non renseigné, jamais `null` -
  // le validateur (question-import-validator.js) traite un champ optionnel
  // *présent mais vide* comme une erreur, contrairement à un champ absent.
  if (fields.sourceDocument && fields.sourceDocument.name) {
    result.source = fields.sourceDocument.name;
  }
  return result;
}
