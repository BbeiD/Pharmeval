// ===================== SERVICE DE METADONNEES DES ORGANISATIONS (Sprint 13) =====================
// Definit le MODELE DE DONNEES d'une Organisation (voir RAPPORT_SPRINT13.md
// pour la documentation complete) et centralise sa lecture, sa validation
// et sa completion - meme role que parcours-metadata-service.js (Sprint 12)
// pour les Parcours, et question-metadata-service.js (Sprint 9) pour les
// questions.
//
// Une Organisation est le premier niveau de gouvernance de Pharmeval
// (Universite, chaine de pharmacies, officine independante, laboratoire,
// autorite de sante, societe privee, autre). Ce sprint pose uniquement la
// STRUCTURE DE DONNEES et son ecran de gestion : aucune gestion des
// utilisateurs, aucune authentification, aucun groupe, role, droit,
// progression, certification ni IA (explicitement hors perimetre).
//
// REUTILISATION EXACTE (regle de developpement n°3 - "reutiliser les
// composants existants avant d'en creer de nouveaux") : les statuts et la
// palette de couleurs fermee sont repris TELS QUELS depuis
// parcours-metadata-service.js, jamais redefinis ici - "les memes couleurs
// signifient toujours la meme chose" (voir la charte de conception
// suggeree). Choix delibere : importer depuis parcours-metadata-service.js
// plutot que d'extraire un module partage, pour respecter la regle de
// developpement n°1 ("ne jamais reanalyser/modifier les sprints
// precedents") - aucune ligne de ce fichier valide n'est touchee. Une
// future extraction vers un module de palette commun (ex.
// color-palette-service.js) pourra etre envisagee le jour ou un TROISIEME
// type de contenu aura besoin de la meme palette, mais n'est pas
// necessaire pour ce sprint (deux consommateurs suffisent a justifier la
// duplication zero via reexport, pas encore une extraction).
//
// Ce fichier n'effectue aucun appel Firestore : utilitaire pur.

import { normalizeTagList } from "./tag-service.js";
import {
  PARCOURS_STATUSES,
  PARCOURS_COLORS,
  PARCOURS_COLOR_HEX,
  resolveParcoursColorHex,
} from "./parcours-metadata-service.js";

/** Statuts d'une Organisation - IDENTIQUES a ceux des Parcours et des
 * Questions (draft/review/published/archived/trash), reutilises tels
 * quels plutot que redefinis - "tous les objets suivent le meme cycle de
 * vie" (charte de conception suggeree). */
export const ORGANISATION_STATUSES = PARCOURS_STATUSES;

/** Palette de couleurs fermee - IDENTIQUE a celle des Parcours (Sprint 12
 * correctif), reutilisee telle quelle. */
export const ORGANISATION_COLORS = PARCOURS_COLORS;
export const ORGANISATION_COLOR_HEX = PARCOURS_COLOR_HEX;
export const resolveOrganisationColorHex = resolveParcoursColorHex;

/**
 * Types d'organisation. Liste fermee, exactement celle demandee par le
 * Sprint 13.
 */
export const ORGANISATION_TYPES = Object.freeze({
  UNIVERSITE: 'universite',
  CHAINE_PHARMACIES: 'chaine_pharmacies',
  OFFICINE_INDEPENDANTE: 'officine_independante',
  LABORATOIRE: 'laboratoire',
  AUTORITE_SANTE: 'autorite_sante',
  SOCIETE_PRIVEE: 'societe_privee',
  AUTRE: 'autre',
});

/** Libelles humains des types d'organisation, pour l'affichage (jamais la
 * valeur technique brute directement dans l'interface). */
export const ORGANISATION_TYPE_LABELS = Object.freeze({
  universite: 'Université',
  chaine_pharmacies: 'Chaîne de pharmacies',
  officine_independante: 'Officine indépendante',
  laboratoire: 'Laboratoire',
  autorite_sante: 'Autorité de santé',
  societe_privee: 'Société privée',
  autre: 'Autre',
});

const ID_PREFIX_ORGANISATION = 'ORG';

function randomIdSuffix() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Genere un identifiant stable d'organisation (ex. "ORG-a1b2c3d4"). Genere
 * UNE SEULE FOIS a la creation - ne change jamais ensuite, meme principe
 * que les identifiants de Parcours (Sprint 12) et de questions (Sprint 9).
 *
 * @returns {string}
 */
export function generateOrganisationId() {
  return ID_PREFIX_ORGANISATION + '-' + randomIdSuffix();
}

