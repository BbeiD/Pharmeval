// ===================== COQUE ADMIN — Sprint 1 =====================
// Remplace renderSiteHeader('administration') sur toutes les pages admin.
// Exports :
//   renderAdminNav(activeKey)  — sidebar + topbar
//   showAdminToast(msg, type)  — toast non-bloquant
//   showAdminConfirm(opts)     — modale de confirmation (retourne Promise<bool>)
//
// NAV_ITEMS doit rester synchronisé avec les liens dans index.html?admin=1
// (section admin-view). Toute nouvelle page admin = 1 entrée ici.

import { getCurrentUserContext } from "../js/services/app-context.js";

const NAV = [
  {
    label: 'Vue d\'ensemble',
    items: [
      { key: 'dashboard',    href: 'dashboard.html',        icon: 'ti-layout-dashboard', label: 'Tableau de bord' },
    ]
  },
  {
    label: 'Contenu',
    items: [
      { key: 'bank',         href: 'bank.html',             icon: 'ti-help',             label: 'Banque de questions' },
      { key: 'parcours',     href: 'parcours.html',         icon: 'ti-books',            label: 'Parcours' },
      { key: 'sources',      href: 'document-sources.html', icon: 'ti-book-2',           label: 'Sources documentaires' },
      { key: 'competencies', href: 'competencies.html',     icon: 'ti-brain',            label: 'Compétences' },
    ]
  },
  {
    label: 'Utilisateurs',
    items: [
      { key: 'users',        href: 'users.html',            icon: 'ti-users',            label: 'Utilisateurs' },
      { key: 'orgs',         href: 'reference-banks.html',  icon: 'ti-building',         label: 'Organisations' },
    ]
  },
  {
    label: 'Système',
    items: [
      { key: 'catalog-sync', href: 'catalog-sync.html',     icon: 'ti-refresh',          label: 'Synchronisation' },
      { key: 'audit',        href: 'audit-log.html',        icon: 'ti-history',          label: 'Journal d\'audit' },
      { key: 'reports',      href: 'reports.html',          icon: 'ti-flag',             label: 'Signalements' },
    ]
  },
];

// Titres affichés dans le breadcrumb par clé de page
const PAGE_LABELS = {
  dashboard:    'Tableau de bord',
  bank:         'Banque de questions',
  parcours:     'Parcours',
  sources:      'Sources documentaires',
  competencies: 'Compétences',
  users:        'Utilisateurs',
  orgs:         'Organisations / Profils / Groupes',
  'catalog-sync': 'Synchronisation du catalogue',
  audit:        'Journal d\'audit',
  reports:      'Signalements',
};

