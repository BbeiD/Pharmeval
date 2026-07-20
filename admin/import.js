// ===================== CONTROLEUR DE L'ECRAN D'IMPORT (Sprint 10) =====================
// Aucune logique metier ici : ce fichier ne fait qu'appeler
// js/services/import-service.js et afficher le resultat. Toute regle de
// validation, de construction de document ou d'ecriture Firestore vit
// exclusivement dans les services (voir RAPPORT_SPRINT10.md, architecture).
//
// Double controle d'acces (meme principe qu'ailleurs dans Pharmeval depuis
// le Sprint 3) :
// 1. Interface : #import-view reste masque tant que l'acces n'est pas confirme.
// 2. Logique metier : import-service.js revalide lui-meme la permission a
//    chaque appel (analyzeImportFile/commitImport), independamment de ce
//    controleur - un appel direct en contournant cette page se heurterait
//    au meme refus.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { analyzeImportFile, commitImport } from "../js/services/import-service.js";
import { formatThemeLabel } from "../js/services/theme-utils.js";
import { browseDocumentSources } from "../js/services/document-source-service.js";
import { getSectionTree } from "../js/services/document-section-service.js";
import { DOCUMENT_SOURCE_TYPE_LABELS } from "../js/services/document-source-metadata-service.js";

// Etat en memoire de l'analyse en cours (necessaire pour que les boutons
// "Simuler"/"Importer" reutilisent exactement le meme fichier deja
// analyse, sans avoir a le relire ni le revalider inutilement deux fois -
// commitImport() revalide neanmoins independamment, voir import-service.js).
let currentPayload = null;
let currentFileName = null;
let selectedDestination = null; // {documentSourceId, documentSectionId, generateCode} ou null (non classé), Sprint 20
let sectionOptionsCache = [];

// ---------------------------------------------------------------------------
// Controle d'acces
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('import-loading');
  const deniedEl = document.getElementById('import-denied');
  const viewEl = document.getElementById('import-view');

  if (!user) {
    clearCurrentUserContext();
    // Pas connecte : cette page n'a pas vocation a gerer la connexion
    // elle-meme (voir ../index.html pour l'ecran d'authentification) -
    // redirection simple vers l'application principale.
    window.location.href = '../index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
    // Meme en cas de panne Firestore, on ne bloque pas silencieusement :
    // hasPermission() ci-dessous se repliera sur "aucune permission" tant
    // que le contexte n'est pas correctement peuple, ce qui refuse l'acces
    // par prudence plutot que de l'accorder par erreur.
  }

  if (loadingEl) loadingEl.style.display = 'none';

  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) {
    if (deniedEl) deniedEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    return;
  }

  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
});

// ---------------------------------------------------------------------------
// Selection et analyse du fichier
// ---------------------------------------------------------------------------

export function onImportFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  const nameEl = document.getElementById('import-file-name');
  const analyzeBtn = document.getElementById('import-analyze-btn');
  resetResultCards();
  if (!file) {
    if (nameEl) nameEl.textContent = '';
    if (analyzeBtn) analyzeBtn.disabled = true;
    return;
  }
  currentFileName = file.name;
  if (nameEl) nameEl.textContent = 'Fichier sélectionné : ' + file.name;
  if (analyzeBtn) analyzeBtn.disabled = false;
}

export async function analyzeSelectedFile() {
  const input = document.getElementById('import-file-input');
  const file = input && input.files && input.files[0];
  if (!file) return;

  resetResultCards();
  const analyzeBtn = document.getElementById('import-analyze-btn');
  if (analyzeBtn) analyzeBtn.disabled = true;

  const rawText = await file.text();
  const result = await analyzeImportFile(rawText, { fileName: file.name });

  if (analyzeBtn) analyzeBtn.disabled = false;

  if (!result.authorized) {
    showErrors([{ scope: 'file', message: result.message }]);
    return;
  }
  if (result.parseError) {
    showErrors([{ scope: 'file', message: result.parseError }]);
    return;
  }
  if (!result.valid) {
    showErrors(result.errors);
    return;
  }

  currentPayload = result.payload;
  showPreview(result.preview);
}

