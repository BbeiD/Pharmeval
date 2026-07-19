// ===================== SERVICE DE METADONNEES DE LA BANQUE DES COMPETENCES (Sprint 13) =====================
// Definit le MODELE DE DONNEES d'une Competence de la nouvelle "Banque des
// competences" (objet Firestore INDEPENDANT, reutilisable par plusieurs
// Parcours - voir SPRINT13, "Objectif du Sprint 13"). Meme role que
// question-metadata-service.js (Sprint 9) pour les questions et que
// parcours-metadata-service.js (Sprint 12) pour les parcours : utilitaire
// pur, aucun appel Firestore ici (voir competency-catalog-service.js).
//
// IMPORTANT (ne pas confondre avec l'existant) : jusqu'au Sprint 12, un
// "COMP-xxxx" designait une competence en TEXTE LIBRE imbriquee DANS un
// document parcours (voir parcours-metadata-service.js, completeCompetency()
// - inchange, conserve pour compatibilite ascendante). Ce Sprint 13 cree un
// type d'objet DIFFERENT et INDEPENDANT : une fiche de competence de la
// banque, stockee dans sa PROPRE collection Firestore (`competencies`),
// prefixee "SKILL-" pour ne jamais etre confondue avec l'ancien identifiant
// imbrique "COMP-xxxx" d'un parcours. Un parcours reference desormais une
// fiche de la banque par son identifiant SKILL-xxxx (voir
// parcours-metadata-service.js, champ `competencyId` de completeCompetency()).

import { normalizeTagList } from "./tag-service.js";
import { DIFFICULTY_LEVELS } from "./question-metadata-service.js";

/**
 * Statuts d'une fiche de competence de la banque. Memes valeurs que
 * PARCOURS_STATUSES/QUESTION_STATUSES (workflow de suppression securisee
 * deja etabli dans le projet - "Ne jamais repartir de zero", reutilisation
 * d'un principe deja valide plutot qu'invention d'un nouveau workflow).
 */
export const COMPETENCY_STATUSES = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  TRASH: 'trash',
});

/**
 * Palette FERMEE de couleurs pour une competence (demande explicite du
 * Sprint 13 : "Remplacer le code couleur libre. Pas de saisie de code
 * HEX."). Volontairement DISTINCTE de PARCOURS_COLORS (parcours-metadata-
 * service.js) : ce sont deux palettes pour deux types de contenu
 * differents, qui pourraient diverger a l'avenir (ex. le Jaune n'existe
 * que pour les competences, sur demande explicite du Sprint 13).
 */
export const COMPETENCY_COLORS = Object.freeze({
  ROUGE: 'rouge',
  ORANGE: 'orange',
  JAUNE: 'jaune',
  VERT: 'vert',
  BLEU: 'bleu',
  VIOLET: 'violet',
});

/** Code hexadecimal reellement affiche pour chaque couleur de la palette
 * fermee des competences. Seul point de verite (meme principe que
 * PARCOURS_COLOR_HEX) - admin/competencies.js et admin/parcours.js (pour
 * l'affichage d'une competence liee) l'utilisent pour peindre les pastilles
 * et les badges de couleur. */
export const COMPETENCY_COLOR_HEX = Object.freeze({
  rouge: '#C62828',
  orange: '#E65100',
  jaune: '#F9A825',
  vert: '#2E7D32',
  bleu: '#1565C0',
  violet: '#6A1B9A',
});

/**
 * Resout le code hexadecimal reellement affichable pour une valeur de
 * couleur. Retourne null si aucune couleur n'est definie (jamais de
 * couleur inventee par defaut).
 * @param {string} colorValue
 * @returns {string|null}
 */
export function resolveCompetencyColorHex(colorValue) {
  if (!colorValue) return null;
  return COMPETENCY_COLOR_HEX[colorValue] || null;
}

const ID_PREFIX_COMPETENCY_BANK = 'SKILL';

function randomIdSuffix() {
  // Meme mecanisme que generateParcoursId()/generateCompetencyId()
  // (parcours-metadata-service.js) - reutilise a l'identique.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Genere un identifiant stable de fiche de competence de la banque (ex.
 * "SKILL-a1b2c3d4"). Genere UNE SEULE FOIS a la creation, ne change jamais
 * ensuite - c'est cet identifiant qu'un parcours referencera (jamais une
 * copie du contenu de la fiche).
 * @returns {string}
 */
export function generateCompetencyBankId() {
  return ID_PREFIX_COMPETENCY_BANK + '-' + randomIdSuffix();
}

/**
 * Niveaux conseilles pour une competence. REUTILISE directement l'echelle
 * de difficulte deja existante pour les questions (DIFFICULTY_LEVELS,
 * question-metadata-service.js, Sprint 9) plutot que d'inventer une
 * nouvelle echelle parallele - meme principe pedagogique, un seul
 * vocabulaire de niveau dans tout Pharmeval.
 */
