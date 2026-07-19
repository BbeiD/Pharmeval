// ===================== CONTROLEUR DES PARCOURS (Sprint 12) =====================
// Aucune logique metier ici : ce fichier ne fait qu'appeler
// js/services/parcours-service.js et afficher le resultat. Reutilise le
// meme style et les memes classes CSS que admin/bank.js (Sprint 11) -
// "Reutiliser les composants existants autant que possible".
//
// Double controle d'acces (meme principe qu'ailleurs dans Pharmeval) :
// 1. Interface : #parcours-view reste masque tant que l'acces n'est pas confirme.
// 2. Logique metier : parcours-service.js revalide lui-meme la permission.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatDateFr } from "../js/services/date-utils.js";
import { PARCOURS_COLOR_HEX, resolveParcoursColorHex } from "../js/services/parcours-metadata-service.js";
import {
  browseParcours, createParcours, publishParcours, archiveParcours, revertParcoursToDraft,
  moveParcoursToTrash, restoreParcoursFromTrash, permanentlyDeleteParcours,
  editParcoursMetadata, removeCompetency, moveCompetency,
  linkQuestionToCompetency, unlinkQuestionFromCompetency, searchQuestionsForLinking,
  addCompetencyFromBank, resolveParcoursCompetenciesDisplay,
  getParcoursTimeline,
} from "../js/services/parcours-service.js";
import { browseCompetencies } from "../js/services/competency-service.js";
import { COMPETENCY_COLOR_HEX, resolveCompetencyColorHex } from "../js/services/competency-metadata-service.js";
import {
  ASSIGNMENT_TARGET_TYPES, ASSIGNMENT_TARGET_TYPE_LABELS,
  ASSIGNMENT_PRIORITIES,
} from "../js/services/assignment-metadata-service.js";
import {
  listParcoursAssignments, createAssignment, removeAssignment, searchAssignmentTargets,
} from "../js/services/assignment-service.js";

const STATUS_BADGES = {
  draft: { emoji: '🟡', label: 'Brouillon', cls: 'bank-badge-draft' },
  review: { emoji: '🔵', label: 'En relecture', cls: 'bank-badge-review' },
  published: { emoji: '🟢', label: 'Publié', cls: 'bank-badge-published' },
  archived: { emoji: '⚫', label: 'Archivé', cls: 'bank-badge-archived' },
  trash: { emoji: '🔴', label: 'Corbeille', cls: 'bank-badge-trash' },
};

let state = {
  searchText: '', filters: { status: '', author: '' }, sortField: 'createdAt', sortDirection: 'desc',
  page: 0, cursorStack: [null], cursorIndex: 0,
  items: [], hasMore: false, selectedId: null,
};
let pendingAction = null;      // { kind, parcours }
let linkingCompetencyId = null; // competence en cours de liaison (panneau de recherche de questions)

// ---------------------------------------------------------------------------
// Controle d'acces
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('parcours-loading');
  const deniedEl = document.getElementById('parcours-denied');
  const viewEl = document.getElementById('parcours-view');

  if (!user) {
    clearCurrentUserContext();
    window.location.href = '../index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';

  if (!hasPermission(PERMISSIONS.MANAGE_PARCOURS)) {
    if (deniedEl) deniedEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    return;
  }

  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';

  await loadPage();
});

// ---------------------------------------------------------------------------
// Chargement et rendu de la liste
// ---------------------------------------------------------------------------

async function loadPage() {
  const listEl = document.getElementById('parcours-list');
  const emptyEl = document.getElementById('parcours-list-empty');
  if (listEl) listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  if (emptyEl) emptyEl.style.display = 'none';

  const isSearch = !!state.searchText.trim();
  const cursorDoc = isSearch ? null : state.cursorStack[state.cursorIndex];

  const result = await browseParcours({
    searchText: state.searchText, filters: state.filters,
    sortField: state.sortField, sortDirection: state.sortDirection,
    page: state.page, cursorDoc: cursorDoc,
  });

  if (!result.authorized) {
    showParcoursMessage('denied', result.message);
    return;
  }
  if (result.error) {
    if (listEl) listEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = result.message; }
    return;
  }

  state.items = result.items;
  state.hasMore = result.hasMore;
  if (!result.searchMode) state.lastDoc = result.lastDoc;

  const disclaimerEl = document.getElementById('parcours-search-disclaimer');
  if (disclaimerEl) {
    if (result.searchMode && result.truncatedScan) {
      disclaimerEl.style.display = 'block';
      disclaimerEl.textContent = 'Recherche limitée aux parcours les plus récents correspondant aux filtres actifs.';
    } else {
      disclaimerEl.style.display = 'none';
    }
  }

  renderList(state.items);
  renderPagination();
}

function renderList(items) {
  const listEl = document.getElementById('parcours-list');
  const emptyEl = document.getElementById('parcours-list-empty');
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = 'Aucun parcours ne correspond à ces critères.'; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = items.map(rowHtml).join('');
}

