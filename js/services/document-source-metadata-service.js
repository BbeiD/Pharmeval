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
