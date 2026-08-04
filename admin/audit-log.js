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
import { formatDateFr, toMillis } from "../js/services/date-utils.js";
import { getRecentAuditEntries } from "../js/services/audit-service.js";
import { getRecentQuestionAuditLogs } from "../js/services/question-audit-service.js";
import { getRecentParcoursAuditLogs } from "../js/services/parcours-audit-service.js";
import { getRecentCompetencyAuditLogs } from "../js/services/competency-audit-service.js";
import { getRecentReferenceBankAuditEntries } from "../js/services/reference-bank-service.js";
import { renderAdminNav } from "./admin-shell.js";
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

// ── Tables de traduction ──────────────────────────────────────────────────────

const STATUS_LABELS = {
  draft: 'Brouillon', published: 'Publié', archived: 'Archivé',
  review: 'En relecture', trash: 'Corbeille',
  active: 'Actif', suspended: 'Suspendu', inactive: 'Inactif',
};
const ROLE_LABELS = {
  user: 'Utilisateur', admin: 'Administrateur', manager: 'Manager',
};
const BUSINESS_FIELD_LABELS = {
  organizationType:    'Modification du type d\'organisation',
  organizationName:    'Modification du nom de l\'organisation',
  organizationId:      'Modification de l\'organisation (rattachement)',
  firstName:           'Modification du prénom',
  lastName:            'Modification du nom de famille',
  profileId:           'Modification du profil',
  groupIds:            'Modification des groupes',
  role:                'Modification du rôle',
  status:              'Modification du statut',
};
const PARCOURS_FIELD_LABELS = {
  name: 'nom', description: 'description', targetAudience: 'public cible',
  color: 'couleur', icon: 'icône', level: 'niveau',
};
const REFBANK_FIELD_LABELS = {
  name: 'nom', description: 'description', color: 'couleur', type: 'type',
};

function statusLabel(v) { return STATUS_LABELS[v] || v || '—'; }
function roleLabel(v)   { return ROLE_LABELS[v]   || v || '—'; }
function arrow(a, b)    { return statusLabel(a) + ' → ' + statusLabel(b); }

const QUESTION_STATUS_TRANSITION_LABELS = {
  'draft->review':    'Envoyée en relecture',
  'draft->published': 'Publication',
  'review->published': 'Publication', 'archived->published': 'Publication',
  'published->archived': 'Archivage', 'review->archived': 'Archivage',
  'draft->archived': 'Archivage',    'archived->trash': 'Mise à la corbeille',
  'trash->archived': 'Restauration depuis la corbeille',
  'archived->draft': 'Remise en brouillon', 'published->draft': 'Remise en brouillon',
  'review->draft': 'Remise en brouillon',   'archived->review': 'Envoyée en relecture',
};

