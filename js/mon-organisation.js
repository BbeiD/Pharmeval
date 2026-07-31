// ===================== TABLEAU DE BORD ORGANISATION (B2B) =====================
// Accessible aux roles 'teacher', 'manager' et 'admin' (ayant un organizationId).
// Lecture seule : affiche les membres de l'organisation + leurs stats.
// Aucune logique metier ici — tout passe par org-dashboard-service.js.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { hasPermission, PERMISSIONS } from "./services/authorization-service.js";
import { formatDateFr } from "./services/date-utils.js";
import { getScoreClass } from "./services/score-utils.js";
import { getOrgDashboard } from "./services/org-dashboard-service.js";
import { renderSiteHeader } from "./site-header.js";

// Seuil de considérer un membre comme "inactif" (en jours)
const INACTIVE_THRESHOLD_DAYS = 30;

let lastDashboardData = null;
let currentFilter = 'all';

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initials(member) {
  const first = (member.firstName || member.displayName || '').trim();
  const last = (member.lastName || '').trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (member.email) return member.email[0].toUpperCase();
  return '?';
}

function isInactive(member) {
  if (!member.lastEvalAt) return true;
  const last = new Date(member.lastEvalAt);
  const now = new Date();
  return (now - last) / (1000 * 60 * 60 * 24) > INACTIVE_THRESHOLD_DAYS;
}

function parcoursStatusHtml(m, orgParcours) {
  if (!orgParcours || orgParcours.length === 0) return '';
  const statusMap = {};
  (m.parcoursStatus || []).forEach(function(s) { statusMap[s.parcoursId] = s.hasStarted; });
  const chips = orgParcours.map(function(p) {
    const done = !!statusMap[p.parcoursId];
    return '<span class="org-parcours-chip ' + (done ? 'org-parcours-done' : 'org-parcours-pending') + '" title="' + escapeHtml(p.title) + '">' +
      (done ? '<i class="ti ti-circle-check" aria-hidden="true"></i>' : '<i class="ti ti-clock" aria-hidden="true"></i>') +
      ' ' + escapeHtml(p.title) +
    '</span>';
  }).join('');
  return '<div class="org-member-parcours">' + chips + '</div>';
}

function memberCardHtml(m, isCurrentUser, orgParcours) {
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.displayName || m.email || '—';
  const statusLabel = m.status === 'suspended' ? '<span class="org-member-badge org-badge-suspended">Désactivé</span>' : '';
  const inactiveLabel = m.status !== 'suspended' && isInactive(m) ? '<span class="org-member-badge org-badge-inactive">Inactif</span>' : '';
  const selfLabel = isCurrentUser ? '<span class="org-member-badge org-badge-self">Vous</span>' : '';
  const profileLine = m.profileLabel
    ? '<div class="org-member-profile">' + escapeHtml(m.profileLabel) + '</div>'
    : '';
  const lastActivity = m.lastEvalAt
    ? '<span>' + escapeHtml(formatDateFr(m.lastEvalAt)) + '</span>'
    : '<span class="org-member-empty">—</span>';
  const avgScoreHtml = typeof m.avgScore === 'number'
    ? '<span class="org-member-score ' + escapeHtml(getScoreClass(m.avgScore)) + '">' + m.avgScore + ' %</span>'
    : '<span class="org-member-empty">—</span>';

  return (
    '<div class="org-member-card' + (m.status === 'suspended' ? ' org-member-suspended' : '') + '">' +
      '<div class="org-member-avatar">' + escapeHtml(initials(m)) + '</div>' +
      '<div class="org-member-info">' +
        '<div class="org-member-name">' + escapeHtml(name) + selfLabel + statusLabel + inactiveLabel + '</div>' +
        profileLine +
        '<div class="org-member-email">' + escapeHtml(m.email) + '</div>' +
      '</div>' +
      '<div class="org-member-stats">' +
        '<div class="org-stat-item"><div class="org-stat-value">' + (m.totalEvals || 0) + '</div><div class="org-stat-label">évaluations</div></div>' +
        '<div class="org-stat-item"><div class="org-stat-value">' + avgScoreHtml + '</div><div class="org-stat-label">score moyen</div></div>' +
        '<div class="org-stat-item"><div class="org-stat-value">' + lastActivity + '</div><div class="org-stat-label">dernière activité</div></div>' +
      '</div>' +
      parcoursStatusHtml(m, orgParcours) +
    '</div>'
  );
}

