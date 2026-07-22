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
import { resolveParcoursColorHex } from "./services/parcours-metadata-service.js";
import { resolveCompetencyColorHex } from "./services/competency-metadata-service.js";

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
}

function render(view) {
  const p = view.parcours;

  document.getElementById('pv-breadcrumb-current').textContent = p.name;
  document.title = 'Pharmeval — ' + p.name;

  renderHeader(view);
  renderStats(view);
  renderCompetencies(view);
  renderEvaluations(view);
}

function renderHeader(view) {
  const p = view.parcours;
  const el = document.getElementById('pv-header');
  const hex = p.color ? resolveParcoursColorHex(p.color) : null;

  let html = '<div class="pv-header-card">';
  if (hex) html += '<div class="pv-header-stripe" style="background:' + escapeHtml(hex) + ';"></div>';
  html += '<h1>' + (p.icon ? escapeHtml(p.icon) + ' ' : '') + escapeHtml(p.name) + '</h1>';
  html += '<p class="pv-header-description">' + escapeHtml(p.description || 'Aucune description disponible.') + '</p>';

  html += '<div class="bank-detail-tags-row">';
  if (view.category) html += '<span class="bank-chip">📂 ' + escapeHtml(view.category) + '</span>';
  if (view.level) html += '<span class="bank-chip">🎯 Niveau ' + escapeHtml(LEVEL_LABELS[view.level] || view.level) + '</span>';
  html += '<span class="bank-chip">🧩 ' + view.stats.competencyCount + ' compétence(s)</span>';
  html += '<span class="bank-chip">❓ ' + view.stats.questionCount + ' question(s)</span>';
  if (view.stats.sourceCount) html += '<span class="bank-chip">📚 ' + view.stats.sourceCount + ' source(s)</span>';
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
    { label: 'Compétences', value: s.competencyCount },
    { label: 'Questions', value: s.questionCount },
    { label: 'Sources', value: s.sourceCount },
  ];
  el.innerHTML = items.map(function(i) {
    return '<div class="pv-stat-card"><div class="pv-stat-value">' + escapeHtml(i.value) + '</div><div class="pv-stat-label">' + escapeHtml(i.label) + '</div></div>';
  }).join('');
}

function renderCompetencies(view) {
  const gridEl = document.getElementById('pv-competencies');
  const emptyEl = document.getElementById('pv-competencies-empty');
  const competencies = view.competencies;

  if (competencies.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  gridEl.innerHTML = competencies.map(function(c) {
    const bank = c.bankData;
    const name = bank ? bank.name : c.name;
    const description = bank ? bank.description : c.description;
    const hex = bank && bank.color ? resolveCompetencyColorHex(bank.color) : null;
    const stripe = hex ? 'background:' + escapeHtml(hex) + ';' : '';
    let tags = '';
    if (bank && bank.category) tags += '<span class="bank-chip">' + escapeHtml(bank.category) + '</span>';
    if (bank && bank.recommendedLevel) tags += '<span class="bank-chip">' + escapeHtml(LEVEL_LABELS[bank.recommendedLevel] || bank.recommendedLevel) + '</span>';
    if (c.derived) tags += '<span class="bank-chip">🔗 Déduite des questions</span>';
    return (
      '<div class="pv-competency-card">' +
        '<div class="pv-competency-card-stripe" style="' + stripe + '"></div>' +
        '<div class="pv-competency-card-body">' +
          '<h3>' + escapeHtml(name || 'Compétence sans nom') + '</h3>' +
          '<p>' + escapeHtml(description || 'Aucune description disponible.') + '</p>' +
          '<div class="bank-detail-tags-row">' + tags + '</div>' +
        '</div>' +
      '</div>'
    );
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
