// ===================== CONTROLEUR "ENTRAINEMENT LIBRE" (Sprint 21.5, Phase B1) =====================
// Espace UTILISATEUR (pas un ecran d'administration) : accessible a toute
// personne connectee, meme principe que js/mes-parcours.js. Aucune
// logique metier ici : compose le pool via free-training-service.js
// (Phase B1, deja livre et teste), affiche le resultat, et demarre/
// remplace une session via evaluation-session-service.js (deja livre au
// Sprint 17 + Phase B1) - RIEN n'est recalcule ni reimplemente ici.
//
// "Ne jamais lancer silencieusement un entrainement sur un sous-ensemble
// tronque" (cadrage Phase B0, point 4) : composeFreeTrainingPool() gere
// deja cette regle (evaluateTrainingPoolReadiness) - cette page se
// contente d'afficher fidelement son resultat, jamais de le contourner.
//
// CORRECTIF (demande directe de David, 29/07/2026, "je préférerais que tu
// partes sur les grandes classifications qu'on a mis dans les parcours") :
// les tuiles "Thème(s)" reposaient jusqu'ici sur les document_sources
// brutes (noms parfois peu clairs, ex. "A-4"/"A-5") - remplacees par les
// grandes classifications deja utilisees pour regrouper les Parcours
// (voir parcours-classification-logic.js), beaucoup plus lisibles ("Douleur,
// AINS & rhumatologie", "Cardiovasculaire"...). Plus de sous-theme (section) :
// une classification est un regroupement a plat, sans arborescence.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { getSelfServiceCatalogParcours } from "./services/parcours-service.js";
import { groupParcoursByClassification } from "./services/parcours-classification-logic.js";
import { resolveParcoursColorHex } from "./services/parcours-metadata-service.js";
import { composeFreeTrainingPoolByIds, launchTestMeByIds } from "./services/free-training-service.js";
import { pickRandomSubset } from "./services/free-training-logic.js";
import {
  getActiveFreeTrainingSession, startNewFreeTrainingSession, restartFreeTrainingSession,
} from "./services/evaluation-session-service.js";
import { renderSiteHeader } from "./site-header.js";
import { icon } from "./icons.js";

// Icone unique pour toute classification (aucune icone propre stockee,
// voir parcours-classification-logic.js - seule sa couleur, deja portee
// par les Parcours generes, varie d'une classification a l'autre).
const CLASSIFICATION_ICON_KEY = 'content-tag-label';
const DEFAULT_CLASSIFICATION_HEX = '#94A3B8';

