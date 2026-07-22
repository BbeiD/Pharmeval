// ===================== METADONNEES D'UNE SOURCE DOCUMENTAIRE (Sprint 20) =====================
// Definit le MODELE DE DONNEES d'un `document_sources/{id}` : "une source
// documentaire ou une edition identifiable" (CBIP 2026, BAPCOC 2025,
// Procedure Familia - Retours v3, Pharmacologie ULiege Master 1...).
// Utilitaire pur (aucun appel Firestore) - meme role que
// competency-metadata-service.js (Sprint 13) pour son domaine.
//
// PHILOSOPHIE (cadrage, "Philosophie d'architecture") : "La question ne
// doit pas porter elle-meme toute la classification documentaire... Cette
// approche doit eviter de dupliquer les memes informations sur des
// centaines de questions." Toutes les informations DECRIVANT la source
// (organisme, version, annee, statut...) vivent UNIQUEMENT ici, jamais
// recopiees sur chaque question - une question ne porte que
// `documentSourceId` (reference).

const ID_PREFIX_SOURCE = 'DOCSRC';

function randomIdSuffix() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Genere un identifiant Firestore stable (ex. "DOCSRC-a1b2c3d4"). A NE
 * JAMAIS CONFONDRE avec l'identifiant FONCTIONNEL lisible (ex.
 * "REF-CBIP", voir question-code-service.js) : celui-ci reste
 * l'identifiant technique du document Firestore lui-meme.
 * @returns {string}
 */
export function generateDocumentSourceId() {
  return ID_PREFIX_SOURCE + '-' + randomIdSuffix();
}

/** Types de source documentaire (cadrage, "sourceType"). */
export const DOCUMENT_SOURCE_TYPES = Object.freeze({
  REF: 'REF',   // referentiel externe (CBIP, BAPCOC, FTM...)
  PROC: 'PROC', // procedure interne (Familia, un groupement...)
  ETU: 'ETU',   // enseignement / cours (universite, haute ecole...)
});
export const DOCUMENT_SOURCE_TYPE_LABELS = Object.freeze({
  REF: 'Référentiel',
  PROC: 'Procédure interne',
  ETU: 'Enseignement',
});

// AJOUT (refonte visuelle, phase 1) : icone PAR DEFAUT d'une source (tuiles
// entrainement libre ET admin/document-sources.js) quand aucune icone
// personnalisee n'a ete choisie (display.icon) - centralise ICI pour
// eviter deux tables dupliquees en train de diverger.
// CORRECTIF (bibliotheque d'icones, remplace les emojis) : cles de
// assets/icons/svg (voir js/icons.js), plus des emojis bruts - toute donnee
// Firestore existante avec un ancien emoji brut dans display.icon ne
// correspondra plus a une cle connue et retombera silencieusement sur cette
// icone par defaut au rendu (voir resolveSourceIconKey, admin/document-sources.js).
export const DOCUMENT_SOURCE_TYPE_DEFAULT_ICON = Object.freeze({
  REF: 'doc-01-closed-book',
  PROC: 'doc-04-clipboard',
  ETU: 'academic-diploma',
});

// AJOUT (bibliotheque d'icones, remplace les emojis) : choix propose a
// l'admin pour personnaliser l'icone d'UNE source (admin/document-sources.js
// #saveSourceIcon) - regroupe par theme dans l'ordre d'affichage du picker.
// Les 8 dernieres cles sont des pastilles de couleur unie (voir DOT_ICONS,
// js/icons.js) plutot que des pictogrammes - meme usage libre qu'avant
// (choisir un simple code couleur plutot qu'un dessin).
export const SOURCE_ICON_PICKER_CHOICES = Object.freeze([
  'doc-01-closed-book', 'doc-02-open-book', 'doc-03-notebook', 'doc-04-clipboard',
  'doc-05-binder', 'doc-06-text-sheet', 'doc-07-stacked-pages', 'doc-08-bookmark-book',
  'doc-09-journal', 'doc-10-report', 'doc-11-manual', 'doc-12-reference-card',
  'academic-diploma', 'academic-institution', 'academic-scales-legal', 'academic-scroll-official',
  'academic-pen-signature', 'academic-bookmark', 'academic-label', 'academic-pin', 'academic-growth-chart',
  'medical-hospital-cross', 'medical-pill', 'medical-stethoscope', 'medical-microscope',
  'medical-test-tube', 'medical-flask', 'medical-dna', 'medical-bandage',
  'medical-syringe', 'medical-bacteria', 'medical-bottle-lotion', 'medical-petri-dish',
  'highlight-star-filled', 'highlight-star-premium', 'highlight-lightbulb', 'highlight-search',
  'highlight-brain', 'highlight-check-validated', 'highlight-heart',
  'dot-red', 'dot-orange', 'dot-yellow', 'dot-green', 'dot-blue', 'dot-violet', 'dot-black', 'dot-white-grey',
]);

