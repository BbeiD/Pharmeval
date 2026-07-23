// ===================== CONTROLEUR DE L'ACCUEIL (Sprint 21.5+, refonte visuelle phase 1) =====================
// Accueil de l'application - en-tete partage (site-header.js), tuiles de
// statistiques REELLES (jamais de chiffre invente), donut de progression
// globale, et apercu des parcours attribues a l'utilisateur. Aucune
// logique metier ici : chaque donnee provient d'un service deja existant
// (assignment-service.js, statistics-service.js, parcours-completion-
// service.js, question-progress-service.js, evaluation-result-service.js),
// ce fichier ne fait qu'assembler et afficher.
//
// CORRECTIF (demande directe de David, 22/07/2026) : le donut utilisait
// competency-progress-service.js (repartition par competence) - jamais
// alimente depuis que plus aucun flux d'evaluation ne renseigne
// competencyId (parcours mixte, entrainement libre, "Test me", defi du
// jour). Remplace par une repartition par QUESTION (question-progress-
// service.js), reellement alimentee par l'usage actuel de l'application.
// "Mes compétences" (mes-competences.html) utilise ENCORE l'ancienne
// donnee - hors perimetre de ce correctif, qui ne concerne que l'accueil.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getAssignedParcoursForUser } from "./services/assignment-service.js";
import { resolveParcoursColorHex, resolveParcoursIconKey } from "./services/parcours-metadata-service.js";
import { renderSiteHeader } from "./site-header.js";
import { getEvaluationsForStatistics } from "./services/history-service.js";
import { calculateOverview } from "./services/statistics-service.js";
import { getParcoursCompletionForUser } from "./services/parcours-completion-service.js";
import { getMyQuestionMasterySummary } from "./services/question-progress-service.js";
import { getParcoursAttemptSummaryForUser } from "./services/evaluation-result-service.js";
import { getRecentActivityForUser } from "./services/recent-activity-service.js";
import { getDailyChallengeStateForUser, startTodaysChallenge } from "./services/daily-challenge-service.js";
import { DAILY_CHALLENGE_QUESTION_COUNT } from "./services/daily-challenge-logic.js";
import { formatRelativeFr } from "./services/date-utils.js";
import { renderMasteryDonutHtml } from "./mastery-donut-chart.js";
import { icon, renderAnyIcon, ICONS, DOT_ICONS } from "./icons.js";

const KNOWN_ICON_KEYS = new Set([...Object.keys(ICONS), ...Object.keys(DOT_ICONS)]);

// AJOUT ("Activité récente", demande directe de David) : une icone + une
// couleur par type d'evenement (voir recent-activity-logic.js) - jamais de
// nouvelle icone inventee, toutes deja presentes dans js/icons.js.
const ACTIVITY_ICON_BY_TYPE = {
  evaluation_completed: { icon: 'content-question-bank', cls: 'stat-card-icon-blue' },
  score_improved: { icon: 'feedback-trend-up', cls: 'stat-card-icon-green' },
  parcours_started: { icon: 'nav-paths-formations', cls: 'stat-card-icon-orange' },
  streak: { icon: 'feedback-streak-regularity', cls: 'stat-card-icon-orange' },
};

// AJOUT (demande directe de David, 22/07/2026) : config du donut "progression
// globale" en QUESTIONS (voir renderMasteryDonutHtml(), mastery-donut-
// chart.js) - remplace la repartition par competence (jamais alimentee
// depuis que plus aucun flux d'evaluation ne renseigne competencyId, voir
// question-progress-service.js#getMyQuestionMasterySummary()).
const QUESTION_MASTERY_DONUT_OPTIONS = {
  statusOrder: ['mastered', 'in_progress', 'to_work'],
  statusColor: { mastered: 'var(--green)', in_progress: '#D4A017', to_work: 'var(--red)' },
  statusLabels: { mastered: 'Maîtrisé', in_progress: 'En cours', to_work: 'À travailler' },
  centerLabel: 'Progression',
  ariaLabel: 'Répartition de vos questions par niveau de maîtrise',
  emptyTitle: 'Aucune question évaluée pour le moment',
  emptySubtitle: 'Votre progression apparaîtra ici dès votre première évaluation terminée.',
};

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
    loadRecentActivity(),
    loadDefiCard(),
  ]);
});

