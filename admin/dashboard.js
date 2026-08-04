// ===================== TABLEAU DE BORD ADMIN — Sprint 2 =====================
import { auth, db } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection, query, where, getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { renderAdminNav } from "./admin-shell.js";

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
  _loadStats();
});

// ---------------------------------------------------------------------------
// Stats Firestore — getCountFromServer (pas de lecture de documents)
// ---------------------------------------------------------------------------

function _loadStats() {
  _loadQuestionStats();
  _loadParcoursStats();
  _loadUserStats();
  _loadReportStats();
  _buildModulesGrid();
}

async function _loadQuestionStats() {
  try {
    const [snapTotal, snapDraft] = await Promise.all([
      getCountFromServer(collection(db, 'questions')),
      getCountFromServer(query(collection(db, 'questions'), where('status', '==', 'draft'))),
    ]);
    const total = snapTotal.data().count;
    const draft = snapDraft.data().count;
    qs('ds-q-total').textContent = total;
    qs('ds-q-sub').textContent = draft > 0 ? draft + ' en brouillon' : 'Tout publié / archivé';
    if (draft > 0) _addAttention({ href: 'bank.html', label: 'questions en brouillon', count: draft, type: 'info' });
  } catch(e) {
    console.error('[dashboard] questions stats:', e);
    qs('ds-q-total').textContent = '—';
    qs('ds-q-sub').textContent = 'Impossible de charger';
  }
}

async function _loadParcoursStats() {
  try {
    const [snapTotal, snapDraft] = await Promise.all([
      getCountFromServer(collection(db, 'parcours')),
      getCountFromServer(query(collection(db, 'parcours'), where('status', '==', 'draft'))),
    ]);
    const total = snapTotal.data().count;
    const draft = snapDraft.data().count;
    qs('ds-p-total').textContent = total;
    qs('ds-p-sub').textContent = draft > 0 ? draft + ' en brouillon' : 'Tout publié / archivé';
  } catch(e) {
    console.error('[dashboard] parcours stats:', e);
    qs('ds-p-total').textContent = '—';
    qs('ds-p-sub').textContent = 'Impossible de charger';
  }
}

async function _loadUserStats() {
  try {
    const snap = await getCountFromServer(collection(db, 'users'));
    const total = snap.data().count;
    qs('ds-u-total').textContent = total;
    qs('ds-u-sub').textContent = total === 1 ? '1 compte' : total + ' comptes';
  } catch(e) {
    console.error('[dashboard] user stats:', e);
    qs('ds-u-total').textContent = '—';
    qs('ds-u-sub').textContent = 'Impossible de charger';
  }
}

async function _loadReportStats() {
  try {
    const snap = await getCountFromServer(
      query(collection(db, 'question_reports'), where('status', '==', 'open'))
    );
    const open = snap.data().count;
    qs('ds-reports').textContent = open;
    qs('ds-reports-sub').textContent = open > 0 ? 'non traités' : 'Aucun signalement ouvert';
    if (open > 0) {
      qs('ds-reports-card').classList.add('adm-stat-warn');
      _addAttention({ href: 'reports.html', label: 'signalements non traités', count: open, type: 'warn' });
    } else {
      qs('ds-reports-card').classList.add('adm-stat-ok');
    }
  } catch(e) {
    console.error('[dashboard] reports stats:', e);
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
  { href: 'bank.html',             icon: 'ti-help',    label: 'Banque de questions',   desc: 'Questions, statuts, historique' },
  { href: 'parcours.html',         icon: 'ti-books',   label: 'Parcours',              desc: 'Entraînement & éditorial' },
  { href: 'document-sources.html', icon: 'ti-book-2',  label: 'Sources documentaires', desc: 'Référentiels officiels' },
  { href: 'competencies.html',     icon: 'ti-brain',   label: 'Compétences',           desc: 'Banque des compétences' },
  { href: 'users.html',            icon: 'ti-users',   label: 'Utilisateurs',          desc: 'Fiches & invitations' },
  { href: 'reference-banks.html',  icon: 'ti-building',label: 'Organisations',         desc: 'Profils & groupes' },
  { href: 'catalog-sync.html',     icon: 'ti-refresh', label: 'Synchronisation',       desc: 'Import Excel → Firestore' },
  { href: 'audit-log.html',        icon: 'ti-history', label: 'Journal d\'audit',      desc: 'Historique des actions' },
  { href: 'reports.html',          icon: 'ti-flag',    label: 'Signalements',          desc: 'Questions signalées' },
];

function _buildModulesGrid() {
  const grid = qs('dash-modules-grid');
  if (!grid) return;
  grid.innerHTML = MODULES.map(function(m) {
    return `<a href="${m.href}" class="dash-module-card">
      <i class="ti ${m.icon}" aria-hidden="true"></i>
      <div>
        <div class="dash-module-label">${m.label}</div>
        <div class="dash-module-desc">${m.desc}</div>
      </div>
    </a>`;
  }).join('');
}
