// ===================== EN-TETE PARTAGE (refonte visuelle, Phase 1) =====================
// Point de verite UNIQUE pour la barre de navigation superieure, reutilisee
// par TOUTES les pages - jusqu'ici, seule index.html avait un vrai
// `.site-header` (logo + nav + compte), copie nulle part ailleurs (voir
// RAPPORT_REFONTE_VISUELLE.md). Chaque page ajoute un point de montage :
//
//   <div id="site-header-mount"></div>
//   <script type="module" src="js/site-header.js"></script>   (ou "../js/..." depuis admin/*.html)
//
// puis appelle renderSiteHeader('<cle-de-page>') JUSTE APRES avoir peuple
// le contexte utilisateur (setCurrentUserContext(...)) - meme endroit que
// chaque page appelle deja aujourd'hui (voir js/mes-parcours.js comme
// reference). Ce module ne fait JAMAIS d'appel Firebase Authentication/
// Firestore pour LIRE le contexte : il ne fait que lire ce que la page
// appelante a deja peuple via getCurrentUserContext().
//
// DECONNEXION : geree ICI en autonomie (signOut() + clearCurrentUserContext()
// + redirection vers l'accueil), plutot que de dependre de js/auth.js (trop
// couple a l'ecran de connexion, voir son en-tete) - corrige au passage un
// bug reel : avant ce module, aucune page hors index.html n'offrait de
// moyen de se deconnecter.

import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { hasPermission, PERMISSIONS } from "./services/authorization-service.js";
import { icon } from "./icons.js";

// Pages REELLEMENT construites aujourd'hui - a completer au fur et a
// mesure du deploiement (sources documentaires, Mon profil : pas encore
// de page, donc AUCUN lien mort ici tant qu'elles n'existent pas).
// "viewToggle" : nom (string) d'une fonction deja globale (window.xxx) que
// index.html expose pour basculer une section SANS recharger la page -
// reutilisee ICI pour eviter un rechargement complet quand on est deja sur
// index.html (voir wireInteractions ci-dessous). Depuis toute AUTRE page,
// le lien reste un href classique ("index.html?admin=1"/"?history=1"),
// meme convention deja utilisee par les liens "Retour a l'administration"
// des pages admin/*.html (voir js/auth.js#revealApp).
const NAV_ITEMS = [
  { key: 'accueil', href: 'index.html', icon: 'nav-home', label: 'Accueil', viewToggle: 'goHome' },
  { key: 'mes-parcours', href: 'mes-parcours.html', icon: 'nav-paths-formations', label: 'Mes parcours' },
  { key: 'mes-competences', href: 'mes-competences.html', icon: 'nav-skills', label: 'Mes compétences' },
  { key: 'entrainement-libre', href: 'entrainement-libre.html', icon: 'nav-free-training', label: 'Entraînement libre' },
  { key: 'mes-evaluations', href: 'index.html?history=1', icon: 'nav-evaluations-stats', label: 'Mes évaluations', viewToggle: 'openHistoryView' },
  { key: 'administration', href: 'index.html?admin=1', icon: 'nav-administration', label: 'Administration', adminOnly: true, viewToggle: 'openAdminZone' },
];

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

// CORRECTIF chemins relatifs : les pages admin/*.html vivent un dossier
// plus bas - un lien "index.html" ecrit tel quel y pointerait vers
// admin/index.html (inexistant). Prefixe systematiquement les cibles avec
// "../" quand la page courante est dans /admin/.
function basePath() {
  return /\/admin\//.test(window.location.pathname) ? '../' : '';
}

/**
 * Construit et injecte l'en-tete dans #site-header-mount. A appeler UNE
 * SEULE FOIS par chargement de page, APRES que setCurrentUserContext() ait
 * deja ete appele par la page elle-meme.
 * @param {string} activeKey - cle de NAV_ITEMS correspondant a la page courante
 */
