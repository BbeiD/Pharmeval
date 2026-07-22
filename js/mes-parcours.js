// ===================== CONTROLEUR "MES FORMATIONS" (Sprint 15, refonte visuelle phase 1) =====================
// Espace UTILISATEUR (pas un ecran d'administration) : accessible a TOUTE
// personne connectee, pour SA PROPRE liste de parcours attribues
// uniquement - aucune permission d'administration requise ici (voir
// js/services/assignment-service.js, getAssignedParcoursForUser(), et
// firestore.rules pour la garantie reelle cote serveur).
//
// CORRECTIF (demande directe de David, 22/07/2026) : cet ecran affichait
// jusqu'ici un % de questions repondues correctement (parcours-completion-
// service.js, metrique gardee INCHANGEE sur "Mes évaluations") - jugee peu
// lisible ici ("je viens de terminer le parcours, pourquoi 0%/44% ?").
// Remplacee par une metrique "par tentative" bien plus simple : nombre de
// fois ou une evaluation de ce parcours a ete SOUMISE (getParcoursAttemptSummaryForUser(),
// evaluation-result-service.js) + meilleur score obtenu - plus une session
// EN COURS (non terminee) detectee separement (getActiveSession(),
// evaluation-session-service.js) pour l'onglet "En cours".

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getAssignedParcoursForUser } from "./services/assignment-service.js";
import { resolveParcoursColorHex } from "./services/parcours-metadata-service.js";
import { getParcoursAttemptSummaryForUser } from "./services/evaluation-result-service.js";
import { getActiveSession } from "./services/evaluation-session-service.js";
import { renderSiteHeader } from "./site-header.js";
import { icon } from "./icons.js";

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

// TABS : classification DERIVEE de deux donnees deja calculees ailleurs
// (jamais une nouvelle notion) - une session EN COURS (non soumise)
// l'emporte toujours sur un decompte de tentatives passees (si on a
// recommence, c'est "en cours" avant tout, meme avec des tentatives
// anterieures) ; sinon, 0 tentative -> "a-commencer", au moins 1 -> "terminees".
const TABS = [
  { key: 'toutes', label: 'Toutes' },
  { key: 'en-cours', label: 'En cours' },
  { key: 'a-commencer', label: 'À commencer' },
  { key: 'terminees', label: 'Terminées' },
];

let state = { entries: [], attemptsByParcoursId: new Map(), activeSessionByParcoursId: new Map(), activeTab: 'toutes' };

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

function statusForEntry(parcoursId) {
  if (state.activeSessionByParcoursId.get(parcoursId)) return 'en-cours';
  const attempts = state.attemptsByParcoursId.get(parcoursId);
  return (attempts && attempts.attemptsCount > 0) ? 'terminees' : 'a-commencer';
}

async function loadMyParcours() {
  const ctx = getCurrentUserContext();
  const gridEl = document.getElementById('mesparcours-grid');
  const emptyEl = document.getElementById('mesparcours-empty');
  gridEl.innerHTML = '<div class="bank-list-loading">Chargement de vos parcours…</div>';
  emptyEl.style.display = 'none';

  const [assignedResult, attemptResult] = await Promise.all([
    getAssignedParcoursForUser(ctx && ctx.uid),
    getParcoursAttemptSummaryForUser(ctx && ctx.uid),
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
  // une erreur ici masque simplement les statistiques de tentatives (jamais
  // affiche comme une erreur bloquante), la liste reste consultable.
  state.attemptsByParcoursId = attemptResult.error ? new Map() : attemptResult.byParcoursId;

  // Session EN COURS par parcours - un appel PARALLELE par parcours attribue
  // (liste toujours modeste, meme volumetrie que le reste de cet ecran).
  state.entries = assignedResult.items;
  state.activeSessionByParcoursId = new Map();
  await Promise.all(state.entries.map(async function(entry) {
    const active = await getActiveSession(entry.parcours.id, null).catch(function() { return null; });
    if (active) state.activeSessionByParcoursId.set(entry.parcours.id, active);
  }));

  renderGrid();
}

function renderGrid() {
  const gridEl = document.getElementById('mesparcours-grid');
  const emptyEl = document.getElementById('mesparcours-empty');

  const filtered = state.entries.filter(function(entry) {
    if (state.activeTab === 'toutes') return true;
    return statusForEntry(entry.parcours.id) === state.activeTab;
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
    return cardHtml(entry, state.attemptsByParcoursId.get(entry.parcours.id), !!state.activeSessionByParcoursId.get(entry.parcours.id));
  }).join('');
}

function attemptsLineHtml(attempts, hasActiveSession) {
  const n = attempts ? attempts.attemptsCount : 0;
  if (hasActiveSession) {
    return n > 0
      ? 'Évaluation en cours · déjà terminé ' + n + ' fois (meilleur score ' + attempts.bestPercent + ' %)'
      : 'Évaluation en cours';
  }
  if (n === 0) return 'Pas encore commencé';
  return 'Terminé ' + n + ' fois · Meilleur score : ' + attempts.bestPercent + ' %';
}

function cardHtml(entry, attempts, hasActiveSession) {
  const p = entry.parcours;
  const hex = p.color ? resolveParcoursColorHex(p.color) : null;
  const stripe = hex ? 'background:' + escapeHtml(hex) + ';' : '';
  const mandatoryBadge = entry.assignment && entry.assignment.mandatory
    ? '<span class="bank-chip" style="background:#C62828;color:#fff;">Obligatoire</span>' : '';
  const dueBadge = entry.assignment && entry.assignment.dueDate
    ? '<span class="bank-chip">Échéance : ' + escapeHtml(entry.assignment.dueDate) + '</span>' : '';

  return (
    '<div class="mesparcours-card">' +
      '<div class="mesparcours-card-stripe" style="' + stripe + '"></div>' +
      '<div class="mesparcours-card-body">' +
        '<h3>' + (p.icon ? escapeHtml(p.icon) + ' ' : '') + escapeHtml(p.name) + '</h3>' +
        '<p>' + escapeHtml(p.description || 'Aucune description disponible.') + '</p>' +
        '<div class="bank-detail-tags-row">' +
          '<span class="bank-chip bank-badge-published">' + icon('status-published-active', { size: 13 }) + ' Publié</span>' + mandatoryBadge + dueBadge +
        '</div>' +
        '<p class="mesparcours-attempts">' + escapeHtml(attemptsLineHtml(attempts, hasActiveSession)) + '</p>' +
        '<button class="btn-primary" onclick="openParcours(\'' + escapeHtml(p.id) + '\')">Ouvrir</button>' +
      '</div>' +
    '</div>'
  );
}

export function openParcours(parcoursId) {
  window.location.href = 'parcours-detail.html?id=' + encodeURIComponent(parcoursId);
}
window.openParcours = openParcours;
