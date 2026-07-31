// ===================== TABLEAU DE BORD ORGANISATION (B2B) =====================
// Accessible aux roles 'teacher' et 'admin' (ayant un organizationId).
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

function memberCardHtml(m, isCurrentUser) {
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.displayName || m.email || '—';
  const statusLabel = m.status === 'suspended' ? '<span class="org-member-badge org-badge-suspended">Désactivé</span>' : '';
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
        '<div class="org-member-name">' + escapeHtml(name) + selfLabel + statusLabel + '</div>' +
        profileLine +
        '<div class="org-member-email">' + escapeHtml(m.email) + '</div>' +
      '</div>' +
      '<div class="org-member-stats">' +
        '<div class="org-stat-item"><div class="org-stat-value">' + (m.totalEvals || 0) + '</div><div class="org-stat-label">évaluations</div></div>' +
        '<div class="org-stat-item"><div class="org-stat-value">' + avgScoreHtml + '</div><div class="org-stat-label">score moyen</div></div>' +
        '<div class="org-stat-item"><div class="org-stat-value">' + lastActivity + '</div><div class="org-stat-label">dernière activité</div></div>' +
      '</div>' +
    '</div>'
  );
}

async function loadDashboard(currentUid) {
  const contentEl = document.getElementById('org-content');
  const loadingEl = document.getElementById('org-loading-data');
  const errorEl = document.getElementById('org-error');
  const emptyEl = document.getElementById('org-empty');
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

  // Nom de l'org dans le titre
  const orgNameEl = document.getElementById('org-name');
  if (orgNameEl) orgNameEl.textContent = result.orgName || 'Mon organisation';

  const countEl = document.getElementById('org-member-count');
  if (countEl) countEl.textContent = result.members.length + ' membre' + (result.members.length !== 1 ? 's' : '');

  if (!result.members || result.members.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'block';
    return;
  }

  const grid = document.getElementById('org-members-grid');
  if (grid) {
    grid.innerHTML = result.members.map(function(m) {
      return memberCardHtml(m, m.uid === currentUid);
    }).join('');
  }

  if (contentEl) contentEl.style.display = 'block';
}

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