function rowHtml(p) {
  const badge = STATUS_BADGES[p.status] || STATUS_BADGES.draft;
  const selected = p.id === state.selectedId ? ' bank-row-selected' : '';
  const competencyCount = (p.competencies || []).length;
  return (
    '<div class="bank-row' + selected + '" onclick="selectParcours(\'' + escapeHtml(p.id) + '\')">' +
      '<div class="bank-row-top">' +
        '<span class="bank-row-id">' + (p.icon ? escapeHtml(p.icon) + ' ' : '') + escapeHtml(p.name) + '</span>' +
        '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>' +
      '</div>' +
      '<div class="bank-row-question">' + escapeHtml((p.description || '').slice(0, 90)) + '</div>' +
      '<div class="bank-row-meta">' + escapeHtml(p.targetAudience || '—') + ' · ' + competencyCount + ' compétence(s)</div>' +
    '</div>'
  );
}

function renderPagination() {
  const el = document.getElementById('parcours-pagination');
  if (!el) return;
  const isSearch = !!state.searchText.trim();
  const canGoBack = isSearch ? state.page > 0 : state.cursorIndex > 0;
  const canGoForward = state.hasMore;
  el.innerHTML =
    '<button class="btn-secondary" onclick="goToParcoursPage(-1)"' + (canGoBack ? '' : ' disabled') + '>← Précédent</button>' +
    '<span class="bank-pagination-label">Page ' + ((isSearch ? state.page : state.cursorIndex) + 1) + '</span>' +
    '<button class="btn-secondary" onclick="goToParcoursPage(1)"' + (canGoForward ? '' : ' disabled') + '>Suivant →</button>';
}

export function goToParcoursPage(delta) {
  const isSearch = !!state.searchText.trim();
  if (isSearch) {
    state.page = Math.max(0, state.page + delta);
  } else {
    if (delta > 0 && state.hasMore) {
      state.cursorStack = state.cursorStack.slice(0, state.cursorIndex + 1);
      state.cursorStack.push(state.lastDoc);
      state.cursorIndex++;
    } else if (delta < 0 && state.cursorIndex > 0) {
      state.cursorIndex--;
    }
  }
  return loadPage();
}

function resetPagination() {
  state.page = 0;
  state.cursorStack = [null];
  state.cursorIndex = 0;
}

// ---------------------------------------------------------------------------
// Recherche, filtres, tri
// ---------------------------------------------------------------------------

export function onParcoursSearchInput() {
  state.searchText = valueOf('parcours-search-input');
  resetPagination();
  return loadPage();
}

export function onParcoursFilterChange() {
  state.filters.status = valueOf('parcours-filter-status');
  state.filters.author = valueOf('parcours-filter-author');
  state.sortField = valueOf('parcours-sort-field');
  resetPagination();
  return loadPage();
}

export function toggleParcoursSortDirection() {
  state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  const btn = document.getElementById('parcours-sort-dir-btn');
  if (btn) btn.textContent = state.sortDirection === 'desc' ? '⬇️' : '⬆️';
  resetPagination();
  return loadPage();
}

