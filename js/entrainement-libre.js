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
import { browseDocumentSources } from "./services/document-source-service.js";
import { getSectionTree } from "./services/document-section-service.js";
import { listMostUsedTags } from "./services/tag-catalog-service.js";
import { composeFreeTrainingPool } from "./services/free-training-service.js";
import { pickRandomSubset } from "./services/free-training-logic.js";
import {
  getActiveFreeTrainingSession, startNewFreeTrainingSession, restartFreeTrainingSession,
} from "./services/evaluation-session-service.js";

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
let state = { pool: null, replacingSessionId: null };

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
  const select = qs('etl-source');
  const result = await browseDocumentSources({ status: 'active' });
  const items = (result && result.items) || [];
  select.innerHTML = '<option value="">— Choisir —</option>' +
    items.map(function(s) { return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>'; }).join('');
}

async function populateTags() {
  const select = qs('etl-tag');
  const result = await listMostUsedTags({ pageSize: 50 });
  const items = (result && result.items) || [];
  select.innerHTML = '<option value="">Tous</option>' +
    items.map(function(t) { return '<option value="' + escapeHtml(t.label) + '">' + escapeHtml(t.label) + '</option>'; }).join('');
}

async function onSourceChange() {
  const sourceId = qs('etl-source').value;
  const sectionSelect = qs('etl-section');
  const composeBtn = qs('etl-compose-btn');

  resetDownstream();

  if (!sourceId) {
    sectionSelect.innerHTML = '<option value="">—</option>';
    sectionSelect.disabled = true;
    composeBtn.disabled = true;
    return;
  }

  const result = await getSectionTree(sourceId);
  const items = ((result && result.items) || []).filter(function(s) { return s.status !== 'archived'; });
  sectionSelect.innerHTML = '<option value="">— Toute la source —</option>' +
    items.map(function(s) {
      const indent = '— '.repeat(s.level);
      return '<option value="' + escapeHtml(s.id) + '">' + indent + escapeHtml(s.name) + '</option>';
    }).join('');
  sectionSelect.disabled = false;
  composeBtn.disabled = false;
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
    documentSourceId: qs('etl-source').value,
    documentSectionId: qs('etl-section').value || undefined,
    difficulty: qs('etl-difficulty').value || undefined,
    tag: qs('etl-tag').value || undefined,
    withImages: qs('etl-with-images').checked,
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
  qs('etl-preview-text').textContent = result.items.length + ' question(s) correspondent à cette sélection.';
  qs('etl-preview-card').style.display = 'block';
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
  qs('etl-source').addEventListener('change', onSourceChange);
  qs('etl-compose-btn').addEventListener('click', onComposeClick);
  qs('etl-launch-btn').addEventListener('click', onLaunchClick);
}