function renderWelcomeTitle() {
  const el = document.getElementById('home-welcome-title');
  if (!el) return;
  const ctx = getCurrentUserContext();
  // "Prenom" reel si disponible (displayName), jamais invente - a defaut,
  // salutation neutre plutot qu'un nom devine depuis l'e-mail.
  const firstName = ((ctx && ctx.displayName) || '').trim().split(/\s+/)[0];
  // CORRECTIF (bibliotheque d'icones, remplace les emojis) : icon() rend du
  // HTML - .innerHTML desormais, plus .textContent. firstName vient d'une
  // donnee utilisateur (displayName) : escapeHtml() obligatoire ici, a la
  // difference de .textContent qui neutralisait deja tout HTML par nature.
  el.innerHTML = (firstName ? ('Bienvenue ' + escapeHtml(firstName) + ' !') : 'Bienvenue sur Pharmeval') + ' ' + icon('feedback-welcome', { size: 20 });
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
      icon: icon('nav-paths-formations', { size: 20 }), iconCls: 'stat-card-icon-blue',
      value: String(inProgressCount), label: 'Parcours en cours',
    },
    {
      icon: icon('nav-evaluations-stats', { size: 20 }), iconCls: 'stat-card-icon-orange',
      value: String(overview.count), label: 'Évaluations réalisées',
    },
    {
      icon: icon('highlight-star-filled', { size: 20 }), iconCls: 'stat-card-icon-green',
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
  const summary = await getMyQuestionMasterySummary();
  // "Progression" au centre = deja maitrisee OU en cours (mockup : 7% + 16%
  // = 23%) - tout ce qui n'est plus "jamais reussie", jamais juste
  // "maitrisee" seule (voir renderMasteryDonutHtml(), centerValue).
  const centerValue = (summary.percentages.mastered || 0) + (summary.percentages.in_progress || 0);
  el.innerHTML = renderMasteryDonutHtml(summary, Object.assign({ centerValue: centerValue }, QUESTION_MASTERY_DONUT_OPTIONS));
}

// ---------------------------------------------------------------------------
// Apercu des parcours attribues
// ---------------------------------------------------------------------------

async function loadHomeParcours() {
  const gridEl = document.getElementById('home-parcours-grid');
  const emptyEl = document.getElementById('home-parcours-empty');
  if (!gridEl) return;

  const ctx = getCurrentUserContext();
  const [result, attemptResult] = await Promise.all([
    getAssignedParcoursForUser(ctx && ctx.uid),
    getParcoursAttemptSummaryForUser(ctx && ctx.uid),
  ]);

  if (result.error || result.items.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.style.display = result.error ? 'none' : 'block';
    return;
  }

  // AJOUT (demande directe de David, "les parcours posés là comme ça c'est
  // pas ouf") : meme metrique par tentative que js/mes-parcours.js (nombre
  // de fois termine + meilleur score) - jamais une barre de % par question,
  // pour rester coherent avec cette page.
  const attemptsByParcoursId = attemptResult.error ? new Map() : attemptResult.byParcoursId;

  emptyEl.style.display = 'none';
  gridEl.innerHTML = result.items.slice(0, MAX_HOME_PARCOURS).map(function(entry) {
    return cardHtml(entry, attemptsByParcoursId.get(entry.parcours.id));
  }).join('');
}

function attemptsLineHtml(attempts) {
  const n = attempts ? attempts.attemptsCount : 0;
  if (n === 0) return 'Pas encore commencé';
  return 'Terminé ' + n + ' fois · Meilleur score : ' + attempts.bestPercent + ' %';
}

