// ===================== CONTROLEUR DES SOURCES DOCUMENTAIRES (Sprint 20) =====================
// Aucune logique metier ici : appelle document-source-service.js /
// document-section-service.js et affiche le resultat - meme discipline que
// tous les autres ecrans d'administration du projet.
//
// CORRECTIF (post-import reel) : tout le contenu documentaire vient
// desormais exclusivement de l'import Excel (Synchronisation du catalogue).
// Retires : les 3 onglets (Migration par lots / Non classees n'existent
// plus), la creation manuelle de source, les outils de verification/
// analyse ponctuels ("Vérifier tout le catalogue", "Analyser les anciennes
// données", "Vérifier les compteurs"), et toute interactivite sur
// l'arborescence des sections (figee, heritee de l'Excel). Ajoute :
// "Supprimer le référentiel" (masquage non destructif en cascade, voir
// document-source-service.js#deleteDocumentSource).

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatDateFr } from "../js/services/date-utils.js";
import {
  DOCUMENT_SOURCE_TYPE_LABELS, DOCUMENT_SOURCE_STATUSES, SOURCE_ICON_PICKER_CHOICES, resolveSourceIconKey,
} from "../js/services/document-source-metadata-service.js";
import {
  browseDocumentSources, changeDocumentSourceStatus, deleteDocumentSource, activateAllDraftSources,
  setSourceHiddenFromFreeTraining, setSourceDisplayIcon,
} from "../js/services/document-source-service.js";
import { getSectionTree } from "../js/services/document-section-service.js";
import { renderSiteHeader } from "../js/site-header.js";
import { icon, renderAnyIcon, ICONS, DOT_ICONS } from "../js/icons.js";

const KNOWN_ICON_KEYS = new Set([...Object.keys(ICONS), ...Object.keys(DOT_ICONS)]);

