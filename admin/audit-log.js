// ===================== CONTROLEUR DU JOURNAL D'AUDIT CONSOLIDE (demande directe de David, 27/07/2026) =====================
// Aucune logique metier ici : appelle les services d'audit deja existants
// de chaque domaine (audit-service.js, question-audit-service.js,
// parcours-audit-service.js, competency-audit-service.js,
// reference-bank-service.js) et affiche le resultat - meme discipline que
// tous les autres ecrans d'administration du projet.
//
// RAISON D'ETRE : chaque domaine avait DEJA son propre historique traduit
// (visible uniquement depuis la fiche d'UN element precis - une question,
// un parcours...), mais aucune page ne donnait de vue d'ensemble ("j'ai
// l'impression de devoir ouvrir Firestore pour voir ce qui se passe").
// Cette page ne duplique aucune regle de traduction : describeEntry()
// ci-dessous reprend fidelement le vocabulaire deja utilise par les
// describeAuditEntry() prives de chaque fichier (question-bank-service.js,
// parcours-service.js, competency-service.js, admin/users.js,
// reference-bank-service.js), regroupe ici en un seul endroit pour ne pas
// multiplier les imports d'une fonction privee par fichier.

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { formatDateFr } from "../js/services/date-utils.js";
import { getRecentAuditEntries } from "../js/services/audit-service.js";
import { getRecentQuestionAuditLogs } from "../js/services/question-audit-service.js";
import { getRecentParcoursAuditLogs } from "../js/services/parcours-audit-service.js";
import { getRecentCompetencyAuditLogs } from "../js/services/competency-audit-service.js";
import { getRecentReferenceBankAuditEntries } from "../js/services/reference-bank-service.js";
import { renderSiteHeader } from "../js/site-header.js";
import { icon } from "../js/icons.js";

const READ_LIMIT = 200;

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showMessage(status, message) {
  const el = document.getElementById('al-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Onglets (un domaine = une collection Firestore deja existante)
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'users', label: 'Utilisateurs', targetField: 'targetEmail' },
  { key: 'questions', label: 'Questions', targetField: 'pedagogicalId' },
  { key: 'parcours', label: 'Parcours', targetField: 'parcoursId' },
  { key: 'competencies', label: 'Compétences', targetField: 'competencyId' },
  { key: 'referenceBanks', label: 'Organisations / Profils / Groupes', targetField: 'entityId' },
];

let state = { activeTab: 'users', items: [], searchText: '' };

async function fetchTab(tabKey) {
  if (tabKey === 'users') return getRecentAuditEntries({ limit: READ_LIMIT });
  if (tabKey === 'questions') return getRecentQuestionAuditLogs({ limit: READ_LIMIT });
  if (tabKey === 'parcours') return getRecentParcoursAuditLogs({ limit: READ_LIMIT });
  if (tabKey === 'competencies') return getRecentCompetencyAuditLogs({ limit: READ_LIMIT });
  if (tabKey === 'referenceBanks') return getRecentReferenceBankAuditEntries({ limit: READ_LIMIT });
  return { items: [], error: false };
}

// ---------------------------------------------------------------------------
// Traduction ("qu'est-ce que ça veut dire ?") - reprend fidelement le
// vocabulaire deja utilise par chaque describeAuditEntry() prive existant.
// ---------------------------------------------------------------------------

const QUESTION_STATUS_TRANSITION_LABELS = {
  'draft->review': 'Envoyée en relecture', 'draft->published': 'Publication',
  'review->published': 'Publication', 'archived->published': 'Publication',
  'published->archived': 'Archivage', 'review->archived': 'Archivage',
  'draft->archived': 'Archivage', 'archived->trash': 'Mise à la corbeille',
  'trash->archived': 'Restauration depuis la corbeille', 'archived->draft': 'Remise en brouillon',
  'published->draft': 'Remise en brouillon', 'review->draft': 'Remise en brouillon',
  'archived->review': 'Envoyée en relecture',
};

