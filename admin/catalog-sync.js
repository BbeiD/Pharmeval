// ===================== CONTROLEUR — Synchronisation du catalogue (Sprint 21, phase 3) =====================
// AUCUNE LOGIQUE METIER NI DE RENDU DUPLIQUEE ICI (cadrage explicite) :
// - la logique metier (dedoublonnage, identification, diff, ecriture)
//   vit exclusivement dans js/services/catalog-sync-engine.js ;
// - le rendu DOM vit dans catalog-sync-render.js (testable sans Firebase) ;
// - les fonctions pures de formatage vivent dans catalog-sync-helpers.js.
// Ce fichier ne fait que : cabler les evenements, lire le fichier
// selectionne, appeler le connecteur/le moteur, et orchestrer l'appel aux
// fonctions de rendu ci-dessus. Meme double controle d'acces que
// admin/import.js.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { ExcelCatalogConnector } from "../js/services/connectors/excel-catalog-connector.js";
import { logImport, getRecentImportLogs } from "../js/services/import-log-service.js";
import { createCatalogSyncEngine } from "./catalog-sync-wiring.js";
import { createAuthGateController } from "./catalog-sync-auth-gate.js";
import {
  fingerprintFile, formatFileSize, hasAcceptedExtension, buildConfirmMessage, classifySyncStatus,
  buildCorrespondenceCsv, applyUiState,
} from "./catalog-sync-helpers.js";
import { renderAnalysisResult, renderDetailTab, renderSyncReportBody, renderHistory } from "./catalog-sync-render.js";

const { engine, backend, isDemoBackend } = createCatalogSyncEngine();
const connector = new ExcelCatalogConnector(typeof window !== 'undefined' ? window.XLSX : globalThis.XLSX);

let currentFile = null;
let currentAnalysis = null;
let currentAnalysisFingerprint = null;
let currentTab = 'create';
let isAnalyzing = false;
let isSyncing = false;
let lastReportData = null;

// ---------------------------------------------------------------------------
// Controle d'acces — voir catalog-sync-auth-gate.js (correctif dedie,
// dependances injectees, garde anti-double-appel, 3 etats).
// ---------------------------------------------------------------------------

const authGate = createAuthGateController({
  onAuthStateChanged: onAuthStateChanged,
  auth: auth,
  ensureUserDocument: ensureUserDocument,
  setCurrentUserContext: setCurrentUserContext,
  clearCurrentUserContext: clearCurrentUserContext,
  hasPermission: hasPermission,
  PERMISSIONS: PERMISSIONS,
  loadHistory: function() { loadHistory(); },
  document: typeof document !== 'undefined' ? document : null,
});

export function initAuthGate() { authGate.init(); }

// ---------------------------------------------------------------------------
// Selection du fichier
// ---------------------------------------------------------------------------

export function onFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  const infoEl = document.getElementById('cs-file-info');
  const analyzeBtn = document.getElementById('cs-analyze-btn');

  currentAnalysis = null;
  currentAnalysisFingerprint = null;
  applyUiState(file ? 'file-selected' : 'no-file');

  if (!file) {
    currentFile = null;
    if (infoEl) infoEl.textContent = '';
    if (analyzeBtn) analyzeBtn.disabled = true;
    return;
  }

  currentFile = file;
  if (!hasAcceptedExtension(file.name)) {
    if (infoEl) infoEl.innerHTML = '<span class="import-report-error">Format non pris en charge — sélectionnez un fichier .xlsx ou .xls.</span>';
    if (analyzeBtn) analyzeBtn.disabled = true;
    return;
  }

  if (infoEl) infoEl.textContent = file.name + ' — ' + formatFileSize(file.size);
  if (analyzeBtn) analyzeBtn.disabled = false;
}

// ---------------------------------------------------------------------------
// Analyse (sans ecriture)
// ---------------------------------------------------------------------------

function setProgressStep(stepKey) {
  const steps = document.querySelectorAll('#cs-progress-steps li');
  const order = ['read', 'validate', 'compare', 'resolve', 'report'];
  const idx = order.indexOf(stepKey);
  steps.forEach(function(li) {
    const liIdx = order.indexOf(li.getAttribute('data-step'));
    li.classList.remove('cs-step-active', 'cs-step-done');
    if (liIdx < idx) li.classList.add('cs-step-done');
    else if (liIdx === idx) li.classList.add('cs-step-active');
  });
}