function valueOf(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

// ---------------------------------------------------------------------------
// CORRECTIF : palette de couleurs fermee (pastilles cliquables)
// ---------------------------------------------------------------------------

function colorSwatchesHtml(inputId, selectedColor) {
  const swatches = Object.keys(PARCOURS_COLOR_HEX).map(function(key) {
    const isSelected = selectedColor === key;
    return '<button type="button" class="parcours-color-swatch' + (isSelected ? ' parcours-color-selected' : '') +
      '" style="background:' + PARCOURS_COLOR_HEX[key] + ';" onclick="pickParcoursColor(\'' + inputId + '\',\'' + key + '\')" title="' + capitalizeFirst(key) + '"></button>';
  }).join('');
  const noneSelected = !selectedColor || !PARCOURS_COLOR_HEX[selectedColor];
  const noneBtn = '<button type="button" class="parcours-color-swatch parcours-color-none' + (noneSelected ? ' parcours-color-selected' : '') +
    '" onclick="pickParcoursColor(\'' + inputId + '\',\'\')" title="Aucune couleur">✕</button>';
  return swatches + noneBtn;
}

function colorPickerHtml(inputId, selectedColor) {
  return '<div class="parcours-color-picker" id="' + inputId + '-picker">' + colorSwatchesHtml(inputId, selectedColor) + '</div>' +
         '<input type="hidden" id="' + inputId + '" value="' + escapeHtml(selectedColor || '') + '">';
}

export function pickParcoursColor(inputId, colorValue) {
  const hiddenInput = document.getElementById(inputId);
  if (hiddenInput) hiddenInput.value = colorValue;
  const picker = document.getElementById(inputId + '-picker');
  if (picker) picker.innerHTML = colorSwatchesHtml(inputId, colorValue);
}

function capitalizeFirst(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function openCreateParcoursForm() {
  document.getElementById('parcours-create-color-container').innerHTML = colorPickerHtml('parcours-create-color', '');
  document.getElementById('parcours-create-card').style.display = 'block';
}
export function closeCreateParcoursForm() {
  document.getElementById('parcours-create-card').style.display = 'none';
}
export async function submitCreateParcours() {
  const fields = {
    name: valueOf('parcours-create-name'),
    description: valueOf('parcours-create-description'),
    targetAudience: valueOf('parcours-create-audience'),
    color: valueOf('parcours-create-color'),
    icon: valueOf('parcours-create-icon'),
  };
  const result = await createParcours(fields);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    closeCreateParcoursForm();
    ['parcours-create-name', 'parcours-create-description', 'parcours-create-audience', 'parcours-create-icon'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('parcours-create-color-container').innerHTML = '';
    await loadPage();
  }
}

// ---------------------------------------------------------------------------
// Selection et fiche detaillee
// ---------------------------------------------------------------------------

export async function selectParcours(id) {
  const p = state.items.find(function(item) { return item.id === id; });
  if (!p) return;
  state.selectedId = id;
  renderList(state.items);

  document.getElementById('parcours-detail-placeholder').style.display = 'none';
  const detailEl = document.getElementById('parcours-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  // Sprint 13 : resolution des competences liees a la Banque des
  // compétences AVANT le rendu, pour toujours afficher le nom/la
  // description/la couleur A JOUR (voir resolveParcoursCompetenciesDisplay,
  // "Reutilisation").
  const resolvedCompetencies = await resolveParcoursCompetenciesDisplay(p);
  detailEl.innerHTML = detailHtml(p, resolvedCompetencies);

  await renderTimeline(p);
  await renderAssignments(p);
}

function detailHtml(p, resolvedCompetencies) {
  const badge = STATUS_BADGES[p.status] || STATUS_BADGES.draft;
  const competencies = (resolvedCompetencies || p.competencies || []).slice().sort(function(a, b) { return a.order - b.order; });

  let html = '<div class="bank-detail-card">';

  html += '<div class="bank-detail-header">';
  html += '<h3>' + (p.icon ? escapeHtml(p.icon) + ' ' : '') + escapeHtml(p.name) + '</h3>';
  html += '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>';
  html += '</div>';
  html += '<div class="bank-detail-tags-row">';
  html += '<span class="bank-chip">' + escapeHtml(p.id) + '</span>';
  if (p.targetAudience) html += '<span class="bank-chip">' + escapeHtml(p.targetAudience) + '</span>';
  if (p.color) {
    const hex = resolveParcoursColorHex(p.color);
    const label = PARCOURS_COLOR_HEX[p.color] ? capitalizeFirst(p.color) : p.color;
    html += '<span class="bank-chip" style="background:' + escapeHtml(hex) + ';color:#fff;">' + escapeHtml(label) + '</span>';
  }
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Description</h4><p>' + escapeHtml(p.description || '—') + '</p></div>';

  html += '<div class="bank-detail-section"><h4>Métadonnées</h4>';
  html += '<div class="bank-detail-row"><strong>Auteur :</strong> ' + escapeHtml(p.author || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Créé le :</strong> ' + escapeHtml(p.createdAt ? formatDateFr(p.createdAt) : '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Modifié le :</strong> ' + escapeHtml(p.updatedAt ? formatDateFr(p.updatedAt) : '—') + '</div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Compétences (' + competencies.length + ')</h4>';
  if (competencies.length === 0) {
    html += '<p class="bank-list-empty" style="padding:12px;">Aucune compétence pour l\'instant.</p>';
  } else {
    html += '<div class="parcours-competency-list">';
    competencies.forEach(function(c, i) {
      // Sprint 13 : si la competence est liee a la banque (`competencyId`)
      // et que la fiche a pu etre relue (`bankData`), affiche TOUJOURS ces
      // donnees a jour - jamais l'ancienne copie imbriquee `c.name`/
      // `c.description`, qui ne sert plus que de repli (voir
      // parcours-service.js, resolveParcoursCompetenciesDisplay()).
      const bank = c.bankData || null;
      const displayName = bank ? bank.name : c.name;
      const displayDescription = bank ? bank.description : c.description;
      const notYetMigrated = !c.competencyId;
      const brokenLink = !!c.competencyId && !bank;

      html += '<div class="parcours-competency-card">';
      html += '<div class="parcours-competency-header"><strong>' + escapeHtml(displayName) + '</strong>';
      if (bank && bank.color && COMPETENCY_COLOR_HEX[bank.color]) {
        html += '<span class="bank-chip" style="background:' + escapeHtml(COMPETENCY_COLOR_HEX[bank.color]) + ';color:#fff;">' + escapeHtml(capitalizeFirst(bank.color)) + '</span>';
      }
      if (bank && bank.category) html += '<span class="bank-chip">' + escapeHtml(bank.category) + '</span>';
      html += '<div class="parcours-competency-actions">';
      html += '<button class="btn-secondary" onclick="moveCompetencyUp(\'' + escapeHtml(c.id) + '\')"' + (i === 0 ? ' disabled' : '') + '>↑</button>';
      html += '<button class="btn-secondary" onclick="moveCompetencyDown(\'' + escapeHtml(c.id) + '\')"' + (i === competencies.length - 1 ? ' disabled' : '') + '>↓</button>';
      html += '<button class="btn-secondary bank-delete-btn" onclick="requestRemoveCompetency(\'' + escapeHtml(c.id) + '\')">Supprimer</button>';
      html += '</div></div>';
      if (displayDescription) html += '<p class="parcours-competency-description">' + escapeHtml(displayDescription) + '</p>';
      if (notYetMigrated) {
        html += '<p class="parcours-bulk-duplicates">⚠️ Compétence non reliée à la banque (ancienne compétence texte) — utilisez « Migrer » depuis la <a href="competencies.html" target="_blank">Banque des compétences</a>.</p>';
      } else if (brokenLink) {
        html += '<p class="parcours-bulk-duplicates">⚠️ Fiche introuvable dans la banque (peut-être supprimée définitivement).</p>';
      }
      html += '<div class="parcours-competency-questions">';
      if (c.questionIds.length === 0) {
        html += '<span class="bank-chip">Aucune question liée</span>';
      } else {
        c.questionIds.forEach(function(qid) {
          html += '<span class="bank-chip">' + escapeHtml(qid) + ' <a href="#" onclick="unlinkQuestion(\'' + escapeHtml(c.id) + '\',\'' + escapeHtml(qid) + '\');return false;" title="Retirer">✕</a></span>';
        });
      }
      html += ' <button class="btn-secondary" onclick="openLinkQuestionPanel(\'' + escapeHtml(c.id) + '\')">+ Lier une question</button>';
      html += '</div></div>';
    });
    html += '</div>';
  }
  html += '<div class="btn-row"><button class="btn-primary" onclick="openCompetencyPickerPanel()">+ Ajouter une compétence (banque)</button></div>';
  html += '</div>';

  // NOUVEAU (Sprint 15) : "Attributions" - qui reçoit ce parcours
  // (utilisateur / groupe / profil). Rempli de façon asynchrone par
  // renderAssignments() juste après ce rendu (voir selectParcours) -
  // même principe que le conteneur d'historique ci-dessous.
  html += '<div class="bank-detail-section"><h4>Attributions</h4>';
  html += '<div id="parcours-assignments-container" class="bank-timeline">Chargement…</div>';
  html += '<div class="btn-row"><button class="btn-primary" onclick="openAssignmentPickerPanel()">+ Attribuer</button></div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Actions</h4><div class="bank-actions-row">';
  if (p.status !== 'trash') {
    if (p.status !== 'published') html += '<button class="btn-primary" onclick="requestParcoursAction(\'publish\')">Publier</button>';
    if (p.status !== 'archived') html += '<button class="btn-secondary" onclick="requestParcoursAction(\'archive\')">Archiver</button>';
    if (p.status !== 'draft') html += '<button class="btn-secondary" onclick="requestParcoursAction(\'draft\')">Remettre en brouillon</button>';
  }
  if (p.status === 'archived') {
    html += '<button class="btn-secondary bank-trash-btn" onclick="requestParcoursAction(\'trash\')">🗑️ Mettre à la corbeille</button>';
  }
  if (p.status === 'trash') {
    html += '<button class="btn-secondary" onclick="requestParcoursAction(\'restore\')">↩️ Restaurer</button>';
    if (hasPermission(PERMISSIONS.PURGE_PARCOURS)) {
      html += '<button class="btn-secondary bank-delete-btn" onclick="requestParcoursAction(\'purge\')">Supprimer définitivement</button>';
    }
  }
  html += '</div></div>';

  html += '<div class="bank-detail-section"><h4>Historique</h4><div id="parcours-timeline-container" class="bank-timeline">Chargement…</div></div>';

  html += '<div class="bank-detail-section"><h4>Modifier</h4>';
  html += '<label class="bank-edit-label">Nom</label>';
  html += '<input type="text" id="parcours-edit-name" class="bank-select" value="' + escapeHtml(p.name) + '">';
  html += '<label class="bank-edit-label">Description</label>';
  html += '<textarea id="parcours-edit-description" class="bank-edit-textarea">' + escapeHtml(p.description || '') + '</textarea>';
  html += '<label class="bank-edit-label">Public cible</label>';
  html += '<input type="text" id="parcours-edit-audience" class="bank-select" value="' + escapeHtml(p.targetAudience || '') + '">';
  html += '<label class="bank-edit-label">Couleur</label>';
  html += colorPickerHtml('parcours-edit-color', PARCOURS_COLOR_HEX[p.color] ? p.color : '');
  html += '<label class="bank-edit-label">Icône</label>';
  html += '<input type="text" id="parcours-edit-icon" class="bank-select" value="' + escapeHtml(p.icon || '') + '">';
  html += '<div class="btn-row"><button class="btn-primary" onclick="saveParcoursEdit()">Enregistrer les modifications</button></div>';
  html += '</div>';

  html += '</div>';
  return html;
}

async function renderTimeline(p) {
  const container = document.getElementById('parcours-timeline-container');
  if (!container) return;
  const result = await getParcoursTimeline(p);
  if (!result.authorized) { container.textContent = result.message || 'Accès refusé.'; return; }
  if (result.items.length === 0) { container.textContent = 'Aucun historique disponible pour ce parcours.'; return; }
  let html = '<ul class="bank-timeline-list">' + result.items.map(function(entry) {
    const dateLabel = entry.date ? formatDateFr(entry.date) : '—';
    const who = entry.adminEmail ? ' — ' + escapeHtml(entry.adminEmail) : '';
    return '<li class="bank-timeline-item"><div class="bank-timeline-date">' + escapeHtml(dateLabel) + '</div><div class="bank-timeline-label">' + escapeHtml(entry.label) + who + '</div></li>';
  }).join('') + '</ul>';
  // CORRECTIF : le journal detaille peut etre temporairement indisponible
  // (ex. index Firestore en cours de creation) sans que cela empeche
  // d'afficher au moins l'evenement de creation - une mention discrete
  // signale cette limite, jamais un message d'erreur bloquant.
  if (result.auditUnavailable) {
    html += '<p class="bank-timeline-partial-note">Historique partiel : le journal détaillé des actions n\u2019a pas pu être chargé pour le moment.</p>';
  }
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// NOUVEAU (Sprint 15) : Attributions (utilisateur / groupe / profil)
// ---------------------------------------------------------------------------

let currentParcoursAssignments = []; // derniere liste resolue (avec targetLabel), pour retrouver l'objet complet lors d'une suppression

async function renderAssignments(p) {
  const container = document.getElementById('parcours-assignments-container');
  if (!container) return;
  const result = await listParcoursAssignments(p.id);
  if (!result.authorized) { container.textContent = result.message || 'Accès refusé.'; return; }
  if (result.error) { container.textContent = result.message; return; }

  currentParcoursAssignments = result.items;

  if (result.items.length === 0) { container.textContent = 'Ce parcours n\'est attribué à personne pour l\'instant.'; return; }

  container.innerHTML = '<div class="parcours-competency-list">' + result.items.map(function(a) {
    const typeLabel = ASSIGNMENT_TARGET_TYPE_LABELS[a.type] || a.type;
    const dueLabel = a.dueDate ? '<span class="bank-chip">Échéance : ' + escapeHtml(formatDateFr(a.dueDate)) + '</span>' : '';
    const mandatoryLabel = a.mandatory ? '<span class="bank-chip">Obligatoire</span>' : '';
    return '<div class="parcours-competency-card">' +
      '<div class="parcours-competency-header">' +
        '<strong>' + escapeHtml(typeLabel) + ' — ' + escapeHtml(a.targetLabel) + '</strong>' +
        dueLabel + mandatoryLabel +
        '<div class="parcours-competency-actions">' +
          '<button class="btn-secondary bank-delete-btn" onclick="requestRemoveAssignment(\'' + escapeHtml(a.id) + '\')">Retirer l\'attribution</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('') + '</div>';
}

let assignmentPickerType = ASSIGNMENT_TARGET_TYPES.USER;
let assignmentPickerSelectedTarget = null; // {id, label}
let assignmentPickerDebounce = null;

export function openAssignmentPickerPanel() {
  assignmentPickerType = ASSIGNMENT_TARGET_TYPES.USER;
  assignmentPickerSelectedTarget = null;
  document.getElementById('parcours-assignment-search').value = '';
  document.getElementById('parcours-assignment-duedate').value = '';
  document.getElementById('parcours-assignment-priority').value = ASSIGNMENT_PRIORITIES.NORMAL;
  document.getElementById('parcours-assignment-mandatory').checked = false;
  document.querySelectorAll('.parcours-assignment-type-btn').forEach(function(btn) {
    btn.classList.toggle('bank-row-selected', btn.getAttribute('data-type') === assignmentPickerType);
  });
  document.getElementById('parcours-assignment-overlay').style.display = 'flex';
  runAssignmentTargetSearch('');
}
export function closeAssignmentPickerPanel() {
  document.getElementById('parcours-assignment-overlay').style.display = 'none';
}
export function pickAssignmentType(type) {
  assignmentPickerType = type;
  assignmentPickerSelectedTarget = null;
  document.querySelectorAll('.parcours-assignment-type-btn').forEach(function(btn) {
    btn.classList.toggle('bank-row-selected', btn.getAttribute('data-type') === type);
  });
  runAssignmentTargetSearch(valueOf('parcours-assignment-search'));
}
export function onAssignmentSearchInput() {
  clearTimeout(assignmentPickerDebounce);
  const value = valueOf('parcours-assignment-search');
  assignmentPickerDebounce = setTimeout(function() { runAssignmentTargetSearch(value); }, 250);
}
async function runAssignmentTargetSearch(searchText) {
  const container = document.getElementById('parcours-assignment-results');
  container.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  const results = await searchAssignmentTargets(assignmentPickerType, searchText);
  if (results.length === 0) { container.innerHTML = '<p class="bank-list-empty">Aucun résultat.</p>'; return; }
  container.innerHTML = results.map(function(r) {
    const selected = assignmentPickerSelectedTarget && assignmentPickerSelectedTarget.id === r.id;
    return '<label style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer;">' +
      '<input type="radio" name="parcours-assignment-target" onchange="pickAssignmentTarget(\'' + escapeHtml(r.id) + '\',\'' + escapeHtml(r.label) + '\')"' + (selected ? ' checked' : '') + '>' +
      '<span>' + escapeHtml(r.label) + '</span></label>';
  }).join('');
}
export function pickAssignmentTarget(id, label) {
  assignmentPickerSelectedTarget = { id: id, label: label };
}
export async function confirmAssignmentPicker() {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p || !assignmentPickerSelectedTarget) {
    showParcoursMessage('denied', 'Sélectionnez une cible avant de confirmer.');
    return;
  }
  const result = await createAssignment({
    parcoursId: p.id, type: assignmentPickerType, targetId: assignmentPickerSelectedTarget.id,
    dueDate: valueOf('parcours-assignment-duedate') || null,
    priority: document.getElementById('parcours-assignment-priority').value,
    mandatory: document.getElementById('parcours-assignment-mandatory').checked,
  });
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    closeAssignmentPickerPanel();
    await renderAssignments(p);
  }
}

export function requestRemoveAssignment(assignmentId) {
  const assignment = currentParcoursAssignments.find(function(a) { return a.id === assignmentId; });
  if (!assignment) return;
  pendingAction = { kind: 'remove_assignment', assignment: assignment };
  document.getElementById('parcours-confirm-message').textContent =
    'Voulez-vous vraiment retirer l\'attribution de « ' + assignment.targetLabel + ' » ? Le parcours lui-même ne sera pas supprimé.';
  document.getElementById('parcours-confirm-overlay').style.display = 'flex';
}

// ---------------------------------------------------------------------------
// Edition
// ---------------------------------------------------------------------------

export async function saveParcoursEdit() {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p) return;
  const fields = {
    name: valueOf('parcours-edit-name'),
    description: valueOf('parcours-edit-description'),
    targetAudience: valueOf('parcours-edit-audience'),
    color: valueOf('parcours-edit-color'),
    icon: valueOf('parcours-edit-icon'),
  };
  const result = await editParcoursMetadata(p, fields);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') await loadPage();
}

// ---------------------------------------------------------------------------
// Competences
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NOUVEAU (Sprint 13) : sélection d'une ou plusieurs compétences EXISTANTES
// dans la Banque des compétences, remplace l'ancien ajout en texte libre
// (submitAddCompetency) et l'ancien panneau "Ajouter plusieurs" (Sprint 12
// correctif, conservés côté service pour compatibilité et migration
// uniquement — voir js/services/parcours-service.js).
// ---------------------------------------------------------------------------

let competencyPickerSelection = new Set(); // identifiants de fiches de la banque cochées dans le panneau
let competencyPickerResults = [];

export async function openCompetencyPickerPanel() {
  competencyPickerSelection = new Set();
  document.getElementById('parcours-competency-picker-search').value = '';
  document.getElementById('parcours-competency-picker-overlay').style.display = 'flex';
  await runCompetencyPickerSearch('');
}
export function closeCompetencyPickerPanel() {
  document.getElementById('parcours-competency-picker-overlay').style.display = 'none';
}

let competencyPickerDebounce = null;
export function onCompetencyPickerSearchInput() {
  clearTimeout(competencyPickerDebounce);
  const value = valueOf('parcours-competency-picker-search');
  competencyPickerDebounce = setTimeout(function() { runCompetencyPickerSearch(value); }, 250);
}

async function runCompetencyPickerSearch(searchText) {
  const container = document.getElementById('parcours-competency-picker-results');
  container.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  const alreadyLinkedIds = (p && Array.isArray(p.competencies))
    ? p.competencies.map(function(c) { return c.competencyId; }).filter(Boolean)
    : [];

  // NOTE (limite documentée) : browseCompetencies() exige la permission
  // MANAGE_COMPETENCIES (voir authorization-service.js). Aujourd'hui, seul
  // le rôle admin existe réellement et possède déjà les deux permissions
  // (MANAGE_PARCOURS + MANAGE_COMPETENCIES) — un futur rôle qui gérerait
  // les parcours SANS gérer la banque de compétences ne pourrait pas
  // encore lier de compétence depuis cet écran ; signalé ici plutôt que
  // masqué, à traiter le jour où un tel rôle serait réellement attribué.
  const result = await browseCompetencies({
    searchText: searchText, filters: { status: 'published' },
    sortField: 'name', sortDirection: 'asc', pageSize: 50,
  });

  if (!result.authorized || result.error) {
    container.innerHTML = '<p>' + escapeHtml(result.message || 'Impossible de charger la banque des compétences.') + '</p>';
    competencyPickerResults = [];
    return;
  }

  competencyPickerResults = result.items.filter(function(c) { return alreadyLinkedIds.indexOf(c.id) === -1; });

  if (competencyPickerResults.length === 0) {
    container.innerHTML = '<p class="bank-list-empty">Aucune compétence publiée disponible (ou déjà toutes liées à ce parcours).</p>';
    return;
  }

  container.innerHTML = competencyPickerResults.map(function(c) {
    const hex = resolveCompetencyColorHex(c.color);
    const colorDot = hex ? '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + escapeHtml(hex) + ';margin-right:6px;"></span>' : '';
    return '<label style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer;">' +
      '<input type="checkbox" onchange="toggleCompetencyPick(\'' + escapeHtml(c.id) + '\')">' +
      colorDot + '<span><strong>' + escapeHtml(c.name) + '</strong>' + (c.category ? ' — ' + escapeHtml(c.category) : '') + '</span>' +
      '</label>';
  }).join('');
}

export function toggleCompetencyPick(competencyId) {
  if (competencyPickerSelection.has(competencyId)) competencyPickerSelection.delete(competencyId);
  else competencyPickerSelection.add(competencyId);
}

export async function confirmCompetencyPicker() {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p || competencyPickerSelection.size === 0) return;

  const ids = Array.from(competencyPickerSelection);
  let lastResult = null;
  for (const competencyId of ids) {
    lastResult = await addCompetencyFromBank(p, competencyId);
    if (lastResult.status === 'success') p.competencies = lastResult.competencies;
  }

  showParcoursMessage(lastResult ? lastResult.status : 'error', ids.length + ' compétence(s) traitée(s).');
  closeCompetencyPickerPanel();
  await selectParcours(p.id);
}

export async function requestRemoveCompetency(competencyId) {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p) return;
  const result = await removeCompetency(p, competencyId);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    p.competencies = result.competencies;
    await selectParcours(p.id);
  }
}

export async function moveCompetencyUp(competencyId) {
  await handleMoveCompetency(competencyId, -1);
}
export async function moveCompetencyDown(competencyId) {
  await handleMoveCompetency(competencyId, 1);
}
async function handleMoveCompetency(competencyId, direction) {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p) return;
  const result = await moveCompetency(p, competencyId, direction);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    p.competencies = result.competencies;
    await selectParcours(p.id);
  }
}