function cardHtml(entry, attempts) {
  const p = entry.parcours;
  const hex = p.color ? resolveParcoursColorHex(p.color) : null;
  const stripe = hex ? 'background:' + escapeHtml(hex) + ';' : '';
  const mandatoryBadge = entry.assignment && entry.assignment.mandatory
    ? '<span class="bank-chip" style="background:#C62828;color:#fff;">Obligatoire</span>' : '';
  return (
    '<div class="mesparcours-card">' +
      '<div class="mesparcours-card-stripe" style="' + stripe + '"></div>' +
      '<div class="mesparcours-card-body">' +
        '<h3>' + renderAnyIcon(resolveParcoursIconKey(p, KNOWN_ICON_KEYS), { size: 18 }) + ' ' + escapeHtml(p.name) + '</h3>' +
        '<p>' + escapeHtml(p.description || 'Aucune description disponible.') + '</p>' +
        '<div class="bank-detail-tags-row">' + mandatoryBadge + '</div>' +
        '<p class="mesparcours-attempts">' + escapeHtml(attemptsLineHtml(attempts)) + '</p>' +
        '<a class="btn-primary" href="parcours-detail.html?id=' + encodeURIComponent(p.id) + '">Ouvrir</a>' +
      '</div>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Activite recente (demande directe de David, 22/07/2026 - "agrège et
// renseigne le")
// ---------------------------------------------------------------------------

async function loadRecentActivity() {
  const listEl = document.getElementById('home-activity-list');
  const emptyEl = document.getElementById('home-activity-empty');
  if (!listEl) return;

  const ctx = getCurrentUserContext();
  const result = await getRecentActivityForUser(ctx && ctx.uid);

  if (result.error || result.items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = result.error ? 'none' : 'block';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = result.items.map(activityRowHtml).join('');
}

function activityRowHtml(event) {
  const conf = ACTIVITY_ICON_BY_TYPE[event.type] || ACTIVITY_ICON_BY_TYPE.evaluation_completed;
  return (
    '<div class="home-activity-row">' +
      '<div class="stat-card-icon ' + conf.cls + '" style="width:32px;height:32px;margin-bottom:0;">' + icon(conf.icon, { size: 16 }) + '</div>' +
      '<div class="home-activity-text">' +
        '<div class="home-activity-label">' + escapeHtml(event.label) + '</div>' +
        '<div class="home-activity-detail">' + escapeHtml(event.detail) + '</div>' +
      '</div>' +
      '<div class="home-activity-time">' + escapeHtml(formatRelativeFr(event.date)) + '</div>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Défi du jour (demande directe de David, 22/07/2026) - meme donnee que
// js/defi.js, presentation condensee pour l'accueil. AUCUN "temps estime"
// (explicitement refuse - personne ne mesure le temps reel par question
// aujourd'hui, ce serait une valeur inventee).
// ---------------------------------------------------------------------------

async function loadDefiCard() {
  const el = document.getElementById('home-defi-body');
  if (!el) return;

  const state = await getDailyChallengeStateForUser();
  const trophy = '<div class="home-defi-trophy">' + icon('feedback-success-achievement', { size: 40 }) + '</div>';

  if (state.eligibleCount === 0) {
    el.innerHTML = '<p class="pv-list-empty">Aucune question disponible pour le moment.</p>';
    return;
  }

  if (state.alreadyCompletedToday) {
    el.innerHTML =
      trophy +
      '<p style="text-align:center;"><strong>Défi relevé pour aujourd\'hui !</strong></p>' +
      '<div class="btn-row" style="justify-content:center;"><a class="btn-secondary" href="defi.html">Voir mon défi</a></div>';
    return;
  }

  const questionCount = Math.min(DAILY_CHALLENGE_QUESTION_COUNT, state.eligibleCount);
  el.innerHTML =
    '<p>' + questionCount + ' questions sélectionnées pour vous.</p>' +
    trophy +
    '<button class="btn-primary" id="home-defi-start-btn" style="width:100%;">Commencer le défi</button>';

  document.getElementById('home-defi-start-btn').addEventListener('click', async function() {
    const btn = this;
    btn.disabled = true;
    btn.textContent = 'Préparation…';
    const result = await startTodaysChallenge();
    if (result.status !== 'success') {
      btn.disabled = false;
      btn.textContent = 'Commencer le défi';
      return;
    }
    window.location.href = 'evaluation.html?sessionType=daily_challenge';
  });
}