// ---------------------------------------------------------------------------
// Affichage des erreurs de validation
// ---------------------------------------------------------------------------

function showErrors(errors) {
  const card = document.getElementById('import-errors-card');
  const list = document.getElementById('import-errors-list');
  if (!card || !list) return;
  list.innerHTML = errors.map(function(e) {
    let location = '';
    if (e.scope === 'question') {
      location = 'Question n°' + ((e.index !== undefined ? e.index + 1 : '?')) + (e.pedagogicalId ? ' (' + escapeHtml(e.pedagogicalId) + ')' : '') + ' — ';
    }
    return '<li>' + location + escapeHtml(e.message) + '</li>';
  }).join('');
  card.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Affichage de l'apercu
// ---------------------------------------------------------------------------

function showPreview(preview) {
  const card = document.getElementById('import-preview-card');
  if (!card) return;

  setText('preview-total', preview.totalQuestions);
  setText('preview-new', preview.newCount);
  setText('preview-update', preview.updateCount);

  const themesEl = document.getElementById('preview-themes');
  if (themesEl) {
    themesEl.innerHTML = Object.keys(preview.byTheme).map(function(theme) {
      return '<span class="import-badge">' + escapeHtml(theme) + ' (' + preview.byTheme[theme] + ')</span>';
    }).join(' ');
  }

  const diffEl = document.getElementById('preview-difficulties');
  if (diffEl) {
    diffEl.innerHTML = Object.keys(preview.byDifficulty).map(function(diff) {
      return '<span class="import-badge">' + escapeHtml(diff) + ' (' + preview.byDifficulty[diff] + ')</span>';
    }).join(' ');
  }

  card.style.display = 'block';
}

// ---------------------------------------------------------------------------
// SPRINT 20 : étape de destination documentaire
// ---------------------------------------------------------------------------

export async function proceedToDestinationStep() {
  const card = document.getElementById('import-destination-card');
  if (!card) return;
  card.style.display = 'block';

  const sourceSelect = document.getElementById('import-dest-source');
  const result = await browseDocumentSources({ status: 'active' });
  const items = (result && result.items) || [];
  sourceSelect.innerHTML = '<option value="">— Aucune destination (brouillon non classé) —</option>' +
    items.map(function(s) { return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + ' (' + escapeHtml(DOCUMENT_SOURCE_TYPE_LABELS[s.sourceType] || s.sourceType) + ')</option>'; }).join('');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function onImportDestSourceChange() {
  const sourceId = document.getElementById('import-dest-source').value;
  const sectionSelect = document.getElementById('import-dest-section');

  if (!sourceId) {
    sectionSelect.innerHTML = '<option value="">—</option>';
    sectionSelect.disabled = true;
    return;
  }

  const result = await getSectionTree(sourceId);
  sectionOptionsCache = (result && result.items) || [];
  sectionSelect.innerHTML = '<option value="">— Aucune sous-section (rattacher directement à la source) —</option>' +
    sectionOptionsCache.filter(function(s) { return s.status !== 'archived'; }).map(function(s) {
      const indent = '— '.repeat(s.level);
      return '<option value="' + escapeHtml(s.id) + '">' + indent + escapeHtml(s.name) + '</option>';
    }).join('');
  sectionSelect.disabled = false;
}

export function confirmDestinationAndPreview() {
  const sourceId = document.getElementById('import-dest-source').value;
  const sectionId = document.getElementById('import-dest-section').value;
  const generateCode = document.getElementById('import-dest-gencode').checked;

  selectedDestination = sourceId ? { documentSourceId: sourceId, documentSectionId: sectionId || null, generateCode: generateCode } : null;

  const summaryEl = document.getElementById('import-destination-summary-text');
  if (selectedDestination) {
    const sourceLabel = document.getElementById('import-dest-source').selectedOptions[0].textContent;
    const sectionLabel = sectionId ? document.getElementById('import-dest-section').selectedOptions[0].textContent.replace(/^—\s*/, '') : null;
    summaryEl.textContent = 'Les questions sans destination propre (dans le fichier) seront rattachées à : ' + sourceLabel + (sectionLabel ? ' › ' + sectionLabel : '') + '.';
  } else {
    summaryEl.textContent = 'Aucune destination choisie : les questions sans destination propre (dans le fichier) resteront « Non classées », rattachables plus tard.';
  }
  document.getElementById('import-destination-warnings').innerHTML = '';
  document.getElementById('import-destination-summary-card').style.display = 'block';
  document.getElementById('import-destination-summary-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Simulation / import reel
// ---------------------------------------------------------------------------

export async function runImport(simulate) {
  if (!currentPayload) return;

  const simulateBtn = document.getElementById('import-simulate-btn');
  const commitBtn = document.getElementById('import-commit-btn');
  if (simulateBtn) simulateBtn.disabled = true;
  if (commitBtn) commitBtn.disabled = true;

  const result = await commitImport(currentPayload, { fileName: currentFileName }, { simulate: !!simulate, destination: selectedDestination });

  if (simulateBtn) simulateBtn.disabled = false;
  if (commitBtn) commitBtn.disabled = false;

  if (!result.authorized) {
    showErrors([{ scope: 'file', message: result.message }]);
    return;
  }

  if (result.classificationWarnings && result.classificationWarnings.length > 0) {
    document.getElementById('import-destination-warnings').innerHTML =
      '<p class="import-report-error">' + result.classificationWarnings.length + ' avertissement(s) de classification :</p>' +
      '<ul class="import-errors-list">' + result.classificationWarnings.map(function(w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('') + '</ul>';
  }

  showReport(result);
}

function showReport(result) {
  const card = document.getElementById('import-report-card');
  const title = document.getElementById('import-report-title');
  const body = document.getElementById('import-report-body');
  if (!card || !body) return;

  if (title) title.textContent = result.simulated ? '5. Rapport de simulation (aucune écriture effectuée)' : '5. Rapport d\'import';

  if (!result.success) {
    body.innerHTML =
      '<p class="import-report-error">L\'import n\'a pas pu être finalisé.</p>' +
      '<ul class="import-errors-list">' + (result.errors || []).map(function(e) { return '<li>' + escapeHtml(e.message) + '</li>'; }).join('') + '</ul>';
    card.style.display = 'block';
    return;
  }

  const durationSeconds = (result.durationMs / 1000).toFixed(1);
  body.innerHTML =
    '<p class="import-report-summary">' +
      (result.simulated ? 'Simulation terminée — ' : 'Import terminé — ') +
      (result.createdCount + result.updatedCount) + ' questions analysées, ' +
      result.createdCount + ' ' + (result.simulated ? 'seraient créées' : 'créées') + ', ' +
      result.updatedCount + ' ' + (result.simulated ? 'seraient mises à jour' : 'mises à jour') + '.' +
    '</p>' +
    '<p class="import-report-duration">Temps : ' + durationSeconds + ' secondes.</p>';

  card.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Reinitialisation
// ---------------------------------------------------------------------------

export function resetImportScreen() {
  currentPayload = null;
  currentFileName = null;
  selectedDestination = null;
  const input = document.getElementById('import-file-input');
  if (input) input.value = '';
  const nameEl = document.getElementById('import-file-name');
  if (nameEl) nameEl.textContent = '';
  const analyzeBtn = document.getElementById('import-analyze-btn');
  if (analyzeBtn) analyzeBtn.disabled = true;
  resetResultCards();
}

function resetResultCards() {
  ['import-errors-card', 'import-preview-card', 'import-destination-card', 'import-destination-summary-card', 'import-report-card'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// ---------------------------------------------------------------------------
// Utilitaires d'affichage
// ---------------------------------------------------------------------------

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------------------------------------------------------------------------
// Pont vers le HTML classique (attributs onclick/onchange).
// ---------------------------------------------------------------------------
window.onImportFileSelected = onImportFileSelected;
window.analyzeSelectedFile = analyzeSelectedFile;
window.proceedToDestinationStep = proceedToDestinationStep;
window.onImportDestSourceChange = onImportDestSourceChange;
window.confirmDestinationAndPreview = confirmDestinationAndPreview;
window.runImport = runImport;
window.resetImportScreen = resetImportScreen;
