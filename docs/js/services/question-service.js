// ===================== SERVICE DE QUESTIONS (FACADE PRINCIPALE) =====================
// Point d'entree principal pour tout ce qui concerne une question en tant
// qu'OBJET PEDAGOGIQUE (pas seulement un QCM) : identifiants (technique et
// pedagogique), metadonnees completes. Coordonne :
//   - js/services/question-metadata-service.js (modele de donnees, defauts, validation)
//   - js/services/evaluation-service.js (reutilise computeQuestionId(), jamais duplique)
//   - js/services/tag-service.js (indirectement, via question-metadata-service.js)
//
// Prepare les usages futurs annonces par le Sprint 9 (editeur de questions,
// import Excel/JSON, campagnes, recommandations, recherche) : ce fichier
// est le point unique que ces futures fonctionnalites appelleront pour
// obtenir l'identite et les metadonnees d'une question, sans jamais avoir a
// connaitre les details de calcul (hachage, numerotation, defauts).

import { computeQuestionId } from "./evaluation-service.js";
import { getMetadata } from "./question-metadata-service.js";
import { THEME_CODES } from "./theme-utils.js";

// ---------------------------------------------------------------------------
// Identifiant pedagogique stable (demande complementaire du Sprint 9)
// ---------------------------------------------------------------------------
//
// Contrairement a l'identifiant technique (computeQuestionId, base sur un
// hachage du texte - CHANGE si la question est reformulee, voir
// RAPPORT_SPRINT4.md), l'identifiant pedagogique NE DOIT JAMAIS CHANGER,
// meme apres de multiples corrections de contenu. Il est donc construit a
// partir de la POSITION de la question au sein de son domaine, dans la
// banque de questions telle que chargee - une correction de texte
// (typographie, distracteur revu...) ne deplace jamais une question dans
// le tableau, donc ne change jamais son identifiant pedagogique.
//
// Limite assumee et documentee (voir QUESTION_SCHEMA.md et
// RAPPORT_SPRINT9.md) : cet identifiant resterait stable pour une
// REORGANISATION du fichier de donnees (ex. reinjection d'une correction
// via le Protocole Operationnel Qualite existant, qui remplace un contenu
// en place sans reordonner), mais changerait si des questions etaient
// un jour INSEREES ou SUPPRIMEES au milieu d'un domaine, ce qui decalerait
// la position de toutes celles qui suivent. C'est une limite structurelle
// tant qu'aucun champ `id` permanent n'est stocke dans data/questions.js
// (hors perimetre de ce sprint : aucune question existante n'est modifiee).

const PEDAGOGICAL_ID_PREFIX = 'PHARM';
const PEDAGOGICAL_ID_DIGITS = 6;
const UNKNOWN_DOMAIN_CODE = 'GEN';

let cachedPedagogicalIdMap = null; // Map<questionObjectRef, string>

function getQdb() {
  return (typeof window !== 'undefined' && window.PharmevalQDB) || [];
}
function getThemeOfQuestionFn() {
  return (typeof window !== 'undefined' && window.PharmevalThemeOfQuestion) || null;
}

function padNumber(n) {
  return String(n).padStart(PEDAGOGICAL_ID_DIGITS, '0');
}

/**
 * Construit (une seule fois, puis met en cache) la correspondance entre
 * chaque question de la banque chargee et son identifiant pedagogique
 * stable, en numerotant sequentiellement les questions AU SEIN de chaque
 * domaine, dans l'ordre ou elles apparaissent dans la banque.
 *
 * @returns {Map<object, string>}
 */
function buildPedagogicalIdMap() {
  if (cachedPedagogicalIdMap) return cachedPedagogicalIdMap;

  const qdb = getQdb();
  const themeOfQuestion = getThemeOfQuestionFn();
  const countersByDomain = {};
  const map = new Map();

  qdb.forEach(function(q) {
    const domain = themeOfQuestion ? themeOfQuestion(q) : null;
    const code = (domain && THEME_CODES[domain]) || UNKNOWN_DOMAIN_CODE;
    countersByDomain[code] = (countersByDomain[code] || 0) + 1;
    map.set(q, PEDAGOGICAL_ID_PREFIX + '-' + code + '-' + padNumber(countersByDomain[code]));
  });

  cachedPedagogicalIdMap = map;
  return map;
}

/**
 * Retourne l'identifiant pedagogique stable d'une question deja presente
 * dans la banque chargee (ex. "PHARM-BAP-000124"). Retourne `null` pour une
 * question qui n'appartiendrait pas (encore) a la banque chargee - un futur
 * editeur de questions devra explicitement integrer une nouvelle question a
 * la banque avant qu'un identifiant pedagogique definitif ne lui soit
 * attribue (evite d'attribuer un identifiant "definitif" a un brouillon qui
 * pourrait encore etre abandonne).
 *
 * @param {object} q
 * @returns {string|null}
 */
export function getPedagogicalId(q) {
  if (!q) return null;
  const map = buildPedagogicalIdMap();
  return map.has(q) ? map.get(q) : null;
}

/**
 * Retourne l'identifiant TECHNIQUE d'une question (reutilise
 * computeQuestionId(), deja etabli et teste depuis le Sprint 4 - jamais
 * duplique ici). Sert notamment a relier une question a son historique
 * d'evaluation existant.
 *
 * @param {object} q
 * @returns {string}
 */
export function getTechnicalId(q) {
  return computeQuestionId(q);
}

/**
 * Retourne les metadonnees completes d'une question (voir
 * question-metadata-service.js), en y injectant en plus les deux
 * identifiants (technique et pedagogique) calcules par ce service - point
 * d'entree unique recommande pour tout code ayant besoin de "tout savoir"
 * sur une question.
 *
 * @param {object} q
 * @returns {object}
 */
export function getQuestionMetadata(q) {
  const metadata = getMetadata(q);
  metadata.id = metadata.id || getTechnicalId(q);
  metadata.pedagogicalId = metadata.pedagogicalId || getPedagogicalId(q);
  return metadata;
}

/**
 * Reinitialise le cache de correspondance des identifiants pedagogiques.
 * Utile uniquement pour les tests (ex. simuler une banque de questions
 * differente entre deux scenarios) - jamais appelee en usage normal, la
 * banque de questions ne change pas en cours de session utilisateur.
 */
export function _resetPedagogicalIdCacheForTests() {
  cachedPedagogicalIdMap = null;
}