// ---------------------------------------------------------------------------
// Liaison de questions
// ---------------------------------------------------------------------------

export function openLinkQuestionPanel(competencyId) {
  linkingCompetencyId = competencyId;
  document.getElementById('parcours-link-search').value = '';
  document.getElementById('parcours-link-results').innerHTML = '';
  document.getElementById('parcours-link-overlay').style.display = 'flex';
}
export function closeLinkQuestionPanel() {
  linkingCompetencyId = null;
  document.getElementById('parcours-link-overlay').style.display = 'none';
}
export async function onLinkSearchInput() {
  const searchText = valueOf('parcours-link-search');
  const result = await searchQuestionsForLinking({ searchText: searchText });
  const container = document.getElementById('parcours-link-results');
  if (!result.authorized || result.error) {
    container.textContent = result.message || 'Impossible de rechercher des questions.';
    return;
  }
  if (result.items.length === 0) {
    container.innerHTML = '<p>Aucune question ne correspond.</p>';
    return;
  }
  container.innerHTML = result.items.map(function(q) {
    return '<div class="bank-row" onclick="pickQuestionToLink(\'' + escapeHtml(q.pedagogicalId) + '\')">' +
      '<div class="bank-row-top"><span class="bank-row-id">' + escapeHtml(q.pedagogicalId) + '</span></div>' +
      '<div class="bank-row-question">' + escapeHtml((q.question || '').slice(0, 90)) + '</div>' +
    '</div>';
  }).join('');
}
export async function pickQuestionToLink(pedagogicalId) {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p || !linkingCompetencyId) return;
  const result = await linkQuestionToCompetency(p, linkingCompetencyId, pedagogicalId);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    p.competencies = result.competencies;
    closeLinkQuestionPanel();
    await selectParcours(p.id);
  }
}
export async function unlinkQuestion(competencyId, pedagogicalId) {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p) return;
  const result = await unlinkQuestionFromCompetency(p, competencyId, pedagogicalId);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    p.competencies = result.competencies;
    await selectParcours(p.id);
  }
}

