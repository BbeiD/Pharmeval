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

// Point central de la garde d'authentification : tant que Firebase n'a pas
// confirme l'etat de connexion, seul l'ecran de chargement est visible.
onAuthStateChanged(auth, function(user) {
  var loadingEl = document.getElementById('auth-loading');
  var authEl = document.getElementById('auth-screen');
  var appEl = document.getElementById('app-root');
  if (loadingEl) loadingEl.style.display = 'none';

  if (user) {
    if (authEl) authEl.style.display = 'none';
    if (appEl) appEl.style.display = 'block';
    var emailEl = document.getElementById('user-email-display');
    if (emailEl) emailEl.textContent = user.email || '';
  } else {
    if (appEl) appEl.style.display = 'none';
    if (authEl) authEl.style.display = 'flex';
    var emailEl2 = document.getElementById('user-email-display');
    if (emailEl2) emailEl2.textContent = '';
  }
});

// Les attributs onclick du HTML classique s'executent hors du scope du
// module : on rattache donc explicitement ces fonctions a window.
window.toggleAuthMode = toggleAuthMode;
window.handleAuthSubmit = handleAuthSubmit;
window.doGoogleSignIn = doGoogleSignIn;
window.doSignOut = doSignOut;