/**
 * Determine la cle d'icone a afficher pour une source - sa personnalisation
 * (display.icon) SI elle correspond a une cle reelle du pack, sinon l'icone
 * par defaut de son type. Centralise ici (utilise par admin/document-sources.js
 * ET js/entrainement-libre.js) pour ne jamais dupliquer cette regle de repli
 * - notamment le cas d'une ancienne valeur emoji brute (📕...) enregistree
 * avant l'introduction du pack d'icones, qui ne doit jamais s'afficher comme
 * un texte brut ni faire planter le rendu.
 * @param {{display?: {icon?: string}, sourceType?: string}} source
 * @param {Set<string>} knownIconKeys - cles valides (ICONS+DOT_ICONS reunis, voir appelant)
 * @returns {string}
 */
export function resolveSourceIconKey(source, knownIconKeys) {
  const custom = source && source.display && source.display.icon;
  if (custom && knownIconKeys.has(custom)) return custom;
  const fallback = DOCUMENT_SOURCE_TYPE_DEFAULT_ICON[source && source.sourceType];
  return fallback || 'doc-06-text-sheet';
}

/** Statuts d'une source documentaire (cadrage : "draft | active | archived").
 * CORRECTIF : ajout de "deleted" - masquage non destructif distinct de
 * "archived" (une source "deleted" cascade l'archivage de ses questions
 * rattachées, voir document-source-service.js#deleteDocumentSource ;
 * "archived" seul reste sans effet sur les questions, comportement
 * inchangé). Aucune suppression Firestore réelle dans les deux cas. */
export const DOCUMENT_SOURCE_STATUSES = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
});