const STATUS_BADGES = {
  draft: { iconKey: 'status-draft', label: 'Brouillon', cls: 'bank-badge-draft' },
  active: { iconKey: 'status-published-active', label: 'Actif', cls: 'bank-badge-published' },
  archived: { iconKey: 'status-archived', label: 'Archivé', cls: 'bank-badge-archived' },
  deleted: { iconKey: 'status-trash', label: 'Supprimé', cls: 'bank-badge-trash' },
};
function badgeHtml(badge) {
  return '<span class="bank-badge ' + badge.cls + '">' + icon(badge.iconKey, { size: 14 }) + ' ' + badge.label + '</span>';
}

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function qs(id) { return document.getElementById(id); }
function showMessage(status, message) {
  const el = qs('ds-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

let state = {
  sourceItems: [], selectedSourceId: null, sectionItems: [],
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
  renderSiteHeader('administration');

  await loadSources();
});

// ---------------------------------------------------------------------------
// Liste des sources
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

// AJOUT (refonte visuelle, phase 1, decision validee avec David) :
// presentation "comme l'entrainement libre" - tuile a icone + nom
// uniquement, la fiche complete (statut, type, compteurs...) n'apparait
// plus qu'au clic, dans le panneau de detail en dessous (voir
// sourceDetailHtml). Le badge de statut reste visible en surimpression
// (coin superieur droit) - seule information conservee sur la tuile.
function sourceRowHtml(s) {
  const badge = STATUS_BADGES[s.status] || STATUS_BADGES.draft;
  const selectedCls = s.id === state.selectedSourceId ? ' source-tile-selected' : '';
  const iconKey = resolveSourceIconKey(s, KNOWN_ICON_KEYS);
  return (
    '<button type="button" class="source-tile' + selectedCls + '" onclick="selectSource(\'' + escapeHtml(s.id) + '\')" title="' + escapeHtml(badge.label) + '">' +
      '<span class="source-tile-status-dot" aria-hidden="true">' + icon(badge.iconKey, { size: 12 }) + '</span>' +
      '<span class="source-tile-emoji" aria-hidden="true">' + renderAnyIcon(iconKey, { size: 24 }) + '</span>' +
      '<span class="source-tile-name">' + escapeHtml(s.name) + '</span>' +
    '</button>'
  );
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
  html += '<div class="bank-detail-header"><h3>' + escapeHtml(s.name) + '</h3>' + badgeHtml(badge) + '</div>';
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
  html += '<div class="bank-detail-row"><strong>Entraînement libre :</strong> ' + (s.hiddenFromFreeTraining ? icon('admin-disable', { size: 14 }) + ' Masquée (indisponible pour l\'entraînement libre)' : icon('status-published-active', { size: 14 }) + ' Visible') + '</div>';
  html += '</div>';

  // AJOUT (refonte visuelle, phase 1, decision validee avec David) : icone
  // affichee sur la tuile de selection de l'entrainement libre
  // (js/entrainement-libre.js) - stockee dans le champ deja reserve
  // `display.icon` (document-source-metadata-service.js, jamais exploite
  // jusqu'ici). Repli sur une icone par TYPE de source si non renseignee -
  // voir resolveSourceIconKey, document-source-metadata-service.js.
  // CORRECTIF (bibliotheque d'icones, remplace les emojis) : `display.icon`
  // stocke desormais une CLE du pack (ex. "doc-01-closed-book"), plus un
  // emoji brut - input cache (valeur reelle) + apercu visuel separe
  // (rendu SVG, jamais un texte brut).
  const currentIconKey = resolveSourceIconKey(s, KNOWN_ICON_KEYS);
  html += '<div class="bank-detail-section"><h4>Icône (entraînement libre)</h4>';
  html += '<p class="admin-users-disclaimer">Une icône affichée sur la tuile de sélection de l\'entraînement libre. Laissez vide pour revenir à l\'icône par défaut selon le type de source.</p>';
  html += '<div class="btn-row">';
  html += '<input type="hidden" id="ds-icon-input" value="' + escapeHtml((s.display && s.display.icon) || '') + '">';
  html += '<button type="button" class="ds-icon-preview-btn" onclick="toggleIconPicker()" title="Choisir une icône">' + renderAnyIcon(currentIconKey, { size: 24 }) + '</button>';
  html += '<button class="btn-secondary" onclick="toggleIconPicker()">Choisir</button>';
  html += '<button class="btn-primary" onclick="saveSourceIcon()">Enregistrer l\'icône</button>';
  html += '</div>';
  html += '<div id="ds-icon-picker" class="emoji-picker" style="display:none;">' + iconPickerHtml() + '</div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Actions</h4><div class="bank-actions-row">';
  if (s.status !== DOCUMENT_SOURCE_STATUSES.DELETED) {
    if (s.status !== DOCUMENT_SOURCE_STATUSES.ACTIVE) html += '<button class="btn-primary" onclick="requestSourceStatus(\'active\')">Activer</button>';
    if (s.status !== DOCUMENT_SOURCE_STATUSES.ARCHIVED) html += '<button class="btn-secondary bank-trash-btn" onclick="requestSourceStatus(\'archived\')">Archiver</button>';
    if (s.status === DOCUMENT_SOURCE_STATUSES.ARCHIVED) html += '<button class="btn-secondary" onclick="requestSourceStatus(\'active\')">Réactiver</button>';
    // AJOUT (refonte visuelle, phase 1) : rendre une source invisible pour
    // l'entrainement libre uniquement - n'affecte ni son statut, ni sa
    // disponibilite pour les parcours/la banque de questions (voir
    // setSourceHiddenFromFreeTraining, document-source-service.js).
    html += s.hiddenFromFreeTraining
      ? '<button class="btn-secondary" onclick="toggleSourceFreeTrainingVisibility(false)">' + icon('status-published-active', { size: 14 }) + ' Rendre visible dans l\'entraînement libre</button>'
      : '<button class="btn-secondary" onclick="toggleSourceFreeTrainingVisibility(true)">' + icon('admin-disable', { size: 14 }) + ' Masquer de l\'entraînement libre</button>';
    html += '<button class="btn-secondary bank-delete-btn" onclick="requestDeleteSource()">' + icon('action-delete', { size: 14 }) + ' Supprimer le référentiel</button>';
  } else {
    html += '<p class="admin-users-disclaimer">Cette source est supprimée : ses questions ont été archivées en cascade. Aucune donnée n\'a été effacée.</p>';
  }
  html += '</div></div>';

  // CORRECTIF : arborescence figee, purement informative - heritee de
  // l'import Excel, aucun bouton ni aucune zone cliquable (plus de
  // creation/archivage de section depuis cet ecran).
  html += '<div class="bank-detail-section"><h4>Arborescence des sections</h4>';
  html += '<div id="ds-section-tree" style="margin-top:10px;">' + renderSectionTree(sections) + '</div>';
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
        '</div>' +
      '</div>'
    );
  }).join('') + '</div>';
}

// ---------------------------------------------------------------------------
// Confirmation avant action sensible
// ---------------------------------------------------------------------------

export function requestSourceStatus(newStatus) {
  pendingAction = { kind: 'source_status', newStatus: newStatus };
  qs('ds-confirm-message').textContent = 'Confirmer ce changement de statut ?';
  qs('ds-confirm-overlay').style.display = 'flex';
}

export function requestDeleteSource() {
  pendingAction = { kind: 'delete_source' };
  qs('ds-confirm-message').textContent = 'Supprimer ce référentiel ? Il sera masqué et toutes ses questions rattachées seront archivées. Rien n\'est supprimé réellement — action réversible manuellement (réactivation de la source, puis republication question par question si besoin).';
  qs('ds-confirm-overlay').style.display = 'flex';
}