function escHtml(str) {
  return (str == null ? '' : String(str))
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/**
 * Injecte la sidebar admin et le topbar.
 * Doit être appelé APRÈS que #site-header-mount et le contenu de la page
 * sont dans le DOM. Ne touche pas à la logique Firebase des pages hôtes.
 *
 * @param {string} activeKey  - clé de la page active (ex. 'bank')
 * @param {object} [opts]
 * @param {string} [opts.badge_reports] - nombre de signalements non traités
 */
export function renderAdminNav(activeKey, opts = {}) {
  // Masquer la nav utilisateur (présente dans toutes les pages admin)
  const siteHeaderMount = document.getElementById('site-header-mount');
  if (siteHeaderMount) siteHeaderMount.style.display = 'none';

  // Injecter le conteneur global si ce n'est pas encore fait
  _ensureLayout();

  // Sidebar
  const sidebar = document.getElementById('adm-sidebar');
  if (sidebar) sidebar.innerHTML = _buildSidebar(activeKey, opts);

  // Topbar (breadcrumb)
  const topbar = document.getElementById('adm-topbar');
  if (topbar) topbar.innerHTML = _buildTopbar(activeKey);

  // Toast container (une seule fois)
  if (!document.getElementById('adm-toast-container')) {
    const tc = document.createElement('div');
    tc.id = 'adm-toast-container';
    document.body.appendChild(tc);
  }

  // Modale mutualisée (une seule fois)
  if (!document.getElementById('adm-modal-overlay')) {
    const mo = document.createElement('div');
    mo.id = 'adm-modal-overlay';
    mo.innerHTML = `
      <div class="adm-modal" role="dialog" aria-modal="true" aria-labelledby="adm-modal-title">
        <button class="adm-modal-close" id="adm-modal-close-btn" aria-label="Fermer">✕</button>
        <h2 class="adm-modal-title" id="adm-modal-title"></h2>
        <div class="adm-modal-body" id="adm-modal-body"></div>
        <div class="adm-modal-actions" id="adm-modal-actions"></div>
      </div>`;
    document.body.appendChild(mo);
    document.getElementById('adm-modal-close-btn').addEventListener('click', _closeModal);
    mo.addEventListener('click', function(e) { if (e.target === mo) _closeModal(); });
  }
}

// ---------------------------------------------------------------------------
// Sidebar HTML
// ---------------------------------------------------------------------------

function _buildSidebar(activeKey, opts) {
  const ctx = getCurrentUserContext();
  const email = ctx && ctx.user ? ctx.user.email : '';

  let navHtml = '';
  NAV.forEach(function(section) {
    navHtml += `<div class="adm-nav-section">
      <div class="adm-nav-section-label">${escHtml(section.label)}</div>`;
    section.items.forEach(function(item) {
      const isActive = item.key === activeKey;
      const badge = (item.key === 'reports' && opts.badge_reports)
        ? `<span class="adm-nav-badge">${opts.badge_reports}</span>` : '';
      navHtml += `<a class="adm-nav-item${isActive ? ' adm-nav-item-active' : ''}"
          href="${escHtml(item.href)}"
          ${isActive ? 'aria-current="page"' : ''}>
          <i class="ti ${escHtml(item.icon)}" aria-hidden="true"></i>
          ${escHtml(item.label)}${badge}
        </a>`;
    });
    navHtml += '</div>';
  });

  return `
    <a class="adm-logo" href="dashboard.html" aria-label="Accueil administration">
      <img src="../assets/brand/pharmeval-mark.png" alt="" width="28" height="28">
      <div class="adm-logo-text">
        <span class="adm-logo-name">Pharmeval</span>
        <span class="adm-logo-tag">Administration</span>
      </div>
    </a>
    <nav class="adm-nav" aria-label="Navigation administration">${navHtml}</nav>
    <div class="adm-sidebar-footer">
      <div class="adm-sidebar-footer-email" title="${escHtml(email)}">${escHtml(email)}</div>
      <a href="../index.html"><i class="ti ti-arrow-left" aria-hidden="true"></i> Retour à l'application</a>
    </div>`;
}

// ---------------------------------------------------------------------------
// Topbar HTML
// ---------------------------------------------------------------------------

function _buildTopbar(activeKey) {
  const label = PAGE_LABELS[activeKey] || activeKey;
  return `
    <nav class="adm-breadcrumb" aria-label="Fil d'Ariane">
      <a href="dashboard.html">Administration</a>
      <span class="adm-breadcrumb-sep" aria-hidden="true">›</span>
      <span class="adm-breadcrumb-current">${escHtml(label)}</span>
    </nav>`;
}

// ---------------------------------------------------------------------------
// Layout DOM (crée adm-sidebar + adm-topbar + adm-content si absents)
// ---------------------------------------------------------------------------

function _ensureLayout() {
  if (document.getElementById('adm-sidebar')) return; // déjà injecté

  // Sidebar
  const sidebar = document.createElement('div');
  sidebar.id = 'adm-sidebar';
  document.body.insertBefore(sidebar, document.body.firstChild);

  // Zone principale : wrapper autour du contenu existant
  let main = document.getElementById('adm-main');
  if (!main) {
    main = document.createElement('div');
    main.id = 'adm-main';

    // Topbar
    const topbar = document.createElement('div');
    topbar.id = 'adm-topbar';
    topbar.className = 'adm-topbar';
    main.appendChild(topbar);

    // Wrapper du contenu existant
    const content = document.createElement('div');
    content.className = 'adm-content';

    // Déplacer tout le contenu body existant (sauf sidebar) dans adm-content
    Array.from(document.body.children).forEach(function(child) {
      if (child !== sidebar && child !== main) content.appendChild(child);
    });
    main.appendChild(content);
    document.body.appendChild(main);
  }
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

/**
 * Affiche un toast non-bloquant.
 * @param {string} message
 * @param {'success'|'error'|'info'} [type='info']
 * @param {number} [duration=3500] ms
 */
export function showAdminToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3500;
  const container = document.getElementById('adm-toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'adm-toast adm-toast-' + type;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(function() {
    t.style.animation = 'admToastOut .2s ease forwards';
    setTimeout(function() { t.remove(); }, 220);
  }, duration);
}

// ---------------------------------------------------------------------------
// Modale de confirmation
// ---------------------------------------------------------------------------

let _confirmResolve = null;

/**
 * Affiche une modale de confirmation et retourne une Promise<boolean>.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.confirmLabel='Confirmer']
 * @param {string} [opts.cancelLabel='Annuler']
 * @param {boolean} [opts.destructive=false]
 */
export function showAdminConfirm(opts) {
  return new Promise(function(resolve) {
    _confirmResolve = resolve;
    const overlay = document.getElementById('adm-modal-overlay');
    document.getElementById('adm-modal-title').textContent = opts.title || 'Confirmation';
    document.getElementById('adm-modal-body').textContent = opts.body || '';
    const actions = document.getElementById('adm-modal-actions');
    const confirmLabel = opts.confirmLabel || 'Confirmer';
    const cancelLabel  = opts.cancelLabel  || 'Annuler';
    const destructive  = opts.destructive  || false;
    actions.innerHTML = `
      <button class="btn-secondary" id="adm-modal-cancel">${escHtml(cancelLabel)}</button>
      <button class="${destructive ? 'btn-danger' : 'btn-primary'}" id="adm-modal-confirm">${escHtml(confirmLabel)}</button>`;
    document.getElementById('adm-modal-cancel').addEventListener('click', function() { _resolveModal(false); });
    document.getElementById('adm-modal-confirm').addEventListener('click', function() { _resolveModal(true); });
    overlay.classList.add('adm-modal-open');
    document.getElementById('adm-modal-confirm').focus();
  });
}

function _resolveModal(result) {
  _closeModal();
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

function _closeModal() {
  const overlay = document.getElementById('adm-modal-overlay');
  if (overlay) overlay.classList.remove('adm-modal-open');
}
