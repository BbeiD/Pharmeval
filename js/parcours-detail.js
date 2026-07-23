// ===================== CONTROLEUR DE LA PAGE "PARCOURS" (Sprint 16) =====================
// "Point d'entrée de toute l'expérience pédagogique" (SPRINT16). Aucune
// logique metier ici : appelle js/services/parcours-view-service.js et
// affiche le resultat - meme discipline que toutes les autres pages du
// projet (mes-parcours.js, admin/*.js).
//
// AUCUNE ECRITURE FIRESTORE DANS CE FICHIER (SPRINT16, "Aucune donnee
// utilisateur ne doit encore etre enregistree. Aucune progression. Aucun
// score. Aucune reponse.") : ce fichier ne fait que LIRE et AFFICHER.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getParcoursDetailForUser } from "./services/parcours-view-service.js";
import { formatDateFr } from "./services/date-utils.js";
import { resolveParcoursColorHex, resolveParcoursIconKey } from "./services/parcours-metadata-service.js";
import { getParcoursAttemptSummaryForUser } from "./services/evaluation-result-service.js";
import { icon, renderAnyIcon, ICONS, DOT_ICONS } from "./icons.js";

const KNOWN_ICON_KEYS = new Set([...Object.keys(ICONS), ...Object.keys(DOT_ICONS)]);

const LEVEL_LABELS = { essentiel: 'Essentiel', approfondi: 'Approfondi', avance: 'Avancé' };

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function getParcoursIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('pv-loading');

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

  await loadParcours();
});

async function loadParcours() {
  const parcoursId = getParcoursIdFromUrl();
  const ctx = getCurrentUserContext();
  const deniedEl = document.getElementById('pv-denied');
  const viewEl = document.getElementById('pv-view');

  const result = await getParcoursDetailForUser(parcoursId, ctx && ctx.uid);

  if (!result.authorized) {
    document.getElementById('pv-denied-message').textContent =
      result.message || 'Ce parcours ne vous a pas été attribué, ou n\'est plus disponible.';
    deniedEl.style.display = 'block';
    viewEl.style.display = 'none';
    return;
  }

  deniedEl.style.display = 'none';
  viewEl.style.display = 'block';
  render(result.view);

  // AJOUT (demande directe de David, 22/07/2026) : historique des
  // tentatives - lecture INDEPENDANTE du reste de cette page (une erreur
  // ici n'empeche jamais l'affichage du parcours lui-meme, meme principe
  // que js/mes-parcours.js). Toujours "aucune ecriture Firestore" (voir
  // en-tete de fichier) : purement une lecture supplementaire.
  const attemptResult = await getParcoursAttemptSummaryForUser(ctx && ctx.uid);
  const attempts = (!attemptResult.error && attemptResult.byParcoursId.get(parcoursId)) || null;
  renderHistory(attempts);
}

function render(view) {
  const p = view.parcours;

  document.getElementById('pv-breadcrumb-current').textContent = p.name;
  document.title = 'Pharmeval — ' + p.name;

  renderHeader(view);
  renderStats(view);
  renderEvaluations(view);
}