function describeUsersEntry(entry) {
  if (entry.actionType === 'account_created') return 'Compte créé';
  if (entry.actionType === 'evaluation_completed') {
    const pct = (typeof entry.percent === 'number') ? entry.percent + ' %' : '—';
    return 'Évaluation terminée — ' + pct + ' (' + entry.correct + '/' + entry.total + ')';
  }
  if (entry.actionType === 'role_change') return 'Changement de rôle (' + entry.oldValue + ' → ' + entry.newValue + ')';
  if (entry.actionType === 'status_change') return 'Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')';
  if (entry.actionType && entry.actionType.indexOf('business_profile_edit_') === 0) return 'Modification (' + entry.actionType.replace('business_profile_edit_', '') + ')';
  return null;
}
function describeQuestionsEntry(entry) {
  if (entry.actionType === 'status_change') {
    const key = entry.oldValue + '->' + entry.newValue;
    return QUESTION_STATUS_TRANSITION_LABELS[key] || ('Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')');
  }
  if (entry.actionType === 'bulk_publish') return 'Publication en masse';
  if (entry.actionType === 'edit_explanation') return 'Modification de l\'explication';
  if (entry.actionType === 'edit_tags') return 'Modification des tags';
  if (entry.actionType === 'edit_source') return 'Modification de la source';
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return null;
}
function describeParcoursEntry(entry) {
  if (entry.actionType === 'creation') return 'Création';
  if (entry.actionType === 'status_change') return 'Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')';
  if (entry.actionType === 'edit_name') return 'Modification du nom';
  if (entry.actionType === 'edit_description') return 'Modification de la description';
  if (entry.actionType === 'edit_targetAudience') return 'Modification du public cible';
  if (entry.actionType === 'edit_color') return 'Modification de la couleur';
  if (entry.actionType === 'edit_icon') return 'Modification de l\'icône';
  if (entry.actionType === 'add_competency') return 'Ajout d\'une compétence (' + entry.newValue + ')';
  if (entry.actionType === 'add_competencies_bulk') return 'Ajout multiple de compétences (' + entry.newValue + ')';
  if (entry.actionType === 'remove_competency') return 'Suppression d\'une compétence (' + entry.oldValue + ')';
  if (entry.actionType === 'reorder_competency') return 'Réordonnancement des compétences';
  if (entry.actionType === 'link_question') return 'Question liée à « ' + entry.oldValue + ' »';
  if (entry.actionType === 'unlink_question') return 'Liaison retirée de « ' + entry.newValue + ' »';
  if (entry.actionType === 'add_source') return 'Source ajoutée (' + entry.newValue + ')';
  if (entry.actionType === 'remove_source') return 'Source retirée';
  if (entry.actionType === 'add_direct_question') return 'Question ajoutée directement (' + entry.newValue + ')';
  if (entry.actionType === 'remove_direct_question') return 'Question retirée directement (' + entry.oldValue + ')';
  if (entry.actionType === 'assign') return 'Attribution ajoutée (' + entry.newValue + ')';
  if (entry.actionType === 'unassign') return 'Attribution retirée (' + entry.oldValue + ')';
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return null;
}
function describeCompetenciesEntry(entry) {
  if (entry.actionType === 'creation') return 'Création';
  if (entry.actionType === 'status_change') return 'Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')';
  if (entry.actionType === 'bulk_publish') return 'Publication en masse';
  if (entry.actionType === 'edit_name') return 'Modification du nom';
  if (entry.actionType === 'edit_description') return 'Modification de la description';
  if (entry.actionType === 'edit_category') return 'Modification de la catégorie';
  if (entry.actionType === 'edit_color') return 'Modification de la couleur';
  if (entry.actionType === 'edit_keywords') return 'Modification des mots-clés';
  if (entry.actionType === 'edit_recommendedLevel') return 'Modification du niveau conseillé';
  if (entry.actionType === 'migration_import') return 'Créée automatiquement lors de la migration';
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return null;
}
function describeReferenceBanksEntry(entry) {
  if (entry.actionType === 'status_change') return 'Changement de statut (' + entry.oldValue + ' → ' + entry.newValue + ')';
  if (entry.actionType && entry.actionType.indexOf('edit_') === 0) return 'Modification (' + entry.actionType.slice(5) + ')';
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return null;
}
const DESCRIBERS = {
  users: describeUsersEntry, questions: describeQuestionsEntry, parcours: describeParcoursEntry,
  competencies: describeCompetenciesEntry, referenceBanks: describeReferenceBanksEntry,
};
function describeEntry(tabKey, entry) {
  return DESCRIBERS[tabKey](entry) || ('Action (' + entry.actionType + ')');
}

