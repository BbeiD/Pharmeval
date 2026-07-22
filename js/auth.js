// ===================== AUTHENTIFICATION FIREBASE =====================
// Creation de compte, connexion e-mail/mot de passe, connexion Google,
// deconnexion, suivi de l'etat d'authentification, messages d'erreur.
// Perimetre strict : authentification uniquement. Aucune donnee Firestore,
// aucun profil utilisateur, aucun role n'est cree ici.
//
// Contenu identique a celui du sprint 1 (Pharmeval v1.1.0), deplace tel quel
// dans ce fichier dedie lors de la migration multi-fichiers (v1.2.0).

import { auth } from "./firebase-config.js";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { syncPendingEvaluations } from "./services/evaluation-service.js";
import { startOnboarding } from "./onboarding.js";
import { updateAdminUI, openAdminZone } from "./admin.js";
import { hasPermission, PERMISSIONS } from "./services/authorization-service.js";

let authMode = 'signin'; // 'signin' | 'signup'

function toggleAuthMode() {
  authMode = (authMode === 'signin') ? 'signup' : 'signin';
  var title = document.getElementById('auth-title');
  var submitBtn = document.getElementById('auth-submit-btn');
  var switchText = document.getElementById('auth-switch-text');
  var switchLink = document.getElementById('auth-switch-link');
  clearAuthError();
  if (authMode === 'signup') {
    if (title) title.textContent = 'Créer un compte';
    if (submitBtn) submitBtn.textContent = 'Créer mon compte';
    if (switchText) switchText.textContent = 'Déjà un compte ?';
    if (switchLink) switchLink.textContent = 'Se connecter';
  } else {
    if (title) title.textContent = 'Connexion';
    if (submitBtn) submitBtn.textContent = 'Se connecter';
    if (switchText) switchText.textContent = 'Pas encore de compte ?';
    if (switchLink) switchLink.textContent = 'Créer un compte';
  }
}

function showAuthError(message) {
  var errEl = document.getElementById('auth-error');
  if (errEl) { errEl.textContent = message; errEl.style.display = 'block'; }
}

