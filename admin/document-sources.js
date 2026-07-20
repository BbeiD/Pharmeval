// ===================== CONTROLEUR DES SOURCES DOCUMENTAIRES (Sprint 20) =====================
// Aucune logique metier ici : appelle document-source-service.js /
// document-section-service.js / question-migration-service.js et affiche
// le resultat - meme discipline que tous les autres ecrans
// d'administration du projet.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatDateFr } from "../js/services/date-utils.js";
import {
  DOCUMENT_SOURCE_TYPE_LABELS, DOCUMENT_SOURCE_STATUSES,
} from "../js/services/document-source-metadata-service.js";
import {
  browseDocumentSources, createDocumentSource, changeDocumentSourceStatus,
} from "../js/services/document-source-service.js";
import {
  getSectionTree, createDocumentSection, archiveDocumentSection,
} from "../js/services/document-section-service.js";
import { previewMigrationBatch, prepareMigration, applyMigration } from "../js/services/question-migration-service.js";
import { classifyQuestion, getQuestionForClassification } from "../js/services/question-classification-service.js";
import { rebuildSourceCounts, rebuildSectionCounts, applyReconciliation, reconcileAllDocumentCounts } from "../js/services/document-count-service.js";
import { analyzeLegacyCatalogData, stripLegacyOrganizationField, stripLegacyOrganizationFieldBulk } from "../js/services/document-catalog-migration-service.js";

const STATUS_BADGES = {
  draft: { emoji: '🟡', label: 'Brouillon', cls: 'bank-badge-draft' },
  active: { emoji: '🟢', label: 'Actif', cls: 'bank-badge-published' },
  archived: { emoji: '⚫', label: 'Archivé', cls: 'bank-badge-archived' },
};

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function qs(id) { return document.getElementById(id); }
function valueOf(id) { const el = qs(id); return el ? el.value.trim() : ''; }
function showMessage(status, message) {
  const el = qs('ds-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

let state = {
  activeTab: 'sources',
  sourceItems: [], selectedSourceId: null, sectionItems: [],
  migrationMatches: [], migrationFilters: null, pendingMigration: null,
};
let pendingAction = null;

// ---------------------------------------------------------------------------
// Controle d'acces
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async function(user) {
  const loadingEl = qs('ds-loading');
  const deniedEl = qs('ds-denied');
  const viewEl = qs('ds-view');

  if (!user) { clearCurrentUserContext(); window.location.href = '../index.html'; return; }
  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) { console.error('Erreur lors de la vérification du compte :', err); }

  if (loadingEl) loadingEl.style.display = 'none';
  if (!hasPermission(PERMISSIONS.MANAGE_GLOBAL_CATALOG)) {
    if (deniedEl) deniedEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    return;
  }
  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';

  await loadSources();
});

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------

export function switchTab(tab) {
  state.activeTab = tab;
  ['sources', 'migration', 'unclassified'].forEach(function(t) {
    qs('ds-panel-' + t).style.display = (t === tab) ? 'block' : 'none';
    qs('ds-tab-' + t).classList.toggle('bank-row-selected', t === tab);
  });
  if (tab === 'unclassified') loadUnclassifiedCount();
}

/**
 * CORRECTIF (Sprint 20.2) : réconciliation du catalogue GLOBAL entier
 * (remplace l'ancienne vérification "par organisation" - il n'y a plus
 * qu'un seul catalogue à vérifier, jamais un par organisation).
 */
export async function checkAllOrgCounts() {
  const container = qs('ds-org-reconcile-report');
  container.innerHTML = '<div class="bank-list-loading">Calcul en cours pour toutes les sources du catalogue (peut prendre un moment)…</div>';
  const result = await reconcileAllDocumentCounts();

  const rows = result.items.map(function(entry) {
    const inconsistentSections = entry.sectionCounts.items.filter(function(i) { return i.diffDirect !== 0 || i.diffTotal !== 0; });
    const ok = entry.sourceCounts.diff === 0 && inconsistentSections.length === 0;
    return '<li>' + (ok ? '✅' : '⚠️') + ' ' + escapeHtml(entry.source.name) + ' — écart source : ' + (entry.sourceCounts.diff > 0 ? '+' : '') + entry.sourceCounts.diff + ', sections incohérentes : ' + inconsistentSections.length +
      ' <button class="btn-secondary" onclick="selectSource(\'' + escapeHtml(entry.source.id) + '\')">Ouvrir →</button></li>';
  });
  container.innerHTML = '<div class="bank-detail-card"><h4>Résultat pour ' + result.items.length + ' source(s)</h4><ul>' + rows.join('') + '</ul>' +
    '<p class="admin-users-disclaimer">Ouvrez une source pour appliquer sa correction individuellement.</p></div>';
}