export async function analyzeCatalog() {
  if (!currentFile || isAnalyzing) return;
  isAnalyzing = true;
  const analyzeBtn = document.getElementById('cs-analyze-btn');
  if (analyzeBtn) analyzeBtn.disabled = true;

  applyUiState('analyzing');
  setProgressStep('read');

  const arrayBuffer = await currentFile.arrayBuffer();
  setProgressStep('validate');
  setProgressStep('compare');
  const analysis = await engine.analyze(connector, { arrayBuffer: arrayBuffer });
  setProgressStep('resolve');
  setProgressStep('report');

  isAnalyzing = false;
  if (analyzeBtn) analyzeBtn.disabled = false;

  currentAnalysis = analysis;
  currentAnalysisFingerprint = fingerprintFile(currentFile);

  if (!analysis.success) {
    document.getElementById('cs-warnings-card').style.display = (analysis.rowErrors || []).length > 0 ? 'block' : 'none';
  }
  renderAnalysisResult(document, analysis, currentTab, backend);
}

// ---------------------------------------------------------------------------
// Detail (onglets, recherche, filtres)
// ---------------------------------------------------------------------------

export function switchDetailTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.cs-tab-btn').forEach(function(btn) {
    btn.classList.toggle('cs-tab-active', btn.getAttribute('data-tab') === tab);
  });
  renderDetailTab(document, currentAnalysis, tab, currentFilters(), backend);
}

function currentFilters() {
  return {
    search: document.getElementById('cs-detail-search').value,
    sourceName: document.getElementById('cs-detail-source-filter').value,
  };
}

export function onDetailFiltersChanged() {
  renderDetailTab(document, currentAnalysis, currentTab, currentFilters(), backend);
}

// ---------------------------------------------------------------------------
// Confirmation puis synchronisation
// ---------------------------------------------------------------------------

export function openConfirmDialog() {
  if (!currentAnalysis || !currentAnalysis.success) return;
  if (fingerprintFile(currentFile) !== currentAnalysisFingerprint) {
    document.getElementById('cs-stale-notice').style.display = 'block';
    return;
  }
  document.getElementById('cs-confirm-message').textContent = buildConfirmMessage(currentAnalysis.analysis.counts);
  document.getElementById('cs-confirm-overlay').style.display = 'flex';
}

export function cancelConfirmDialog() {
  document.getElementById('cs-confirm-overlay').style.display = 'none';
}

export async function confirmSync() {
  if (isSyncing) return; // anti double-clic
  const overlay = document.getElementById('cs-confirm-overlay');
  const confirmBtn = document.getElementById('cs-confirm-sync-btn');
  if (confirmBtn) confirmBtn.disabled = true;

  // REVALIDATION OBLIGATOIRE : jamais confiance en l'analyse deja
  // affichee - on relance une analyse fraiche et on ne synchronise QUE ce
  // resultat frais (meme pattern "analyze puis commit" que import-
  // service.js existant).
  const freshArrayBuffer = await currentFile.arrayBuffer();
  const freshAnalysis = await engine.analyze(connector, { arrayBuffer: freshArrayBuffer });

  if (!freshAnalysis.success) {
    overlay.style.display = 'none';
    currentAnalysis = freshAnalysis;
    renderAnalysisResult(document, freshAnalysis, currentTab, backend);
    if (confirmBtn) confirmBtn.disabled = false;
    return;
  }

  overlay.style.display = 'none';
  isSyncing = true;
  applyUiState('syncing');

  const t0 = Date.now();
  const syncResult = await engine.synchronize(freshAnalysis, { dryRun: false });
  const durationMs = Date.now() - t0;

  isSyncing = false;
  if (confirmBtn) confirmBtn.disabled = false;

  await recordAndShowReport(syncResult, durationMs);
  await loadHistory();
}

// ---------------------------------------------------------------------------
// Rapport final
// ---------------------------------------------------------------------------

