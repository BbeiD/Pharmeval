// ===================== CONTROLEUR DE L'ACCUEIL (Sprint 21.5+, refonte visuelle phase 1) =====================
// Accueil de l'application - en-tete partage (site-header.js), tuiles de
// statistiques REELLES (jamais de chiffre invente), donut de progression
// globale, et apercu des parcours attribues a l'utilisateur. Aucune
// logique metier ici : chaque donnee provient d'un service deja existant
// (assignment-service.js, statistics-service.js, parcours-completion-
// service.js, competency-progress-service.js), ce fichier ne fait
// qu'assembler et afficher.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getAssignedParcoursForUser } from "./services/assignment-service.js";
import { resolveParcoursColorHex } from "./services/parcours-metadata-service.js";
import { renderSiteHeader } from "./site-header.js";
import { getEvaluationsForStatistics } from "./services/history-service.js";
import { calculateOverview } from "./services/statistics-service.js";
import { getParcoursCompletionForUser } from "./services/parcours-completion-service.js";
import { getMyCompetencyProgress, summarizeMasteryStatus } from "./services/competency-progress-service.js";
import { renderMasteryDonutHtml } from "./mastery-donut-chart.js";

// Nombre maximal de parcours affiches sur l'accueil - au-dela, l'utilisateur
// est renvoye vers "Mes parcours" (lien deja present dans la section, voir
// index.html) plutot que de surcharger la page d'accueil.
const MAX_HOME_PARCOURS = 4;

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

onAuthStateChanged(auth, async function(user) {
  if (!user) return;

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  // CORRECTIF : si l'arrivee sur index.html vient d'un lien "Mes
  // évaluations"/"Administration" de l'en-tete partage (depuis une AUTRE
  // page), js/auth.js#revealApp() a deja bascule vers la bonne vue ET deja
  // surligne la bonne entree de navigation (openHistoryView()/openAdminZone(),
  // voir js/history.js/js/admin.js). Sans cette garde, cet appel ecrasait
  // systematiquement ce surlignage avec "accueil", meme quand l'utilisateur
  // etait en realite sur "Mes évaluations" - constat fait en testant
  // depuis "Sources documentaires".
  const params = new URLSearchParams(window.location.search);
  if (params.get('history') !== '1' && params.get('admin') !== '1') {
    renderSiteHeader('accueil');
  }
  renderWelcomeTitle();

  await Promise.all([
    loadHomeParcours(),
    loadHomeStats(),
    loadMasteryDonut(),
  ]);
});

function renderWelcomeTitle() {
  const el = document.getElementById('home-welcome-title');
  if (!el) return;
  const ctx = getCurrentUserContext();
  // "Prenom" reel si disponible (displayName), jamais invente - a defaut,
  // salutation neutre plutot qu'un nom devine depuis l'e-mail.
  const firstName = ((ctx && ctx.displayName) || '').trim().split(/\s+/)[0];
  el.textContent = firstName ? ('Bienvenue ' + firstName + ' ! 👋') : 'Bienvenue sur Pharmeval 👋';
}

// ---------------------------------------------------------------------------
// Tuiles de statistiques (donnees deja calculees ailleurs, jamais recalculees)
// ---------------------------------------------------------------------------

async function loadHomeStats() {
  const gridEl = document.getElementById('home-stats-grid');
  if (!gridEl) return;

  const [evalResult, completionResult] = await Promise.all([
    getEvaluationsForStatistics(),
    getParcoursCompletionForUser((getCurrentUserContext() || {}).uid),
  ]);

  const overview = calculateOverview(evalResult.items);
  const completionItems = (completionResult && !completionResult.error) ? completionResult.items : [];
  // "En cours" = un parcours ayant deja une progression mesuree (au moins
  // une question deja repondue correctement) mais pas encore termine -
  // jamais "0" invente pour un parcours sans donnee (percent === null).
  const inProgressCount = completionItems.filter(function(c) { return c.percent !== null && c.percent < 100; }).length;

  const tiles = [
    {
      icon: '🎒', iconCls: 'stat-card-icon-blue',
      value: String(inProgressCount), label: 'Formations en cours',
    },
    {
      icon: '📊', iconCls: 'stat-card-icon-orange',
      value: String(overview.count), label: 'Évaluations réalisées',
    },
    {
      icon: '⭐', iconCls: 'stat-card-icon-green',
      value: overview.averageScore !== null ? (overview.averageScore + '%') : '—', label: 'Score moyen',
    },
  ];

  gridEl.innerHTML = tiles.map(function(t) {
    return (
      '<div class="stat-card">' +
        '<div class="stat-card-icon ' + t.iconCls + '">' + t.icon + '</div>' +
        '<div class="stat-card-value">' + escapeHtml(t.value) + '</div>' +
        '<div class="stat-card-label">' + escapeHtml(t.label) + '</div>' +
      '</div>'
    );
  }).join('');
}

// ---------------------------------------------------------------------------
// Donut "progression globale" (masteryStatus agrege - voir mastery-donut-chart.js)
// ---------------------------------------------------------------------------

async function loadMasteryDonut() {
  const el = document.getElementById('home-mastery-donut');
  if (!el) return;
  const result = await getMyCompetencyProgress();
  const summary = summarizeMasteryStatus(result.items);
  el.innerHTML = renderMasteryDonutHtml(summary);
}

// ---------------------------------------------------------------------------
// Apercu des parcours attribues
// ---------------------------------------------------------------------------

async function loadHomeParcours() {
  const gridEl = document.getElementById('home-parcours-grid');
  const emptyEl = document.getElementById('home-parcours-empty');
  if (!gridEl) return;

  const ctx = getCurrentUserContext();
  const result = await getAssignedParcoursForUser(ctx && ctx.uid);

  if (result.error || result.items.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.style.display = result.error ? 'none' : 'block';
    return;
  }

  emptyEl.style.display = 'none';
  gridEl.innerHTML = result.items.slice(0, MAX_HOME_PARCOURS).map(cardHtml).join('');
}

function cardHtml(entry) {
  const p = entry.parcours;
  const hex = p.color ? resolveParcoursColorHex(p.color) : null;
  const stripe = hex ? 'background:' + escapeHtml(hex) + ';' : '';
  const mandatoryBadge = entry.assignment && entry.assignment.mandatory
    ? '<span class="bank-chip" style="background:#C62828;color:#fff;">Obligatoire</span>' : '';
  return (
    '<div class="mesparcours-card">' +
      '<div class="mesparcours-card-stripe" style="' + stripe + '"></div>' +
      '<div class="mesparcours-card-body">' +
        '<h3>' + (p.icon ? escapeHtml(p.icon) + ' ' : '') + escapeHtml(p.name) + '</h3>' +
        '<p>' + escapeHtml(p.description || 'Aucune description disponible.') + '</p>' +
        '<div class="bank-detail-tags-row">' + mandatoryBadge + '</div>' +
        '<a class="btn-primary" href="parcours-detail.html?id=' + encodeURIComponent(p.id) + '">Ouvrir</a>' +
      '</div>' +
    '</div>'
  );
}