export function requestBulkActivateSources() {
  pendingAction = { kind: 'bulk_activate_sources' };
  qs('ds-confirm-message').textContent = 'Activer toutes les sources actuellement en brouillon ? Les sources déjà actives, archivées ou supprimées ne seront pas touchées.';
  qs('ds-confirm-overlay').style.display = 'flex';
}

// CORRECTIF (bibliotheque d'icones, remplace les emojis) : palette de cles
// SOURCE_ICON_PICKER_CHOICES (document-source-metadata-service.js, partagee
// avec toute autre consommatrice future) - plus un tableau d'emoji local a
// ce fichier. Chaque bouton affiche le rendu SVG reel (icone ou pastille de
// couleur, voir renderAnyIcon) plutot qu'un caractere.
function iconPickerHtml() {
  return SOURCE_ICON_PICKER_CHOICES.map(function(key) {
    return '<button type="button" class="emoji-picker-btn" onclick="pickSourceIcon(\'' + key + '\')" title="' + key + '">' + renderAnyIcon(key, { size: 20 }) + '</button>';
  }).join('');
}

export function toggleIconPicker() {
  const el = qs('ds-icon-picker');
  if (!el) return;
  el.style.display = (el.style.display === 'none') ? 'grid' : 'none';
}

export function pickSourceIcon(iconKey) {
  qs('ds-icon-input').value = iconKey;
  const previewBtn = document.querySelector('.ds-icon-preview-btn');
  if (previewBtn) previewBtn.innerHTML = renderAnyIcon(iconKey, { size: 24 });
  qs('ds-icon-picker').style.display = 'none';
}

export async function saveSourceIcon() {
  const source = state.sourceItems.find(function(s) { return s.id === state.selectedSourceId; });
  if (!source) return;
  const value = qs('ds-icon-input').value.trim();

  // CORRECTIF : setSourceDisplayIcon() (dedie, champ unique) plutot que
  // editDocumentSource() (revalidait toute la fiche - shortCode compris -
  // et refusait ce simple changement d'icone des qu'une source avait deja
  // un shortCode invalide/absent en base, sans rapport avec l'icone).
  const result = await setSourceDisplayIcon(source, value || null);
  showMessage(result.status, result.message);
  if (result.status === 'success') {
    source.display = Object.assign({}, source.display, { icon: value || null });
    await selectSource(state.selectedSourceId);
  }
}

export async function toggleSourceFreeTrainingVisibility(hidden) {
  const source = state.sourceItems.find(function(s) { return s.id === state.selectedSourceId; });
  if (!source) return;
  const result = await setSourceHiddenFromFreeTraining(source, hidden);
  showMessage(result.status, result.message);
  if (result.status === 'success') {
    source.hiddenFromFreeTraining = hidden;
    await selectSource(state.selectedSourceId);
  }
}

export function cancelDsAction() { pendingAction = null; qs('ds-confirm-overlay').style.display = 'none'; }

export async function confirmDsAction() {
  if (!pendingAction) return;
  const action = pendingAction; pendingAction = null;
  qs('ds-confirm-overlay').style.display = 'none';

  if (action.kind === 'bulk_activate_sources') {
    const result = await activateAllDraftSources();
    showMessage(result.status, result.message);
    if (result.status === 'success') await loadSources();
    return;
  }

  const source = state.sourceItems.find(function(s) { return s.id === state.selectedSourceId; });

  if (action.kind === 'source_status') {
    const result = await changeDocumentSourceStatus(source, action.newStatus);
    showMessage(result.status, result.message);
    if (result.status === 'success') await selectSource(state.selectedSourceId);
    return;
  }
  if (action.kind === 'delete_source') {
    const result = await deleteDocumentSource(source);
    showMessage(result.status, result.message);
    if (result.status === 'success') await selectSource(state.selectedSourceId);
    return;
  }
}

// ---------------------------------------------------------------------------
// Exposition au HTML
// ---------------------------------------------------------------------------

window.onSourcesFilterChange = onSourcesFilterChange;
window.selectSource = selectSource;
window.requestSourceStatus = requestSourceStatus;
window.requestDeleteSource = requestDeleteSource;
window.requestBulkActivateSources = requestBulkActivateSources;
window.toggleSourceFreeTrainingVisibility = toggleSourceFreeTrainingVisibility;
window.saveSourceIcon = saveSourceIcon;
window.toggleIconPicker = toggleIconPicker;
window.pickSourceIcon = pickSourceIcon;
window.cancelDsAction = cancelDsAction;
window.confirmDsAction = confirmDsAction;
