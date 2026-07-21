// ===================== SERVICE DE METADONNEES DES PARCOURS (Sprint 12) =====================
// Definit le MODELE DE DONNEES d'un Parcours (voir RAPPORT_SPRINT12.md pour
// la documentation complete) et centralise sa lecture, sa validation et sa
// completion - meme role pour les Parcours que question-metadata-service.js
// (Sprint 9) pour les questions.
//
// "Parcours" (jamais "Parcours de competences" dans l'interface - voir
// RAPPORT_SPRINT12.md, decision de nommage) est une organisation logique de
// competences, chacune pouvant etre liee a des questions existantes. Ce
// sprint pose uniquement la STRUCTURE DE DONNEES : aucune logique
// pedagogique, aucune progression utilisateur, aucune validation
// automatique (explicitement hors perimetre).
//
// Ce fichier n'effectue aucun appel Firestore : utilitaire pur, comme
// question-metadata-service.js.

import { normalizeTagList } from "./tag-service.js";

/**
 * Statuts d'un Parcours - EXACTEMENT les memes valeurs que
 * QUESTION_STATUSES (Sprint 9/11), pour un "workflow identique aux
 * questions" comme demande explicitement (Publier/Archiver/Remettre en
 * brouillon/Mettre a la corbeille/Restaurer/Supprimer definitivement).
 * Reprise plutot que reutilisation directe de QUESTION_STATUSES : un
 * Parcours et une Question restent deux types de contenu independants,
 * qui pourraient un jour diverger (ex. un statut specifique aux parcours),
 * mais partagent aujourd'hui exactement le meme cycle de vie.
 */
export const PARCOURS_STATUSES = Object.freeze({
  DRAFT: 'draft',
  REVIEW: 'review',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  TRASH: 'trash',
});

const ID_PREFIX_PARCOURS = 'PARC';
const ID_PREFIX_COMPETENCY = 'COMP';

/**
 * CORRECTIF (avant validation du Sprint 12) : palette FERMEE de 6
 * couleurs, remplaçant la saisie manuelle d'un code couleur libre.
 * L'interface affiche des pastilles cliquables portant ces valeurs
 * TECHNIQUES (ex. "vert") ; la couleur reelle affichee (code hexadecimal)
 * est resolue via PARCOURS_COLOR_HEX ci-dessous - jamais l'inverse, pour
 * ne jamais stocker une valeur dependante d'un theme visuel qui pourrait
 * changer plus tard.
 */
export const PARCOURS_COLORS = Object.freeze({
  VERT: 'vert',
  BLEU: 'bleu',
  ORANGE: 'orange',
  VIOLET: 'violet',
  ROUGE: 'rouge',
  GRIS: 'gris',
});

/** Code hexadecimal reellement affiche pour chaque couleur de la palette
 * fermee. Seul point de verite pour la correspondance valeur technique ->
 * rendu visuel (voir admin/parcours.js, qui l'utilise pour peindre les
 * pastilles cliquables et l'apercu de la couleur choisie). */
export const PARCOURS_COLOR_HEX = Object.freeze({
  vert: '#2E7D32',
  bleu: '#1565C0',
  orange: '#E65100',
  violet: '#6A1B9A',
  rouge: '#C62828',
  gris: '#616161',
});

/**
 * Resout la couleur reellement affichable (code hexadecimal CSS valide)
 * pour une valeur de couleur donnee. COMPATIBILITE ASCENDANTE (demandee
 * explicitement) : un parcours cree AVANT ce correctif peut porter un
 * ancien code hexadecimal libre (ex. "#2E7D32") plutot qu'une des 6
 * valeurs de la palette fermee - dans ce cas, la valeur est utilisee
 * TELLE QUELLE (elle est deja un code CSS valide), sans jamais forcer une
 * migration ni faire disparaitre la couleur choisie a l'epoque.
 *
 * @param {string} colorValue - une valeur de PARCOURS_COLORS, un ancien code hex libre, ou null/vide
 * @returns {string|null}
 */
export function resolveParcoursColorHex(colorValue) {
  if (!colorValue) return null;
  return PARCOURS_COLOR_HEX[colorValue] || colorValue;
}