function qs(id) { return document.getElementById(id); }
function escapeHtml(s) {
  return (s === undefined || s === null ? '' : s).toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function showMessage(status, message) {
  const el = qs('etl-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

// state.replacingSessionId : non-null lorsque l'utilisateur a choisi de
// remplacer un entrainement en cours (voir etl-replace-btn) - determine
// alors si le lancement appelle startNewFreeTrainingSession() ou
// restartFreeTrainingSession(), jamais les deux a la fois.
// state.classifications : une entree par grande classification (voir
// groupParcoursByClassification()), chacune avec l'union deduplicee de ses
// `directQuestionIds`. state.selectedClassifications : selection MULTIPLE
// (tuiles a icones, meme principe que l'ancienne selection de sources) -
// identifiee par le NOM de la classification (seule cle stable disponible,
// aucune collection Firestore dediee ne lui attribue d'id).
let state = { pool: null, replacingSessionId: null, classifications: [], selectedClassifications: new Set() };


// ---------------------------------------------------------------------------
// Authentification (meme principe que js/mes-parcours.js : aucune
// permission d'administration requise, uniquement une connexion valide)
// ---------------------------------------------------------------------------

// CORRECTIF (meme cause que RAPPORT_CORRECTIF_ACCES_INFINI.md, applique
// ici a l'identique) : ne jamais rediriger automatiquement des le
// premier user=null - Firebase peut declencher ce callback une premiere
// fois avec null avant d'avoir fini de restaurer une session persistee,
// surtout sur un chargement direct de page (lien classique, pas une
// navigation interne "a chaud"). On affiche un ecran explicite AVEC UN
// LIEN a la place - si un appel ulterieur confirme un utilisateur reel,
// ce meme gestionnaire sera rappele et basculera normalement vers
// l'affichage, sans avoir perdu la page entre-temps.
let initDone = false; // garde anti-double-appel (meme principe que catalog-sync-auth-gate.js)

onAuthStateChanged(auth, async function(user) {
  const loadingEl = qs('etl-loading');
  const deniedEl = qs('etl-denied');
  const viewEl = qs('etl-view');

  if (!user) {
    clearCurrentUserContext();
    if (loadingEl) loadingEl.style.display = 'none';
    if (viewEl) viewEl.style.display = 'none';
    if (deniedEl) deniedEl.style.display = 'block';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('entrainement-libre');

  if (initDone) return;
  initDone = true;
  await init();
});

async function init() {
  await Promise.all([checkActiveSession(), populateClassifications()]);
  wireEvents();
}

// ---------------------------------------------------------------------------
// Entrainement deja en cours (jamais deux sessions actives en meme temps)
// ---------------------------------------------------------------------------

async function checkActiveSession() {
  const active = await getActiveFreeTrainingSession();
  if (!active) return;

  const card = qs('etl-active-session-card');
  const total = (active.questionIds && active.questionIds.length) || 0;
  qs('etl-active-session-text').textContent =
    'Un entraînement de ' + total + ' question(s) est en cours, commencé le ' +
    new Date(active.startedAt).toLocaleString('fr-BE') + '.';
  card.style.display = 'block';

  qs('etl-resume-btn').addEventListener('click', function() {
    window.location.href = 'evaluation.html?sessionType=free_training';
  });
  qs('etl-replace-btn').addEventListener('click', function() {
    state.replacingSessionId = active.id;
    card.style.display = 'none';
  });
}

// ---------------------------------------------------------------------------
// Peuplement des tuiles de classification
// ---------------------------------------------------------------------------

async function populateClassifications() {
  const result = await getSelfServiceCatalogParcours();
  const parcoursItems = (result && result.items) || [];
  state.classifications = groupParcoursByClassification(parcoursItems);
  renderClassificationTiles();
}

function renderClassificationTiles() {
  const container = qs('etl-source-icons');
  container.innerHTML = state.classifications.map(function(c) {
    const selectedCls = state.selectedClassifications.has(c.classification) ? ' source-tile-selected' : '';
    const hex = resolveParcoursColorHex(c.color) || DEFAULT_CLASSIFICATION_HEX;
    return (
      '<button type="button" class="source-tile' + selectedCls + '" onclick="toggleEtlClassification(\'' + escapeHtml(c.classification) + '\')" aria-pressed="' + (state.selectedClassifications.has(c.classification) ? 'true' : 'false') + '">' +
        '<span class="source-tile-emoji" aria-hidden="true" style="color:' + escapeHtml(hex) + ';">' + icon(CLASSIFICATION_ICON_KEY, { size: 24 }) + '</span>' +
        '<span class="source-tile-name">' + escapeHtml(c.classification) + '</span>' +
      '</button>'
    );
  }).join('');
}

export function toggleEtlClassification(classification) {
  if (state.selectedClassifications.has(classification)) state.selectedClassifications.delete(classification);
  else state.selectedClassifications.add(classification);
  renderClassificationTiles();
  onClassificationSelectionChange();
}
window.toggleEtlClassification = toggleEtlClassification;

function onClassificationSelectionChange() {
  resetDownstream();
  qs('etl-compose-btn').disabled = state.selectedClassifications.size === 0;
}

function resetDownstream() {
  state.pool = null;
  qs('etl-errors-card').style.display = 'none';
  qs('etl-preview-card').style.display = 'none';
}

/** Union dedupliquee des `questionIds` des classifications actuellement
 * sélectionnées (state.selectedClassifications). */
function selectedQuestionIds() {
  const ids = new Set();
  state.classifications
    .filter(function(c) { return state.selectedClassifications.has(c.classification); })
    .forEach(function(c) { c.questionIds.forEach(function(id) { ids.add(id); }); });
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Composition du pool (lecture seule, ne cree aucune session)
// ---------------------------------------------------------------------------

async function onComposeClick() {
  resetDownstream();
  const composeBtn = qs('etl-compose-btn');
  composeBtn.disabled = true;

  const result = await composeFreeTrainingPoolByIds(selectedQuestionIds());
  composeBtn.disabled = false;

  if (!result.ready) {
    qs('etl-errors-message').textContent = result.message || 'Aucune question ne correspond à cette sélection.';
    qs('etl-errors-card').style.display = 'block';
    return;
  }

  state.pool = result.items;
  updatePreviewText();
  qs('etl-preview-card').style.display = 'block';
}

// AJOUT : rend explicite AVANT le lancement que seul un tirage aleatoire
// de "Nombre de questions souhaite" sera reellement utilise - le pool
// compose ci-dessus represente le TOTAL correspondant aux filtres, jamais
// ce qui sera reellement joue (source de confusion constatee : sans ce
// texte, rien ne distinguait visuellement les deux avant le lancement).
function updatePreviewText() {
  const total = state.pool.length;
  const desiredCount = parseInt(qs('etl-count').value, 10) || 1;
  const actualCount = Math.min(desiredCount, total);
  qs('etl-preview-text').textContent = total + ' question(s) correspondent à cette sélection — ' +
    actualCount + ' seront tirée(s) au hasard pour cet entraînement.';
}

// ---------------------------------------------------------------------------
// Lancement (ou remplacement) reel de l'entrainement
// ---------------------------------------------------------------------------

async function onLaunchClick() {
  if (!state.pool || state.pool.length === 0) return;
  const launchBtn = qs('etl-launch-btn');
  launchBtn.disabled = true;

  const desiredCount = parseInt(qs('etl-count').value, 10) || 1;
  const picked = pickRandomSubset(state.pool, desiredCount);
  const pedagogicalIds = picked.selected.map(function(q) { return q.pedagogicalId; });

  const result = state.replacingSessionId
    ? await restartFreeTrainingSession(state.replacingSessionId, pedagogicalIds)
    : await startNewFreeTrainingSession(pedagogicalIds);

  launchBtn.disabled = false;

  if (result.status !== 'success') {
    showMessage('error', result.message || 'Le démarrage de l\'entraînement a échoué. Réessayez.');
    return;
  }

  window.location.href = 'evaluation.html?sessionType=free_training';
}

// ---------------------------------------------------------------------------
// Cablage des evenements
// ---------------------------------------------------------------------------

// AJOUT ("Test me", demande directe de David) : raccourci qui court-circuite
// tout le formulaire de filtres - 10 questions reparties sur l'ensemble des
// classifications connues, aucune configuration prealable. Reutilise TOUTES
// les classifications deja chargees par populateClassifications().
const TEST_ME_QUESTION_COUNT = 10;

async function onTestMeClick() {
  const btn = qs('etl-testme-btn');
  btn.disabled = true;
  btn.textContent = 'Préparation du test…';

  // Lookup id -> classification (chaque question n'appartient qu'a UNE
  // seule classification, voir generate-leveled-parcours.mjs) - necessaire
  // pour que launchTestMeByIds() puisse repartir le tirage par classification
  // plutot qu'un tirage uniformement aleatoire sur l'union complete.
  const classificationByQuestionId = new Map();
  const allIds = [];
  state.classifications.forEach(function(c) {
    c.questionIds.forEach(function(id) {
      classificationByQuestionId.set(id, c.classification);
      allIds.push(id);
    });
  });

  const result = await launchTestMeByIds(allIds, TEST_ME_QUESTION_COUNT, function(q) {
    return classificationByQuestionId.get(q.pedagogicalId) || '(inconnue)';
  });

  btn.disabled = false;
  btn.textContent = 'Test me !';

  if (result.status !== 'success') {
    showMessage('error', result.message || 'Impossible de démarrer le test pour le moment. Réessayez.');
    return;
  }

  window.location.href = 'evaluation.html?sessionType=free_training';
}

function wireEvents() {
  qs('etl-testme-btn').addEventListener('click', onTestMeClick);
  qs('etl-compose-btn').addEventListener('click', onComposeClick);
  qs('etl-launch-btn').addEventListener('click', onLaunchClick);
  // Si le pool est deja compose, un changement du nombre souhaite met a
  // jour l'apercu immediatement, sans devoir recomposer le pool.
  qs('etl-count').addEventListener('input', function() {
    if (state.pool) updatePreviewText();
  });
}
