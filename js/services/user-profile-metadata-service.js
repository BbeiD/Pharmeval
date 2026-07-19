// ===================== METADONNEES METIER D'UN UTILISATEUR (Sprint 14) =====================
// Definit les champs ADDITIFS de gestion metier ajoutes au document
// existant `users/{uid}` (js/services/user-service.js, Sprint 2), sans
// jamais toucher aux champs deja geres par l'authentification (uid, email,
// displayName, photoURL, provider, role, status, profileCompleted,
// version, profile.*, createdAt, lastLogin).
//
// Utilitaire pur (aucun appel Firestore) - meme role que
// competency-metadata-service.js (Sprint 13) pour les compétences.
//
// NE PAS CONFONDRE (voir aussi profiles-bank-service.js) :
// - `role` (authorization-service.js) = permissions techniques (user/admin...)
// - `status` (authorization-service.js STATUSES) = pending/active/suspended,
//   deja utilise par ce sprint comme "Actif" (active) / "Désactivé"
//   (suspended) - AUCUN nouveau champ de statut n'est cree (reutilisation
//   demandee par la Charte : "ne jamais dupliquer un concept existant").
// - `profileId` (ci-dessous) = reference vers la Banque des profils
//   (Sprint 14, profiles-bank-service.js) : le "Profil" metier
//   (Étudiant/Pharmacien/...), une notion totalement distincte du `role`.

/**
 * Complete les champs metier additifs d'un utilisateur a partir de valeurs
 * partielles. Jamais de donnee inventee : les references manquantes
 * restent null/vides plutot que remplacees par une valeur par defaut
 * arbitraire.
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeUserBusinessFields(partial) {
  const p = partial || {};
  return {
    firstName: (p.firstName || '').toString().trim(),
    lastName: (p.lastName || '').toString().trim(),
    organizationId: p.organizationId || null,   // reference vers organizations/{id} (Sprint 14)
    profileId: p.profileId || null,             // reference vers profiles/{id} (Sprint 14)
    groupIds: Array.isArray(p.groupIds) ? p.groupIds.slice() : [], // references vers groups/{id}, plusieurs possibles
    createdBy: p.createdBy || null,              // uid de l'administrateur ayant pré-créé la fiche, null si auto-inscription

    // --- Champs prepares pour le futur (Sprint 14, "Préparer l'avenir") ---
    // Vides par defaut. Aucune interface ne les affiche au-dela d'un
    // compteur en lecture seule (voir admin/users.js) - architecture posee,
    // pas de fonctionnalite prematuree ("Aucun système d'apprentissage
    // n'est demandé dans ce sprint").
    assignedParcoursIds: Array.isArray(p.assignedParcoursIds) ? p.assignedParcoursIds.slice() : [],
    validatedCompetencyIds: Array.isArray(p.validatedCompetencyIds) ? p.validatedCompetencyIds.slice() : [],
    progress: (p.progress && typeof p.progress === 'object') ? p.progress : {},
    badges: Array.isArray(p.badges) ? p.badges.slice() : [],
    certificates: Array.isArray(p.certificates) ? p.certificates.slice() : [],
    trainingHistory: Array.isArray(p.trainingHistory) ? p.trainingHistory.slice() : [],
    evaluationResults: Array.isArray(p.evaluationResults) ? p.evaluationResults.slice() : [],
  };
}

/**
 * Nom d'affichage complet, avec repli honnete si prénom/nom sont absents
 * (utilisateur qui ne s'est jamais vu attribuer de fiche métier complète -
 * jamais masqué ni remplacé par une valeur inventée).
 * @param {object} user - document utilisateur complet (users/{uid})
 * @returns {string}
 */
export function formatUserFullName(user) {
  const u = user || {};
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return full || u.displayName || u.email || '(sans nom)';
}

const MIN_NAME_LENGTH = 1;

/**
 * Valide les champs metier editables d'un utilisateur. Ne leve jamais
 * d'exception.
 * @param {object} fields
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateUserBusinessFields(fields) {
  const errors = [];
  const f = fields || {};
  if (f.firstName !== undefined && f.firstName !== '' && f.firstName.toString().trim().length < MIN_NAME_LENGTH) {
    errors.push('Le prénom est invalide.');
  }
  if (f.lastName !== undefined && f.lastName !== '' && f.lastName.toString().trim().length < MIN_NAME_LENGTH) {
    errors.push('Le nom est invalide.');
  }
  if (f.groupIds !== undefined && !Array.isArray(f.groupIds)) {
    errors.push('Le champ "groupIds" doit être un tableau.');
  }
  return { valid: errors.length === 0, errors: errors };
}
