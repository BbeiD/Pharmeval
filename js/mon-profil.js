// ===================== CONTROLEUR "MON PROFIL" (refonte visuelle, phase 1) =====================
// Nouvelle page VOLONTAIREMENT MINIMALE (decision prise avec David) :
// affichage en lecture seule d'informations DEJA REELLES (fiche
// utilisateur + profil declare lors de l'assistant de premiere connexion,
// js/onboarding.js) - jamais un champ invente pour combler visuellement.
// Reportes a une prochaine etape : photo de profil editable (aucun chemin
// d'upload n'existe aujourd'hui), onglets Preferences/Securite, "Vos
// badges" (aucun systeme de badges n'existe dans le modele de donnees).

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument, PROFESSION_OPTIONS, ORGANIZATION_TYPE_OPTIONS } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getUserByUid } from "./services/user-management-service.js";
import { formatDateFr } from "./services/date-utils.js";
import { renderSiteHeader } from "./site-header.js";

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
}
