// ===================== SERVICE DE TAGS (REGISTRE CENTRALISE) =====================
// Centralise la connaissance de tous les tags utilises par Pharmeval, pour
// que le futur moteur de recommandations (js/services/recommendation-
// service.js), un futur editeur de questions, ou une future recherche par
// mot-cle puissent tous s'appuyer sur la MEME liste, jamais sur des chaines
// dispersees et redefinies a chaque endroit.
//
// Ce fichier est un utilitaire pur (aucun appel Firestore) : les tags des
// questions existantes vivent dans data/questions.js (non modifie par ce
// sprint - aucune question n'a aujourd'hui de tags reels), ce service ne
// fait que fournir l'infrastructure de gestion (normalisation, registre,
// libelles) pour les tags qui seront ajoutes plus tard, question par
// question, par un futur editeur.
//
// Preparation de l'internationalisation (demande complementaire du Sprint
// 9) : chaque tag est un identifiant technique (ex. "grossesse"), separe de
// son libelle affichable (voir TAG_LABELS ci-dessous), meme principe que
// js/services/theme-utils.js.

/**
 * Tags "de depart" (seed), fournis a titre d'EXEMPLE pour demontrer le
 * mecanisme - ils ne sont associes a AUCUNE question reelle aujourd'hui
 * (aucune analyse de contenu n'a ete effectuee, conformement au principe
 * "ne jamais inventer une association non verifiee"). Un futur editeur de
 * questions pourra librement ajouter d'autres tags via registerTag().
 */
const SEED_TAG_LABELS = Object.freeze({
  grossesse: 'Grossesse',
  pediatrie: 'Pédiatrie',
  diabete: 'Diabète',
  antibiotique: 'Antibiotique',
  urgence: 'Urgence',
});

// Registre mutable (en memoire, pour la session en cours) : commence avec
// les tags de depart ci-dessus, et s'enrichit au fil de registerTag().
const tagRegistry = new Map(Object.entries(SEED_TAG_LABELS));

/**
 * Normalise un tag brut avant tout usage (registre, comparaison,
 * affectation a une question) : minuscules, espaces superflus retires.
 * Ne modifie jamais un tag deja normalise. Centralise ici pour que deux
 * ecritures differentes du meme tag (" Grossesse", "grossesse ") ne
 * produisent jamais deux entrees distinctes dans le registre.
 *
 * @param {string} tag
 * @returns {string}
 */
export function normalizeTag(tag) {
  return (tag || '').toString().trim().toLowerCase();
}

/**
 * Enregistre un nouveau tag dans le registre centralise (ou ne fait rien
 * s'il existe deja). Le libelle affichable est optionnel : s'il est omis,
 * un libelle de repli est genere a partir de l'identifiant (premiere
 * lettre en majuscule), a la maniere de formatThemeLabel().
 *
 * @param {string} tag
 * @param {string} [label]
 * @returns {string} le tag normalise effectivement enregistre
 */
export function registerTag(tag, label) {
  const normalized = normalizeTag(tag);
  if (!normalized) return normalized;
  if (!tagRegistry.has(normalized)) {
    tagRegistry.set(normalized, label || (normalized.charAt(0).toUpperCase() + normalized.slice(1)));
  } else if (label) {
    tagRegistry.set(normalized, label);
  }
  return normalized;
}

/**
 * Libelle humain d'un tag (voir TAG_LABELS/i18n). Si le tag n'est pas
 * encore enregistre, il est enregistre a la volee avec un libelle de repli
 * (jamais affiche sous sa forme technique brute sans tentative de mise en
 * forme), sans jamais faire planter l'appelant.
 *
 * @param {string} tag
 * @returns {string}
 */
export function getTagLabel(tag) {
  const normalized = normalizeTag(tag);
  if (!normalized) return '';
  if (!tagRegistry.has(normalized)) {
    registerTag(normalized);
  }
  return tagRegistry.get(normalized);
}

/**
 * Liste de tous les tags actuellement connus (seed + tags enregistres
 * depuis), triee alphabetiquement par identifiant pour un affichage stable.
 *
 * @returns {Array<{tag:string, label:string}>}
 */
export function getAllTags() {
  return Array.from(tagRegistry.entries())
    .map(function(entry) { return { tag: entry[0], label: entry[1] }; })
    .sort(function(a, b) { return a.tag < b.tag ? -1 : (a.tag > b.tag ? 1 : 0); });
}

/**
 * Normalise une liste de tags (dedoublonnage inclus), typiquement le champ
 * `tags` ou `keywords` d'une question. Ignore les valeurs vides. Utilisee
 * par js/services/question-metadata-service.js pour completer les
 * metadonnees d'une question de facon sure (jamais de doublon, jamais de
 * tag mal forme).
 *
 * @param {Array<string>} rawTags
 * @returns {Array<string>}
 */
export function normalizeTagList(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set();
  const result = [];
  rawTags.forEach(function(t) {
    const normalized = normalizeTag(t);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}
