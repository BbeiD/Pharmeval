// ===================== ZONE D'ADMINISTRATION (BASE) =====================
// Premiere zone d'administration, volontairement minimale (Sprint 3) :
// elle sert de fondation pour securiser les futurs developpements (gestion
// des utilisateurs, campagnes, questions, signalements, statistiques
// globales - voir "Preparation des futures fonctionnalites" dans
// RAPPORT_SPRINT3.md), pas encore a les implementer.
//
// Toute la logique de role est deleguee a services/authorization-service.js :
// ce fichier ne contient aucune comparaison de role en dur.
//
// Double controle d'acces, comme demande :
// 1. Interface : le bouton d'acces a la zone d'administration est masque par
//    defaut dans le HTML brut et n'est revele que si isAdmin() est vrai
//    (voir updateAdminUI, appelee depuis js/auth.js a chaque connexion).
// 2. Logique metier : openAdminZone() revérifie isAdmin() elle-meme avant
//    d'afficher quoi que ce soit, meme si elle est appelee directement
//    depuis la console du navigateur en contournant le bouton masque.

import { isAdmin, getCurrentRole } from "./services/authorization-service.js";
import { getCurrentUserContext } from "./services/app-context.js";

// Version affichee dans la zone d'administration. Mise a jour manuellement a
// chaque nouvelle version (coherent avec VERSION.md) ; ce sprint ne met pas
// en place de lecture automatique de version, jugee hors perimetre ici.
const APP_VERSION = 'Pharmeval v1.7.0';

/**
 * A appeler apres chaque connexion (voir js/auth.js -> revealApp()) pour
 * afficher ou masquer le bouton d'acces a l'administration selon le role
 * courant. Un utilisateur "user" ne voit jamais ce bouton.
 */
export function updateAdminUI() {
  var btn = document.getElementById('btn-admin-zone');
  if (btn) btn.style.display = isAdmin() ? '' : 'none';
}

/**
 * Ouvre la zone d'administration. Controle d'acces reel : si l'utilisateur
 * n'est pas administrateur, la fonction s'arrete immediatement et n'affiche
 * rien, meme si elle est invoquee directement (ex. depuis la console du
 * navigateur) en contournant le bouton d'interface masque.
 */
export function openAdminZone() {
  if (!isAdmin()) {
    console.warn('Acces refuse : la zone d\'administration est reservee aux administrateurs.');
    return;
  }

  var ctx = getCurrentUserContext();

  ['home-view', 'quiz-view', 'results-view'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  var adminEl = document.getElementById('admin-view');
  if (adminEl) adminEl.style.display = 'block';

  var versionEl = document.getElementById('admin-version');
  var userEl = document.getElementById('admin-current-user');
  var roleEl = document.getElementById('admin-current-role');
  if (versionEl) versionEl.textContent = APP_VERSION;
  if (userEl) userEl.textContent = (ctx && ctx.email) || '';
  if (roleEl) roleEl.textContent = getCurrentRole();
}

/**
 * Retour a l'accueil depuis la zone d'administration.
 */
export function closeAdminZone() {
  var adminEl = document.getElementById('admin-view');
  if (adminEl) adminEl.style.display = 'none';
  var homeEl = document.getElementById('home-view');
  if (homeEl) homeEl.style.display = 'block';
}

// Attributs onclick du HTML classique : rattachement explicite a window.
window.openAdminZone = openAdminZone;
window.closeAdminZone = closeAdminZone;
