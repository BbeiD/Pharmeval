// ===================== TABLEAU DE BORD ADMIN — Sprint 1 =====================
import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { renderAdminNav } from "./admin-shell.js";
import { API_BASE_URL } from "../js/config.js";

function qs(id) { return document.getElementById(id); }

onAuthStateChanged(auth, async function(user) {
  if (!user) { clearCurrentUserContext(); window.location.href = '../index.html'; return; }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (e) { console.error(e); }

  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) {
    qs('dash-loading').style.display = 'none';
    qs('dash-denied').style.display = 'block';
    return;
  }

  qs('dash-loading').style.display = 'none';
  qs('dash-view').style.display = 'block';

  renderAdminNav('dashboard');
  _setVersion();
  await _loadStats();
});

function _setVersion() {
  const el = qs('dash-version');
  if (el) el.textContent = '';
}

async function _loadStats() {
  // Chaque stat est indépendante — on affiche au fur et à mesure
  _loadQuestionStats();
  _loadParcoursStats();
  _loadUserStats();
  _loadReportStats();
  _buildModulesGrid();
}

async function _loadQuestionStats() {
  try {
    const r = await fetch(API_BASE_URL + '/api/questions/stats', { headers: await _authHeaders() });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const total = (d.published || 0) + (d.draft || 0) + (d.archived || 0);
    qs('ds-q-total').textContent = total;
    qs('ds-q-sub').textContent = (d.published || 0) + ' publiées · ' + (d.draft || 0) + ' brouillons';
    if ((d.draft || 0) > 0) {
      _addAttention({
        href: 'bank.html',
        label: 'questions en brouillon',
        count: d.draft,
        type: 'info'
      });
    }
  } catch(e) {
    qs('ds-q-total').textContent = '—';
    qs('ds-q-sub').textContent = 'Impossible de charger';
  }
}

async function _loadParcoursStats() {
  try {
    const r = await fetch(API_BASE_URL + '/api/parcours/stats', { headers: await _authHeaders() });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const total = (d.published || 0) + (d.draft || 0);
    qs('ds-p-total').textContent = total;
    qs('ds-p-sub').textContent = (d.published || 0) + ' publiés · ' + (d.draft || 0) + ' brouillons';
  } catch(e) {
    qs('ds-p-total').textContent = '—';
    qs('ds-p-sub').textContent = 'Impossible de charger';
  }
}

async function _loadUserStats() {
  try {
    const r = await fetch(API_BASE_URL + '/api/users/stats', { headers: await _authHeaders() });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    qs('ds-u-total').textContent = d.total || 0;
    const pending = d.pending || 0;
    qs('ds-u-sub').textContent = (d.active || 0) + ' actifs' + (pending > 0 ? ' · ' + pending + ' en attente' : '');
    if (pending > 0) {
      _addAttention({ href: 'users.html', label: 'invitations en attente', count: pending, type: 'info' });
    }
  } catch(e) {
    qs('ds-u-total').textContent = '—';
    qs('ds-u-sub').textContent = 'Impossible de charger';
  }
}

async function _loadReportStats() {
  try {
    const r = await fetch(API_BASE_URL + '/api/reports/stats', { headers: await _authHeaders() });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const open = d.open || 0;
    qs('ds-reports').textContent = open;
    qs('ds-reports-sub').textContent = open > 0 ? 'non traités' : 'Aucun signalement ouvert';
    if (open > 0) {
      qs('ds-reports-card').classList.add('adm-stat-warn');
      _addAttention({ href: 'reports.html', label: 'signalements non traités', count: open, type: 'warn' });
    } else {
      qs('ds-reports-card').classList.add('adm-stat-ok');
    }
  } catch(e) {
    qs('ds-reports').textContent = '—';
    qs('ds-reports-sub').textContent = 'Impossible de charger';
  }
}

// ---------------------------------------------------------------------------
// Bloc "À traiter"
// ---------------------------------------------------------------------------

const _attentionItems = [];

function _addAttention(item) {
  _attentionItems.push(item);
  _renderAttention();
}

function _renderAttention() {
  const section = qs('dash-attention-section');
  const list = qs('dash-attention-list');
  if (!section || !list) return;
  if (_attentionItems.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = _attentionItems.map(function(it) {
    return `<a href="${it.href}" class="adm-attention-item adm-attention-item-${it.type}">
      <span>${it.label}</span>
      <span class="adm-attention-item-count">${it.count}</span>
    </a>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Grille des modules
// ---------------------------------------------------------------------------

const MODULES = [
  { href: 'bank.html',             icon: 'ti-help',             label: 'Banque de questions', desc: '~1 500 questions' },
  { href: 'parcours.html',         icon: 'ti-books',            label: 'Parcours',            desc: 'Entraînement & éditorial' },
  { href: 'document-sources.html', icon: 'ti-book-2',           label: 'Sources documentaires', desc: '7 sources actives' },
  { href: 'competencies.html',     icon: 'ti-brain',            label: 'Compétences',         desc: '6 compétences' },
  { href: 'users.html',            icon: 'ti-users',            label: 'Utilisateurs',        desc: 'Fiches & invitations' },
  { href: 'reference-banks.html',  icon: 'ti-building',         label: 'Organisations',       desc: 'Profils & groupes' },
  { href: 'catalog-sync.html',     icon: 'ti-refresh',          label: 'Synchronisation',     desc: 'Import Excel → Firestore' },
  { href: 'audit-log.html',        icon: 'ti-history',          label: 'Journal d\'audit',    desc: 'Historique des actions' },
  { href: 'reports.html',          icon: 'ti-flag',             label: 'Signalements',        desc: 'Questions signalées' },
];

function _buildModulesGrid() {
  const grid = qs('dash-modules-grid');
  if (!grid) return;
  grid.innerHTML = MODULES.map(function(m) {
    return `<a href="${m.href}" style="
      display:flex;align-items:center;gap:12px;padding:14px;
      background:var(--surface);border:1.5px solid var(--border2);
      border-radius:var(--radius-lg);text-decoration:none;color:inherit;
      transition:border-color .12s,background .12s;">
      <i class="ti ${m.icon}" style="font-size:22px;color:var(--green);flex-shrink:0;" aria-hidden="true"></i>
      <div>
        <div style="font-size:13px;font-weight:700;">${m.label}</div>
        <div style="font-size:11px;color:var(--text2);">${m.desc}</div>
      </div>
    </a>`;
  }).join('');
  // Hover effect via JS (CSS :hover sur les <a> fonctionne aussi)
  grid.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('mouseenter', function() { a.style.borderColor = 'var(--green)'; a.style.background = 'var(--green-light)'; });
    a.addEventListener('mouseleave', function() { a.style.borderColor = ''; a.style.background = ''; });
  });
}

// ---------------------------------------------------------------------------
// Token Firebase pour les appels API
// ---------------------------------------------------------------------------

async function _authHeaders() {
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: 'Bearer ' + token };
}
