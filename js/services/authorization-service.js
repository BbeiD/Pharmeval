// ===================== SERVICE D'AUTORISATION =====================
// Centralise TOUTE la logique liee aux roles et aux droits d'acces. Aucun
// autre fichier ne doit contenir de condition du type
// "if (role === 'admin')" : il doit systematiquement passer par les
// fonctions ci-dessous (isAdmin, hasRole, getCurrentRole...).
//
// Ce service lit le role depuis app-context.js (jamais depuis Firestore
// directement) : le contexte est deja peuple une seule fois par connexion
// (voir js/auth.js), ce qui evite toute lecture Firestore repetee.
//
// Important (a documenter aussi cote produit, voir RAPPORT_SPRINT3.md) :
// ce fichier ne fait que des controles COTE CLIENT (affichage, navigation).
// La securite reelle des donnees repose sur les regles Firestore, qui
// doivent independamment empecher toute elevation de privilege (un
// utilisateur ne peut pas s'auto-attribuer le role "admin" en modifiant sa
// propre requete). Les fonctions ci-dessous ne remplacent pas les regles
// Firestore, elles les completent au niveau de l'interface et du code.

import { getCurrentUserContext } from "./app-context.js";

/**
 * Roles connus par Pharmeval. Ce sprint n'en definit que deux, mais la
 * structure est volontairement un objet extensible : ajouter un role futur
 * (ex. TEACHER, QUALITY_MANAGER, SUPER_ADMIN - voir VISION_PHARMEVAL.md)
 * ne demande qu'une ligne ici, sans toucher aux fonctions ci-dessous ni au
 * reste de l'application, qui continuent de fonctionner via hasRole()/
 * getCurrentRole() sans jamais comparer de chaine en dur ailleurs.
 */
export const ROLES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
  // Reserves pour une activation future (voir "Preparer l'avenir" dans
  // RAPPORT_SPRINT8.md) : definis des maintenant comme de vraies constantes
  // (pas de simples commentaires), pour que la matrice de permissions
  // ci-dessous soit deja complete et testable. Ces roles NE SONT PAS
  // attribuables aujourd'hui : aucun bouton ni filtre de l'interface (voir
  // js/admin.js) ne permet de les assigner - seule la fondation
  // architecturale est posee, comme demande explicitement.
  EDITOR: 'editor',           // futur : gestion des questions
  TEACHER: 'teacher',         // futur : gestion des groupes et campagnes
  SUPER_ADMIN: 'super_admin', // futur : gestion complete de la plateforme
});

/**
 * Libelles humains des roles, centralises ici pour ne jamais etre repetes
 * dans plusieurs fichiers (Sprint 8, section "Aucune chaine de caracteres
 * ne doit etre repetee dans plusieurs fichiers"). Utilise par
 * js/admin.js pour l'affichage du tableau des utilisateurs.
 */
export const ROLE_LABELS = Object.freeze({
  user: 'Utilisateur',
  admin: 'Administrateur',
  editor: 'Éditeur',
  teacher: 'Enseignant',
  super_admin: 'Super administrateur',
});

/**
 * Statuts de compte connus par Pharmeval (Sprint 8). Comme pour ROLES,
 * objet extensible : un statut futur ne demanderait qu'une ligne ici.
 * A ce stade, tous les comptes existants et nouveaux restent "active"
 * (voir js/services/user-service.js, inchange par ce sprint) : ces statuts
 * ne sont utilises que par le Centre d'administration pour preparer les
 * evolutions futures, comme demande.
 */
export const STATUSES = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
});

/** Libelles humains des statuts, memes principes que ROLE_LABELS. */
export const STATUS_LABELS = Object.freeze({
  pending: 'En attente',
  active: 'Actif',
  suspended: 'Suspendu',
});

const DEFAULT_ROLE = ROLES.USER;

/**
 * Role de l'utilisateur actuellement connecte, ou le role par defaut
 * ("user") si personne n'est connecte ou si le contexte n'est pas encore
 * charge - un utilisateur non authentifie ou non encore charge n'a jamais
 * plus de droits qu'un utilisateur standard.
 *
 * @returns {string}
 */
export function getCurrentRole() {
  const ctx = getCurrentUserContext();
  return (ctx && ctx.role) || DEFAULT_ROLE;
}

/**
 * L'utilisateur connecte possede-t-il exactement ce role ?
 * (Ce sprint ne gere qu'un role unique par utilisateur ; si Pharmeval
 * devait un jour supporter plusieurs roles simultanes pour un meme compte,
 * seule cette fonction - et la forme du champ "role" cote Firestore -
 * auraient besoin d'evoluer, pas les appelants.)
 *
 * @param {string} role
 * @returns {boolean}
 */
export function hasRole(role) {
  return getCurrentRole() === role;
}

/**
 * Raccourci le plus utilise : l'utilisateur connecte est-il administrateur ?
 * @returns {boolean}
 */
export function isAdmin() {
  return hasRole(ROLES.ADMIN);
}

/**
 * Permissions nommees connues par Pharmeval. Le code appelant (interface,
 * services) doit toujours raisonner en termes de PERMISSION plutot que de
 * ROLE brut des qu'une action pourrait un jour etre accordee a plus d'un
 * role (ex. gerer les utilisateurs sera, demain, accessible a la fois a
 * ADMIN et a SUPER_ADMIN - voir ROLE_PERMISSIONS ci-dessous).
 */
