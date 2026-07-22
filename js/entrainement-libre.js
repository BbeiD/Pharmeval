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

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { browseActiveDocumentSources } from "./services/document-source-service.js";
import { getActiveSectionTree } from "./services/document-section-service.js";
import { listMostUsedTags } from "./services/tag-catalog-service.js";
import { composeFreeTrainingPool } from "./services/free-training-service.js";
import { pickRandomSubset } from "./services/free-training-logic.js";
import {
  getActiveFreeTrainingSession, startNewFreeTrainingSession, restartFreeTrainingSession,
} from "./services/evaluation-session-service.js";
import { renderSiteHeader } from "./site-header.js";
import { resolveSourceIconKey } from "./services/document-source-metadata-service.js";
import { renderAnyIcon, ICONS, DOT_ICONS } from "./icons.js";

const KNOWN_ICON_KEYS = new Set([...Object.keys(ICONS), ...Object.keys(DOT_ICONS)]);

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
// state.selectedSourceIds : selection MULTIPLE (tuiles a icones, decision
// validee avec David) - remplace l'ancien <select> a choix unique.
let state = { pool: null, replacingSessionId: null, sources: [], selectedSourceIds: new Set() };


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
  await Promise.all([checkActiveSession(), populateSources(), populateTags()]);
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
// Peuplement des selecteurs (memes fonctions que admin/import.js)
// ---------------------------------------------------------------------------

async function populateSources() {
  const result = await browseActiveDocumentSources();
  state.sources = (result && result.items) || [];
  renderSourceIcons();
}

function renderSourceIcons() {
  const container = qs('etl-source-icons');
  container.innerHTML = state.sources.map(function(s) {
    const selectedCls = state.selectedSourceIds.has(s.id) ? ' source-tile-selected' : '';
    // Icone personnalisee par l'administration (display.icon, voir
    // admin/document-sources.js#saveSourceIcon) si renseignee, sinon repli
    // sur l'icone par type de source - meme regle de resolution que cote
    // admin (resolveSourceIconKey), jamais dupliquee.
    const iconKey = resolveSourceIconKey(s, KNOWN_ICON_KEYS);
    return (
      '<button type="button" class="source-tile' + selectedCls + '" onclick="toggleEtlSource(\'' + escapeHtml(s.id) + '\')" aria-pressed="' + (state.selectedSourceIds.has(s.id) ? 'true' : 'false') + '">' +
        '<span class="source-tile-emoji" aria-hidden="true">' + renderAnyIcon(iconKey, { size: 24 }) + '</span>' +
        '<span class="source-tile-name">' + escapeHtml(s.name) + '</span>' +
      '</button>'
    );
  }).join('');
}

export function toggleEtlSource(sourceId) {
  if (state.selectedSourceIds.has(sourceId)) state.selectedSourceIds.delete(sourceId);
  else state.selectedSourceIds.add(sourceId);
  renderSourceIcons();
  onSourceSelectionChange();
}
window.toggleEtlSource = toggleEtlSource;

async function populateTags() {
  const select = qs('etl-tag');
  const result = await listMostUsedTags({ pageSize: 50 });
  const items = (result && result.items) || [];
  select.innerHTML = '<option value="">Tous</option>' +
    items.map(function(t) { return '<option value="' + escapeHtml(t.label) + '">' + escapeHtml(t.label) + '</option>'; }).join('');
}

async function onSourceSelectionChange() {
  resetDownstream();
  const sectionWrap = qs('etl-section-wrap');
  const sectionSelect = qs('etl-section');
  const composeBtn = qs('etl-compose-btn');

  const selectedIds = Array.from(state.selectedSourceIds);

  if (selectedIds.length === 0) {
    sectionWrap.style.display = 'none';
    sectionSelect.innerHTML = '<option value="">—</option>';
    sectionSelect.disabled = true;
    composeBtn.disabled = true;
    return;
  }

  composeBtn.disabled = false;

  // La section n'a de sens QUE si une seule source est selectionnee - une
  // section appartient a UNE source precise (voir composeFreeTrainingPool,
  // meme regle cote service) : masquee/reinitialisee des que plusieurs
  // sources sont choisies, jamais laissee visible dans un etat ambigu.
  if (selectedIds.length === 1) {
    sectionWrap.style.display = 'block';
    const result = await getActiveSectionTree(selectedIds[0]);
    const items = (result && result.items) || [];
    sectionSelect.innerHTML = '<option value="">— Toute la source —</option>' +
      items.map(function(s) {
        const indent = '— '.repeat(s.level);
        return '<option value="' + escapeHtml(s.id) + '">' + indent + escapeHtml(s.name) + '</option>';
      }).join('');
    sectionSelect.disabled = false;
  } else {
    sectionWrap.style.display = 'none';
    sectionSelect.innerHTML = '<option value="">—</option>';
    sectionSelect.disabled = true;
  }
}

function resetDownstream() {
  state.pool = null;
  qs('etl-errors-card').style.display = 'none';
  qs('etl-preview-card').style.display = 'none';
}

// ---------------------------------------------------------------------------
// Composition du pool (lecture seule, ne cree aucune session)
// ---------------------------------------------------------------------------

async function onComposeClick() {
  resetDownstream();
  const composeBtn = qs('etl-compose-btn');
  composeBtn.disabled = true;

  const filters = {
    documentSourceIds: Array.from(state.selectedSourceIds),
    documentSectionId: qs('etl-section').value || undefined,
    difficulty: qs('etl-difficulty').value || undefined,
    tag: qs('etl-tag').value || undefined,
    neverSeen: qs('etl-never-seen').checked,
    neverSucceeded: qs('etl-never-succeeded').checked,
  };

  const result = await composeFreeTrainingPool(filters);
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

function wireEvents() {
  qs('etl-compose-btn').addEventListener('click', onComposeClick);
  qs('etl-launch-btn').addEventListener('click', onLaunchClick);
  // Si le pool est deja compose, un changement du nombre souhaite met a
  // jour l'apercu immediatement, sans devoir recomposer le pool.
  qs('etl-count').addEventListener('input', function() {
    if (state.pool) updatePreviewText();
  });
}