/**
 * Genere des indicateurs de tableau de bord SIMULES (nombre de parcours,
 * de questions, d'utilisateurs, de campagnes) - explicitement autorise a
 * l'etre par le Sprint 13 ("Ces valeurs peuvent etre simulees"), aucune
 * liaison reelle n'existant encore. Calcul DETERMINISTE a partir de
 * l'identifiant de l'organisation (jamais aleatoire a chaque affichage) :
 * les memes chiffres s'affichent de maniere stable pour une meme
 * organisation, plutot que de changer a chaque rafraichissement, ce qui
 * serait deroutant meme pour une valeur explicitement simulee.
 *
 * @param {string} organisationId
 * @returns {{parcoursCount:number, questionsCount:number, usersCount:number, campaignsCount:number}}
 */
export function simulateOrganisationStats(organisationId) {
  const seed = (organisationId || '').split('').reduce(function(acc, ch) {
    return (acc * 31 + ch.charCodeAt(0)) % 100000;
  }, 7);
  function pick(offset, max) {
    return (seed + offset * 17) % max;
  }
  return {
    parcoursCount: pick(1, 12),
    questionsCount: pick(2, 400),
    usersCount: pick(3, 250),
    campaignsCount: pick(4, 6),
  };
}

/**
 * Construit les metadonnees completes d'une Organisation a partir de
 * valeurs partielles, completant par des defauts surs (jamais une donnee
 * inventee).
 *
 * Prepare les futures relations (utilisateurs, groupes, roles, parcours,
 * questions, campagnes) SANS LES UTILISER (Sprint 13, explicitement hors
 * perimetre) : un champ `relations` reserve la structure attendue, vide
 * par defaut, pour permettre cette evolution future SANS migration lourde
 * des documents deja crees - voir RAPPORT_SPRINT13.md pour la discussion
 * du choix (references directes ici vs. futur champ `organisationId`
 * inverse sur les collections concernees, a trancher le jour ou cette
 * fonctionnalite sera reellement construite).
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeOrganisationMetadata(partial) {
  const p = partial || {};
  return {
    id: p.id || generateOrganisationId(),
    name: (p.name || '').toString().trim(),
    description: (p.description || '').toString().trim(),
    type: p.type || ORGANISATION_TYPES.AUTRE,
    logoUrl: (p.logoUrl || '').toString().trim() || null,
    color: p.color || null,
    status: p.status || ORGANISATION_STATUSES.DRAFT, // jamais publiee par defaut, meme principe que Parcours/Questions
    author: p.author || null,
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,
    // Preparation de l'internationalisation (Sprint 13, pas encore utilise) :
    country: (p.country || '').toString().trim() || null,
    primaryLanguage: (p.primaryLanguage || '').toString().trim() || null,
    timezone: (p.timezone || '').toString().trim() || null,
    // Preparation des futures relations (Sprint 13, pas encore utilise) :
    relations: {
      users: Array.isArray(p.relations && p.relations.users) ? p.relations.users : [],
      groups: Array.isArray(p.relations && p.relations.groups) ? p.relations.groups : [],
      roles: Array.isArray(p.relations && p.relations.roles) ? p.relations.roles : [],
      parcours: Array.isArray(p.relations && p.relations.parcours) ? p.relations.parcours : [],
      questions: Array.isArray(p.relations && p.relations.questions) ? p.relations.questions : [],
      campaigns: Array.isArray(p.relations && p.relations.campaigns) ? p.relations.campaigns : [],
    },
    tags: normalizeTagList(p.tags || []), // reutilise tag-service.js (Sprint 9), meme principe que Parcours
  };
}

const MIN_ORGANISATION_METADATA_NAME_LENGTH = 3;

/**
 * Valide les metadonnees d'une Organisation. Ne leve jamais d'exception :
 * retourne toujours un resultat structure.
 *
 * @param {object} metadata
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateOrganisationMetadata(metadata) {
  const errors = [];
  const m = metadata || {};

  if (Object.values(ORGANISATION_STATUSES).indexOf(m.status) === -1) {
    errors.push('Statut invalide : "' + m.status + '" (attendu : ' + Object.values(ORGANISATION_STATUSES).join(', ') + ').');
  }
  if (!m.name || m.name.toString().trim().length < MIN_ORGANISATION_METADATA_NAME_LENGTH) {
    errors.push('Le nom de l\'organisation doit contenir au moins ' + MIN_ORGANISATION_METADATA_NAME_LENGTH + ' caractères.');
  }
  if (m.type && Object.values(ORGANISATION_TYPES).indexOf(m.type) === -1) {
    errors.push('Type d\'organisation invalide : "' + m.type + '" (attendu : ' + Object.values(ORGANISATION_TYPES).join(', ') + ').');
  }
  // Meme principe que Parcours (correctif Sprint 12) : la couleur doit
  // appartenir a la palette fermee, uniquement verifie a la CREATION.
  if (m.color && Object.values(ORGANISATION_COLORS).indexOf(m.color) === -1) {
    errors.push('Couleur invalide : "' + m.color + '" (attendu : ' + Object.values(ORGANISATION_COLORS).join(', ') + ', ou aucune).');
  }

  return { valid: errors.length === 0, errors: errors };
}