/**
 * CORRECTIF (Sprint 20.2) : "Prévoir une migration propre" pour les
 * données existantes - détecte les sources portant encore un ancien
 * `organizationId` (résidu Sprint 20) et les doublons potentiels
 * (créés séparément par organisation avant ce correctif). Ne fusionne
 * JAMAIS automatiquement - rapport uniquement, décision manuelle.
 */
export async function analyzeLegacyData() {
  const container = qs('ds-legacy-report');
  container.innerHTML = '<div class="bank-list-loading">Analyse du catalogue en cours…</div>';

  const result = await analyzeLegacyCatalogData();
  if (!result.authorized) { container.innerHTML = '<p class="admin-message admin-message-denied">' + escapeHtml(result.message) + '</p>'; return; }

  let html = '<div class="bank-detail-card"><h4>Rapport (sur ' + result.totalScanned + ' source(s) analysée(s)' + (result.truncated ? ', balayage limité' : '') + ')</h4>';

  html += '<h5>Sources avec un ancien champ « organisation » résiduel</h5>';
  if (result.legacyOrgFieldSources.length === 0) {
    html += '<p>✅ Aucune — le catalogue est déjà entièrement global.</p>';
  } else {
    html += '<ul>' + result.legacyOrgFieldSources.map(function(s) {
      return '<li>' + escapeHtml(s.name) + ' (' + escapeHtml(s.id) + ') <button class="btn-secondary" onclick="cleanupOneLegacySource(\'' + escapeHtml(s.id) + '\')">Nettoyer</button></li>';
    }).join('') + '</ul>';
    html += '<div class="btn-row"><button class="btn-primary" onclick="cleanupAllLegacySources()">Nettoyer toutes ces sources (' + result.legacyOrgFieldSources.length + ')</button></div>';
  }

  html += '<h5 style="margin-top:14px;">Doublons potentiels (même type + code court + version)</h5>';
  if (result.duplicateGroups.length === 0) {
    html += '<p>✅ Aucun doublon détecté.</p>';
  } else {
    html += '<p class="import-report-error">⚠️ ' + result.duplicateGroups.length + ' groupe(s) détecté(s) — décision manuelle requise, jamais fusionné automatiquement.</p>';
    html += '<ul>' + result.duplicateGroups.map(function(g) {
      return '<li>' + escapeHtml(g.key) + ' — ' + g.sources.length + ' sources : ' + g.sources.map(function(s) { return escapeHtml(s.id); }).join(', ') + '</li>';
    }).join('') + '</ul>';
  }

  html += '</div>';
  container.innerHTML = html;
}

export async function cleanupOneLegacySource(sourceId) {
  const result = await stripLegacyOrganizationField(sourceId);
  showMessage(result.status, result.message);
  if (result.status === 'success') await analyzeLegacyData();
}

export async function cleanupAllLegacySources() {
  const result = await analyzeLegacyCatalogData();
  if (!result.authorized || result.legacyOrgFieldSources.length === 0) return;
  const ids = result.legacyOrgFieldSources.map(function(s) { return s.id; });
  const cleanup = await stripLegacyOrganizationFieldBulk(ids);
  showMessage(cleanup.failedIds.length === 0 ? 'success' : 'denied', cleanup.succeededCount + ' source(s) nettoyée(s)' + (cleanup.failedIds.length ? ', ' + cleanup.failedIds.length + ' échec(s)' : '') + '.');
  await analyzeLegacyData();
}

// ---------------------------------------------------------------------------
// Onglet Sources
// ---------------------------------------------------------------------------

export async function onSourcesFilterChange() { await loadSources(); }

