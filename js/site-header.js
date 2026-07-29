// ===================== EN-TETE PARTAGE — SIDEBAR (refonte visuelle, mockup David 22/07/2026) =====================
// Point de verite UNIQUE pour la navigation, reutilisee par TOUTES les
// pages - jusqu'ici une barre HORIZONTALE en haut de page, desormais une
// SIDEBAR verticale fixee a gauche (mockup valide avec David). Chaque page
// ajoute un point de montage :
//
//   <div id="site-header-mount"></div>
//   <script type="module" src="js/site-header.js"></script>   (ou "../js/..." depuis admin/*.html)
//
// puis appelle renderSiteHeader('<cle-de-page>') JUSTE APRES avoir peuple
// le contexte utilisateur (setCurrentUserContext(...)) - meme endroit que
// chaque page appelle deja aujourd'hui (voir js/mes-parcours.js comme
// reference). Le decalage du contenu de page (jamais recouvert par la
// sidebar fixe) est une regle CSS globale sur `body` (voir css/styles.css,
// ".site-sidebar"/"body") - AUCUNE page n'a besoin de changer sa propre
// structure HTML pour ca.
//
// CORRECTIF (chantier graphique, demande directe de David, 28/07/2026) :
// le pied de sidebar (avatar/nom/profession + serie du defi) a ete retire
// - deja consultable directement depuis "Mon profil" (nav), redondant ici.
// La deconnexion (autrefois geree dans ce module) vit desormais sur
// mon-profil.html (voir js/mon-profil.js, renderMenu()).

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
// CORRECTIF (refonte visuelle, phase 3 - mockup mobile ideal fourni par
// David, 27/07/2026) : 5 entrees au lieu de 7, pour une barre de
// navigation (mobile ET desktop, meme source unique) moins chargee - "Mes
// compétences", "Mes évaluations" et "Administration" restent
// entierement fonctionnelles, simplement accessibles depuis la page
// "Mon profil" (mon-profil.html) plutot que depuis la barre elle-meme -
// voir js/mon-profil.js, qui reprend EXACTEMENT les memes cibles
// (href + viewToggle) que les entrees retirees ici.
const NAV_ITEMS = [
  { key: 'accueil', href: 'index.html', iconKey: 'nav-home', label: 'Accueil', viewToggle: 'goHome' },
  { key: 'mes-parcours', href: 'mes-parcours.html', iconKey: 'nav-paths-formations', label: 'Mes parcours' },
  // "l'icone defi doit toujours etre la flamme" (David, 29/07/2026) - meme
  // cle que le streak (icons.js), jamais une autre icone pour ce concept.
  { key: 'defi', href: 'defi.html', iconKey: 'feedback-streak-regularity', label: 'Défi' },
  { key: 'entrainement-libre', href: 'entrainement-libre.html', iconKey: 'nav-free-training', label: 'Entraînement libre' },
  { key: 'mon-profil', href: 'mon-profil.html', iconKey: 'nav-profile', label: 'Profil' },
];

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
        '<span class="sh-nav-icon">' + icon(item.iconKey, { size: 22 }) + '</span>' +
        '<span class="sh-nav-label">' + escapeHtml(item.label) + '</span>' +
      '</a>';
    }).join('');

  mount.innerHTML =
    '<div class="site-sidebar">' +
      '<a class="sh-logo-link" href="' + escapeHtml(base + 'index.html') + '">' +
        '<img class="logo" src="' + escapeHtml(base + 'assets/brand/pharmeval-mark.png') + '" alt="">' +
        '<span class="sh-logo-text">' +
          '<span class="sh-app-name">Pharmeval</span>' +
          '<span class="sh-app-tagline">Apprendre · Comprendre · Progresser</span>' +
        '</span>' +
      '</a>' +
      '<nav class="sh-nav" aria-label="Navigation principale">' + navHtml + '</nav>' +
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
}
