// ===================== SERVICE DE COMPLETUDE DES QUESTIONS =====================
// Responsabilite UNIQUE : calculer un indicateur de completude des
// metadonnees d'une question (ex. "80 %"), demande explicitement par le
// Sprint 11 ("coup de coeur").
//
// IMPORTANT - ce que cet indicateur N'EST PAS : il ne s'agit EN AUCUN CAS
// d'une evaluation scientifique ou pedagogique de la qualite reelle de la
// question (cela releve d'une relecture humaine, voir
// CHARTE_QUALITE_PHARMEVAL.md). Il s'agit uniquement de verifier la
// PRESENCE des metadonnees attendues (objectifs pedagogiques, tags,
// source, explication, auteur, temps estime) - un signal purement
// STRUCTUREL, jamais une note de qualite du contenu lui-meme. Une
// question a 100% de completude peut tres bien contenir une erreur
// scientifique ; une question a 40% peut etre parfaitement exacte mais
// simplement pas encore enrichie de mots-cles.
//
// Ce fichier n'effectue aucun appel Firestore : utilitaire pur, comme
// question-metadata-service.js.

/**
 * Les six criteres de completude, dans l'ordre demande par le Sprint 11.
 * Chaque critere verifie uniquement la PRESENCE d'une information, jamais
 * sa justesse. Centralise ici pour ne jamais dupliquer cette liste
 * ailleurs (ex. admin/bank.js, qui affiche le detail par critere).
 */
const COMPLETENESS_CRITERIA = Object.freeze([
  {
    key: 'learningObjectives',
    label: 'Objectifs pédagogiques',
    check: function(q) { return Array.isArray(q.learningObjectives) && q.learningObjectives.length > 0; },
  },
  {
    key: 'tags',
    label: 'Tags',
    check: function(q) { return Array.isArray(q.tags) && q.tags.length > 0; },
  },
  {
    key: 'source',
    label: 'Source',
    check: function(q) { return !!(q.source && q.source.toString().trim().length > 0); },
  },
  {
    key: 'explanation',
    label: 'Explication',
    check: function(q) { return !!(q.explanation && q.explanation.toString().trim().length >= 10); },
  },
  {
    key: 'author',
    label: 'Auteur',
    check: function(q) { return !!(q.author && q.author.toString().trim().length > 0); },
  },
  {
    key: 'estimatedTime',
    label: 'Temps estimé',
    check: function(q) { return typeof q.estimatedTime === 'number' && q.estimatedTime > 0; },
  },
]);

/**
 * Calcule la completude des metadonnees d'une question. Ne leve jamais
 * d'exception (fonctionne meme sur un objet partiel ou vide) : une
 * question totalement vide obtient simplement 0%, jamais un plantage de
 * l'interface.
 *
 * @param {object} questionDoc - le document Firestore d'une question (voir QUESTION_SCHEMA.md)
 * @returns {{score:number, passedCount:number, totalCount:number, checks:Array<{key:string, label:string, passed:boolean}>}}
 */
export function computeCompleteness(questionDoc) {
  const q = questionDoc || {};
  const checks = COMPLETENESS_CRITERIA.map(function(criterion) {
    return { key: criterion.key, label: criterion.label, passed: !!criterion.check(q) };
  });
  const passedCount = checks.filter(function(c) { return c.passed; }).length;
  const totalCount = COMPLETENESS_CRITERIA.length;
  const score = totalCount === 0 ? 0 : Math.round((passedCount / totalCount) * 100);
  return { score: score, passedCount: passedCount, totalCount: totalCount, checks: checks };
}

/**
 * Represente visuellement un score de completude sous forme de barre de
 * blocs pleins/vides (ex. "████████░░" pour 80%), reutilisable par
 * n'importe quelle interface future sans dupliquer ce calcul.
 *
 * @param {number} score - 0 a 100
 * @param {number} [barLength] - nombre total de blocs (10 par defaut, comme dans l'exemple du Sprint 11)
 * @returns {string}
 */
export function renderCompletenessBar(score, barLength) {
  const length = barLength || 10;
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, length - filled));
}