async function loadSources() {
  const listEl = qs('ds-list');
  const emptyEl = qs('ds-list-empty');
  listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  const result = await browseDocumentSources({
    sourceType: qs('ds-filter-type').value || undefined,
    status: qs('ds-filter-status').value || undefined,
  });
  if (!result.authorized) { showMessage('denied', result.message); return; }
  if (result.error) { listEl.innerHTML = ''; emptyEl.style.display = 'block'; emptyEl.textContent = result.message; return; }

  state.sourceItems = result.items;
  if (result.items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'Aucune source documentaire ne correspond à ces critères.';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = result.items.map(sourceRowHtml).join('');
}

function sourceRowHtml(s) {
  const badge = STATUS_BADGES[s.status] || STATUS_BADGES.draft;
  const selected = s.id === state.selectedSourceId ? ' bank-row-selected' : '';
  return (
    '<div class="bank-row' + selected + '" onclick="selectSource(\'' + escapeHtml(s.id) + '\')">' +
      '<div class="bank-row-top">' +
        '<span class="bank-row-id">' + escapeHtml(s.name) + '</span>' +
        '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>' +
      '</div>' +
      '<div class="bank-row-question">' + escapeHtml(DOCUMENT_SOURCE_TYPE_LABELS[s.sourceType] || s.sourceType) + (s.version ? ' · v' + escapeHtml(s.version) : '') + '</div>' +
      '<div class="bank-row-meta">' + s.questionCount + ' question(s) · ' + s.sectionCount + ' section(s)</div>' +
    '</div>'
  );
}

export function openCreateSourceForm() {
  ['ds-create-name', 'ds-create-shortcode', 'ds-create-orgname', 'ds-create-version', 'ds-create-academicyear', 'ds-create-description'].forEach(function(id) { qs(id).value = ''; });
  qs('ds-create-card').style.display = 'block';
}
export function closeCreateSourceForm() { qs('ds-create-card').style.display = 'none'; }

export async function submitCreateSource() {
  const fields = {
    sourceType: qs('ds-create-type').value,
    name: valueOf('ds-create-name'),
    shortCode: valueOf('ds-create-shortcode'),
    sourceOrganizationName: valueOf('ds-create-orgname'),
    version: valueOf('ds-create-version'),
    academicYear: valueOf('ds-create-academicyear'),
    description: valueOf('ds-create-description'),
  };
  const result = await createDocumentSource(fields);
  showMessage(result.status, result.message + (result.warnings && result.warnings.length ? ' (' + result.warnings.join(' ') + ')' : ''));
  if (result.status === 'success') {
    closeCreateSourceForm();
    await loadSources();
  }
}

export async function selectSource(sourceId) {
  state.selectedSourceId = sourceId;
  loadSources();
  const source = state.sourceItems.find(function(s) { return s.id === sourceId; });
  if (!source) return;

  qs('ds-detail-placeholder').style.display = 'none';
  const detailEl = qs('ds-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  const treeResult = await getSectionTree(sourceId);
  state.sectionItems = treeResult.items || [];
  detailEl.innerHTML = sourceDetailHtml(source, state.sectionItems);
}

function sourceDetailHtml(s, sections) {
  const badge = STATUS_BADGES[s.status] || STATUS_BADGES.draft;
  let html = '<div class="bank-detail-card">';
  html += '<div class="bank-detail-header"><h3>' + escapeHtml(s.name) + '</h3><span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span></div>';
  html += '<div class="bank-detail-tags-row"><span class="bank-chip">' + escapeHtml(DOCUMENT_SOURCE_TYPE_LABELS[s.sourceType] || s.sourceType) + '</span>';
  if (s.version) html += '<span class="bank-chip">Version ' + escapeHtml(s.version) + '</span>';
  if (s.academicYear) html += '<span class="bank-chip">' + escapeHtml(s.academicYear) + '</span>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Informations</h4>';
  html += '<div class="bank-detail-row"><strong>Organisme auteur/éditeur :</strong> ' + escapeHtml(s.sourceOrganizationName || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Description :</strong> ' + escapeHtml(s.description || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Questions rattachées :</strong> ' + s.questionCount + '</div>';
  html += '<div class="bank-detail-row"><strong>Sections :</strong> ' + s.sectionCount + '</div>';
  html += '<div class="bank-detail-row"><strong>Créé le :</strong> ' + escapeHtml(s.createdAt ? formatDateFr(s.createdAt) : '—') + '</div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Actions</h4><div class="bank-actions-row">';
  if (s.status !== DOCUMENT_SOURCE_STATUSES.ACTIVE) html += '<button class="btn-primary" onclick="requestSourceStatus(\'active\')">Activer</button>';
  if (s.status !== DOCUMENT_SOURCE_STATUSES.ARCHIVED) html += '<button class="btn-secondary bank-trash-btn" onclick="requestSourceStatus(\'archived\')">Archiver</button>';
  if (s.status === DOCUMENT_SOURCE_STATUSES.ARCHIVED) html += '<button class="btn-secondary" onclick="requestSourceStatus(\'active\')">Réactiver</button>';
  html += '<button class="btn-secondary" onclick="checkSourceCounts(\'' + escapeHtml(s.id) + '\')">🔍 Vérifier les compteurs</button>';
  html += '</div>';
  html += '<div id="ds-reconcile-report" style="margin-top:10px;"></div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Arborescence des sections</h4>';
  html += '<div class="btn-row"><button class="btn-secondary" onclick="openCreateSectionForm(null)">+ Section racine</button></div>';
  html += '<div id="ds-section-tree" style="margin-top:10px;">' + renderSectionTree(sections) + '</div>';
  html += '<div id="ds-section-form" style="display:none;margin-top:12px;" class="bank-detail-card">';
  html += '<label class="bank-edit-label">Nom de la section</label><input type="text" id="ds-section-name" class="bank-select">';
  html += '<label class="bank-edit-label">Code court (optionnel)</label><input type="text" id="ds-section-shortcode" class="bank-select">';
  html += '<div class="btn-row"><button class="btn-secondary" onclick="closeCreateSectionForm()">Annuler</button><button class="btn-primary" onclick="submitCreateSection()">Créer</button></div>';
  html += '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}

function renderSectionTree(sections) {
  if (sections.length === 0) return '<p class="bank-list-empty">Aucune section pour l\'instant.</p>';
  return '<div class="parcours-competency-list">' + sections.map(function(sec) {
    const indent = 16 * sec.level;
    const badge = sec.status === 'archived' ? '<span class="bank-chip">Archivée</span>' : '';
    return (
      '<div class="parcours-competency-card" style="margin-left:' + indent + 'px;">' +
        '<div class="parcours-competency-header">' +
          '<strong>' + escapeHtml(sec.name) + '</strong>' + badge +
          '<span class="bank-chip">' + sec.directQuestionCount + ' direct(es) · ' + sec.totalQuestionCount + ' au total</span>' +
          '<div class="parcours-competency-actions">' +
            '<button class="btn-secondary" onclick="openCreateSectionForm(\'' + escapeHtml(sec.id) + '\')">+ Sous-section</button>' +
            (sec.status !== 'archived' ? '<button class="btn-secondary bank-delete-btn" onclick="requestArchiveSection(\'' + escapeHtml(sec.id) + '\')">Archiver</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('') + '</div>';
}

let pendingSectionParentId = null;
export function openCreateSectionForm(parentSectionId) {
  pendingSectionParentId = parentSectionId;
  qs('ds-section-name').value = '';
  qs('ds-section-shortcode').value = '';
  qs('ds-section-form').style.display = 'block';
}
export function closeCreateSectionForm() { qs('ds-section-form').style.display = 'none'; }

export async function submitCreateSection() {
  const result = await createDocumentSection({
    documentSourceId: state.selectedSourceId,
    parentSectionId: pendingSectionParentId,
    name: valueOf('ds-section-name'),
    shortCode: valueOf('ds-section-shortcode'),
  });
  showMessage(result.status, result.message);
  if (result.status === 'success') {
    closeCreateSectionForm();
    await selectSource(state.selectedSourceId);
  }
}

export function requestArchiveSection(sectionId) {
  pendingAction = { kind: 'archive_section', sectionId: sectionId };
  qs('ds-confirm-message').textContent = 'Archiver cette section ? Les questions déjà rattachées le resteront.';
  qs('ds-confirm-overlay').style.display = 'flex';
}
export function requestSourceStatus(newStatus) {
  pendingAction = { kind: 'source_status', newStatus: newStatus };
  qs('ds-confirm-message').textContent = 'Confirmer ce changement de statut ?';
  qs('ds-confirm-overlay').style.display = 'flex';
}
export function cancelDsAction() { pendingAction = null; qs('ds-confirm-overlay').style.display = 'none'; }
export async function confirmDsAction() {
  if (!pendingAction) return;
  const action = pendingAction; pendingAction = null;
  qs('ds-confirm-overlay').style.display = 'none';

  if (action.kind === 'archive_section') {
    const section = state.sectionItems.find(function(s) { return s.id === action.sectionId; });
    const result = await archiveDocumentSection(section);
    showMessage(result.status, result.message);
    if (result.status === 'success') await selectSource(state.selectedSourceId);
    return;
  }
  if (action.kind === 'source_status') {
    const source = state.sourceItems.find(function(s) { return s.id === state.selectedSourceId; });
    const result = await changeDocumentSourceStatus(source, action.newStatus);
    showMessage(result.status, result.message);
    if (result.status === 'success') await selectSource(state.selectedSourceId);
    return;
  }
  if (action.kind === 'reconcile') {
    if (!pendingReconciliation) return;
    const result = await applyReconciliation(pendingReconciliation.sourceId, pendingReconciliation);
    showMessage(result.status, result.message);
    pendingReconciliation = null;
    if (result.status === 'success') await selectSource(state.selectedSourceId);
    return;
  }
}

// ---------------------------------------------------------------------------
// Rattachement individuel d'une question
// ---------------------------------------------------------------------------

let singleQuestion = null;

export async function loadSingleQuestion() {
  const pedagogicalId = valueOf('single-pedagogical-id');
  const infoEl = qs('single-question-info');
  const actionsEl = qs('single-question-actions');
  if (!pedagogicalId) { infoEl.textContent = 'Saisissez un identifiant.'; return; }

  infoEl.textContent = 'Chargement…';
  actionsEl.style.display = 'none';
  singleQuestion = await getQuestionForClassification(pedagogicalId);
  if (!singleQuestion) {
    infoEl.textContent = 'Aucune question trouvée pour cet identifiant.';
    return;
  }
  infoEl.innerHTML =
    '<div class="bank-row"><div class="bank-row-top"><span class="bank-row-id">' + escapeHtml(singleQuestion.pedagogicalId) + '</span></div>' +
    '<div class="bank-row-question">' + escapeHtml((singleQuestion.question || '').slice(0, 120)) + '</div>' +
    '<div class="bank-row-meta">Classification actuelle : ' + (singleQuestion.documentSourceId ? escapeHtml(singleQuestion.documentSourceId) + (singleQuestion.documentSectionId ? ' › ' + escapeHtml(singleQuestion.documentSectionId) : '') : 'Non classée') + '</div></div>';
  actionsEl.style.display = 'block';
  await populateGlobalSourceSelect('single-dest-source');
}

/**
 * CORRECTIF (Sprint 20.2) : remplace l'ancienne cascade organisation →
 * source par un chargement DIRECT des sources globales actives - le
 * catalogue documentaire n'a plus de notion d'organisation.
 * @param {string} selectId
 */
async function populateGlobalSourceSelect(selectId) {
  const sourceSelect = qs(selectId);
  const result = await browseDocumentSources({ status: 'active' });
  const items = (result && result.items) || [];
  sourceSelect.innerHTML = '<option value="">— Aucune destination —</option>' + items.map(function(s) {
    return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + ' (' + escapeHtml(DOCUMENT_SOURCE_TYPE_LABELS[s.sourceType] || s.sourceType) + ')</option>';
  }).join('');
}

export async function onSingleDestSourceChange() {
  const sourceId = qs('single-dest-source').value;
  const sectionSelect = qs('single-dest-section');
  if (!sourceId) { sectionSelect.innerHTML = '<option value="">—</option>'; sectionSelect.disabled = true; return; }
  const result = await getSectionTree(sourceId);
  const items = (result && result.items) || [];
  sectionSelect.innerHTML = '<option value="">— Rattacher directement à la source —</option>' + items.filter(function(s) { return s.status !== 'archived'; }).map(function(s) {
    return '<option value="' + escapeHtml(s.id) + '">' + '— '.repeat(s.level) + escapeHtml(s.name) + '</option>';
  }).join('');
  sectionSelect.disabled = false;
}
export async function attachSingleQuestion() {
  if (!singleQuestion) return;
  const sourceId = qs('single-dest-source').value;
  if (!sourceId) { showMessage('error', 'Choisissez une source de destination.'); return; }
  const result = await classifyQuestion(singleQuestion, {
    documentSourceId: sourceId,
    documentSectionId: qs('single-dest-section').value || null,
    generateCode: qs('single-gencode').checked,
  });
  showMessage(result.status, result.message + (result.functionalCode ? ' Identifiant fonctionnel : ' + result.functionalCode + '.' : ''));
  if (result.status === 'success') await loadSingleQuestion();
}

let pendingReconciliation = null;

/**
 * CORRECTIF : "Vérifier les compteurs" — recalcule les compteurs RÉELS
 * d'une source (et de toutes ses sections) à partir des questions
 * effectivement classifiées, sans rien modifier, et affiche les écarts.
 */
export async function checkSourceCounts(sourceId) {
  const container = qs('ds-reconcile-report');
  container.innerHTML = '<div class="bank-list-loading">Calcul en cours (peut prendre quelques secondes)…</div>';

  const [sourceCounts, sectionCounts] = await Promise.all([rebuildSourceCounts(sourceId), rebuildSectionCounts(sourceId)]);
  pendingReconciliation = { sourceId: sourceId, sourceCounts: sourceCounts, sectionCounts: sectionCounts };

  const inconsistentSections = sectionCounts.items.filter(function(i) { return i.diffDirect !== 0 || i.diffTotal !== 0; });

  let html = '<div class="bank-detail-card">';
  html += '<div class="bank-detail-row"><strong>Compteur stocké (source) :</strong> ' + sourceCounts.storedCount + '</div>';
  html += '<div class="bank-detail-row"><strong>Compteur réel (source) :</strong> ' + sourceCounts.actualCount + '</div>';
  html += '<div class="bank-detail-row"><strong>Écart :</strong> ' + (sourceCounts.diff > 0 ? '+' : '') + sourceCounts.diff + '</div>';
  html += '<div class="bank-detail-row"><strong>Sections incohérentes :</strong> ' + inconsistentSections.length + ' / ' + sectionCounts.items.length + '</div>';
  if (sourceCounts.truncated || sectionCounts.truncated) {
    html += '<p class="admin-users-disclaimer">⚠️ Balayage limité — le volume de questions de cette source dépasse la limite de lecture d\'une réconciliation. Le résultat peut être incomplet.</p>';
  }
  if (sectionCounts.anomalies && sectionCounts.anomalies.length > 0) {
    html += '<p class="import-report-error">⚠️ ' + escapeHtml(sectionCounts.anomalies.join(' | ')) + '</p>';
  }
  if (inconsistentSections.length > 0) {
    html += '<ul>' + inconsistentSections.map(function(i) {
      return '<li>' + escapeHtml(i.name) + ' — direct : ' + i.storedDirect + ' → ' + i.actualDirect + ' ; total : ' + i.storedTotal + ' → ' + i.actualTotal + '</li>';
    }).join('') + '</ul>';
  }
  const hasAnyDiff = sourceCounts.diff !== 0 || inconsistentSections.length > 0;
  html += hasAnyDiff
    ? '<div class="btn-row"><button class="btn-primary" onclick="requestReconciliationConfirm()">Corriger les compteurs</button></div>'
    : '<p>✅ Aucun écart détecté — les compteurs sont cohérents.</p>';
  html += '</div>';
  container.innerHTML = html;
}

export function requestReconciliationConfirm() {
  pendingAction = { kind: 'reconcile' };
  qs('ds-confirm-message').textContent = 'Corriger les compteurs de cette source et de ses sections avec les valeurs réelles calculées ci-dessus ? Cette action est journalisée.';
  qs('ds-confirm-overlay').style.display = 'flex';
}

// ---------------------------------------------------------------------------
// Onglet Migration par lots
// ---------------------------------------------------------------------------

export async function previewMigration() {
  const filters = {
    theme: valueOf('mig-filter-theme') || undefined,
    subtheme: valueOf('mig-filter-subtheme') || undefined,
    difficulty: qs('mig-filter-difficulty').value || undefined,
    onlyUnclassified: qs('mig-filter-unclassified-only').checked,
  };
  const result = await previewMigrationBatch(filters);
  if (!result.authorized) { showMessage('denied', result.message); return; }
  if (result.error) { showMessage('error', result.message); return; }

  state.migrationMatches = result.items;
  state.migrationFilters = filters;

  qs('mig-preview-count').textContent = result.items.length + ' question(s) correspondent à ces critères.';
  const truncEl = qs('mig-preview-truncated');
  if (result.truncated) {
    truncEl.style.display = 'block';
    truncEl.textContent = '⚠️ Balayage limité : d\'autres questions correspondantes pourraient exister au-delà de la limite de lecture. Affinez les filtres si nécessaire.';
  } else {
    truncEl.style.display = 'none';
  }
  qs('mig-preview-card').style.display = 'block';
  qs('mig-delta-card').style.display = 'none';
  qs('mig-report-card').style.display = 'none';
  state.pendingMigration = null;
  await populateGlobalSourceSelect('mig-dest-source');
}

export async function onMigDestSourceChange() {
  const sourceId = qs('mig-dest-source').value;
  const sectionSelect = qs('mig-dest-section');
  if (!sourceId) { sectionSelect.innerHTML = '<option value="">—</option>'; sectionSelect.disabled = true; return; }
  const result = await getSectionTree(sourceId);
  const items = (result && result.items) || [];
  sectionSelect.innerHTML = '<option value="">— Rattacher directement à la source —</option>' + items.filter(function(s) { return s.status !== 'archived'; }).map(function(s) {
    return '<option value="' + escapeHtml(s.id) + '">' + '— '.repeat(s.level) + escapeHtml(s.name) + '</option>';
  }).join('');
  sectionSelect.disabled = false;
}

/**
 * CORRECTIF : étape "Préparer" — relit la classification réelle de
 * chaque question du lot et calcule le delta agrégé exact (par source,
 * section et ancêtre), affiché avant toute écriture. Rien n'est encore
 * appliqué à ce stade.
 */
export async function prepareMigrationStep() {
  const sourceId = qs('mig-dest-source').value;
  if (!sourceId) { showMessage('error', 'Choisissez une source de destination.'); return; }
  if (state.migrationMatches.length === 0) { showMessage('denied', 'Aucune question à migrer.'); return; }

  const destination = { documentSourceId: sourceId, documentSectionId: qs('mig-dest-section').value || null };
  const result = await prepareMigration(state.migrationMatches, destination, state.migrationFilters);
  if (result.status !== 'success') { showMessage(result.status, result.message); return; }

  state.pendingMigration = result;
  qs('mig-delta-card').style.display = 'block';
  qs('mig-delta-body').innerHTML = deltaPreviewHtml(result);
  qs('mig-report-card').style.display = 'none';
}

/**
 * Construit un résumé lisible du delta agrégé, dans l'esprit de
 * l'exemple du cadrage ("50 questions sélectionnées, 20 non classées,
 * 15 provenant de CBIP 2026 > IEC... Deltas prévus : ...").
 */
function deltaPreviewHtml(prepared) {
  let html = '<p>' + prepared.toApply.length + ' question(s) seront effectivement modifiées' +
    (prepared.alreadyInDestinationCount ? ' (' + prepared.alreadyInDestinationCount + ' déjà dans la destination, ignorée(s) — opération idempotente)' : '') + '.</p>';

  html += '<h4>Deltas de sources</h4><ul>';
  const sourceIds = Object.keys(prepared.aggregated.sourceDeltas);
  if (sourceIds.length === 0) html += '<li>Aucun changement de source (déplacement interne uniquement).</li>';
  sourceIds.forEach(function(id) {
    const d = prepared.aggregated.sourceDeltas[id];
    html += '<li>' + escapeHtml(id) + ' : ' + (d > 0 ? '+' : '') + d + '</li>';
  });
  html += '</ul>';

  html += '<h4>Deltas de sections (direct / total)</h4><ul>';
  const sectionIds = Object.keys(prepared.aggregated.sectionDeltas);
  if (sectionIds.length === 0) html += '<li>Aucune section affectée.</li>';
  sectionIds.forEach(function(id) {
    const d = prepared.aggregated.sectionDeltas[id];
    html += '<li>' + escapeHtml(id) + ' : direct ' + (d.direct > 0 ? '+' : '') + d.direct + ' / total ' + (d.total > 0 ? '+' : '') + d.total + '</li>';
  });
  html += '</ul>';

  if (prepared.ancestorAnomalies && prepared.ancestorAnomalies.length > 0) {
    html += '<p class="import-report-error">⚠️ Anomalies détectées dans l\'arborescence : ' + escapeHtml(prepared.ancestorAnomalies.join(' | ')) + ' — une réconciliation est recommandée après application.</p>';
  }

  return html;
}

/**
 * CORRECTIF : étape "Appliquer" + "Vérifier" + "Rapporter" — applique le
 * lot déjà préparé (jamais appelée directement sans passer par
 * prepareMigrationStep() au préalable).
 */
export async function confirmApplyMigration() {
  if (!state.pendingMigration) { showMessage('error', 'Aucun lot préparé.'); return; }
  const prepared = state.pendingMigration;

  const result = await applyMigration(prepared.jobId, prepared.toApply, prepared.destination, prepared.aggregated);

  qs('mig-report-card').style.display = 'block';
  qs('mig-report-body').innerHTML =
    '<p>' + escapeHtml(result.message) + '</p>' +
    '<ul><li>Identifiant du job : ' + escapeHtml(result.jobId || '—') + '</li>' +
    '<li>Réussites : ' + (result.succeededCount || 0) + '</li>' +
    (result.failedCount ? '<li>Échecs : ' + result.failedCount + ' (' + escapeHtml((result.failedIds || []).join(', ')) + ')</li>' : '') +
    (result.inconsistencies && result.inconsistencies.length ? '<li class="import-report-error">⚠️ ' + result.inconsistencies.length + ' incohérence(s) de compteur détectée(s) et corrigée(s) — lancez une réconciliation pour vérifier.</li>' : '') +
    '</ul>';
  showMessage(result.status === 'success' ? 'success' : (result.status === 'partial' ? 'denied' : 'error'), null);
  state.pendingMigration = null;
}

// ---------------------------------------------------------------------------
// Onglet Non classées
// ---------------------------------------------------------------------------

async function loadUnclassifiedCount() {
  qs('uncl-count').textContent = 'Chargement…';
  const result = await previewMigrationBatch({ onlyUnclassified: true });
  if (!result.authorized || result.error) { qs('uncl-count').textContent = result.message || 'Indisponible.'; return; }
  qs('uncl-count').textContent = result.items.length + ' question(s) non classée(s) actuellement' + (result.truncated ? ' (parmi les plus récentes — balayage borné)' : '') + '.';
}

// ---------------------------------------------------------------------------
// Exposition au HTML
// ---------------------------------------------------------------------------

window.switchTab = switchTab;
window.checkAllOrgCounts = checkAllOrgCounts;
window.analyzeLegacyData = analyzeLegacyData;
window.cleanupOneLegacySource = cleanupOneLegacySource;
window.cleanupAllLegacySources = cleanupAllLegacySources;
window.onSourcesFilterChange = onSourcesFilterChange;
window.openCreateSourceForm = openCreateSourceForm;
window.closeCreateSourceForm = closeCreateSourceForm;
window.submitCreateSource = submitCreateSource;
window.selectSource = selectSource;
window.openCreateSectionForm = openCreateSectionForm;
window.closeCreateSectionForm = closeCreateSectionForm;
window.submitCreateSection = submitCreateSection;
window.requestArchiveSection = requestArchiveSection;
window.requestSourceStatus = requestSourceStatus;
window.checkSourceCounts = checkSourceCounts;
window.requestReconciliationConfirm = requestReconciliationConfirm;
window.cancelDsAction = cancelDsAction;
window.confirmDsAction = confirmDsAction;
window.loadSingleQuestion = loadSingleQuestion;
window.onSingleDestSourceChange = onSingleDestSourceChange;
window.attachSingleQuestion = attachSingleQuestion;
window.previewMigration = previewMigration;
window.onMigDestSourceChange = onMigDestSourceChange;
window.prepareMigrationStep = prepareMigrationStep;
window.confirmApplyMigration = confirmApplyMigration;