export function renderSiteHeader(activeKey) {
  const mount = document.getElementById('site-header-mount');
  if (!mount) return;

  const ctx = getCurrentUserContext();
  // Meme condition que updateAdminUI()/openAdminZone() (js/admin.js) - le
  // lien Administration doit apparaitre pour TOUT role possedant
  // MANAGE_USERS (admin ET super_admin), jamais un simple role === 'admin'
  // qui exclurait a tort super_admin.
  const isAdmin = hasPermission(PERMISSIONS.MANAGE_USERS);
  const base = basePath();

  const navHtml = NAV_ITEMS
    .filter(function(item) { return !item.adminOnly || isAdmin; })
    .map(function(item) {
      const activeCls = item.key === activeKey ? ' sh-nav-active' : '';
      const toggleAttr = item.viewToggle ? ' data-view-toggle="' + item.viewToggle + '"' : '';
      return '<a class="sh-nav-link' + activeCls + '" href="' + escapeHtml(base + item.href) + '"' + toggleAttr + '>' +
        '<span class="sh-nav-icon">' + icon(item.icon, { size: 20 }) + '</span>' +
        '<span class="sh-nav-label">' + escapeHtml(item.label) + '</span>' +
      '</a>';
    }).join('');

  const displayName = (ctx && ctx.displayName) || (ctx && ctx.email) || '';
  const photoURL = ctx && ctx.photoURL;
  const avatarHtml = photoURL
    ? '<img class="sh-avatar-img" src="' + escapeHtml(photoURL) + '" alt="">'
    : '<span class="sh-avatar-initials">' + escapeHtml(initialsFrom(ctx && ctx.displayName, ctx && ctx.email)) + '</span>';

  mount.innerHTML =
    '<div class="site-header">' +
      '<a class="sh-logo-link" href="' + escapeHtml(base + 'index.html') + '">' +
        '<div class="logo">Fp</div>' +
        '<span class="sh-app-name">Pharmeval</span>' +
      '</a>' +
      '<nav class="sh-nav" aria-label="Navigation principale">' + navHtml + '</nav>' +
      '<div class="sh-account">' +
        '<button type="button" class="sh-avatar-btn" id="sh-avatar-btn" aria-haspopup="true" aria-expanded="false" aria-label="Mon compte">' + avatarHtml + '</button>' +
        '<div class="sh-account-menu" id="sh-account-menu" style="display:none;">' +
          '<div class="sh-account-name">' + escapeHtml(displayName || '—') + '</div>' +
          (ctx && ctx.email ? '<div class="sh-account-email">' + escapeHtml(ctx.email) + '</div>' : '') +
          '<a class="sh-account-profile-link" href="' + escapeHtml(base + 'mon-profil.html') + '">' + icon('nav-profile', { size: 16 }) + ' Mon profil</a>' +
          '<button type="button" class="sh-account-logout" id="sh-account-logout">' + icon('action-restore', { size: 16 }) + ' Se déconnecter</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  wireInteractions(mount);
}

function wireInteractions(mount) {
  // Reste en mode "SPA" quand on est DEJA sur index.html (#app-root n'existe
  // que sur cette page - signal fiable, sans depender d'un match d'URL) :
  // appelle directement la fonction deja globale (window.openHistoryView()/
  // openAdminZone()) plutot que de recharger la page via son href classique.
  const navEl = mount.querySelector('.sh-nav');
  navEl.addEventListener('click', function(evt) {
    const link = evt.target.closest('[data-view-toggle]');
    if (!link || !document.getElementById('app-root')) return;
    const fn = window[link.getAttribute('data-view-toggle')];
    if (typeof fn === 'function') {
      evt.preventDefault();
      fn();
    }
  });

  const avatarBtn = document.getElementById('sh-avatar-btn');
  const menu = document.getElementById('sh-account-menu');

  avatarBtn.addEventListener('click', function(evt) {
    evt.stopPropagation();
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
    avatarBtn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  });
  document.addEventListener('click', function(evt) {
    if (!mount.contains(evt.target)) {
      menu.style.display = 'none';
      avatarBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.getElementById('sh-account-logout').addEventListener('click', async function() {
    clearCurrentUserContext();
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Erreur de déconnexion :', err);
    }
    window.location.href = basePath() + 'index.html';
  });
}