export const COMPETENCY_LEVELS = DIFFICULTY_LEVELS;

/**
 * Construit un element de "ressource" attache a une competence (voir
 * "Preparer le futur" du Sprint 13 : questions associees, ressources
 * pedagogiques, videos, procedures, documents). Une SEULE structure
 * generique `resources[]` couvre ressources/videos/procedures/documents
 * plutot que 4 tableaux paralleles - plus simple a faire evoluer (un
 * nouveau `type` de ressource ne demande aucun changement de schema), et
 * strictement additif : aucune interface ne consomme encore ce champ (ce
 * sprint ne demande "aucune interface complexe pour ces elements").
 *
 * @param {{type?:string, title?:string, url?:string}} partial
 * @returns {object}
 */
export function completeCompetencyResource(partial) {
  const p = partial || {};
  return {
    id: p.id || generateCompetencyBankId().replace(ID_PREFIX_COMPETENCY_BANK, 'RES'),
    type: (p.type || 'document').toString().trim(), // 'document' | 'video' | 'procedure' | 'link' (liste ouverte, non fermee : simple etiquette d'affichage future)
    title: (p.title || '').toString().trim(),
    url: (p.url || '').toString().trim(),
    addedAt: p.addedAt || new Date().toISOString(),
  };
}

/**
 * Construit les metadonnees completes d'une fiche de competence de la
 * banque a partir de valeurs partielles, completant par des defauts surs
 * (jamais une donnee inventee).
 *
 * Champs "prepares pour le futur" (Sprint 13, section "Preparer le futur") :
 * questionIds, resources, levels, badges, recommendations - tableaux vides
 * par defaut, aucune interface ne les exploite encore, mais le schema est
 * deja pret (ajout futur sans migration de structure).
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeCompetencyMetadata(partial) {
  const p = partial || {};
  return {
    id: p.id || generateCompetencyBankId(),
    name: (p.name || '').toString().trim(),
    description: (p.description || '').toString().trim(),
    color: p.color || null,
    category: (p.category || '').toString().trim(),
    keywords: normalizeTagList(p.keywords || []), // reutilise tag-service.js (Sprint 9), meme principe que les tags de questions
    recommendedLevel: p.recommendedLevel || null,
    status: p.status || COMPETENCY_STATUSES.DRAFT,
    author: p.author || null,
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,

    // --- Champs prepares pour le futur (Sprint 13, "Preparer le futur") ---
    // Vides par defaut. Aucune interface admin/competencies.js ne les
    // affiche au-dela d'un compteur en lecture seule - architecture posee,
    // pas de fonctionnalite prematuree.
    questionIds: Array.isArray(p.questionIds) ? p.questionIds.slice() : [],
    resources: Array.isArray(p.resources) ? p.resources.map(completeCompetencyResource) : [],
    levels: Array.isArray(p.levels) ? p.levels.slice() : [],
    badges: Array.isArray(p.badges) ? p.badges.slice() : [],
    recommendations: Array.isArray(p.recommendations) ? p.recommendations.slice() : [],
  };
}

const MIN_NAME_LENGTH = 3;

/**
 * Valide les metadonnees d'une fiche de competence. Ne leve jamais
 * d'exception : retourne toujours un resultat structure (meme convention
 * que validateParcoursMetadata()).
 *
 * @param {object} metadata
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateCompetencyMetadata(metadata) {
  const errors = [];
  const m = metadata || {};

  if (Object.values(COMPETENCY_STATUSES).indexOf(m.status) === -1) {
    errors.push('Statut invalide : "' + m.status + '" (attendu : ' + Object.values(COMPETENCY_STATUSES).join(', ') + ').');
  }
  if (!m.name || m.name.toString().trim().length < MIN_NAME_LENGTH) {
    errors.push('Le nom de la compétence doit contenir au moins ' + MIN_NAME_LENGTH + ' caractères.');
  }
  if (m.color && Object.values(COMPETENCY_COLORS).indexOf(m.color) === -1) {
    errors.push('Couleur invalide : "' + m.color + '" (attendu : ' + Object.values(COMPETENCY_COLORS).join(', ') + ', ou aucune).');
  }
  if (m.recommendedLevel && Object.values(COMPETENCY_LEVELS).indexOf(m.recommendedLevel) === -1) {
    errors.push('Niveau conseillé invalide : "' + m.recommendedLevel + '" (attendu : ' + Object.values(COMPETENCY_LEVELS).join(', ') + ', ou aucun).');
  }
  if (!Array.isArray(m.keywords)) {
    errors.push('Le champ "keywords" doit être un tableau.');
  }

  return { valid: errors.length === 0, errors: errors };
}