// ---------------------------------------------------------------------------
// Controle d'acces
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('al-loading');
  const deniedEl = document.getElementById('al-denied');
  const viewEl = document.getElementById('al-view');

  if (!user) { clearCurrentUserContext(); window.location.href = '../index.html'; return; }
  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) { console.error('Erreur lors de la vérification du compte :', err); }

  if (loadingEl) loadingEl.style.display = 'none';
  if (!hasPermission(PERMISSIONS.MANAGE_USERS)) {
    if (deniedEl) deniedEl.style.display = 'block';
    if (viewEl) viewEl.style.display = 'none';
    return;
  }
  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('administration');

  renderTabs();
  await loadTab('users');
});

function renderTabs() {
  const container = document.getElementById('al-tabs');
  container.innerHTML = TABS.map(function(t) {
    const activeCls = t.key === state.activeTab ? ' bank-tab-active' : '';
    return '<button type="button" class="bank-tab' + activeCls + '" onclick="switchAuditTab(\'' + t.key + '\')">' + escapeHtml(t.label) + '</button>';
  }).join('');
}

export async function switchAuditTab(tabKey) {
  state.activeTab = tabKey;
  state.searchText = '';
  document.getElementById('al-search').value = '';
  renderTabs();
  await loadTab(tabKey);
}

async function loadTab(tabKey) {
  const listEl = document.getElementById('al-list');
  const emptyEl = document.getElementById('al-list-empty');
  listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  emptyEl.style.display = 'none';
  showMessage(null, null);

  const result = await fetchTab(tabKey);
  if (result.error) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'Impossible de charger ce journal pour le moment. Réessayez plus tard.';
    return;
  }
  state.items = (result.items || []).slice().sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
  renderList();
}

export function onAuditSearchInput() {
  state.searchText = document.getElementById('al-search').value.trim().toLowerCase();
  renderList();
}

function renderList() {
  const listEl = document.getElementById('al-list');
  const emptyEl = document.getElementById('al-list-empty');
  const tabConfig = TABS.find(function(t) { return t.key === state.activeTab; });
  const needle = state.searchText;

  const filtered = !needle ? state.items : state.items.filter(function(entry) {
    const haystack = [
      entry.adminEmail, entry.targetEmail, entry.actionType,
      entry[tabConfig.targetField], entry.oldValue, entry.newValue,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.indexOf(needle) !== -1;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = state.items.length === 0
      ? 'Aucune action journalisée pour ce domaine pour le moment.'
      : 'Aucune action ne correspond à ce filtre.';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = '<ul class="bank-timeline-list">' + filtered.map(function(entry) {
    const dateLabel = entry.date ? formatDateFr(entry.date) : '—';
    const who = entry.adminEmail ? ' — ' + escapeHtml(entry.adminEmail) : '';
    const target = entry[tabConfig.targetField];
    const targetLabel = target ? ' <span class="bank-row-id">' + escapeHtml(target) + '</span>' : '';
    return '<li class="bank-timeline-item"><div class="bank-timeline-date">' + escapeHtml(dateLabel) + '</div>' +
      '<div class="bank-timeline-label">' + escapeHtml(describeEntry(state.activeTab, entry)) + who + targetLabel + '</div></li>';
  }).join('') + '</ul>';
}

window.switchAuditTab = switchAuditTab;
window.onAuditSearchInput = onAuditSearchInput;