// ---------------------------------------------------------------------------
// Confirmation avant action sensible
// ---------------------------------------------------------------------------

const ACTION_LABELS = {
  publish: 'publier', archive: 'archiver', draft: 'remettre en brouillon',
  trash: 'mettre à la corbeille', restore: 'restaurer depuis la corbeille', purge: 'supprimer définitivement',
};

export function requestParcoursAction(kind) {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p) return;
  pendingAction = { kind: kind, parcours: p };
  const verb = ACTION_LABELS[kind] || kind;
  let extra = '';
  if (kind === 'purge') extra = ' Cette action est définitive et ne peut pas être annulée.';
  else if (kind === 'trash') extra = ' Ce parcours pourra être restauré depuis la corbeille, ou supprimé définitivement plus tard.';
  document.getElementById('parcours-confirm-message').textContent = 'Voulez-vous vraiment ' + verb + ' le parcours « ' + p.name + ' » ?' + extra;
  document.getElementById('parcours-confirm-overlay').style.display = 'flex';
}

export function cancelParcoursAction() {
  pendingAction = null;
  document.getElementById('parcours-confirm-overlay').style.display = 'none';
}

export async function confirmParcoursAction() {
  document.getElementById('parcours-confirm-overlay').style.display = 'none';
  if (!pendingAction) return;
  const action = pendingAction;
  pendingAction = null;

  // NOUVEAU (Sprint 15) : suppression d'une attribution - cas distinct des
  // transitions de statut du parcours ci-dessous (ne concerne jamais le
  // parcours lui-même, seulement le lien assignments/{id}).
  if (action.kind === 'remove_assignment') {
    const result = await removeAssignment(action.assignment);
    showParcoursMessage(result.status, result.message);
    if (result.status === 'success') {
      const p = state.items.find(function(item) { return item.id === state.selectedId; });
      if (p) await renderAssignments(p);
    }
    return;
  }

  let result;
  if (action.kind === 'publish') result = await publishParcours(action.parcours);
  else if (action.kind === 'archive') result = await archiveParcours(action.parcours);
  else if (action.kind === 'draft') result = await revertParcoursToDraft(action.parcours);
  else if (action.kind === 'trash') result = await moveParcoursToTrash(action.parcours);
  else if (action.kind === 'restore') result = await restoreParcoursFromTrash(action.parcours);
  else if (action.kind === 'purge') result = await permanentlyDeleteParcours(action.parcours);

  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    if (action.kind === 'purge') {
      state.selectedId = null;
      document.getElementById('parcours-detail').style.display = 'none';
      document.getElementById('parcours-detail-placeholder').style.display = 'block';
    }
    await loadPage();
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function showParcoursMessage(status, text) {
  const el = document.getElementById('parcours-message');
  if (!el) return;
  el.className = 'admin-message admin-message-' + status;
  el.textContent = text;
  el.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return (s === undefined || s === null ? '' : s).toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------------------------------------------------------------------------
// Pont vers le HTML classique
// ---------------------------------------------------------------------------
window.onParcoursSearchInput = onParcoursSearchInput;
window.onParcoursFilterChange = onParcoursFilterChange;
window.toggleParcoursSortDirection = toggleParcoursSortDirection;
window.goToParcoursPage = goToParcoursPage;
window.openCreateParcoursForm = openCreateParcoursForm;
window.closeCreateParcoursForm = closeCreateParcoursForm;
window.submitCreateParcours = submitCreateParcours;
window.selectParcours = selectParcours;
window.saveParcoursEdit = saveParcoursEdit;
window.requestRemoveCompetency = requestRemoveCompetency;
window.moveCompetencyUp = moveCompetencyUp;
window.moveCompetencyDown = moveCompetencyDown;
window.openLinkQuestionPanel = openLinkQuestionPanel;
window.closeLinkQuestionPanel = closeLinkQuestionPanel;
window.onLinkSearchInput = onLinkSearchInput;
window.pickQuestionToLink = pickQuestionToLink;
window.unlinkQuestion = unlinkQuestion;
window.requestParcoursAction = requestParcoursAction;
window.cancelParcoursAction = cancelParcoursAction;
window.confirmParcoursAction = confirmParcoursAction;
window.pickParcoursColor = pickParcoursColor;
window.openCompetencyPickerPanel = openCompetencyPickerPanel;
window.closeCompetencyPickerPanel = closeCompetencyPickerPanel;
window.onCompetencyPickerSearchInput = onCompetencyPickerSearchInput;
window.toggleCompetencyPick = toggleCompetencyPick;
window.confirmCompetencyPicker = confirmCompetencyPicker;
window.openAssignmentPickerPanel = openAssignmentPickerPanel;
window.closeAssignmentPickerPanel = closeAssignmentPickerPanel;
window.pickAssignmentType = pickAssignmentType;
window.onAssignmentSearchInput = onAssignmentSearchInput;
window.pickAssignmentTarget = pickAssignmentTarget;
window.confirmAssignmentPicker = confirmAssignmentPicker;
window.requestRemoveAssignment = requestRemoveAssignment;
