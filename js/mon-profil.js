// ===================== CONTROLEUR "MON PROFIL" (refonte visuelle, phase 1) =====================
// Nouvelle page VOLONTAIREMENT MINIMALE (decision prise avec David) :
// affichage en lecture seule d'informations DEJA REELLES (fiche
// utilisateur + profil declare lors de l'assistant de premiere connexion,
// js/onboarding.js) - jamais un champ invente pour combler visuellement.
// Reportes a une prochaine etape : photo de profil editable (aucun chemin
// d'upload n'existe aujourd'hui), onglets Preferences/Securite, "Vos
// badges" (aucun systeme de badges n'existe dans le modele de donnees).

import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument, PROFESSION_OPTIONS, ORGANIZATION_TYPE_OPTIONS } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getUserByUid } from "./services/user-management-service.js";
import { formatDateFr } from "./services/date-utils.js";
import { renderSiteHeader } from "./site-header.js";
import { hasPermission, PERMISSIONS } from "./services/authorization-service.js";
import { icon } from "./icons.js";
import { getEvaluationsForStatistics } from "./services/history-service.js";
import { calculateOverview } from "./services/statistics-service.js";
import { getParcoursCompletionForUser } from "./services/parcours-completion-service.js";

function qs(id) { return document.getElementById(id); }
function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function optionLabel(options, value) {
  const opt = options.find(function(o) { return o.value === value; });
  return opt ? opt.label : null;
}
function initialsFrom(displayName, email) {
  const name = (displayName || '').trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return (email || '?').slice(0, 2).toUpperCase();
}

onAuthStateChanged(auth, async function(user) {
  const loadingEl = qs('mp-loading');
  const viewEl = qs('mp-view');

  if (!user) { clearCurrentUserContext(); window.location.href = 'index.html'; return; }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('mon-profil');

  await render();
});

async function render() {
  const ctx = getCurrentUserContext();
  if (!ctx) return;

  qs('mp-name').textContent = ctx.displayName || 'Utilisateur Pharmeval';
  qs('mp-email').textContent = ctx.email || '';

  const avatarEl = qs('mp-avatar');
  avatarEl.innerHTML = ctx.photoURL
    ? '<img src="' + escapeHtml(ctx.photoURL) + '" alt="">'
    : escapeHtml(initialsFrom(ctx.displayName, ctx.email));

  const profile = ctx.profile || {};
  const professionLabel = profile.profession === 'other'
    ? (profile.professionOther || 'Autre')
    : (optionLabel(PROFESSION_OPTIONS, profile.profession) || null);
  const organizationTypeLabel = profile.organizationType === 'other'
    ? (profile.organizationTypeOther || 'Autre')
    : (optionLabel(ORGANIZATION_TYPE_OPTIONS, profile.organizationType) || null);

  qs('mp-profession').textContent = professionLabel || '—';
  qs('mp-organization').textContent = profile.organizationName
    ? (profile.organizationName + (organizationTypeLabel ? ' (' + organizationTypeLabel + ')' : ''))
    : '—';

  // "Membre depuis" - lecture directe de la fiche Firestore (createdAt
  // n'est pas porte par le contexte en memoire, voir app-context.js).
  const fullUser = await getUserByUid(ctx.uid);
  qs('mp-member-since').textContent = (fullUser && fullUser.createdAt) ? formatDateFr(fullUser.createdAt) : '—';

  renderMenu(ctx);
  await renderStats(ctx);
}

/**
 * AJOUT (refonte visuelle, phase 3, mockup mobile fourni par David,
 * 27/07/2026) : memes tuiles REELLES que l'accueil (js/home.js), mais
 * uniquement le "score moyen" + "evaluations realisees" + "parcours en
 * cours" - jamais un nouveau calcul, meme services deja existants.
 */
async function renderStats(ctx) {
  const gridEl = qs('mp-stats-grid');
  if (!gridEl) return;

  const [evalResult, completionResult] = await Promise.all([
    getEvaluationsForStatistics(),
    getParcoursCompletionForUser(ctx.uid),
  ]);
  const overview = calculateOverview(evalResult.items);
  const completionItems = (completionResult && !completionResult.error) ? completionResult.items : [];
  const inProgressCount = completionItems.filter(function(c) { return c.percent !== null && c.percent < 100; }).length;

  const tiles = [
    { icon: icon('nav-paths-formations', { size: 20 }), iconCls: 'stat-card-icon-blue', value: String(inProgressCount), label: 'Parcours en cours' },
    { icon: icon('nav-evaluations-stats', { size: 20 }), iconCls: 'stat-card-icon-orange', value: String(overview.count), label: 'Évaluations réalisées' },
    { icon: icon('highlight-star-filled', { size: 20 }), iconCls: 'stat-card-icon-green', value: overview.averageScore !== null ? (overview.averageScore + '%') : '—', label: 'Score moyen' },
  ];
  gridEl.innerHTML = tiles.map(function(t) {
    return '<div class="stat-card"><div class="stat-card-icon ' + t.iconCls + '">' + t.icon + '</div>' +
      '<div class="stat-card-value">' + escapeHtml(t.value) + '</div>' +
      '<div class="stat-card-label">' + escapeHtml(t.label) + '</div></div>';
  }).join('');
}

/**
 * AJOUT : "Mon profil" devient le point d'acces pour "Mes compétences",
 * "Mes évaluations" et "Administration" - retires de la barre de
 * navigation (5 icones desormais, voir js/site-header.js) mais toujours
 * pleinement fonctionnels, memes cibles exactes qu'avant (href identique
 * a l'ancienne entree de NAV_ITEMS). "Se déconnecter" rejoint aussi ce
 * menu (en plus du menu deroulant de la sidebar, qui reste inchange).
 */
function renderMenu(ctx) {
  const listEl = qs('mp-menu-list');
  if (!listEl) return;
  const isAdmin = hasPermission(PERMISSIONS.MANAGE_USERS);

  const rows = [
    { href: 'mes-competences.html', iconKey: 'nav-skills', label: 'Mes compétences' },
    { href: 'index.html?history=1', iconKey: 'nav-evaluations-stats', label: 'Mes évaluations' },
  ];
  if (isAdmin) rows.push({ href: 'index.html?admin=1', iconKey: 'nav-administration', label: 'Administration' });

  listEl.innerHTML = rows.map(function(r) {
    return '<a class="mp-menu-row" href="' + escapeHtml(r.href) + '">' +
      '<span class="mp-menu-row-icon">' + icon(r.iconKey, { size: 18 }) + '</span>' +
      '<span class="mp-menu-row-label">' + escapeHtml(r.label) + '</span>' +
      icon('action-chevron-right', { size: 16 }) +
    '</a>';
  }).join('') +
  '<button type="button" class="mp-menu-row mp-menu-row-logout" id="mp-logout-btn">' +
    '<span class="mp-menu-row-icon">' + icon('action-restore', { size: 18 }) + '</span>' +
    '<span class="mp-menu-row-label">Se déconnecter</span>' +
  '</button>';

  qs('mp-logout-btn').addEventListener('click', async function() {
    clearCurrentUserContext();
    try { await signOut(auth); } catch (err) { console.error('Erreur de déconnexion :', err); }
    window.location.href = 'index.html';
  });
}