async function recordAndShowReport(syncResult, durationMs) {
  const status = classifySyncStatus(syncResult);
  const ctx = getCurrentUserContext();

  const logEntry = {
    adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
    fileName: currentFile ? currentFile.name : '',
    createdCount: (syncResult.report && syncResult.report.questionsCreated) || 0,
    updatedCount: (syncResult.report && syncResult.report.questionsUpdated) || 0,
    errorCount: status === 'failure' ? 1 : 0,
    durationMs: durationMs,
    simulated: false,
    schemaVersion: '1.1',
    competenciesCreated: (syncResult.report && syncResult.report.competenciesCreated) || 0,
    tagsCreated: (syncResult.report && syncResult.report.tagsCreated) || 0,
    sourcesCreated: (syncResult.report && syncResult.report.sourcesCreated) || 0,
    connectorId: connector.connectorId,
  };
  const logResult = await logImport(logEntry);

  lastReportData = { syncResult: syncResult, status: status };

  renderSyncReportBody(document, syncResult, status, {
    dateLabel: (new Date()).toLocaleString('fr-BE'),
    fileName: currentFile ? currentFile.name : '',
    durationMs: durationMs,
    logSucceeded: logResult.success,
    isDemoBackend: isDemoBackend,
  });

  if (status === 'failure') {
    const retryBtn = document.getElementById('cs-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', resetPage);
  }
}

export function downloadReportJson() {
  if (!lastReportData) return;
  triggerDownload('rapport-synchronisation-' + Date.now() + '.json', JSON.stringify(lastReportData.syncResult, null, 2), 'application/json');
}

export function downloadCorrespondenceCsv() {
  if (!lastReportData) return;
  const csv = buildCorrespondenceCsv(lastReportData.syncResult.report.idCorrespondence);
  triggerDownload('correspondance-' + Date.now() + '.csv', csv, 'text/csv');
}

function triggerDownload(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

export async function loadHistory() {
  const result = await getRecentImportLogs({ limit: 10 });
  renderHistory(document, (result && result.items) || []);
}

// ---------------------------------------------------------------------------
// Reinitialisation
// ---------------------------------------------------------------------------

export function resetPage() {
  currentFile = null;
  currentAnalysis = null;
  currentAnalysisFingerprint = null;
  const input = document.getElementById('cs-file-input');
  if (input) input.value = '';
  const infoEl = document.getElementById('cs-file-info');
  if (infoEl) infoEl.textContent = '';
  const analyzeBtn = document.getElementById('cs-analyze-btn');
  if (analyzeBtn) analyzeBtn.disabled = true;
  const syncBtn = document.getElementById('cs-open-confirm-btn');
  if (syncBtn) syncBtn.disabled = true;
  applyUiState('no-file');
}

// ---------------------------------------------------------------------------
// Cablage des evenements
// ---------------------------------------------------------------------------

export function wireEvents() {
  document.getElementById('cs-file-input').addEventListener('change', onFileSelected);
  document.getElementById('cs-analyze-btn').addEventListener('click', analyzeCatalog);
  document.getElementById('cs-detail-search').addEventListener('input', onDetailFiltersChanged);
  document.getElementById('cs-detail-source-filter').addEventListener('change', onDetailFiltersChanged);
  document.querySelectorAll('.cs-tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { switchDetailTab(btn.getAttribute('data-tab')); });
  });
  document.getElementById('cs-open-confirm-btn').addEventListener('click', openConfirmDialog);
  document.getElementById('cs-cancel-sync-btn').addEventListener('click', cancelConfirmDialog);
  document.getElementById('cs-confirm-sync-btn').addEventListener('click', confirmSync);
  document.getElementById('cs-download-json-btn').addEventListener('click', downloadReportJson);
  document.getElementById('cs-download-csv-btn').addEventListener('click', downloadCorrespondenceCsv);
  document.getElementById('cs-reset-btn').addEventListener('click', resetPage);
}

if (typeof document !== 'undefined' && document.getElementById('cs-file-input')) {
  wireEvents();
  initAuthGate();
  applyUiState('no-file');
  const demoBanner = document.getElementById('cs-demo-banner');
  if (demoBanner) demoBanner.style.display = isDemoBackend ? 'block' : 'none';
}
