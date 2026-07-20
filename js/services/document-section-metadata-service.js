// ===================== METADONNEES D'UNE SECTION DOCUMENTAIRE (Sprint 20) =====================
// Definit le MODELE DE DONNEES d'un `document_sections/{id}` : une
// position dans l'arborescence d'UNE source documentaire (ex.
// "Cardiologie > Hypertension > IEC" au sein de "CBIP 2026"). Utilitaire
// pur (aucun appel Firestore).
//
// "La profondeur de l'arborescence ne doit pas être limitée
// artificiellement à deux niveaux." (cadrage) : `path`/`pathLabels` sont
// des TABLEAUX de longueur variable (jamais deux champs fixes "niveau 1"/
// "niveau 2"), portant la chaine COMPLETE des ancetres - permet un
// affichage en fil d'Ariane a n'importe quelle profondeur sans relire
// chaque section parente une a une.

const ID_PREFIX_SECTION = 'DOCSEC';

function randomIdSuffix() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(16).slice(2, 10);
}

/** @returns {string} */
export function generateDocumentSectionId() {
  return ID_PREFIX_SECTION + '-' + randomIdSuffix();
}

/** Statuts d'une section - meme principe que les sources (cadrage : "status", "isActive"). */
export const DOCUMENT_SECTION_STATUSES = Object.freeze({
  ACTIVE: 'active',
  ARCHIVED: 'archived',
});

/**
 * Construit les metadonnees completes d'une section a partir de valeurs
 * partielles. `path`/`pathLabels`/`level` sont TOUJOURS fournis par
 * l'appelant (document-section-service.js, qui connait la section parente
 * au moment de la creation) - cette fonction ne les recalcule jamais
 * elle-meme (utilitaire pur, sans acces Firestore pour relire le parent).
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeDocumentSectionMetadata(partial) {
  const p = partial || {};
  return {
    id: p.id || generateDocumentSectionId(),
    organizationId: p.organizationId || null,
    documentSourceId: p.documentSourceId || null,

    parentSectionId: p.parentSectionId || null, // null = section racine
    level: (typeof p.level === 'number') ? p.level : 0, // 0 = racine, 1 = enfant direct d'une racine, etc.

    name: (p.name || '').toString().trim(),
    shortCode: (p.shortCode || '').toString().trim().toUpperCase(),
    description: (p.description || '').toString().trim(),

    // Chaine COMPLETE des ancetres (racine -> ... -> parent direct),
    // jamais la section elle-meme. `path` = identifiants Firestore
    // (navigation programmatique), `pathLabels` = noms lisibles (fil
    // d'Ariane immediat, sans relecture).
    path: Array.isArray(p.path) ? p.path.slice() : [],
    pathLabels: Array.isArray(p.pathLabels) ? p.pathLabels.slice() : [],

    displayOrder: (typeof p.displayOrder === 'number') ? p.displayOrder : 0,

    status: p.status || DOCUMENT_SECTION_STATUSES.ACTIVE,
    isActive: (p.isActive !== undefined) ? !!p.isActive : (p.status !== DOCUMENT_SECTION_STATUSES.ARCHIVED),

    // "Prévoir des compteurs maintenus" (cadrage, "Performance") :
    // `directQuestionCount` = questions rattachees A CETTE section
    // precisement ; `totalQuestionCount` = directQuestionCount + celui de
    // TOUTES les sous-sections (maintenu par document-section-service.js
    // en remontant `path` a chaque rattachement/detachement, jamais par
    // un balayage complet).
    directQuestionCount: (typeof p.directQuestionCount === 'number') ? p.directQuestionCount : 0,
    totalQuestionCount: (typeof p.totalQuestionCount === 'number') ? p.totalQuestionCount : 0,
    childSectionCount: (typeof p.childSectionCount === 'number') ? p.childSectionCount : 0,

    createdAt: p.createdAt || null,
    createdBy: p.createdBy || null,
    updatedAt: p.updatedAt || null,
    updatedBy: p.updatedBy || null,
  };
}

const MIN_NAME_LENGTH = 2;

/**
 * Valide une section. Ne leve jamais d'exception.
 * @param {object} section
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateDocumentSection(section) {
  const errors = [];
  const s = section || {};
  if (!s.organizationId) errors.push('La section doit être rattachée à une organisation.');
  if (!s.documentSourceId) errors.push('La section doit appartenir à une source documentaire.');
  if (!s.name || s.name.toString().trim().length < MIN_NAME_LENGTH) {
    errors.push('Le nom de la section doit contenir au moins ' + MIN_NAME_LENGTH + ' caractères.');
  }
  if (Object.values(DOCUMENT_SECTION_STATUSES).indexOf(s.status) === -1) {
    errors.push('Statut de section invalide : "' + s.status + '".');
  }
  return { valid: errors.length === 0, errors: errors };
}
