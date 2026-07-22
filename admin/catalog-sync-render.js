// ===================== RENDU DOM — Synchronisation du catalogue (Sprint 21, phase 3) =====================
// Fonctions qui MANIPULENT le DOM mais n'importent AUCUN service Firebase
// - separees de catalog-sync.js uniquement pour permettre des tests reels
// (jsdom) du rendu complet sans avoir a simuler l'authentification. Ne
// contient aucune regle metier (voir catalog-sync-engine.js) ni aucun
// appel reseau/Firestore.

import {
  filterQuestionRows, filterLabelRows, computeDisplayDiff, applyUiState, escapeHtml, truncate,
} from "./catalog-sync-helpers.js";
import { icon } from "../js/icons.js";

export function setText(doc, id, value) {
  const el = doc.getElementById(id);
  if (el) el.textContent = String(value);
}

export function renderErrorList(doc, listId, errors) {
  const list = doc.getElementById(listId);
  if (!list) return;
  list.innerHTML = errors.map(function(e) { return '<li>' + escapeHtml((e.rowRef ? e.rowRef + ' — ' : '') + e.message) + '</li>'; }).join('');
}

export function renderSummary(doc, a, warningCount) {
  setText(doc, 'cs-stat-lines', a.counts.totalQuestions + warningCount);
  setText(doc, 'cs-stat-valid', a.counts.totalQuestions);
  setText(doc, 'cs-stat-errors', 0);
  setText(doc, 'cs-stat-warnings', warningCount);

  setText(doc, 'cs-stat-create', a.counts.toCreate);
  setText(doc, 'cs-stat-update', a.counts.toUpdate);
  setText(doc, 'cs-stat-unchanged', a.counts.unchanged);
  setText(doc, 'cs-stat-archived', a.counts.archivedCandidates);

  setText(doc, 'cs-stat-comp-new', a.counts.competenciesToCreate);
  setText(doc, 'cs-stat-comp-reused', a.counts.competenciesReused);
  const dupeCount = a.competencyPlan.filter(function(c) { return c.action === 'new' && c.potentialDuplicates && c.potentialDuplicates.length > 0; }).length;
  setText(doc, 'cs-stat-comp-dupes', dupeCount);

  setText(doc, 'cs-stat-tag-new', a.counts.tagsToCreate);
  setText(doc, 'cs-stat-tag-reused', a.counts.tagsReused);

  setText(doc, 'cs-stat-src-new', a.counts.sourcesToCreate);
  setText(doc, 'cs-stat-src-reused', a.counts.sourcesReused);
  setText(doc, 'cs-stat-sec-new', a.counts.sectionsToCreate);
  setText(doc, 'cs-stat-sec-reused', a.counts.sectionsReused);
}

export function renderDetailFilters(doc, a) {
  const sourceSelect = doc.getElementById('cs-detail-source-filter');
  const sourceNames = Array.from(new Set(a.questionActions.map(function(qa) { return qa.sourceDocument && qa.sourceDocument.name; }).filter(Boolean))).sort();
  sourceSelect.innerHTML = '<option value="">Toutes les sources documentaires</option>' +
    sourceNames.map(function(n) { return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; }).join('');
}

