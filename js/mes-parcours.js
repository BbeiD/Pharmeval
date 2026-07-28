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
import { getSelfServiceCatalogParcours, getOrganizationParcours } from "./services/parcours-service.js";
import { resolveParcoursColorHex, resolveParcoursIconKey } from "./services/parcours-metadata-service.js";
import { getParcoursAttemptSummaryForUser } from "./services/evaluation-result-service.js";
import { getActiveSession } from "./services/evaluation-session-service.js";
import { renderSiteHeader } from "./site-header.js";
import { icon, renderAnyIcon, ICONS, DOT_ICONS } from "./icons.js";

const KNOWN_ICON_KEYS = new Set([...Object.keys(ICONS), ...Object.keys(DOT_ICONS)]);

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

// AJOUT (chantier "Mes parcours en self-service" / "Mon organisation",
// demande directe de David, 28/07/2026) : deuxieme niveau d'onglets, AU-DESSUS
// des onglets de statut existants (TABS ci-dessus, inchanges) - "Mes
// parcours" = attribues + catalogue self-service (organizationId===null,
// union dedupliquee), "Mon organisation" = parcours propres a
// l'organisation de l'utilisateur (users/{uid}.organizationId).
const TOP_TABS = [
  { key: 'mes-parcours', label: 'Mes parcours' },
  { key: 'organisation', label: 'Mon organisation' },
];

let state = {
  entries: [], attemptsByParcoursId: new Map(), activeSessionByParcoursId: new Map(),
  activeTab: 'toutes', activeTopTab: 'mes-parcours',
};

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

  renderTopTabs();
  renderTabs();
  await loadMyParcours();
});

function renderTopTabs() {
  const el = document.getElementById('mesparcours-top-tabs');
  if (!el) return;
  el.innerHTML = TOP_TABS.map(function(t) {
    const activeCls = t.key === state.activeTopTab ? ' bank-tab-active' : '';
    return '<button type="button" class="bank-tab' + activeCls + '" onclick="selectMesFormationsTopTab(\'' + t.key + '\')">' + escapeHtml(t.label) + '</button>';
  }).join('');
}

export function selectMesFormationsTopTab(key) {
  state.activeTopTab = key;
  state.activeTab = 'toutes';
  renderTopTabs();
  renderTabs();
  loadMyParcours();
}
window.selectMesFormationsTopTab = selectMesFormationsTopTab;

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

// AJOUT (chantier "Mes parcours en self-service", demande directe de
// David) : "Mes parcours" = attribues (assignment-service.js, inchange) +
// catalogue self-service (organizationId===null) - UNION dedupliquee par
// id, la version ATTRIBUEE gagne quand un parcours existe dans les deux
// (garde le badge "Obligatoire"/l'echeance, jamais perdus).
async function loadEntriesForActiveTopTab(ctx) {
  if (state.activeTopTab === 'organisation') {
    const result = await getOrganizationParcours();
    if (result.error) return { error: true, items: [] };
    return { error: false, items: result.items.map(function(p) { return { parcours: p, assignment: null }; }) };
  }

  const [assignedResult, catalogResult] = await Promise.all([
    getAssignedParcoursForUser(ctx && ctx.uid),
    getSelfServiceCatalogParcours(),
  ]);
  if (assignedResult.error && catalogResult.error) return { error: true, items: [] };

  const byId = new Map();
  (catalogResult.error ? [] : catalogResult.items).forEach(function(p) {
    byId.set(p.id, { parcours: p, assignment: null });
  });
  (assignedResult.error ? [] : assignedResult.items).forEach(function(entry) {
    byId.set(entry.parcours.id, entry); // priorite a la version attribuee (badges/echeance)
  });
  return { error: false, items: Array.from(byId.values()) };
}

async function loadMyParcours() {
  const ctx = getCurrentUserContext();
  const gridEl = document.getElementById('mesparcours-grid');
  const emptyEl = document.getElementById('mesparcours-empty');
  gridEl.innerHTML = '<div class="bank-list-loading">Chargement de vos parcours…</div>';
  emptyEl.style.display = 'none';

  const [entriesResult, attemptResult] = await Promise.all([
    loadEntriesForActiveTopTab(ctx),
    getParcoursAttemptSummaryForUser(ctx && ctx.uid),
  ]);

  if (entriesResult.error) {
    gridEl.innerHTML = '';
    showMessage('error', 'Impossible de charger vos parcours pour le moment. Réessayez plus tard.');
    return;
  }

  if (entriesResult.items.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.textContent = state.activeTopTab === 'organisation'
      ? 'Aucun parcours n\'est encore proposé par votre organisation.'
      : 'Aucun parcours disponible pour l\'instant.';
    emptyEl.style.display = 'block';
    return;
  }

  // Lecture de progression INDEPENDANTE (meme principe que js/history.js) :
  // une erreur ici masque simplement les statistiques de tentatives (jamais
  // affiche comme une erreur bloquante), la liste reste consultable.
  state.attemptsByParcoursId = attemptResult.error ? new Map() : attemptResult.byParcoursId;

  // Session EN COURS par parcours - un appel PARALLELE par parcours affiche
  // (liste toujours modeste, meme volumetrie que le reste de cet ecran).
  state.entries = entriesResult.items;
  state.activeSessionByParcoursId = new Map();
  await Promise.all(state.entries.map(async function(entry) {
    const active = await getActiveSession(entry.parcours.id, null).catch(function() { return null; });
    if (active) state.activeSessionByParcoursId.set(entry.parcours.id, active);
  }));

  renderStatsGrid();
  renderGrid();
}