function randomIdSuffix() {
  // 8 caracteres hexadecimaux, suffisant pour une collision quasi-nulle a
  // l'echelle du nombre de parcours/competences realistement crees par
  // une organisation (voir RAPPORT_SPRINT12.md, "Identifiants").
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  // Repli (environnement sans crypto.randomUUID) : toujours un identifiant
  // valide, juste moins cryptographiquement fort - suffisant pour un usage
  // administratif interne, jamais expose publiquement comme secret.
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Genere un identifiant stable de Parcours (ex. "PARC-a1b2c3d4"). Genere
 * UNE SEULE FOIS a la creation - ne change jamais ensuite, meme apres de
 * multiples modifications (meme principe que l'identifiant pedagogique des
 * questions, Sprint 9).
 *
 * @returns {string}
 */
export function generateParcoursId() {
  return ID_PREFIX_PARCOURS + '-' + randomIdSuffix();
}

/**
 * Genere un identifiant stable de competence au sein d'un Parcours (ex.
 * "COMP-f9e8d7c6").
 *
 * @returns {string}
 */
export function generateCompetencyId() {
  return ID_PREFIX_COMPETENCY + '-' + randomIdSuffix();
}

/**
 * Construit une competence complete a partir de valeurs partielles,
 * completant par des defauts surs tout ce qui manque. Ne genere un nouvel
 * identifiant QUE si aucun n'est deja fourni (permet de completer une
 * competence existante sans lui changer son identifiant stable).
 *
 * CHAMP AJOUTE (Sprint 13, additif, compatibilite ascendante totale) :
 * `competencyId` - reference vers une fiche de la nouvelle "Banque des
 * compétences" (js/services/competency-metadata-service.js, identifiants
 * "SKILL-xxxx"). Une competence de parcours CREEE DEPUIS LE SPRINT 13
 * porte toujours un `competencyId` (voir parcours-service.js,
 * addCompetencyFromBank()) ; une competence plus ancienne peut ne pas en
 * avoir tant qu'elle n'a pas ete migree (voir competency-migration-
 * service.js) - `null` reste une valeur valide, jamais forcee.
 * `name`/`description` restent conserves ici pour un AFFICHAGE DE REPLI
 * immediat si la fiche de la banque n'a pas pu etre relue (jamais comme
 * source de verite une fois `competencyId` present - voir
 * competency-service.js, "Reutilisation").
 *
 * @param {{id?:string, name?:string, description?:string, order?:number, questionIds?:Array<string>, competencyId?:string}} partial
 * @returns {object}
 */
export function completeCompetency(partial) {
  const p = partial || {};
  return {
    id: p.id || generateCompetencyId(),
    name: (p.name || '').toString().trim(),
    description: (p.description || '').toString().trim(),
    order: typeof p.order === 'number' ? p.order : 0,
    questionIds: Array.isArray(p.questionIds) ? p.questionIds.slice() : [],
    competencyId: p.competencyId || null,
  };
}

/**
 * NOUVEAU (Sprint 16, "aller plus loin") : couche "Module", intercalée
 * entre un Parcours et son contenu pédagogique. Aujourd'hui, un seul type
 * existe reellement (regroupement de competences - deja ce que fait
 * `parcours.competencies`), mais le schema est pose des maintenant pour
 * eviter une refonte lorsque d'autres types de contenu (video, PDF,
 * procedure, lien CBIP, cas clinique, simulation...) devront etre integres
 * a un parcours.
 *
 * IMPORTANT (perimetre volontairement limite ce sprint) : `parcours.modules`
 * est un tableau ADDITIF, vide par defaut - `parcours.competencies` reste
 * la SEULE source reellement utilisee par l'interface (Sprint 12/13/16),
 * aucune migration des competences existantes vers cette structure n'a ete
 * effectuee. Cette couche n'est donc, pour l'instant, qu'un schema pret a
 * l'emploi pour un futur sprint - "Les modules peuvent, pour l'instant,
 * etre invisibles pour l'utilisateur" (demande explicite).
 */
export const MODULE_TYPES = Object.freeze({
  COMPETENCY_GROUP: 'competency_group', // regroupement de competences (seul type reellement utilise aujourd'hui, de facon equivalente a parcours.competencies)
  QUIZ: 'quiz',
  CLINICAL_CASE: 'clinical_case',
  PROCEDURE: 'procedure',
  VIDEO: 'video',
  DOCUMENT: 'document',
  LINK: 'link',
});

/**
 * Construit un module complet a partir de valeurs partielles. Utilitaire
 * pur, meme principe que completeCompetency() ci-dessus - non consomme par
 * l'interface ce sprint, prepare pour un futur sprint.
 * @param {{id?:string, name?:string, type?:string, order?:number, competencyIds?:Array<string>, resourceIds?:Array<string>}} partial
 * @returns {object}
 */
export function completeModule(partial) {
  const p = partial || {};
  return {
    id: p.id || generateCompetencyId().replace(ID_PREFIX_COMPETENCY, 'MOD'),
    name: (p.name || '').toString().trim(),
    type: p.type || MODULE_TYPES.COMPETENCY_GROUP,
    order: typeof p.order === 'number' ? p.order : 0,
    competencyIds: Array.isArray(p.competencyIds) ? p.competencyIds.slice() : [],
    // Reserve pour un futur contenu non lie a une competence (video, PDF,
    // lien externe...) - vide par defaut, aucune interface ne l'exploite.
    resourceIds: Array.isArray(p.resourceIds) ? p.resourceIds.slice() : [],
  };
}

/**
 * Construit les metadonnees completes d'un Parcours a partir de valeurs
 * partielles, completant par des defauts surs (jamais une donnee
 * inventee : nom/description vides restent vides, pas remplaces par un
 * texte de substitution).
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeParcoursMetadata(partial) {
  const p = partial || {};
  return {
    id: p.id || generateParcoursId(),
    name: (p.name || '').toString().trim(),
    description: (p.description || '').toString().trim(),
    targetAudience: (p.targetAudience || '').toString().trim(),
    status: p.status || PARCOURS_STATUSES.DRAFT, // jamais publie par defaut, meme principe que les questions
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,
    author: p.author || null,
    color: p.color || null,
    icon: p.icon || null,
    competencies: Array.isArray(p.competencies) ? p.competencies.map(completeCompetency) : [],
    modules: Array.isArray(p.modules) ? p.modules.map(completeModule) : [], // Sprint 16 : prepare, non exploite (voir completeModule ci-dessus)
    tags: normalizeTagList(p.tags || []), // reutilise tag-service.js (Sprint 9), au cas ou un parcours beneficierait des memes mots-cles qu'une question a l'avenir
    // AJOUT (selection directe depuis les Banques) : deux tableaux TOP-LEVEL,
    // jamais niches sous une competence - un parcours peut referencer des
    // sources documentaires et des questions independamment de toute
    // competence. `directQuestionIds` est deliberement distinct de
    // `competencies[].questionIds` (lien question<->competence existant,
    // inchange) pour ne jamais confondre les deux notions dans le code.
    sourceIds: Array.isArray(p.sourceIds) ? p.sourceIds.slice() : [],
    directQuestionIds: Array.isArray(p.directQuestionIds) ? p.directQuestionIds.slice() : [],
  };
}

const MIN_NAME_LENGTH = 3;

/**
 * Valide les metadonnees d'un Parcours : statut valide, nom present avec
 * une longueur minimale, chaque competence structurellement valide. Ne
 * leve jamais d'exception : retourne toujours un resultat structure.
 *
 * @param {object} metadata
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateParcoursMetadata(metadata) {
  const errors = [];
  const m = metadata || {};

  if (Object.values(PARCOURS_STATUSES).indexOf(m.status) === -1) {
    errors.push('Statut invalide : "' + m.status + '" (attendu : ' + Object.values(PARCOURS_STATUSES).join(', ') + ').');
  }
  if (!m.name || m.name.toString().trim().length < MIN_NAME_LENGTH) {
    errors.push('Le nom du parcours doit contenir au moins ' + MIN_NAME_LENGTH + ' caractères.');
  }
  // CORRECTIF : la couleur doit desormais appartenir a la palette fermee
  // (voir PARCOURS_COLORS ci-dessus). Uniquement applique ici (validation
  // a la CREATION) - ne revalide jamais un parcours deja existant, pour
  // ne jamais faire echouer une lecture/edition d'un parcours portant un
  // ancien code couleur libre (compatibilite ascendante demandee).
  if (m.color && Object.values(PARCOURS_COLORS).indexOf(m.color) === -1) {
    errors.push('Couleur invalide : "' + m.color + '" (attendu : ' + Object.values(PARCOURS_COLORS).join(', ') + ', ou aucune).');
  }
  if (!Array.isArray(m.competencies)) {
    errors.push('Le champ "competencies" doit être un tableau.');
  } else {
    m.competencies.forEach(function(c, i) {
      if (!c.name || c.name.toString().trim().length === 0) {
        errors.push('La compétence n°' + (i + 1) + ' doit avoir un nom.');
      }
      if (!Array.isArray(c.questionIds)) {
        errors.push('La compétence n°' + (i + 1) + ' (' + (c.name || '?') + ') doit avoir un tableau "questionIds".');
      }
    });
  }
  if (!Array.isArray(m.sourceIds)) {
    errors.push('Le champ "sourceIds" doit être un tableau.');
  }
  if (!Array.isArray(m.directQuestionIds)) {
    errors.push('Le champ "directQuestionIds" doit être un tableau.');
  }

  return { valid: errors.length === 0, errors: errors };
}
