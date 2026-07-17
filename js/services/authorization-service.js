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
 * Point d'extension pour les sprints futurs : verification d'une permission
 * nommee plutot que d'un role brut (ex. "manage_users", "validate_reports",
 * "manage_campaigns"). Pour l'instant, toute permission est simplement
 * reservee aux administrateurs ; cette fonction existe pour que le reste du
 * code (boutons, gardes d'acces) puisse deja s'ecrire en termes de
 * permissions plutot que de roles, sans devoir etre reecrit quand une
 * matrice de permissions plus fine sera introduite.
 *
 * @param {string} _permission - reserve pour une evolution future
 * @returns {boolean}
 */
export function hasPermission(_permission) {
  return isAdmin();
}
