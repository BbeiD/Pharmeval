// ===================== HELPERS PURS — Synchronisation du catalogue (Sprint 21, phase 3) =====================
// AUCUNE logique metier de fond ici (dedoublonnage, identification,
// validation...) - ce fichier ne fait que preparer/formater des donnees
// DEJA produites par catalog-sync-engine.js pour l'affichage. Separe de
// catalog-sync.js UNIQUEMENT pour permettre des tests reels sans
// dependance a Firebase (catalog-sync.js importe js/firebase-config.js au
// premier niveau, ce qui empeche toute execution hors navigateur).

export function fingerprintFile(file) {
  if (!file) return null;
  return [file.name, file.size, file.lastModified].join('|');
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}

export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls'];

export function hasAcceptedExtension(fileName) {
  const lower = (fileName || '').toLowerCase();
  return ACCEPTED_EXTENSIONS.some(function(ext) { return lower.endsWith(ext); });
}

export function buildConfirmMessage(counts) {
  return 'Vous êtes sur le point de synchroniser ce catalogue avec Pharmeval. ' +
    'Cette opération créera ' + counts.toCreate + ' question(s), modifiera ' + counts.toUpdate +
    ' question(s) et créera ' + counts.competenciesToCreate + ' compétence(s) et ' + counts.tagsToCreate + ' tag(s).';
}

export function classifySyncStatus(syncResult) {
  if (!syncResult || !syncResult.success) return 'failure';
  const chunkResults = (syncResult.report && syncResult.report.chunkResults) || [];
  const anyChunkFailed = chunkResults.some(function(c) { return !c.success; });
  const allChunksFailed = chunkResults.length > 0 && chunkResults.every(function(c) { return !c.success; });
  if (allChunksFailed) return 'failure';
  if (anyChunkFailed) return 'partial';
  return 'success';
}

export function filterQuestionRows(rows, filters) {
  const search = ((filters && filters.search) || '').trim().toLowerCase();
  const sourceName = filters && filters.sourceName;
  return rows.filter(function(r) {
    if (sourceName && (r.sourceDocument && r.sourceDocument.name) !== sourceName) return false;
    if (!search) return true;
    const haystack = [
      r.externalId, r.pedagogicalId, r.resolved && r.resolved.question,
      r.primaryCompetencyLabel, r.sourceDocument && r.sourceDocument.name,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.indexOf(search) !== -1;
  });
}

export function filterLabelRows(rows, search) {
  const s = (search || '').trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(function(r) { return (r.label || '').toLowerCase().indexOf(s) !== -1; });
}

export function buildCorrespondenceCsv(idCorrespondence) {
  const header = 'identifiant_editorial;pedagogicalId;action';
  const rows = idCorrespondence.map(function(c) {
    return [c.editorialId, c.pedagogicalId, c.action].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';');
  });
  return [header].concat(rows).join('\n');
}

export const CONTENT_DIFF_FIELDS = [
  { key: 'question', label: 'Question' },
  { key: 'explanation', label: 'Justification' },
  { key: 'difficulty', label: 'Difficulté' },
];

export function computeDisplayDiff(resolved, existingDoc) {
  if (!existingDoc) return [];
  const diffs = [];
  CONTENT_DIFF_FIELDS.forEach(function(f) {
    const oldVal = existingDoc[f.key];
    const newVal = resolved[f.key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diffs.push({ field: f.label, oldValue: oldVal, newValue: newVal });
    }
  });
  const oldAnswer = existingDoc.answers && typeof existingDoc.correctAnswer === 'number' ? existingDoc.answers[existingDoc.correctAnswer] : undefined;
  const newAnswer = resolved.answers && typeof resolved.correctAnswer === 'number' ? resolved.answers[resolved.correctAnswer] : undefined;
  if (oldAnswer !== newAnswer) diffs.push({ field: 'Bonne réponse', oldValue: oldAnswer, newValue: newAnswer });
  return diffs;
}

export function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

export function escapeHtml(s) {
  return (s === undefined || s === null ? '' : s).toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------------------------------------------------------------------------
// Etats d'interface (point 15 du cahier des charges) — donnees pures,
// applyUiState() prend un `doc` injectable pour rester testable sans
// dependre du `document` global ni de catalog-sync.js.
// ---------------------------------------------------------------------------

export const CARD_IDS = ['cs-progress-card', 'cs-errors-card', 'cs-warnings-card', 'cs-summary-card', 'cs-detail-card', 'cs-sync-action-card', 'cs-syncing-card', 'cs-report-card'];

export const STATE_VISIBILITY = {
  'no-file': [],
  'file-selected': [],
  'analyzing': ['cs-progress-card'],
  'analysis-blocked': ['cs-errors-card', 'cs-warnings-card'],
  'analysis-success': ['cs-summary-card', 'cs-detail-card', 'cs-sync-action-card'],
  'analysis-success-warnings': ['cs-warnings-card', 'cs-summary-card', 'cs-detail-card', 'cs-sync-action-card'],
  'syncing': ['cs-syncing-card'],
  'sync-success': ['cs-report-card'],
  'sync-failed': ['cs-report-card'],
};

/** Les 12 etats explicitement demandes par le cahier des charges (point
 * 15). Utilise pour un test de completude ("aucun etat implicite"). */
export const REQUIRED_UI_STATES = [
  'no-file', 'file-selected', 'analyzing',
  'analysis-success', 'analysis-success-warnings', 'analysis-blocked',
  'confirm', 'syncing', 'sync-success', 'sync-failed',
  'history-empty', 'history-loaded',
];

export function applyUiState(state, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d) return;
  const visible = STATE_VISIBILITY[state] || [];
  CARD_IDS.forEach(function(id) {
    const el = d.getElementById(id);
    if (el) el.style.display = visible.indexOf(id) !== -1 ? 'block' : 'none';
  });
  if (d.body) d.body.setAttribute('data-cs-state', state);
}
