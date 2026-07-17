// ===================== CONTEXTE UTILISATEUR (SESSION EN MEMOIRE) =====================
// Source unique de verite pour "qui est connecte" (uid, profil, role, statut...),
// le temps de la session en cours. Aucun module ne doit relire Firestore pour
// savoir qui est l'utilisateur courant ou quel est son role : tous passent par
// ce contexte, peuple une seule fois par js/auth.js juste apres la connexion
// (voir ensureUserDocument() dans user-service.js), et lu par tous les autres
// services (authorization-service.js, admin.js, et les services futurs :
// evaluation-service.js, statistics-service.js, campaign-service.js...).
//
// Ce fichier ne fait aucun appel Firebase : il ne fait que conserver en
// memoire ce que les autres services lui donnent. Cela le rend trivialement
// testable (aucun mock Firestore necessaire pour le tester lui-meme).

let currentUserContext = null; // null tant qu'aucun utilisateur n'est connecte

/**
 * Construit puis conserve le contexte de l'utilisateur connecte, a partir :
 * - de l'objet `user` fourni par Firebase Authentication (uid, email...) ;
 * - du document Firestore `userData` (role, statut, profil, etc.), tel que
 *   retourne par ensureUserDocument().
 *
 * A appeler une seule fois par connexion (voir js/auth.js), jamais a chaque
 * fois qu'un module a besoin d'une information utilisateur.
 *
 * @param {object} user - objet utilisateur Firebase Authentication
 * @param {object} userData - document Firestore de l'utilisateur
 */
export function setCurrentUserContext(user, userData) {
  currentUserContext = {
    uid: user.uid,
    email: user.email || '',
    displayName: (userData && userData.displayName) || user.displayName || '',
    photoURL: (userData && userData.photoURL) || user.photoURL || '',
    provider: (userData && userData.provider) || '',
    role: (userData && userData.role) || 'user',
    status: (userData && userData.status) || 'active',
    profileCompleted: !!(userData && userData.profileCompleted),
    profile: (userData && userData.profile) || {},
    version: (userData && userData.version) || 1,
  };
}

/**
 * Retourne le contexte de l'utilisateur actuellement connecte, ou `null` si
 * personne n'est connecte (avant authentification, ou apres deconnexion).
 * Les appelants doivent toujours verifier la valeur de retour avant usage.
 *
 * @returns {object|null}
 */
export function getCurrentUserContext() {
  return currentUserContext;
}

/**
 * A appeler lors de la deconnexion (voir js/auth.js) pour vider le contexte
 * et eviter qu'une information de session precedente ne fuite vers la
 * prochaine connexion (ex. sur un poste partage en officine).
 */
export function clearCurrentUserContext() {
  currentUserContext = null;
}

/**
 * Raccourci pratique : un utilisateur est-il actuellement charge en contexte ?
 * @returns {boolean}
 */
export function isSignedIn() {
  return currentUserContext !== null;
}