function describeUsersEntry(entry) {
  if (entry.actionType === 'account_created') return 'Compte créé';
  if (entry.actionType === 'evaluation_completed') {
    const pct = (typeof entry.percent === 'number') ? entry.percent + ' %' : '—';
    return 'Évaluation terminée — ' + pct + ' (' + entry.correct + '/' + entry.total + ')';
  }
  if (entry.actionType === 'role_change') {
    return 'Changement de rôle : ' + roleLabel(entry.oldValue) + ' → ' + roleLabel(entry.newValue);
  }
  if (entry.actionType === 'status_change') {
    return 'Changement de statut : ' + arrow(entry.oldValue, entry.newValue);
  }
  if (entry.actionType && entry.actionType.indexOf('business_profile_edit_') === 0) {
    const field = entry.actionType.replace('business_profile_edit_', '');
    const fullLabel = BUSINESS_FIELD_LABELS[field] || ('Modification : ' + field);
    const detail = (entry.newValue && entry.newValue !== entry.oldValue)
      ? ' → ' + entry.newValue
      : '';
    return fullLabel + detail;
  }
  if (entry.actionType === 'document_source_bulk_activated') return 'Sources documentaires activées en masse';
  if (entry.actionType === 'document_source_shown_in_training') return 'Source documentaire affichée en formation';
  if (entry.actionType === 'document_source_hidden_from_training') return 'Source documentaire masquée des formations';
  if (entry.actionType === 'document_source_renamed')
    return 'Source documentaire renommée' + (entry.newValue ? ' → « ' + entry.newValue + ' »' : '');
  if (entry.actionType === 'document_source_icon_updated') return 'Icône de source documentaire mise à jour';
  if (entry.actionType && entry.actionType.indexOf('document_source_') === 0)
    return 'Source documentaire : ' + entry.actionType.replace('document_source_', '').replace(/_/g, ' ');
  return null;
}
function describeQuestionsEntry(entry) {
  if (entry.actionType === 'status_change') {
    const key = entry.oldValue + '->' + entry.newValue;
    return QUESTION_STATUS_TRANSITION_LABELS[key]
      || ('Changement de statut : ' + arrow(entry.oldValue, entry.newValue));
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
  if (entry.actionType === 'status_change') {
    const key = entry.oldValue + '->' + entry.newValue;
    return QUESTION_STATUS_TRANSITION_LABELS[key]
      || ('Changement de statut : ' + arrow(entry.oldValue, entry.newValue));
  }
  if (entry.actionType === 'edit_name')         return 'Modification du nom';
  if (entry.actionType === 'edit_description')  return 'Modification de la description';
  if (entry.actionType === 'edit_targetAudience') return 'Modification du public cible';
  if (entry.actionType === 'edit_color')        return 'Modification de la couleur';
  if (entry.actionType === 'edit_icon')         return 'Modification de l\'icône';
  if (entry.actionType === 'add_competency')
    return 'Compétence ajoutée' + (entry.newValue ? ' : ' + entry.newValue : '');
  if (entry.actionType === 'add_competencies_bulk')
    return 'Ajout groupé de compétences' + (entry.newValue ? ' (' + entry.newValue + ')' : '');
  if (entry.actionType === 'remove_competency')
    return 'Compétence retirée' + (entry.oldValue ? ' : ' + entry.oldValue : '');
  if (entry.actionType === 'reorder_competency') return 'Réorganisation des compétences';
  if (entry.actionType === 'link_question')
    return 'Question rattachée au parcours' + (entry.oldValue ? ' « ' + entry.oldValue + ' »' : '');
  if (entry.actionType === 'unlink_question')
    return 'Rattachement retiré' + (entry.newValue ? ' (« ' + entry.newValue + ' »)' : '');
  if (entry.actionType === 'add_source')
    return 'Source ajoutée' + (entry.newValue ? ' : ' + entry.newValue : '');
  if (entry.actionType === 'remove_source') return 'Source retirée';
  if (entry.actionType === 'add_direct_question')
    return 'Question ajoutée en accès direct' + (entry.newValue ? ' : ' + entry.newValue : '');
  if (entry.actionType === 'remove_direct_question')
    return 'Question retirée de l\'accès direct' + (entry.oldValue ? ' : ' + entry.oldValue : '');
  if (entry.actionType === 'assign')
    return 'Attribué à : ' + (entry.newValue || '—');
  if (entry.actionType === 'unassign')
    return 'Attribution retirée' + (entry.oldValue ? ' : ' + entry.oldValue : '');
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return null;
}
function describeCompetenciesEntry(entry) {
  if (entry.actionType === 'creation') return 'Création';
  if (entry.actionType === 'status_change') {
    const key = entry.oldValue + '->' + entry.newValue;
    return QUESTION_STATUS_TRANSITION_LABELS[key]
      || ('Changement de statut : ' + arrow(entry.oldValue, entry.newValue));
  }
  if (entry.actionType === 'bulk_publish') return 'Publication en masse';
  if (entry.actionType === 'edit_name')             return 'Modification du nom';
  if (entry.actionType === 'edit_description')      return 'Modification de la description';
  if (entry.actionType === 'edit_category')         return 'Modification de la catégorie';
  if (entry.actionType === 'edit_color')            return 'Modification de la couleur';
  if (entry.actionType === 'edit_keywords')         return 'Modification des mots-clés';
  if (entry.actionType === 'edit_recommendedLevel') return 'Modification du niveau conseillé';
  if (entry.actionType === 'migration_import') return 'Créée lors de la migration';
  if (entry.actionType === 'purge') return 'Suppression définitive';
  return null;
}
function describeReferenceBanksEntry(entry) {
  if (entry.actionType === 'status_change') {
    return 'Changement de statut : ' + arrow(entry.oldValue, entry.newValue);
  }
  if (entry.actionType && entry.actionType.indexOf('edit_') === 0) {
    const field = entry.actionType.slice(5);
    const fieldLabel = REFBANK_FIELD_LABELS[field] || field;
    return 'Modification : ' + fieldLabel;
  }
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
  renderAdminNav('audit');

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
  // CORRECTIF : `date` n'est pas toujours une chaine ISO - certaines
  // entrees anciennes de audit_logs (ecrites avant la migration vers les
  // Cloud Functions) stockent un Timestamp Firestore brut
  // ({seconds, nanoseconds}), qui n'a pas de methode localeCompare().
  // toMillis() (date-utils.js) gere deja tous ces formats de façon
  // uniforme - jamais un tri qui plante sur une donnee heritee.
  state.items = (result.items || []).slice().sort(function(a, b) { return toMillis(b.date) - toMillis(a.date); });
  renderList();
}

export function onAuditSearchInput() {
  state.searchText = document.getElementById('al-search').value.trim().toLowerCase();
  renderList();
}

// ── Helpers pour le rendu amélioré ───────────────────────────────────────────

function dayKey(entry) {
  const ms = toMillis(entry.date);
  if (!ms) return '0000-00-00';
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function dayLabel(key) {
  if (!key || key === '0000-00-00') return 'Date inconnue';
  const today = new Date();
  const pad = function(n) { return String(n).padStart(2, '0'); };
  const todayKey = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const yesterdayKey = yest.getFullYear() + '-' + pad(yest.getMonth() + 1) + '-' + pad(yest.getDate());
  if (key === todayKey) return 'Aujourd\'hui';
  if (key === yesterdayKey) return 'Hier';
  try {
    return new Date(key + 'T12:00:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return key; }
}

function timeLabel(entry) {
  const ms = toMillis(entry.date);
  if (!ms) return '';
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function getEntryColor(tabKey, entry) {
  const at = entry.actionType || '';
  if (at === 'purge' || (at === 'status_change' && entry.newValue === 'trash')) return 'red';
  if (at === 'creation' || at === 'account_created') return 'green';
  if (at === 'bulk_publish') return 'green';
  if (at === 'status_change') {
    if (entry.newValue === 'published') return 'green';
    if (entry.newValue === 'archived') return 'orange';
    if (entry.newValue === 'trash') return 'red';
    return 'purple';
  }
  if (at === 'role_change') return 'orange';
  if (at.indexOf('edit_') === 0 || at.indexOf('business_profile_edit_') === 0 || at.indexOf('document_source_') === 0) return 'blue';
  if (at === 'assign' || at === 'unassign' || at === 'link_question' || at === 'unlink_question') return 'purple';
  if (at.indexOf('add_') === 0 || at.indexOf('remove_') === 0 || at === 'reorder_competency') return 'blue';
  if (at === 'evaluation_completed') return 'neutral';
  return 'neutral';
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

  // Grouper par jour
  const groups = [];
  const groupMap = {};
  filtered.forEach(function(entry) {
    const key = dayKey(entry);
    if (!groupMap[key]) { groupMap[key] = []; groups.push({ key: key, items: groupMap[key] }); }
    groupMap[key].push(entry);
  });

  listEl.innerHTML = groups.map(function(group) {
    const items = group.items.map(function(entry) {
      const color  = getEntryColor(state.activeTab, entry);
      const label  = escapeHtml(describeEntry(state.activeTab, entry));
      const time   = escapeHtml(timeLabel(entry));
      const actor  = entry.adminEmail || entry.targetEmail || '';
      const target = entry[tabConfig.targetField];

      const whoHtml    = actor  ? '<span class="al-who">' + escapeHtml(actor) + '</span>' : '';
      const targetHtml = target ? '<span class="al-target">' + escapeHtml(String(target)) + '</span>' : '';
      const timeHtml   = time   ? '<span class="al-time">' + time + '</span>' : '';

      return '<li class="bank-timeline-item bank-timeline-item-' + color + '">' +
        '<div class="bank-timeline-content">' +
          '<div class="bank-timeline-label">' + label + '</div>' +
          '<div class="bank-timeline-meta">' + whoHtml + targetHtml + timeHtml + '</div>' +
        '</div>' +
      '</li>';
    }).join('');

    return '<div class="al-day-group">' +
      '<div class="al-day-header">' + escapeHtml(dayLabel(group.key)) + '</div>' +
      '<ul class="bank-timeline-list">' + items + '</ul>' +
    '</div>';
  }).join('');
}

window.switchAuditTab = switchAuditTab;
window.onAuditSearchInput = onAuditSearchInput;