/**
 * Construit les metadonnees completes d'une source a partir de valeurs
 * partielles, completant par des defauts surs.
 *
 * CORRECTIF (Sprint 20.2, "Catalogue documentaire global") : `organizationId`
 * a ete RETIRE - une source documentaire est desormais une entite
 * GLOBALE de la plateforme, jamais rattachee a une organisation cliente
 * de Pharmeval (voir en-tete de fichier et RAPPORT_CORRECTIF_SPRINT20_2.md).
 * Le champ `organizationName` du Sprint 20 est RENOMME
 * `sourceOrganizationName` pour lever toute ambiguite : il designe
 * l'organisme AUTEUR/EDITEUR de la source (ex. "CBIP", "Familia",
 * "ULiège"), jamais une organisation Pharmeval.
 *
 * "Tous les champs ne sont pas obligatoires pour chaque type" (cadrage) :
 * cette fonction ne rend RIEN obligatoire elle-meme (voir
 * validateDocumentSource() pour les regles reellement bloquantes).
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeDocumentSourceMetadata(partial) {
  const p = partial || {};
  const now = null; // les dates sont fournies par l'appelant (document-source-service.js), jamais generees ici (utilitaire pur, sans horloge implicite)
  return {
    id: p.id || generateDocumentSourceId(),

    sourceType: p.sourceType || null, // REF | PROC | ETU

    name: (p.name || '').toString().trim(),
    shortCode: (p.shortCode || '').toString().trim().toUpperCase(), // reutilise par question-code-service.js pour l'identifiant fonctionnel (ex. "CBIP")
    sourceOrganizationName: (p.sourceOrganizationName || '').toString().trim(), // "organisme auteur/editeur" (ex. "CBIP", "Familia", "ULiège") - AUCUN lien avec une organisation cliente de Pharmeval
    version: (p.version || '').toString().trim(),
    academicYear: (p.academicYear || '').toString().trim(), // surtout utile pour ETU
    language: p.language || 'fr',

    description: (p.description || '').toString().trim(),

    status: p.status || DOCUMENT_SOURCE_STATUSES.DRAFT,
    isActive: (p.isActive !== undefined) ? !!p.isActive : (p.status === DOCUMENT_SOURCE_STATUSES.ACTIVE),

    // AJOUT (refonte visuelle, phase 1) : une source ACTIVE peut rester
    // utilisee ailleurs (parcours, banque de questions) tout en etant
    // exclue de l'entrainement libre - concept DISTINCT du statut
    // actif/brouillon/archive ci-dessus. Jamais utilise pour filtrer les
    // parcours (voir document-source-service.js#browseActiveDocumentSources,
    // seule consommatrice de ce champ).
    hiddenFromFreeTraining: !!p.hiddenFromFreeTraining,

    metadata: {
      author: (p.metadata && p.metadata.author) || null,
      publisher: (p.metadata && p.metadata.publisher) || null, // utile pour les referentiels externes
      publicationDate: (p.metadata && p.metadata.publicationDate) || null,
      lastRevisionDate: (p.metadata && p.metadata.lastRevisionDate) || null,
      externalReference: (p.metadata && p.metadata.externalReference) || null,
    },

    display: {
      label: (p.display && p.display.label) || (p.name || '').toString().trim(),
      icon: (p.display && p.display.icon) || null,
      color: (p.display && p.display.color) || null,
      order: (p.display && typeof p.display.order === 'number') ? p.display.order : 0,
    },

    // "Prévoir des compteurs maintenus" (cadrage, "Performance") : jamais
    // recalcules en parcourant `questions` a chaque affichage.
    sectionCount: (typeof p.sectionCount === 'number') ? p.sectionCount : 0,
    questionCount: (typeof p.questionCount === 'number') ? p.questionCount : 0,

    createdAt: p.createdAt || now,
    createdBy: p.createdBy || null,
    updatedAt: p.updatedAt || now,
    updatedBy: p.updatedBy || null,
  };
}

const MIN_NAME_LENGTH = 2;

/**
 * Valide une source documentaire. Ne leve jamais d'exception.
 * CORRECTIF (Sprint 20.2) : plus aucune exigence d'`organizationId` -
 * une source globale n'appartient à aucune organisation.
 * @param {object} source
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateDocumentSource(source) {
  const errors = [];
  const s = source || {};

  if (Object.values(DOCUMENT_SOURCE_TYPES).indexOf(s.sourceType) === -1) {
    errors.push('Type de source invalide : "' + s.sourceType + '" (attendu : ' + Object.values(DOCUMENT_SOURCE_TYPES).join(', ') + ').');
  }
  if (!s.name || s.name.toString().trim().length < MIN_NAME_LENGTH) {
    errors.push('Le nom de la source doit contenir au moins ' + MIN_NAME_LENGTH + ' caractères.');
  }
  if (!s.shortCode || !/^[A-Z0-9_-]+$/.test(s.shortCode)) {
    errors.push('Le code court est obligatoire et ne peut contenir que des lettres majuscules, chiffres, tirets et underscores (ex. "CBIP").');
  }
  if (Object.values(DOCUMENT_SOURCE_STATUSES).indexOf(s.status) === -1) {
    errors.push('Statut invalide : "' + s.status + '".');
  }

  // "academicYear est surtout utile pour ETU ; version est
  // particulièrement utile pour REF et PROC" (cadrage) - signalé comme un
  // AVERTISSEMENT doux (pas une erreur bloquante, ces champs restent
  // volontairement non obligatoires) via un champ separe `warnings`,
  // jamais mélangé aux erreurs bloquantes.
  const warnings = [];
  if (s.sourceType === DOCUMENT_SOURCE_TYPES.ETU && !s.academicYear) {
    warnings.push('Une source de type "Enseignement" gagne à préciser une année académique.');
  }
  if ((s.sourceType === DOCUMENT_SOURCE_TYPES.REF || s.sourceType === DOCUMENT_SOURCE_TYPES.PROC) && !s.version) {
    warnings.push('Une source de type "' + DOCUMENT_SOURCE_TYPE_LABELS[s.sourceType] + '" gagne à préciser une version.');
  }

  return { valid: errors.length === 0, errors: errors, warnings: warnings };
}