// AJOUT (refonte visuelle, 23/07/2026) : tuiles de synthese, meme
// vocabulaire visuel que l'accueil (.stat-card-grid) - comptes DERIVES du
// meme statusForEntry() deja utilise par les onglets, jamais recalcules.
function renderStatsGrid() {
  const gridEl = document.getElementById('mesparcours-stats-grid');
  if (!gridEl) return;

  const total = state.entries.length;
  const enCours = state.entries.filter(function(e) { return statusForEntry(e.parcours.id) === 'en-cours'; }).length;
  const terminees = state.entries.filter(function(e) { return statusForEntry(e.parcours.id) === 'terminees'; }).length;

  const tiles = [
    { icon: icon('nav-paths-formations', { size: 20 }), iconCls: 'stat-card-icon-blue', accentCls: 'stat-card-accent-blue', value: String(total), label: 'Parcours disponibles' },
    { icon: icon('nav-evaluations-stats', { size: 20 }), iconCls: 'stat-card-icon-orange', accentCls: 'stat-card-accent-orange', value: String(enCours), label: 'En cours' },
    { icon: icon('status-published-active', { size: 20 }), iconCls: 'stat-card-icon-green', accentCls: '', value: String(terminees), label: 'Terminés au moins une fois' },
  ];

  gridEl.innerHTML = tiles.map(function(t) {
    return (
      '<div class="stat-card ' + t.accentCls + '">' +
        '<div class="stat-card-icon ' + t.iconCls + '">' + t.icon + '</div>' +
        '<div class="stat-card-value">' + escapeHtml(t.value) + '</div>' +
        '<div class="stat-card-label">' + escapeHtml(t.label) + '</div>' +
      '</div>'
    );
  }).join('');
}

function renderGrid() {
  const gridEl = document.getElementById('mesparcours-grid');
  const emptyEl = document.getElementById('mesparcours-empty');

  // AJOUT (mise en avant admin, demande directe de David, 28/07/2026) :
  // les parcours mis en avant remontent en tete de liste - tri stable
  // (Array.prototype.sort en JS moderne preserve l'ordre relatif des
  // elements a egalite), jamais un tri secondaire invente.
  const filtered = state.entries
    .filter(function(entry) {
      if (state.activeTab === 'toutes') return true;
      return statusForEntry(entry.parcours.id) === state.activeTab;
    })
    .sort(function(a, b) { return (b.parcours.featured ? 1 : 0) - (a.parcours.featured ? 1 : 0); });

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

// AJOUT (chantier graphique, demande directe de David) : medaillon icone
// + pills de progression au lieu d'une phrase brute - reutilise UNIQUEMENT
// des donnees deja reelles (couleur/icone du parcours, tentatives, meilleur
// score), jamais une metrique inventee (pas de "XP"/"difficulte" - ca
// n'existe pas dans le modele de donnees).
function progressPillsHtml(attempts, hasActiveSession) {
  const n = attempts ? attempts.attemptsCount : 0;
  if (hasActiveSession) {
    return '<span class="mesparcours-pill mesparcours-pill-active">Évaluation en cours</span>' +
      (n > 0 ? '<span class="mesparcours-pill">Terminé ' + n + ' fois</span>' : '');
  }
  if (n === 0) return '<span class="mesparcours-pill">Pas encore commencé</span>';
  return '<span class="mesparcours-pill">Terminé ' + n + ' fois</span>' +
    '<span class="mesparcours-pill mesparcours-pill-strong">Meilleur score ' + attempts.bestPercent + ' %</span>';
}

function cardHtml(entry, attempts, hasActiveSession) {
  const p = entry.parcours;
  const hex = (p.color ? resolveParcoursColorHex(p.color) : null) || '#1D9E75';
  const mandatoryBadge = entry.assignment && entry.assignment.mandatory
    ? '<span class="bank-chip" style="background:#C62828;color:#fff;">Obligatoire</span>' : '';
  const dueBadge = entry.assignment && entry.assignment.dueDate
    ? '<span class="bank-chip">Échéance : ' + escapeHtml(entry.assignment.dueDate) + '</span>' : '';
  // AJOUT (mise en avant admin, demande directe de David, 28/07/2026) :
  // seul effet visible cote utilisateur du bouton "★" admin/parcours.js -
  // sans ce badge, la mise en avant serait un reglage invisible. Tri par
  // mise en avant applique dans renderGrid() (jamais recalcule ici).
  const featuredBadge = p.featured
    ? '<span class="bank-chip parcours-featured-badge">' + icon('highlight-star-filled', { size: 13 }) + ' Recommandé</span>' : '';

  return (
    '<div class="mesparcours-card">' +
      '<div class="mesparcours-card-stripe" style="background:' + escapeHtml(hex) + ';"></div>' +
      '<div class="mesparcours-card-body">' +
        '<div class="mesparcours-card-header">' +
          '<div class="mesparcours-card-icon" style="background:' + escapeHtml(hex) + '22;color:' + escapeHtml(hex) + ';">' +
            renderAnyIcon(resolveParcoursIconKey(p, KNOWN_ICON_KEYS), { size: 22 }) +
          '</div>' +
          '<h3>' + escapeHtml(p.name) + '</h3>' +
        '</div>' +
        '<div class="bank-detail-tags-row">' +
          '<span class="bank-chip bank-badge-published">' + icon('status-published-active', { size: 13 }) + ' Publié</span>' + featuredBadge + mandatoryBadge + dueBadge +
        '</div>' +
        '<div class="mesparcours-pills">' + progressPillsHtml(attempts, hasActiveSession) + '</div>' +
        '<button class="btn-primary" onclick="openParcours(\'' + escapeHtml(p.id) + '\')">Ouvrir</button>' +
      '</div>' +
    '</div>'
  );
}

export function openParcours(parcoursId) {
  window.location.href = 'parcours-detail.html?id=' + encodeURIComponent(parcoursId);
}
window.openParcours = openParcours;
