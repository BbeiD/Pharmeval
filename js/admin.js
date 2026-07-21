// ===================== CENTRE D'ADMINISTRATION =====================
// Sprint 3 : zone minimale (bienvenue, version, utilisateur, role).
// Sprint 8 : Centre d'administration complet avec tableau utilisateurs inline.
// Sprint 14 : gestion des utilisateurs deplacee dans admin/users.html (V2).
// Ce fichier gere desormais uniquement l'ouverture/fermeture de la zone
// et l'affichage des informations de contexte (version, email, role).

import { getCurrentRole, ROLE_LABELS, PERMISSIONS, hasPermission } from "./services/authorization-service.js";
import { getCurrentUserContext } from "./services/app-context.js";

const APP_VERSION = 'Pharmeval v2.12.0';

/**
 * A appeler apres chaque connexion (voir js/auth.js -> revealApp()) pour
 * afficher ou masquer le bouton d'acces a l'administration selon le role
 * courant. Un utilisateur sans permission MANAGE_USERS ne voit jamais ce bouton.
 */
export function updateAdminUI() {
  var btn = document.getElementById('btn-admin-zone');
  if (btn) btn.style.display = hasPermission(PERMISSIONS.MANAGE_USERS) ? '' : 'none';
}

/**
 * Ouvre la zone d'administration. Double controle d'acces : le bouton est
 * masque dans l'UI ET cette fonction revalide la permission elle-meme —
 * un appel direct depuis la console n'ouvre donc pas l'administration a un
 * utilisateur non autorise.
 */
export function openAdminZone() {
  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) {
    console.warn('Acces refuse : la zone d\'administration est reservee aux administrateurs.');
    return;
  }

  var ctx = getCurrentUserContext();

  ['home-view', 'quiz-view', 'results-view', 'history-view'].forEach(function(id) {
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
  if (roleEl) roleEl.textContent = ROLE_LABELS[getCurrentRole()] || getCurrentRole();
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

window.openAdminZone = openAdminZone;
window.closeAdminZone = closeAdminZone;
