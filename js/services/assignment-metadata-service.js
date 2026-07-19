// ===================== METADONNEES D'UNE ATTRIBUTION DE PARCOURS (Sprint 15) =====================
// Definit le MODELE DE DONNEES d'une "attribution" : le lien entre UN
// parcours et UNE cible (utilisateur, groupe ou profil), stocke dans sa
// PROPRE collection Firestore `assignments` (jamais dans le document du
// parcours lui-meme - voir SPRINT15, "Ne pas modifier directement les
// documents des parcours").
//
// Utilitaire pur (aucun appel Firestore) - meme role que
// competency-metadata-service.js (Sprint 13) / parcours-metadata-
// service.js (Sprint 12) pour leurs domaines respectifs.
//
// NOTE DE CONVENTION (a propos du champ `type`) : le cadrage du sprint
// donne pour exemple des valeurs en francais ("type = utilisateur / groupe
// / profil"). Ce fichier reprend le NOM DE CHAMP `type` tel quel, mais
// utilise des VALEURS TECHNIQUES anglaises ('user'/'group'/'profile'),
// exactement comme le reste de Pharmeval le fait deja pour tout champ
// enumere (ROLES, STATUSES, COMPETENCY_STATUSES...) : une constante
// technique stable en anglais, jamais renommee, et un libelle affichable
// separe (ASSIGNMENT_TARGET_TYPE_LABELS) pour l'interface - voir aussi
// authorization-service.js pour ce meme principe applique aux roles.

const ID_PREFIX_ASSIGNMENT = 'ASSIGN';

function randomIdSuffix() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Genere un identifiant stable d'attribution (ex. "ASSIGN-a1b2c3d4").
 * @returns {string}
 */
export function generateAssignmentId() {
  return ID_PREFIX_ASSIGNMENT + '-' + randomIdSuffix();
}

/**
 * Types de cible d'une attribution (SPRINT15, "Architecture" : "Un parcours
 * peut être attribué directement à un utilisateur, à un groupe, à un
 * profil"). `targetId` prend alors respectivement : un `uid` (collection
 * `users`), un identifiant de la Banque des groupes (`groups/{id}`,
 * Sprint 14), ou un identifiant de la Banque des profils (`profiles/{id}`,
 * Sprint 14).
 */
export const ASSIGNMENT_TARGET_TYPES = Object.freeze({
  USER: 'user',
  GROUP: 'group',
  PROFILE: 'profile',
});

export const ASSIGNMENT_TARGET_TYPE_LABELS = Object.freeze({
  user: 'Utilisateur',
  group: 'Groupe',
  profile: 'Profil',
});

/**
 * Statuts d'une attribution. Ce sprint ne prepare QUE le champ ("Ces
 * champs ne sont pas encore exploités") : toute nouvelle attribution est
 * `active` par defaut, aucune transition automatique (ex. "expirée" a
 * l'echeance) n'est calculee dans ce sprint - reserve pour un sprint futur
 * une fois la progression reellement construite.
 */
export const ASSIGNMENT_STATUSES = Object.freeze({
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
});

/**
 * Priorites d'une attribution (SPRINT15, "Préparer l'avenir"). Meme
 * principe que DIFFICULTY_LEVELS (question-metadata-service.js) : une
 * echelle fermee a 3 niveaux, suffisante pour ce sprint et pour les
 * besoins de tri/filtrage futurs (campagnes, tableaux de bord).
 */
export const ASSIGNMENT_PRIORITIES = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
});
export const ASSIGNMENT_PRIORITY_LABELS = Object.freeze({
  low: 'Faible',
  normal: 'Normale',
  high: 'Haute',
});

/**
 * Construit une attribution complete a partir de valeurs partielles,
 * completant par des defauts surs. Jamais de donnee inventee : `dueDate`
 * reste `null` (nullable, comme demande explicitement) tant qu'aucune
 * echeance n'est fournie.
 *
 * @param {{id?:string, parcoursId:string, type:string, targetId:string, assignedAt?:string, assignedBy?:string, dueDate?:(string|null), priority?:string, mandatory?:boolean, status?:string}} partial
 * @returns {object}
 */
export function completeAssignmentMetadata(partial) {
  const p = partial || {};
  return {
    id: p.id || generateAssignmentId(),
    parcoursId: p.parcoursId || null,   // reference vers parcours/{id} - JAMAIS une copie du parcours (voir "Ne jamais dupliquer un parcours")
    type: p.type || null,               // une valeur de ASSIGNMENT_TARGET_TYPES
    targetId: p.targetId || null,       // uid | groupId | profileId selon `type`

    // --- "Préparer l'avenir" (SPRINT15) : champs poses des maintenant,
    // non exploites au-dela de leur simple stockage/affichage dans ce
    // sprint (aucune logique d'echeance, de priorite ou de caractere
    // obligatoire n'est encore appliquee nulle part). ---
    assignedAt: p.assignedAt || null,
    assignedBy: p.assignedBy || null,
    dueDate: p.dueDate || null,
    priority: p.priority || ASSIGNMENT_PRIORITIES.NORMAL,
    mandatory: !!p.mandatory,
    status: p.status || ASSIGNMENT_STATUSES.ACTIVE,
  };
}

/**
 * Valide une attribution. Ne leve jamais d'exception.
 * @param {object} assignment
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateAssignmentMetadata(assignment) {
  const errors = [];
  const a = assignment || {};
  if (!a.parcoursId) errors.push('Le parcours cible est obligatoire.');
  if (Object.values(ASSIGNMENT_TARGET_TYPES).indexOf(a.type) === -1) {
    errors.push('Type de cible invalide : "' + a.type + '" (attendu : ' + Object.values(ASSIGNMENT_TARGET_TYPES).join(', ') + ').');
  }
  if (!a.targetId) errors.push('La cible (utilisateur, groupe ou profil) est obligatoire.');
  if (a.priority && Object.values(ASSIGNMENT_PRIORITIES).indexOf(a.priority) === -1) {
    errors.push('Priorité invalide : "' + a.priority + '".');
  }
  if (Object.values(ASSIGNMENT_STATUSES).indexOf(a.status) === -1) {
    errors.push('Statut d\'attribution invalide : "' + a.status + '".');
  }
  return { valid: errors.length === 0, errors: errors };
}
