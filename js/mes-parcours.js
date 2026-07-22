// ===================== CONTROLEUR "MES FORMATIONS" (Sprint 15, refonte visuelle phase 1) =====================
// Espace UTILISATEUR (pas un ecran d'administration) : accessible a TOUTE
// personne connectee, pour SA PROPRE liste de parcours attribues
// uniquement - aucune permission d'administration requise ici (voir
// js/services/assignment-service.js, getAssignedParcoursForUser(), et
// firestore.rules pour la garantie reelle cote serveur).
//
// AJOUT (refonte visuelle, phase 1) : "Mes formations" est un renommage/
// reorganisation de cet ecran (decision validee avec David) - MEME
// donnee que "Mes parcours" precedemment, desormais complete par la
// progression REELLE (parcours-completion-service.js, deja utilisee sur
// "Mes évaluations") et repartie en onglets par statut. Aucune nouvelle
// notion de donnee, seulement un affichage plus riche de ce qui existait
// deja.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getAssignedParcoursForUser } from "./services/assignment-service.js";
import { resolveParcoursColorHex } from "./services/parcours-metadata-service.js";
import { getParcoursCompletionForUser } from "./services/parcours-completion-service.js";
import { renderSiteHeader } from "./site-header.js";

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showMessage(status, message) {
  const el = document.getElementById('mesparcours-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

// TABS : classification DERIVEE du pourcentage reel deja calcule par
// parcours-completion-service.js (jamais une nouvelle donnee) -
// percent === 0 -> "a-commencer" (aucune question repondue correctement
// pour l'instant), 0 < percent < 100 -> "en-cours", percent === 100 ->
// "terminees". percent === null (parcours sans aucune question jouable,
// cas limite) est traite comme "a-commencer".
const TABS = [
  { key: 'toutes', label: 'Toutes' },
  { key: 'en-cours', label: 'En cours' },
  { key: 'a-commencer', label: 'À commencer' },
  { key: 'terminees', label: 'Terminées' },
];

let state = { entries: [], completionByParcoursId: new Map(), activeTab: 'toutes' };

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('mesparcours-loading');
  const viewEl = document.getElementById('mesparcours-view');

  if (!user) {
    clearCurrentUserContext();
    window.location.href = 'index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('mes-parcours');

  renderTabs();
  await loadMyParcours();
});

function renderTabs() {
  const el = document.getElementById('mesparcours-tabs');
  if (!el) return;
  el.innerHTML = TABS.map(function(t) {
    const activeCls = t.key === state.activeTab ? ' bank-tab-active' : '';
    return '<button type="button" class="bank-tab' + activeCls + '" onclick="selectMesFormationsTab(\'' + t.key + '\')">' + escapeHtml(t.label) + '</button>';
  }).join('');
}

export function selectMesFormationsTab(key) {
  state.activeTab = key;
  renderTabs();
  renderGrid();
}
window.selectMesFormationsTab = selectMesFormationsTab;

function statusForPercent(percent) {
  if (percent === null || percent === 0) return 'a-commencer';
  if (percent === 100) return 'terminees';
  return 'en-cours';
}

async function loadMyParcours() {
  const ctx = getCurrentUserContext();
  const gridEl = document.getElementById('mesparcours-grid');
  const emptyEl = document.getElementById('mesparcours-empty');
  gridEl.innerHTML = '<div class="bank-list-loading">Chargement de vos parcours…</div>';
  emptyEl.style.display = 'none';

  const [assignedResult, completionResult] = await Promise.all([
    getAssignedParcoursForUser(ctx && ctx.uid),
    getParcoursCompletionForUser(ctx && ctx.uid),
  ]);

  if (assignedResult.error) {
    gridEl.innerHTML = '';
    showMessage('error', 'Impossible de charger vos parcours pour le moment. Réessayez plus tard.');
    return;
  }

  if (assignedResult.items.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  // Lecture de progression INDEPENDANTE (meme principe que js/history.js) :
  // une erreur ici masque simplement la barre de progression (0 partout,
  // jamais affiche comme une erreur bloquante), la liste reste consultable.
  state.completionByParcoursId = new Map();
  if (!completionResult.error) {
    completionResult.items.forEach(function(c) { state.completionByParcoursId.set(c.parcoursId, c); });
  }

  state.entries = assignedResult.items;
  renderGrid();
}

function renderGrid() {
  const gridEl = document.getElementById('mesparcours-grid');
  const emptyEl = document.getElementById('mesparcours-empty');

  const filtered = state.entries.filter(function(entry) {
    if (state.activeTab === 'toutes') return true;
    const completion = state.completionByParcoursId.get(entry.parcours.id);
    const percent = completion ? completion.percent : null;
    return statusForPercent(percent) === state.activeTab;
  });

  if (filtered.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.textContent = state.activeTab === 'toutes'
      ? 'Aucun parcours ne vous a été attribué pour l\'instant. Contactez votre organisation ou votre administrateur Pharmeval.'
      : 'Aucun parcours dans cette catégorie pour l\'instant.';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  gridEl.innerHTML = filtered.map(function(entry) {
    return cardHtml(entry, state.completionByParcoursId.get(entry.parcours.id));
  }).join('');
}

function cardHtml(entry, completion) {
  const p = entry.parcours;
  const hex = p.color ? resolveParcoursColorHex(p.color) : null;
  const stripe = hex ? 'background:' + escapeHtml(hex) + ';' : '';
  const mandatoryBadge = entry.assignment && entry.assignment.mandatory
    ? '<span class="bank-chip" style="background:#C62828;color:#fff;">Obligatoire</span>' : '';
  const dueBadge = entry.assignment && entry.assignment.dueDate
    ? '<span class="bank-chip">Échéance : ' + escapeHtml(entry.assignment.dueDate) + '</span>' : '';

  // Barre de progression REELLE (parcours-completion-service.js, deja
  // utilisee sur "Mes évaluations") - jusqu'ici jamais affichee sur cette
  // page. `percent === null` (parcours sans aucune question jouable) ->
  // pas de barre, jamais "0%" trompeur.
  const percent = completion ? completion.percent : null;
  const progressHtml = percent !== null
    ? (
      '<div class="mesparcours-progress">' +
        '<div class="mesparcours-progress-track"><div class="mesparcours-progress-fill" style="width:' + percent + '%;"></div></div>' +
        '<span class="mesparcours-progress-label">' + percent + '%</span>' +
      '</div>'
    ) : '';

  return (
    '<div class="mesparcours-card">' +
      '<div class="mesparcours-card-stripe" style="' + stripe + '"></div>' +
      '<div class="mesparcours-card-body">' +
        '<h3>' + (p.icon ? escapeHtml(p.icon) + ' ' : '') + escapeHtml(p.name) + '</h3>' +
        '<p>' + escapeHtml(p.description || 'Aucune description disponible.') + '</p>' +
        '<div class="bank-detail-tags-row">' +
          '<span class="bank-chip bank-badge-published">🟢 Publié</span>' + mandatoryBadge + dueBadge +
        '</div>' +
        progressHtml +
        '<button class="btn-primary" onclick="openParcours(\'' + escapeHtml(p.id) + '\')">Ouvrir</button>' +
      '</div>' +
    '</div>'
  );
}

export function openParcours(parcoursId) {
  window.location.href = 'parcours-detail.html?id=' + encodeURIComponent(parcoursId);
}
window.openParcours = openParcours;