function renderGrid(members, currentUid, orgParcours) {
  const grid = document.getElementById('org-members-grid');
  const emptyEl = document.getElementById('org-empty');
  if (!grid) return;
  if (!members || members.length === 0) {
    grid.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  grid.innerHTML = members.map(function(m) {
    return memberCardHtml(m, m.uid === currentUid, orgParcours);
  }).join('');
}

async function loadDashboard(currentUid) {
  const contentEl = document.getElementById('org-content');
  const loadingEl = document.getElementById('org-loading-data');
  const errorEl = document.getElementById('org-error');
  if (loadingEl) loadingEl.style.display = 'block';

  const result = await getOrgDashboard();

  if (loadingEl) loadingEl.style.display = 'none';

  if (result.error) {
    if (errorEl) {
      errorEl.textContent = result.message || 'Une erreur est survenue.';
      errorEl.style.display = 'block';
    }
    return;
  }

  lastDashboardData = { currentUid: currentUid, members: result.members || [], orgName: result.orgName || 'Mon organisation', orgParcours: result.orgParcours || [] };

  const orgNameEl = document.getElementById('org-name');
  if (orgNameEl) orgNameEl.textContent = lastDashboardData.orgName;

  const total = lastDashboardData.members.length;
  const countEl = document.getElementById('org-member-count');
  if (countEl) countEl.textContent = total + ' membre' + (total !== 1 ? 's' : '');

  const inactiveCount = lastDashboardData.members.filter(function(m) {
    return m.status !== 'suspended' && isInactive(m);
  }).length;
  const inactiveEl = document.getElementById('org-inactive-count');
  if (inactiveEl && inactiveCount > 0) {
    inactiveEl.textContent = inactiveCount + ' inactif' + (inactiveCount > 1 ? 's' : '') + ' (>30 j)';
    inactiveEl.style.display = 'inline';
  }

  const filtersEl = document.getElementById('org-filters');
  if (filtersEl && inactiveCount > 0) {
    filtersEl.style.display = 'flex';
    const badge = document.getElementById('filter-inactive-badge');
    if (badge) badge.textContent = '(' + inactiveCount + ')';
  }

  const csvBtn = document.getElementById('org-csv-btn');
  if (csvBtn && total > 0) csvBtn.style.display = 'inline-flex';

  if (total === 0) {
    renderGrid([], currentUid);
    if (contentEl) contentEl.style.display = 'block';
    return;
  }

  renderGrid(lastDashboardData.members, currentUid, lastDashboardData.orgParcours);
  if (contentEl) contentEl.style.display = 'block';
}

window.setOrgFilter = function(filter) {
  if (!lastDashboardData) return;
  currentFilter = filter;
  document.querySelectorAll('.org-filter-btn').forEach(function(btn) {
    btn.classList.toggle('org-filter-active', btn.id === 'filter-' + filter);
  });
  const members = filter === 'inactive'
    ? lastDashboardData.members.filter(function(m) { return m.status !== 'suspended' && isInactive(m); })
    : lastDashboardData.members;
  renderGrid(members, lastDashboardData.currentUid, lastDashboardData.orgParcours);
};

function buildExcelRows() {
  var orgParcours = lastDashboardData.orgParcours || [];
  var headers = ['Prénom', 'Nom', 'Email', 'Profil', 'Statut', 'Évaluations', 'Score moyen (%)', 'Dernière activité']
    .concat(orgParcours.map(function(p) { return p.title; }));
  var dataRows = lastDashboardData.members.map(function(m) {
    var statusMap = {};
    (m.parcoursStatus || []).forEach(function(s) { statusMap[s.parcoursId] = s.hasStarted; });
    var parcoursValues = orgParcours.map(function(p) {
      return statusMap[p.parcoursId] ? 'Démarré' : 'Non démarré';
    });
    return [
      m.firstName || '',
      m.lastName || '',
      m.email || '',
      m.profileLabel || '',
      m.status === 'suspended' ? 'Désactivé' : 'Actif',
      m.totalEvals || 0,
      typeof m.avgScore === 'number' ? m.avgScore : '',
      m.lastEvalAt ? formatDateFr(m.lastEvalAt) : '',
    ].concat(parcoursValues);
  });
  return { headers: headers, rows: dataRows, orgParcours: orgParcours };
}

function generateExcelFile() {
  var XLSX = window.XLSX;
  var built = buildExcelRows();
  var wsData = [built.headers].concat(built.rows);
  var ws = XLSX.utils.aoa_to_sheet(wsData);

  // Largeurs de colonnes
  ws['!cols'] = [
    { wch: 16 }, { wch: 16 }, { wch: 32 }, { wch: 22 },
    { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 18 },
  ].concat(built.orgParcours.map(function() { return { wch: 26 }; }));

  // Ligne d'en-tête en gras via styles (SheetJS CE — format de cellule basique)
  var range = XLSX.utils.decode_range(ws['!ref']);
  for (var C = range.s.c; C <= range.e.c; C++) {
    var cellAddr = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[cellAddr]) continue;
    ws[cellAddr].s = { font: { bold: true } };
  }

  var wb = XLSX.utils.book_new();
  var sheetName = lastDashboardData.orgName.replace(/[/\\?*[\]]/g, '').slice(0, 31) || 'Organisation';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  var date = new Date().toISOString().slice(0, 10);
  var slug = lastDashboardData.orgName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  XLSX.writeFile(wb, 'pharmeval-' + slug + '-' + date + '.xlsx');
}

window.downloadOrgExcel = function() {
  if (!lastDashboardData || !lastDashboardData.members) return;
  var btn = document.getElementById('org-csv-btn');
  if (window.XLSX) {
    generateExcelFile();
    return;
  }
  if (btn) btn.textContent = 'Chargement…';
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  script.onload = function() {
    generateExcelFile();
    if (btn) { btn.innerHTML = '<i class="ti ti-file-spreadsheet" aria-hidden="true"></i> Exporter Excel'; }
  };
  script.onerror = function() {
    if (btn) { btn.innerHTML = '<i class="ti ti-file-spreadsheet" aria-hidden="true"></i> Exporter Excel'; }
    alert('Impossible de charger la bibliothèque d\'export. Vérifiez votre connexion internet.');
  };
  document.head.appendChild(script);
};

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('org-page-loading');
  const deniedEl = document.getElementById('org-denied');
  const viewEl = document.getElementById('org-view');

  if (!user) {
    clearCurrentUserContext();
    window.location.href = 'index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('[mon-organisation] erreur de vérification du compte :', err);
  }

  if (!hasPermission(PERMISSIONS.VIEW_ORG_DASHBOARD)) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (deniedEl) deniedEl.style.display = 'flex';
    return;
  }

  renderSiteHeader('mon-organisation');
  if (loadingEl) loadingEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';

  await loadDashboard(user.uid);
});