export const PERMISSIONS = Object.freeze({
  MANAGE_USERS: 'manage_users',         // Administrateur (aujourd'hui), Super administrateur (futur)
  MANAGE_QUESTIONS: 'manage_questions', // futur : Editeur
  MANAGE_CAMPAIGNS: 'manage_campaigns', // futur : Enseignant
  MANAGE_PLATFORM: 'manage_platform',   // futur : Super administrateur (acces complet)
  // Correctif Sprint 11 ("suppression securisee") : distincte de
  // MANAGE_QUESTIONS. Un futur role EDITOR pourra gerer les questions
  // (creer, publier, archiver, mettre a la corbeille) SANS jamais pouvoir
  // purger definitivement - cette derniere etape reste reservee aux
  // administrateurs (et au futur Super administrateur), jamais a un
  // simple gestionnaire de contenu.
  PURGE_QUESTIONS: 'purge_questions',
  // Sprint 12 ("Parcours") : memes principes que les questions, appliques
  // a ce nouveau type de contenu. Distincte de MANAGE_QUESTIONS car un
  // parcours et une question restent deux types de contenu independants -
  // un futur role pourrait gerer l'un sans l'autre (ex. un "responsable de
  // formation" qui organise des parcours sans jamais editer de questions).
  MANAGE_PARCOURS: 'manage_parcours',
  PURGE_PARCOURS: 'purge_parcours',
});

/**
 * Matrice role -> permissions accordees. C'EST LE SEUL ENDROIT de toute
 * l'application ou un role est associe a ce qu'il a le droit de faire.
 * Ajouter un futur role pleinement operationnel (Editeur, Enseignant,
 * Super administrateur) ne demande donc, cote logique d'autorisation, QUE
 * de completer cette matrice - aucune fonction ci-dessous, ni aucun service
 * consommateur (admin-service.js, etc.), n'a besoin d'etre modifie : ils
 * appellent tous hasPermission(), jamais une comparaison de role en dur.
 *
 * Les roles EDITOR/TEACHER/SUPER_ADMIN possedent deja leurs permissions
 * ici (matrice complete et testee des ce sprint), meme si aucun ecran ne
 * permet encore de les attribuer a un utilisateur reel - voir
 * RAPPORT_SPRINT8.md, "Preparer l'avenir".
 */
const ROLE_PERMISSIONS = Object.freeze({
  user: Object.freeze([]),
  // Sprint 10 : MANAGE_QUESTIONS ajoutee a admin - "l'import de questions
  // est exclusivement reservee aux administrateurs" (demande explicite du
  // Sprint 10). Aujourd'hui, admin est le seul role reellement attribue et
  // detient donc toutes les capacites operationnelles ; editor (reserve,
  // non attribuable) possedera la MEME permission le jour ou ce role sera
  // reellement implemente - une permission peut etre accordee a plusieurs
  // roles a la fois, c'est precisement l'interet d'une matrice plutot que
  // d'un lien direct role -> fonctionnalite.
  admin: Object.freeze([PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_QUESTIONS, PERMISSIONS.PURGE_QUESTIONS, PERMISSIONS.MANAGE_PARCOURS, PERMISSIONS.PURGE_PARCOURS]),
  editor: Object.freeze([PERMISSIONS.MANAGE_QUESTIONS]), // jamais PURGE_QUESTIONS, meme une fois ce role reellement attribuable ; pas de gestion des parcours pour l'instant (type de contenu distinct, voir Sprint 12)
  teacher: Object.freeze([PERMISSIONS.MANAGE_CAMPAIGNS]),
  super_admin: Object.freeze([
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.MANAGE_QUESTIONS,
    PERMISSIONS.MANAGE_CAMPAIGNS,
    PERMISSIONS.MANAGE_PLATFORM,
    PERMISSIONS.PURGE_QUESTIONS,
    PERMISSIONS.MANAGE_PARCOURS,
    PERMISSIONS.PURGE_PARCOURS,
  ]),
});

/**
 * L'utilisateur connecte possede-t-il la permission nommee donnee ?
 * Remplace l'ancien raccourci "toute permission = isAdmin()" par une
 * vraie verification via ROLE_PERMISSIONS, de facon totalement
 * retrocompatible (aujourd'hui, seul ADMIN possede MANAGE_USERS, donc le
 * comportement observable est identique a avant ce sprint).
 *
 * @param {string} permission - une valeur de PERMISSIONS
 * @returns {boolean}
 */
export function hasPermission(permission) {
  const role = getCurrentRole();
  const granted = ROLE_PERMISSIONS[role] || [];
  return granted.indexOf(permission) !== -1;
}

/**
 * Statut de compte de l'utilisateur actuellement connecte (Sprint 8), ou
 * "active" par defaut si le contexte n'est pas encore charge - coherent
 * avec le comportement de creation de compte (voir user-service.js).
 *
 * @returns {string}
 */
export function getCurrentStatus() {
  const ctx = getCurrentUserContext();
  return (ctx && ctx.status) || STATUSES.ACTIVE;
}

/**
 * L'utilisateur connecte a-t-il exactement ce statut ?
 * @param {string} status
 * @returns {boolean}
 */
export function hasStatus(status) {
  return getCurrentStatus() === status;
}