function renderQuestionTable(rows, tab, backend) {
  if (rows.length === 0) return '<p class="cs-history-empty">Aucune question dans cette catégorie.</p>';
  const showDiff = tab === 'update';
  let html = '<table class="cs-detail-table"><thead><tr>' +
    '<th>ID éditorial</th><th>pedagogicalId</th><th>Question</th><th>Source</th><th>Compétence</th>' +
    (showDiff ? '<th>Champs modifiés</th>' : '') + '</tr></thead><tbody>';
  rows.forEach(function(r) {
    html += '<tr>' +
      '<td>' + escapeHtml(r.externalId) + '</td>' +
      '<td>' + escapeHtml(r.pedagogicalId || '(à générer)') + '</td>' +
      '<td>' + escapeHtml(truncate(r.resolved.question, 90)) + '</td>' +
      '<td>' + escapeHtml((r.sourceDocument && r.sourceDocument.name) || '—') + '</td>' +
      '<td>' + escapeHtml(r.primaryCompetencyLabel || '—') + '</td>';
    if (showDiff) {
      const identity = backend && backend.externalIdIndex.has(r.externalId) ? backend.questions.get(backend.externalIdIndex.get(r.externalId)) : null;
      const diffs = computeDisplayDiff(r.resolved, identity);
      html += '<td>' + (diffs.length ? diffs.map(function(d) {
        return '<div><strong>' + escapeHtml(d.field) + '</strong> : <span class="cs-diff-old">' + escapeHtml(truncate(String(d.oldValue || ''), 40)) + '</span> → <span class="cs-diff-new">' + escapeHtml(truncate(String(d.newValue || ''), 40)) + '</span></div>';
      }).join('') : '—') + '</td>';
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function renderLabelTable(rows, showDuplicates) {
  if (rows.length === 0) return '<p class="cs-history-empty">Aucun élément dans cette catégorie.</p>';
  let html = '<table class="cs-detail-table"><thead><tr><th>Libellé</th>' + (showDuplicates ? '<th>Doublons potentiels détectés</th>' : '') + '</tr></thead><tbody>';
  rows.forEach(function(r) {
    html += '<tr><td>' + escapeHtml(r.label) + '</td>';
    if (showDuplicates) {
      html += '<td>' + (r.potentialDuplicates || []).map(function(d) { return '<span class="cs-dupe-pill">' + escapeHtml(d.label) + ' (' + Math.round(d.similarity * 100) + '%)</span>'; }).join(' ') + '</td>';
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

const QUESTION_TABS = { create: 'create', update: 'update', unchanged: 'unchanged' };

/** @param {object} currentAnalysis - resultat de engine.analyze() @param {string} tab @param {object} filters @param {object} backend */
export function renderDetailTab(doc, currentAnalysis, tab, filters, backend) {
  if (!currentAnalysis || !currentAnalysis.success) return;
  const a = currentAnalysis.analysis;
  const body = doc.getElementById('cs-detail-body');

  if (QUESTION_TABS[tab]) {
    const rows = filterQuestionRows(a.questionActions.filter(function(qa) { return qa.action === tab; }), filters);
    body.innerHTML = renderQuestionTable(rows, tab, backend);
    return;
  }
  if (tab === 'archived') {
    const search = (filters.search || '').toLowerCase();
    const rows = a.archivedCandidates.filter(function(id) { return !search || id.toLowerCase().indexOf(search) !== -1; });
    body.innerHTML = '<table class="cs-detail-table"><thead><tr><th>Identifiant éditorial</th><th>Note</th></tr></thead><tbody>' +
      rows.map(function(id) { return '<tr><td>' + escapeHtml(id) + '</td><td>Présente dans Pharmeval, absente de ce catalogue — non modifiée.</td></tr>'; }).join('') +
      '</tbody></table>' + (rows.length === 0 ? '<p class="cs-history-empty">Aucune question dans cette catégorie.</p>' : '');
    return;
  }
  if (tab === 'errors') {
    const errors = (currentAnalysis.fatalErrors || []).concat(currentAnalysis.validationErrors || []);
    body.innerHTML = errors.length ? '<ul class="import-errors-list">' + errors.map(function(e) { return '<li>' + escapeHtml(e.message) + '</li>'; }).join('') + '</ul>' : '<p class="cs-history-empty">Aucune erreur.</p>';
    return;
  }
  if (tab === 'warnings') {
    const warnings = currentAnalysis.rowErrors || [];
    body.innerHTML = warnings.length ? '<ul class="import-errors-list cs-warnings-list">' + warnings.map(function(w) { return '<li>' + escapeHtml((w.rowRef ? w.rowRef + ' — ' : '') + w.message) + '</li>'; }).join('') + '</ul>' : '<p class="cs-history-empty">Aucun avertissement.</p>';
    return;
  }
  if (tab === 'newCompetencies') {
    body.innerHTML = renderLabelTable(filterLabelRows(a.competencyPlan.filter(function(c) { return c.action === 'new'; }), filters.search), false);
    return;
  }
  if (tab === 'dupeCompetencies') {
    body.innerHTML = renderLabelTable(filterLabelRows(a.competencyPlan.filter(function(c) { return c.action === 'new' && c.potentialDuplicates && c.potentialDuplicates.length > 0; }), filters.search), true);
    return;
  }
  if (tab === 'newTags') {
    body.innerHTML = renderLabelTable(filterLabelRows(a.tagPlan.filter(function(t) { return t.action === 'new'; }), filters.search), false);
    return;
  }
}

/** Assemble le rendu complet apres une analyse (succes ou blocage). */
export function renderAnalysisResult(doc, analysis, currentTab, backend) {
  if (!analysis.success) {
    const errors = (analysis.fatalErrors || [])
      .concat((analysis.validationErrors || []).map(function(e) { return { message: e.message }; }));
    renderErrorList(doc, 'cs-errors-list', errors);
    renderErrorList(doc, 'cs-warnings-list', analysis.rowErrors || []);
    doc.getElementById('cs-warnings-card').style.display = (analysis.rowErrors || []).length > 0 ? 'block' : 'none';
    applyUiState('analysis-blocked', doc);
    return;
  }

  const warnings = analysis.rowErrors || [];
  renderErrorList(doc, 'cs-warnings-list', warnings);
  renderSummary(doc, analysis.analysis, warnings.length);
  renderDetailFilters(doc, analysis.analysis);
  renderDetailTab(doc, analysis, currentTab, { search: '', sourceName: '' }, backend);

  const syncBtn = doc.getElementById('cs-open-confirm-btn');
  if (syncBtn) syncBtn.disabled = false;
  doc.getElementById('cs-stale-notice').style.display = 'none';

  applyUiState(warnings.length > 0 ? 'analysis-success-warnings' : 'analysis-success', doc);
}

/** Construit le HTML du rapport de synchronisation (succes/partiel/echec). */
export function renderSyncReportBody(doc, syncResult, status, meta) {
  const title = doc.getElementById('cs-report-title');
  const body = doc.getElementById('cs-report-body');
  // CORRECTIF (bibliotheque d'icones, remplace les emojis) : icon() rend du
  // HTML (balise <svg>) - title.innerHTML desormais, plus .textContent (qui
  // aurait affiche le SVG comme du texte brut). STATUS_LABELS reste 100%
  // interne (jamais alimente par une entree utilisateur), aucun risque XSS.
  const STATUS_LABELS = {
    success: icon('action-confirm-validate-publish', { size: 16 }) + ' Synchronisation réussie',
    partial: icon('action-warning', { size: 16 }) + ' Synchronisation partiellement réussie',
    failure: icon('action-error', { size: 16 }) + ' Échec de la synchronisation',
  };
  if (title) title.innerHTML = '6. Rapport de synchronisation — ' + STATUS_LABELS[status];

  if (status === 'failure') {
    body.innerHTML = '<p class="import-report-error">Aucune écriture n\'a pu être confirmée pour ce lot. Le journal des imports conserve la trace de cette tentative' + (meta.logSucceeded ? '' : ' (échec de journalisation également, voir la console)') + '.</p>' +
      '<div class="btn-row"><button class="btn-secondary" id="cs-retry-btn">Relancer une analyse</button></div>';
    applyUiState('sync-failed', doc);
    return;
  }

  const r = syncResult.report;
  function stat(value, label) { return '<div class="import-preview-stat"><span>' + value + '</span><label>' + escapeHtml(label) + '</label></div>'; }
  body.innerHTML =
    '<p class="import-report-summary">' + meta.dateLabel + ' — fichier « ' + escapeHtml(meta.fileName) + ' » — schéma 1.1</p>' +
    '<div class="import-preview-grid">' +
      stat(r.questionsCreated, 'créées') + stat(r.questionsUpdated, 'modifiées') + stat(r.questionsUnchanged, 'inchangées') +
      stat(r.competenciesCreated, 'compétences créées') + stat(r.tagsCreated, 'tags créés') +
      stat(r.sourcesCreated, 'sources créées') + stat(r.sectionsCreated, 'sections créées') +
    '</div>' +
    '<p class="import-report-duration">Durée mesurée : ' + (meta.durationMs / 1000).toFixed(1) + ' s' + (meta.logSucceeded ? '' : ' — la journalisation de cet import a échoué (voir la console), la synchronisation elle-même a réussi.') + '</p>' +
    (meta.isDemoBackend ? '<p class="import-report-warning">Cette synchronisation a été exécutée sur le backend de démonstration — aucune écriture Firestore réelle n\'a eu lieu.</p>' : '') +
    '<h4>Correspondance identifiant éditorial ↔ identifiant pédagogique</h4>' +
    '<table class="cs-detail-table"><thead><tr><th>ID éditorial</th><th>pedagogicalId</th><th>Action</th></tr></thead><tbody>' +
    r.idCorrespondence.slice(0, 100).map(function(c) { return '<tr><td>' + escapeHtml(c.editorialId) + '</td><td>' + escapeHtml(c.pedagogicalId) + '</td><td>' + escapeHtml(c.action) + '</td></tr>'; }).join('') +
    '</tbody></table>' +
    (r.idCorrespondence.length > 100 ? '<p class="cs-history-empty">… et ' + (r.idCorrespondence.length - 100) + ' de plus (téléchargez le CSV pour la liste complète).</p>' : '');

  applyUiState('sync-success', doc);
}

export function renderHistory(doc, items) {
  const table = doc.getElementById('cs-history-table');
  const empty = doc.getElementById('cs-history-empty');
  const body = doc.getElementById('cs-history-body');

  if (items.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  table.style.display = 'table';
  body.innerHTML = items.map(function(entry) {
    const statusLabel = entry.errorCount > 0 ? icon('action-error', { size: 14 }) + ' Échec' : (entry.simulated ? icon('admin-test-simulation', { size: 14 }) + ' Simulation' : icon('action-confirm-validate-publish', { size: 14 }) + ' Réussi');
    return '<tr>' +
      '<td>' + escapeHtml(new Date(entry.date).toLocaleString('fr-BE')) + '</td>' +
      '<td>' + escapeHtml(entry.fileName) + '</td>' +
      '<td>' + statusLabel + '</td>' +
      '<td>' + entry.createdCount + '</td>' +
      '<td>' + entry.updatedCount + '</td>' +
      '<td>' + entry.errorCount + '</td>' +
      '<td>' + escapeHtml(entry.adminEmail || '—') + '</td>' +
      '</tr>';
  }).join('');
}