function renderHeader(view) {
  const p = view.parcours;
  const el = document.getElementById('pv-header');
  const hex = p.color ? resolveParcoursColorHex(p.color) : null;

  let html = '<div class="pv-header-card">';
  if (hex) html += '<div class="pv-header-stripe" style="background:' + escapeHtml(hex) + ';"></div>';
  html += '<h1>' + renderAnyIcon(resolveParcoursIconKey(p, KNOWN_ICON_KEYS), { size: 22 }) + ' ' + escapeHtml(p.name) + '</h1>';
  html += '<p class="pv-header-description">' + escapeHtml(p.description || 'Aucune description disponible.') + '</p>';

  html += '<div class="bank-detail-tags-row">';
  if (view.category) html += '<span class="bank-chip">' + icon('content-category-folder', { size: 13 }) + ' ' + escapeHtml(view.category) + '</span>';
  if (view.level) html += '<span class="bank-chip">' + icon('nav-free-training', { size: 13 }) + ' Niveau ' + escapeHtml(LEVEL_LABELS[view.level] || view.level) + '</span>';
  html += '<span class="bank-chip">' + icon('content-question', { size: 13 }) + ' ' + view.stats.questionCount + ' question(s)</span>';
  if (view.stats.sourceCount) html += '<span class="bank-chip">' + icon('content-sources-catalog', { size: 13 }) + ' ' + view.stats.sourceCount + ' source(s)</span>';
  html += '</div>';

  html += '<div class="pv-header-meta">';
  html += '<span>Créé le ' + escapeHtml(p.createdAt ? formatDateFr(p.createdAt) : '—') + '</span>';
  if (p.author) html += '<span>· Auteur : ' + escapeHtml(p.author) + '</span>';
  html += '</div>';

  html += '</div>';
  el.innerHTML = html;
}

function renderStats(view) {
  const el = document.getElementById('pv-stats');
  const s = view.stats;
  const items = [
    { label: 'Questions', value: s.questionCount },
    { label: 'Sources', value: s.sourceCount },
  ];
  el.innerHTML = items.map(function(i) {
    return '<div class="pv-stat-card"><div class="pv-stat-value">' + escapeHtml(i.value) + '</div><div class="pv-stat-label">' + escapeHtml(i.label) + '</div></div>';
  }).join('');
}

// AJOUT : un SEUL bouton "Commencer" pour tout le parcours (competences +
// sources + questions directes melangees), plus un par competence -
// decision validee avec David. Visible tant que le parcours a du contenu
// (voir view.stats.questionCount, deja calcule cote service en incluant
// les questions directement liees - voir parcours-view-service.js).
function renderEvaluations(view) {
  const listEl = document.getElementById('pv-evaluations');
  const emptyEl = document.getElementById('pv-evaluations-empty');

  if (view.stats.questionCount === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML =
    '<div class="pv-evaluation-row">' +
      '<span class="pv-evaluation-name">Ce parcours (' + view.stats.questionCount + ' question(s))</span>' +
      '<button class="btn-primary" onclick="startParcoursEvaluation()">Commencer</button>' +
    '</div>';
}

// AJOUT (demande directe de David, 22/07/2026) : historique de toutes les
// tentatives DEJA SOUMISES de ce parcours - date + score, la plus recente
// en premier (deja triee par getParcoursAttemptSummaryForUser()). Chaque
// ligne renvoie vers la page de resultat deja existante (evaluation-
// result.html), jamais un nouvel affichage de detail duplique ici.
function renderHistory(attempts) {
  const listEl = document.getElementById('pv-history');
  const emptyEl = document.getElementById('pv-history-empty');
  if (!listEl || !emptyEl) return;

  if (!attempts || attempts.attemptsCount === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = attempts.attempts.map(function(a) {
    return (
      '<a class="pv-evaluation-row" href="evaluation-result.html?resultId=' + encodeURIComponent(a.resultId) + '" style="text-decoration:none;color:inherit;">' +
        '<span class="pv-evaluation-name">' + escapeHtml(formatDateFr(a.date)) + '</span>' +
        '<span class="bank-chip">' + a.correctCount + ' / ' + a.totalCount + ' · ' + a.percent + ' %</span>' +
      '</a>'
    );
  }).join('');
}

// SPRINT17 : ouvre désormais réellement l'évaluation (evaluation.html), qui
// revérifie elle-même l'accès au parcours et construit le pool de questions
// avant d'afficher quoi que ce soit. Ce fichier ne fait que naviguer,
// AUCUNE écriture Firestore ici (voir en-tête de fichier) - la session
// n'est créée que sur evaluation.html elle-même.
export function startParcoursEvaluation() {
  const parcoursId = getParcoursIdFromUrl();
  window.location.href = 'evaluation.html?parcoursId=' + encodeURIComponent(parcoursId);
}
window.startParcoursEvaluation = startParcoursEvaluation;