function clearAuthError() {
  var errEl = document.getElementById('auth-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
}

// Traduction des erreurs Firebase en messages francais comprehensibles.
// Ne revele jamais si un compte precis existe ou non (message generique
// pour identifiants incorrects).
function mapAuthError(err) {
  var code = (err && err.code) || '';
  switch (code) {
    case 'auth/invalid-email':
      return "Adresse e-mail invalide.";
    case 'auth/missing-password':
      return "Veuillez saisir un mot de passe.";
    case 'auth/weak-password':
      return "Mot de passe trop faible (6 caractères minimum).";
    case 'auth/email-already-in-use':
      return "Cette adresse e-mail est déjà utilisée par un compte.";
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return "Adresse e-mail ou mot de passe incorrect.";
    case 'auth/too-many-requests':
      return "Trop de tentatives. Veuillez réessayer plus tard.";
    case 'auth/network-request-failed':
      return "Problème de connexion réseau. Vérifiez votre connexion internet.";
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return "Connexion Google annulée.";
    case 'auth/popup-blocked':
      return "La fenêtre de connexion Google a été bloquée par le navigateur.";
    default:
      return "Une erreur est survenue. Veuillez réessayer.";
  }
}

async function handleAuthSubmit() {
  clearAuthError();
  var emailInput = document.getElementById('auth-email');
  var passwordInput = document.getElementById('auth-password');
  var email = ((emailInput && emailInput.value) || '').trim();
  var password = (passwordInput && passwordInput.value) || '';
  if (!email || !password) {
    showAuthError("Veuillez renseigner l'adresse e-mail et le mot de passe.");
    return;
  }
  var submitBtn = document.getElementById('auth-submit-btn');
  if (submitBtn) submitBtn.disabled = true;
  try {
    if (authMode === 'signup') {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    // onAuthStateChanged prend le relais pour afficher l'application.
  } catch (err) {
    showAuthError(mapAuthError(err));
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function doGoogleSignIn() {
  clearAuthError();
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    showAuthError(mapAuthError(err));
  }
}

async function doSignOut() {
  try {
    await signOut(auth);
  } catch (err) {
    // Deconnexion : erreur improbable, on ne bloque pas l'utilisateur pour autant.
    console.error('Erreur de deconnexion :', err);
  }
}

/**
 * Affiche l'application (masque le chargement/l'auth/l'onboarding, affiche
 * #app-root et l'e-mail connecte). Exportee pour etre reutilisee par
 * js/onboarding.js une fois l'assistant de premiere connexion termine, afin
 * de ne pas dupliquer cette logique d'affichage a deux endroits.
 *
 * Remarque sur l'import circulaire avec onboarding.js : ce fichier importe
 * startOnboarding() depuis onboarding.js, qui importe lui-meme revealApp()
 * depuis ce fichier. C'est sans risque ici car aucune des deux fonctions
 * n'est appelee au chargement du module (evaluation top-level) : elles ne
 * sont invoquees que plus tard, depuis des callbacks asynchrones (Firebase),
 * une fois que les deux modules ont fini de s'initialiser.
 */
function revealApp(user) {
  var loadingEl = document.getElementById('auth-loading');
  var authEl = document.getElementById('auth-screen');
  var onboardingEl = document.getElementById('onboarding-screen');
  var appEl = document.getElementById('app-root');
  if (loadingEl) loadingEl.style.display = 'none';
  if (authEl) authEl.style.display = 'none';
  if (onboardingEl) onboardingEl.style.display = 'none';
  if (appEl) appEl.style.display = 'block';
  var emailEl = document.getElementById('user-email-display');
  if (emailEl) emailEl.textContent = (user && user.email) || '';
  // Sprint 3 : le bouton d'acces a la zone d'administration n'est revele
  // que si le contexte (deja peuple par setCurrentUserContext ci-dessous)
  // indique un role administrateur.
  updateAdminUI();

  // CORRECTIF (post-Sprint 15, ajuste Sprint 21.5 Phase A) : "Retour à
  // l'administration" depuis un ecran d'administration secondaire
  // (admin/parcours.html, admin/bank.html...) renvoyait vers
  // "../index.html", qui rechargeait l'application au tout debut. Ces
  // liens pointent explicitement vers "../index.html?admin=1" ; ce
  // parametre, detecte ICI, declenche l'ouverture DIRECTE de la zone
  // d'administration (openAdminZone(), reutilisee telle quelle) sans
  // jamais charger l'accueil pharmacien/etudiant en dessous.
  //
  // Double garde volontaire : le parametre seul ne suffit jamais a acceder
  // a l'administration - openAdminZone() revalide de toute facon elle-meme
  // la permission (voir js/admin.js) et refuse silencieusement si
  // l'utilisateur n'est pas administrateur, exactement comme un clic
  // normal sur le bouton "Administration".
  var params = new URLSearchParams(window.location.search);
  var wantsDirectAdmin = params.get('admin') === '1' && hasPermission(PERMISSIONS.MANAGE_USERS);
  // AJOUT (refonte visuelle, phase 1) : meme principe que "?admin=1"
  // ci-dessus - le lien "Mes évaluations" de l'en-tete partage
  // (js/site-header.js) pointe vers "index.html?history=1" depuis toute
  // AUTRE page, et ce parametre declenche ici l'ouverture directe de
  // l'historique, sans jamais charger l'accueil en dessous. Aucune
  // permission particuliere requise (chaque utilisateur consulte
  // uniquement son propre historique, deja garanti par history-service.js).
  var wantsDirectHistory = params.get('history') === '1';

  if (wantsDirectAdmin) {
    openAdminZone();
  } else if (wantsDirectHistory && typeof window.openHistoryView === 'function') {
    window.openHistoryView();
  } else if (typeof window.selectProfile === 'function') {
    window.selectProfile();
  }
}

// Point central de la garde d'authentification : tant que Firebase n'a pas
// confirme l'etat de connexion, seul l'ecran de chargement est visible.
// Depuis le Sprint 2, une connexion reussie declenche egalement la creation
// ou la mise a jour du document utilisateur Firestore (js/services/user-
// service.js), puis l'assistant de premiere connexion si le profil n'est
// pas encore complet.
onAuthStateChanged(auth, async function(user) {
  var loadingEl = document.getElementById('auth-loading');
  var authEl = document.getElementById('auth-screen');
  var appEl = document.getElementById('app-root');

  if (!user) {
    clearCurrentUserContext();
    if (loadingEl) loadingEl.style.display = 'none';
    if (appEl) appEl.style.display = 'none';
    if (authEl) authEl.style.display = 'flex';
    var emailEl2 = document.getElementById('user-email-display');
    if (emailEl2) emailEl2.textContent = '';
    return;
  }

  try {
    var userData = await ensureUserDocument(user);
    // Peuple le contexte utilisateur en memoire (une seule fois par
    // connexion) : tous les autres modules (authorization-service.js,
    // admin.js, et les services futurs) liront desormais le role, le
    // statut et le profil depuis ce contexte plutot que de relire
    // Firestore chacun de leur cote.
    setCurrentUserContext(user, userData);

    // Sprint 4 : tentative (non bloquante) de synchronisation des evaluations
    // enregistrees localement en attente (voir js/services/evaluation-
    // service.js). Volontairement non "attendue" (pas de await) : la
    // synchronisation ne doit jamais retarder l'affichage de l'application.
    syncPendingEvaluations().catch(function(err) {
      console.error('Synchronisation des evaluations en attente impossible :', err);
    });

    if (userData && userData.profileCompleted === false) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (authEl) authEl.style.display = 'none';
      startOnboarding(user);
    } else {
      revealApp(user);
    }
  } catch (err) {
    // Si Firestore est momentanement indisponible, on ne bloque pas
    // l'utilisateur hors de l'application pour autant : il retrouve
    // Pharmeval normalement, et la creation/mise a jour du document sera
    // retentee a la prochaine connexion.
    console.error('Erreur lors de la creation/mise a jour du document utilisateur :', err);
    revealApp(user);
  }
});

// Les attributs onclick du HTML classique s'executent hors du scope du
// module : on rattache donc explicitement ces fonctions a window.
window.toggleAuthMode = toggleAuthMode;
window.handleAuthSubmit = handleAuthSubmit;
window.doGoogleSignIn = doGoogleSignIn;
window.doSignOut = doSignOut;

export { revealApp };
