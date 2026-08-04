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
import { formatDateFr, todayDateStr } from "../js/services/date-utils.js";
import {
  PARCOURS_STATUSES,
  PARCOURS_COLOR_HEX, resolveParcoursColorHex,
  PARCOURS_ICON_PICKER_CHOICES, PARCOURS_DEFAULT_ICON, resolveParcoursIconKey,
  isParcoursCurrentlyFeatured,
  ACCESS_TIERS,
} from "../js/services/parcours-metadata-service.js";
import {
  browseParcours, createParcours, publishParcours, archiveParcours, revertParcoursToDraft,
  moveParcoursToTrash, restoreParcoursFromTrash, permanentlyDeleteParcours, setParcoursFeatured,
  setParcoursAccessTier, setParcoursOrganization,
  editParcoursMetadata, removeCompetency, moveCompetency,
  linkQuestionToCompetency, unlinkQuestionFromCompetency, searchQuestionsForLinking,
  addCompetencyFromBank, resolveParcoursCompetenciesDisplay,
  addSourceToParcours, removeSourceFromParcours,
  addQuestionDirectlyToParcours, removeQuestionDirectlyFromParcours,
  resolveParcoursDirectContentDisplay,
  resolvePooledQuestionIds, resolveDerivedCompetenciesFromPool,
  getParcoursTimeline,
} from "../js/services/parcours-service.js";
import { browseCompetencies } from "../js/services/competency-service.js";
import { organizationsBank } from "../js/services/organizations-bank-service.js";
import { browseDocumentSources } from "../js/services/document-source-service.js";
import { DOCUMENT_SOURCE_TYPE_LABELS } from "../js/services/document-source-metadata-service.js";
import { browseQuestions } from "../js/services/question-bank-service.js";
import { COMPETENCY_COLOR_HEX, resolveCompetencyColorHex } from "../js/services/competency-metadata-service.js";
import {
  ASSIGNMENT_TARGET_TYPES, ASSIGNMENT_TARGET_TYPE_LABELS,
  ASSIGNMENT_PRIORITIES,
} from "../js/services/assignment-metadata-service.js";
import {
  listParcoursAssignments, createAssignment, removeAssignment, searchAssignmentTargets,
} from "../js/services/assignment-service.js";
import { fetchAllUsersBounded } from "../js/services/user-management-service.js";
import { renderAdminNav, showAdminConfirm } from "./admin-shell.js";
import { icon, renderAnyIcon, ICONS, DOT_ICONS } from "../js/icons.js";
import { API_BASE_URL } from "../js/config.js";

const KNOWN_ICON_KEYS = new Set([...Object.keys(ICONS), ...Object.keys(DOT_ICONS)]);

// CORRECTIF (bibliotheque d'icones, remplace les emojis) : `emoji` contient
// desormais le SVG inline deja rendu (icon(...)), plus un caractere - les
// sites d'appel (badge.emoji + ' ' + badge.label) restent inchanges.
const STATUS_BADGES = {
  draft: { emoji: icon('status-draft', { size: 14 }), label: 'Brouillon', cls: 'bank-badge-draft' },
  review: { emoji: icon('status-review', { size: 14 }), label: 'En relecture', cls: 'bank-badge-review' },
  published: { emoji: icon('status-published-active', { size: 14 }), label: 'Publié', cls: 'bank-badge-published' },
  archived: { emoji: icon('status-archived', { size: 14 }), label: 'Archivé', cls: 'bank-badge-archived' },
  trash: { emoji: icon('status-trash', { size: 14 }), label: 'Corbeille', cls: 'bank-badge-trash' },
};

let state = {
  searchText: '', filters: { status: '', author: '' }, sortField: 'createdAt', sortDirection: 'desc',
  items: [], hasMore: false, selectedId: null,
  derivedCompetencyCounts: new Map(), // parcoursId -> nb de competences deduites (voir loadPage())
  // AJOUT (demande directe de David, 28/07/2026, "menu des parcours peu
  // flexible") : selection multiple pour actions groupees (suppression,
  // mise en avant) - toujours videe au rechargement de la liste (recherche,
  // filtre, tri, pagination) pour ne jamais agir sur un parcours qui n'est
  // plus dans la vue courante (voir loadPage()).
  selectedIds: new Set(),
  // AJOUT (attribution a une organisation, demande directe de David,
  // 29/07/2026) : liste des organisations chargee UNE SEULE FOIS (peu
  // nombreuses, jamais paginee ici) pour peupler le selecteur de la fiche
  // detaillee - null tant qu'elle n'a pas encore ete chargee.
  organizations: null,
};
let pendingAction = null;      // { kind, parcours }
let linkingCompetencyId = null; // competence en cours de liaison (panneau de recherche de questions)
let suggestedQuestionsItems = []; // { competencyId, pedagogicalId, question, checked } - voir confirmCompetencyPicker()

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
  renderAdminNav('parcours');

  await loadPage();
});

// ---------------------------------------------------------------------------
// Chargement et rendu de la liste
// ---------------------------------------------------------------------------

// AJOUT (suppression de la pagination, demande directe de David,
// 28/07/2026 - "avec la pagination ce n'est pas evident") : charge TOUS
// les parcours correspondant aux filtres actifs en un seul appel, borne
// genereusement (meme principe que fetchAllUsersBounded(), USER_LIST_
// FETCH_LIMIT=500) plutot que 25 par page. Si la banque depasse un jour
// cette limite, un avertissement est affiche - jamais une troncature
// silencieuse.
const MAX_PARCOURS_DISPLAYED = 500;

async function loadPage() {
  const listEl = document.getElementById('parcours-list');
  const emptyEl = document.getElementById('parcours-list-empty');
  if (listEl) listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';
  if (emptyEl) emptyEl.style.display = 'none';
  state.selectedIds.clear();

  const result = await browseParcours({
    searchText: state.searchText, filters: state.filters,
    sortField: state.sortField, sortDirection: state.sortDirection,
    pageSize: MAX_PARCOURS_DISPLAYED, page: 0, cursorDoc: null,
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

  // AJOUT (demande directe de David, 28/07/2026 - "les competences ne sont
  // pas heritees non plus") : le nombre de competences affiche sur CHAQUE
  // ligne de la liste (rowHtml) ne comptait que parcours.competencies[]
  // (explicites), jamais les competences deduites des questions deja
  // presentes (resolveDerivedCompetenciesFromPool, voir selectParcours()
  // ci-dessus, meme logique) - une ligne pouvait donc afficher "0
  // competence(s)" alors que sa fiche detaillee en montrait plusieurs.
  // Resolu ici pour TOUS les parcours visibles, en parallele, une seule
  // fois par chargement de liste (jamais par ligne individuellement).
  const derivedCounts = new Map();
  await Promise.all(state.items.map(async function(p) {
    try {
      const pooled = await resolvePooledQuestionIds(p);
      const derived = await resolveDerivedCompetenciesFromPool(p, pooled);
      derivedCounts.set(p.id, derived.length);
    } catch (err) {
      derivedCounts.set(p.id, 0);
    }
  }));
  state.derivedCompetencyCounts = derivedCounts;

  const disclaimerEl = document.getElementById('parcours-search-disclaimer');
  if (disclaimerEl) {
    if (result.searchMode && result.truncatedScan) {
      disclaimerEl.style.display = 'block';
      disclaimerEl.textContent = 'Recherche limitée aux parcours les plus récents correspondant aux filtres actifs.';
    } else if (result.hasMore) {
      disclaimerEl.style.display = 'block';
      disclaimerEl.textContent = 'Plus de ' + MAX_PARCOURS_DISPLAYED + ' parcours correspondent à ces critères — seuls les ' + MAX_PARCOURS_DISPLAYED + ' premiers sont affichés.';
    } else {
      disclaimerEl.style.display = 'none';
    }
  }

  renderList(state.items);
}

function renderList(items) {
  const listEl = document.getElementById('parcours-list');
  const emptyEl = document.getElementById('parcours-list-empty');
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = 'Aucun parcours ne correspond à ces critères.'; }
    renderBulkBar();
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = items.map(rowHtml).join('');
  renderBulkBar();
}

// AJOUT (refonte de la liste, demande directe de David, 28/07/2026 -
// "pas très beau ou intuitif, et pas très flexible") : case a cocher
// (selection multiple) + etoile de mise en avant, directement dans la
// ligne - jamais besoin d'ouvrir la fiche complete pour ces deux actions.
// Classes dediees .parcours-row-* (voir css/styles.css) plutot que de
// modifier .bank-row/.bank-row-top, partagees avec d'autres ecrans admin
// (Banque de questions, Utilisateurs) qui ne doivent pas etre affectes.
function rowHtml(p) {
  const badge = STATUS_BADGES[p.status] || STATUS_BADGES.draft;
  const selected = p.id === state.selectedId ? ' parcours-row-selected' : '';
  const competencyCount = (p.competencies || []).length + (state.derivedCompetencyCounts.get(p.id) || 0);
  const checked = state.selectedIds.has(p.id) ? ' checked' : '';
  const starTitle = p.featured ? 'Retirer la mise en avant' : 'Mettre en avant';
  const isPremium = p.accessTier === ACCESS_TIERS.PREMIUM;
  const tierTitle = isPremium ? 'Repasser en gratuit' : 'Marquer comme premium';

  // AJOUT (onglet "À la une", demande directe de David, 29/07/2026) : le
  // badge distingue "à la une aujourd'hui" (fenetre active ou permanente)
  // de "mis en avant mais hors fenetre" (dates passees/futures) - jamais
  // un simple `p.featured` qui masquerait ce caractere temporaire.
  let featuredBadge = '';
  if (p.featured) {
    const isCurrent = isParcoursCurrentlyFeatured(p, todayDateStr());
    const range = (p.featuredStartDate || p.featuredEndDate)
      ? ' (' + (p.featuredStartDate ? formatDateFr(p.featuredStartDate) : '…') + ' → ' + (p.featuredEndDate ? formatDateFr(p.featuredEndDate) : '…') + ')'
      : '';
    featuredBadge = ' <span class="bank-badge parcours-featured-badge">' + icon('highlight-star-filled', { size: 12 }) +
      (isCurrent ? ' À la une' : ' Mis en avant (hors période)') + range + '</span>';
  }

  // AJOUT (demande directe de David, 29/07/2026, "flag gratuit") :
  // construit sur accessTier (deja present, jamais exploite jusqu'ici) -
  // 'free' reste silencieux (comportement historique, tout est gratuit),
  // seul 'premium' est signale explicitement.
  const tierBadge = isPremium
    ? ' <span class="bank-badge" style="background:rgba(192,132,252,.15);color:var(--accent-purple);">' + icon('highlight-star-premium', { size: 12 }) + ' Premium</span>' : '';

  // AJOUT (attribution a une organisation, demande directe de David,
  // 29/07/2026) : le nom reel n'est affiche que si state.organizations
  // est deja charge (voir selectParcours()) - jamais rechargee ici, un
  // libelle generique suffit avant la premiere ouverture d'une fiche.
  let orgBadge = '';
  if (p.organizationId) {
    const org = (state.organizations || []).find(function(o) { return o.id === p.organizationId; });
    orgBadge = ' <span class="bank-badge">' + icon('content-organisation', { size: 12 }) + ' ' + escapeHtml(org ? org.name : 'Organisation') + '</span>';
  }

  return (
    '<div class="parcours-row' + selected + '">' +
      '<label class="parcours-row-checkbox-wrap" onclick="event.stopPropagation()">' +
        '<input type="checkbox" class="parcours-row-checkbox"' + checked + ' onchange="toggleParcoursSelection(\'' + escapeHtml(p.id) + '\', this.checked)">' +
      '</label>' +
      '<div class="parcours-row-body" onclick="selectParcours(\'' + escapeHtml(p.id) + '\')">' +
        '<div class="parcours-row-top">' +
          '<span class="bank-row-id">' + renderAnyIcon(resolveParcoursIconKey(p, KNOWN_ICON_KEYS), { size: 16 }) + ' ' + escapeHtml(p.name) + '</span>' +
          '<span class="bank-badge ' + badge.cls + '">' + badge.emoji + ' ' + badge.label + '</span>' +
        '</div>' +
        '<div class="parcours-row-meta">' + escapeHtml(p.targetAudience || '—') + ' · ' + competencyCount + ' compétence(s)' + featuredBadge + tierBadge + orgBadge +
        '</div>' +
      '</div>' +
      '<button type="button" class="parcours-row-star' + (isPremium ? ' parcours-row-star-active' : '') + '" title="' + tierTitle + '" onclick="event.stopPropagation(); toggleParcoursAccessTierQuick(\'' + escapeHtml(p.id) + '\')">' + icon('highlight-star-premium', { size: 16 }) + '</button>' +
      '<button type="button" class="parcours-row-star' + (p.featured ? ' parcours-row-star-active' : '') + '" title="' + starTitle + '" onclick="event.stopPropagation(); toggleParcoursFeaturedQuick(\'' + escapeHtml(p.id) + '\')">' + (p.featured ? '★' : '☆') + '</button>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Selection multiple et actions groupees (demande directe de David,
// 28/07/2026 - "je veux pouvoir cocher plusieurs parcours et les
// supprimer")
// ---------------------------------------------------------------------------

// Mise en avant : retrait immediat au clic sur l'etoile deja active, sans
// passer par la modale (action non destructive, instantanement
// reversible - meme logique qu'un "favori"). ACTIVER la mise en avant
// passe desormais par la modale de confirmation (voir showFeaturedDates())
// pour proposer une fenetre de dates optionnelle ("à la une", demande
// directe de David, 29/07/2026 - "parcours temporaires").
export async function toggleParcoursFeaturedQuick(id) {
  const p = state.items.find(function(item) { return item.id === id; });
  if (!p) return;

  if (p.featured) {
    const result = await setParcoursFeatured(p, false);
    showParcoursMessage(result.status, result.message);
    if (result.status === 'success') {
      p.featured = false;
      p.featuredStartDate = null;
      p.featuredEndDate = null;
      renderList(state.items);
    }
    return;
  }

  pendingAction = { kind: 'feature_on_single', parcours: p };
  document.getElementById('parcours-confirm-message').textContent = 'Mettre en avant le parcours « ' + p.name + ' » ?';
  showFeaturedDatesFields(true);
  document.getElementById('parcours-confirm-overlay').style.display = 'flex';
}

// AJOUT (demande directe de David, 29/07/2026, "flag gratuit") : bascule
// immediate (aucune date, contrairement a la mise en avant ci-dessus -
// un palier d'acces n'est pas temporaire) entre gratuit et premium.
export async function toggleParcoursAccessTierQuick(id) {
  const p = state.items.find(function(item) { return item.id === id; });
  if (!p) return;
  const next = p.accessTier === ACCESS_TIERS.PREMIUM ? ACCESS_TIERS.FREE : ACCESS_TIERS.PREMIUM;
  const result = await setParcoursAccessTier(p, next);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    p.accessTier = next;
    renderList(state.items);
  }
}

// AJOUT (attribution a une organisation, demande directe de David,
// 29/07/2026) : selecteur de la fiche detaillee (voir detailHtml()) -
// bascule immediate, aucune confirmation (reversible en un clic, meme
// principe que la mise en avant/le palier d'acces ci-dessus).
export async function onParcoursOrganizationChange(id, organizationId) {
  const p = state.items.find(function(item) { return item.id === id; });
  if (!p) return;
  const result = await setParcoursOrganization(p, organizationId || null);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    p.organizationId = organizationId || null;
    renderList(state.items);
  }
}

/**
 * Affiche/masque le champ de fenetre de dates dans la modale de
 * confirmation - UNIQUEMENT pertinent pour une mise en avant "ON" (voir
 * toggleParcoursFeaturedQuick()/requestBulkParcoursAction() ci-dessous).
 * Reinitialise toujours les deux champs a vide a l'ouverture (jamais une
 * valeur residuelle d'une precedente ouverture de la modale).
 * @param {boolean} show
 */
function showFeaturedDatesFields(show) {
  const wrap = document.getElementById('parcours-confirm-dates');
  if (!wrap) return;
  wrap.style.display = show ? 'block' : 'none';
  document.getElementById('parcours-confirm-start-date').value = '';
  document.getElementById('parcours-confirm-end-date').value = '';
}

export function toggleParcoursSelection(id, checked) {
  if (checked) state.selectedIds.add(id); else state.selectedIds.delete(id);
  renderBulkBar();
}

export function toggleParcoursSelectAll(checked) {
  state.items.forEach(function(p) {
    if (checked) state.selectedIds.add(p.id); else state.selectedIds.delete(p.id);
  });
  renderList(state.items);
}

export function clearParcoursSelection() {
  state.selectedIds.clear();
  renderList(state.items);
}

// Barre d'actions groupees : contenu contextuel au filtre de statut actif
// (corbeille => restaurer/supprimer definitivement ; sinon => supprimer,
// qui archive automatiquement au passage si necessaire, voir
// confirmParcoursAction()). Synchronise aussi la case "Tout sélectionner".
function renderBulkBar() {
  const bar = document.getElementById('parcours-bulk-bar');
  const selectAllCb = document.getElementById('parcours-select-all-checkbox');
  const visibleIds = state.items.map(function(p) { return p.id; });
  const selectedVisibleCount = visibleIds.filter(function(id) { return state.selectedIds.has(id); }).length;

  if (selectAllCb) {
    selectAllCb.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
    selectAllCb.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
  }

  if (!bar) return;
  const count = state.selectedIds.size;
  if (count === 0) { bar.style.display = 'none'; bar.innerHTML = ''; return; }

  const isTrashView = state.filters.status === 'trash';
  bar.style.display = 'flex';
  bar.innerHTML =
    '<strong>' + count + ' sélectionné(s)</strong>' +
    '<button type="button" class="btn-secondary" onclick="clearParcoursSelection()">Désélectionner</button>' +
    (isTrashView
      ? '<button type="button" class="btn-secondary" onclick="requestBulkParcoursAction(\'restore\')">' + icon('action-restore', { size: 14 }) + ' Restaurer</button>' +
        (hasPermission(PERMISSIONS.PURGE_PARCOURS) ? '<button type="button" class="btn-secondary bank-delete-btn" onclick="requestBulkParcoursAction(\'delete\')">Supprimer définitivement</button>' : '')
      : '<button type="button" class="btn-primary" onclick="requestBulkParcoursAction(\'publish\')">Publier</button>' +
        '<button type="button" class="btn-secondary" onclick="requestBulkParcoursAction(\'assign_all\')">Attribuer…</button>' +
        '<button type="button" class="btn-secondary bank-trash-btn" onclick="requestBulkParcoursAction(\'delete\')">' + icon('action-delete', { size: 14 }) + ' Supprimer</button>'
    ) +
    '<button type="button" class="btn-secondary" onclick="requestBulkParcoursAction(\'feature_on\')">★ Mettre en avant</button>' +
    '<button type="button" class="btn-secondary" onclick="requestBulkParcoursAction(\'feature_off\')">☆ Retirer la mise en avant</button>' +
    '<button type="button" class="btn-secondary" onclick="requestBulkParcoursAction(\'tier_premium\')">Marquer premium</button>' +
    '<button type="button" class="btn-secondary" onclick="requestBulkParcoursAction(\'tier_free\')">Marquer gratuit</button>';
}

export async function requestBulkParcoursAction(kind) {
  const ids = Array.from(state.selectedIds);
  if (ids.length === 0) return;
  showFeaturedDatesFields(false); // reinitialise avant chaque ouverture - seule la branche feature_on la reaffiche ci-dessous

  let message;
  if (kind === 'delete') {
    pendingAction = { kind: 'bulk_delete', ids: ids };
    message = 'Voulez-vous vraiment supprimer les ' + ids.length + ' parcours sélectionnés ? Les parcours non archivés seront d\'abord archivés puis mis à la corbeille (réversible). Les parcours déjà à la corbeille seront supprimés DÉFINITIVEMENT.';
  } else if (kind === 'restore') {
    pendingAction = { kind: 'bulk_restore', ids: ids };
    message = 'Voulez-vous vraiment restaurer les ' + ids.length + ' parcours sélectionnés depuis la corbeille ?';
  } else if (kind === 'feature_on' || kind === 'feature_off') {
    pendingAction = { kind: 'bulk_feature', ids: ids, featured: kind === 'feature_on' };
    message = (kind === 'feature_on' ? 'Mettre en avant' : 'Retirer la mise en avant pour') + ' les ' + ids.length + ' parcours sélectionnés ?';
    showFeaturedDatesFields(kind === 'feature_on');
  } else if (kind === 'tier_premium' || kind === 'tier_free') {
    pendingAction = { kind: 'bulk_access_tier', ids: ids, accessTier: kind === 'tier_premium' ? ACCESS_TIERS.PREMIUM : ACCESS_TIERS.FREE };
    message = 'Marquer les ' + ids.length + ' parcours sélectionnés comme ' + (kind === 'tier_premium' ? 'premium' : 'gratuits') + ' ?';
  } else if (kind === 'publish') {
    pendingAction = { kind: 'bulk_publish', ids: ids };
    message = 'Voulez-vous vraiment publier les ' + ids.length + ' parcours sélectionnés ? Ils deviendront visibles par tous les utilisateurs.';
  } else if (kind === 'assign_all') {
    // "Attribuer" en masse (demande directe de David, 28/07/2026 - revu le
    // meme jour pour ne PAS attribuer automatiquement a tout le monde,
    // mais ouvrir un panneau de selection precise) : le modele
    // d'attribution (assignment-metadata-service.js) ne connait QUE
    // user/group/profile - aucune cible "tout le monde" - donc on cree
    // une attribution individuelle par utilisateur CHOISI (createAssignment,
    // deja idempotent via assignmentExists()) plutot que d'inventer un
    // nouveau type de cible hors perimetre de ce bouton.
    await openBulkAssignUsersPanel(ids);
    return;
  } else {
    return;
  }

  document.getElementById('parcours-confirm-message').textContent = message;
  document.getElementById('parcours-confirm-overlay').style.display = 'flex';
}

// ---------------------------------------------------------------------------
// AJOUT ("Attribuer" en masse -> selection precise des utilisateurs,
// demande directe de David, 28/07/2026) : panneau distinct de la
// confirmation generique ci-dessus - laisse l'administrateur choisir
// PRECISEMENT a qui attribuer les parcours selectionnes, plutot que de
// tout attribuer automatiquement a la plateforme entiere.
// ---------------------------------------------------------------------------

let bulkAssignParcoursIds = [];
let bulkAssignAllUsers = [];
let bulkAssignSelectedUids = new Set();

async function openBulkAssignUsersPanel(ids) {
  const usersResult = await fetchAllUsersBounded();
  if (usersResult.error) {
    showParcoursMessage('error', 'Impossible de charger la liste des utilisateurs.');
    return;
  }
  bulkAssignAllUsers = usersResult.items || [];
  if (bulkAssignAllUsers.length === 0) {
    showParcoursMessage('denied', 'Aucun utilisateur trouvé.');
    return;
  }
  bulkAssignParcoursIds = ids;
  bulkAssignSelectedUids = new Set();
  document.getElementById('parcours-bulk-assign-search').value = '';
  renderBulkAssignUsersList('');
  document.getElementById('parcours-bulk-assign-users-overlay').style.display = 'flex';
}

function userDisplayLabel(u) {
  const name = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
  return name ? name + ' — ' + (u.email || u.uid) : (u.email || u.uid);
}

function filterBulkAssignUsers(filterText) {
  const needle = (filterText || '').toLowerCase().trim();
  if (!needle) return bulkAssignAllUsers;
  return bulkAssignAllUsers.filter(function(u) {
    return userDisplayLabel(u).toLowerCase().indexOf(needle) !== -1;
  });
}

function renderBulkAssignUsersList(filterText) {
  const filtered = filterBulkAssignUsers(filterText);
  const container = document.getElementById('parcours-bulk-assign-results');
  container.innerHTML = filtered.length === 0
    ? '<p class="bank-list-empty">Aucun utilisateur trouvé.</p>'
    : filtered.map(function(u) {
        const checked = bulkAssignSelectedUids.has(u.uid) ? ' checked' : '';
        return '<label style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer;">' +
          '<input type="checkbox" onchange="toggleBulkAssignUser(\'' + escapeHtml(u.uid) + '\', this.checked)"' + checked + '>' +
          '<span>' + escapeHtml(userDisplayLabel(u)) + '</span></label>';
      }).join('');

  const selectAllCb = document.getElementById('parcours-bulk-assign-select-all');
  if (selectAllCb) {
    const selectedVisible = filtered.filter(function(u) { return bulkAssignSelectedUids.has(u.uid); }).length;
    selectAllCb.checked = filtered.length > 0 && selectedVisible === filtered.length;
    selectAllCb.indeterminate = selectedVisible > 0 && selectedVisible < filtered.length;
  }
}

export function toggleBulkAssignUser(uid, checked) {
  if (checked) bulkAssignSelectedUids.add(uid); else bulkAssignSelectedUids.delete(uid);
  renderBulkAssignUsersList(valueOf('parcours-bulk-assign-search'));
}

export function toggleBulkAssignSelectAllUsers(checked) {
  filterBulkAssignUsers(valueOf('parcours-bulk-assign-search')).forEach(function(u) {
    if (checked) bulkAssignSelectedUids.add(u.uid); else bulkAssignSelectedUids.delete(u.uid);
  });
  renderBulkAssignUsersList(valueOf('parcours-bulk-assign-search'));
}

export function onBulkAssignUserFilterInput() {
  renderBulkAssignUsersList(valueOf('parcours-bulk-assign-search'));
}

export function closeBulkAssignUsersPanel() {
  document.getElementById('parcours-bulk-assign-users-overlay').style.display = 'none';
}

export function confirmBulkAssignUsersPanel() {
  if (bulkAssignSelectedUids.size === 0) {
    showParcoursMessage('denied', 'Sélectionnez au moins un utilisateur.');
    return;
  }
  const selectedUsers = bulkAssignAllUsers.filter(function(u) { return bulkAssignSelectedUids.has(u.uid); });
  closeBulkAssignUsersPanel();
  pendingAction = { kind: 'bulk_assign_all_users', ids: bulkAssignParcoursIds, users: selectedUsers };
  document.getElementById('parcours-confirm-message').textContent =
    'Voulez-vous vraiment attribuer les ' + bulkAssignParcoursIds.length + ' parcours sélectionnés aux ' + selectedUsers.length +
    ' utilisateur(s) choisi(s) ? Cela peut créer jusqu\'à ' + (bulkAssignParcoursIds.length * selectedUsers.length) +
    ' attributions (les attributions déjà existantes sont ignorées, jamais dupliquées).';
  document.getElementById('parcours-confirm-overlay').style.display = 'flex';
}

// Pagination supprimee (demande directe de David, 28/07/2026 - "pas
// evident") : loadPage() charge deja tout en un seul appel borne
// (MAX_PARCOURS_DISPLAYED) - plus besoin de reinitialiser une page avant
// recherche/filtre/tri, mais les 3 sites d'appel existants restent
// inoffensifs a conserver tels quels.
function resetPagination() {}

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
  const editorial = valueOf('parcours-filter-editorial');
  if (editorial === 'linkedin') {
    state.filters.editorialOnly = true;
  } else {
    delete state.filters.editorialOnly;
  }
  state.sortField = valueOf('parcours-sort-field');
  resetPagination();
  return loadPage();
}

export function toggleParcoursSortDirection() {
  state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  const btn = document.getElementById('parcours-sort-dir-btn');
  if (btn) btn.innerHTML = icon(state.sortDirection === 'desc' ? 'action-reorder-down' : 'action-reorder-up', { size: 16 });
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
    '" onclick="pickParcoursColor(\'' + inputId + '\',\'\')" title="Aucune couleur">' + icon('action-close-remove', { size: 14 }) + '</button>';
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
// CORRECTIF (bibliotheque d'icones, remplace les emojis - demande directe de
// David 23/07/2026) : meme picker repliable que admin/document-sources.js
// (.emoji-picker/.emoji-picker-btn, CSS deja existant), generalise ici a
// deux instances possibles (creation ET edition) via un `inputId` distinct.
// ---------------------------------------------------------------------------

function iconSwatchesHtml(inputId) {
  return PARCOURS_ICON_PICKER_CHOICES.map(function(key) {
    return '<button type="button" class="emoji-picker-btn" onclick="pickParcoursIcon(\'' + inputId + '\',\'' + key + '\')" title="' + key + '">' + renderAnyIcon(key, { size: 20 }) + '</button>';
  }).join('');
}

function iconPickerHtml(inputId, selectedIcon) {
  const previewKey = (selectedIcon && KNOWN_ICON_KEYS.has(selectedIcon)) ? selectedIcon : PARCOURS_DEFAULT_ICON;
  return (
    '<div id="' + inputId + '-container">' +
      '<button type="button" class="ds-icon-preview-btn" onclick="toggleParcoursIconPicker(\'' + inputId + '\')" title="Choisir une icône">' + renderAnyIcon(previewKey, { size: 24 }) + '</button>' +
      ' <button type="button" class="btn-secondary" onclick="toggleParcoursIconPicker(\'' + inputId + '\')">Choisir une icône</button>' +
      '<input type="hidden" id="' + inputId + '" value="' + escapeHtml(selectedIcon || '') + '">' +
      '<div id="' + inputId + '-panel" class="emoji-picker" style="display:none;">' + iconSwatchesHtml(inputId) + '</div>' +
    '</div>'
  );
}

export function toggleParcoursIconPicker(inputId) {
  const el = document.getElementById(inputId + '-panel');
  if (!el) return;
  el.style.display = (el.style.display === 'none') ? 'grid' : 'none';
}
window.toggleParcoursIconPicker = toggleParcoursIconPicker;

export function pickParcoursIcon(inputId, iconValue) {
  const hiddenInput = document.getElementById(inputId);
  if (hiddenInput) hiddenInput.value = iconValue;
  const container = document.getElementById(inputId + '-container');
  const previewBtn = container && container.querySelector('.ds-icon-preview-btn');
  if (previewBtn) previewBtn.innerHTML = renderAnyIcon(iconValue || PARCOURS_DEFAULT_ICON, { size: 24 });
  const panel = document.getElementById(inputId + '-panel');
  if (panel) panel.style.display = 'none';
}
window.pickParcoursIcon = pickParcoursIcon;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function openCreateParcoursForm() {
  document.getElementById('parcours-create-color-container').innerHTML = colorPickerHtml('parcours-create-color', '');
  document.getElementById('parcours-create-icon-container').innerHTML = iconPickerHtml('parcours-create-icon', '');
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
    document.getElementById('parcours-create-icon-container').innerHTML = '';
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
  // "Reutilisation"). Meme principe pour les sources/questions directement
  // liees (resolveParcoursDirectContentDisplay) - les deux resolutions sont
  // independantes, lancees en parallele.
  //
  // AJOUT (demande directe de David, 28/07/2026 - "si une question est
  // ajoutee au parcours, la competence doit suivre") : resolveDerivedCompetenciesFromPool()
  // existait deja cote service (parcours-service.js) mais n'etait jamais
  // appelee depuis cet ecran - une question ajoutee (directQuestionIds)
  // dont la fiche Banque porte deja un `competencyId` n'affichait donc
  // jamais sa competence ici. Necessite pooledQuestionIds (resolvePooledQuestionIds),
  // calcule a partir du parcours BRUT (pas des versions deja resolues).
  // AJOUT (attribution a une organisation, demande directe de David,
  // 29/07/2026) : chargee UNE SEULE FOIS (state.organizations reste en
  // cache pour les selections suivantes) - jamais rechargee a chaque
  // ouverture de fiche.
  if (state.organizations === null) {
    const orgResult = await organizationsBank.browse({ filters: { status: 'published' }, pageSize: 200 });
    state.organizations = orgResult.error ? [] : orgResult.items;
  }

  const [resolvedCompetencies, resolvedDirect, pooledQuestionIds] = await Promise.all([
    resolveParcoursCompetenciesDisplay(p),
    resolveParcoursDirectContentDisplay(p),
    resolvePooledQuestionIds(p),
  ]);
  const derivedCompetencies = await resolveDerivedCompetenciesFromPool(p, pooledQuestionIds);
  detailEl.innerHTML = detailHtml(p, resolvedCompetencies, resolvedDirect, derivedCompetencies);

  await renderTimeline(p);
  await renderAssignments(p);
}

function detailHtml(p, resolvedCompetencies, resolvedDirect, derivedCompetencies) {
  const badge = STATUS_BADGES[p.status] || STATUS_BADGES.draft;
  const competencies = (resolvedCompetencies || p.competencies || []).slice().sort(function(a, b) { return a.order - b.order; });
  const directSources = (resolvedDirect && resolvedDirect.sources) || [];
  const directQuestions = (resolvedDirect && resolvedDirect.directQuestions) || [];

  let html = '<div class="bank-detail-card">';

  html += '<div class="bank-detail-header">';
  html += '<h3>' + renderAnyIcon(resolveParcoursIconKey(p, KNOWN_ICON_KEYS), { size: 18 }) + ' ' + escapeHtml(p.name) + '</h3>';
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

  // AJOUT (attribution a une organisation, demande directe de David,
  // 29/07/2026, "un parcours puisse être attribué à une organisation -
  // il apparait uniquement dans 'mon organisation' et toutes les
  // personnes rattachées à cette organisation ont accès") : construit sur
  // le champ organizationId deja present dans le modele (Sprint 20.2)
  // mais jamais exploite depuis cet ecran jusqu'ici.
  html += '<div class="bank-detail-section"><h4>Organisation</h4>';
  html += '<select class="bank-select" style="width:100%;" onchange="onParcoursOrganizationChange(\'' + escapeHtml(p.id) + '\', this.value)">';
  html += '<option value=""' + (!p.organizationId ? ' selected' : '') + '>Catalogue global (self-service, aucune organisation)</option>';
  (state.organizations || []).forEach(function(org) {
    html += '<option value="' + escapeHtml(org.id) + '"' + (p.organizationId === org.id ? ' selected' : '') + '>' + escapeHtml(org.name) + '</option>';
  });
  html += '</select>';
  html += '<p class="admin-users-disclaimer" style="margin-top:6px;">Un parcours attribué à une organisation n\'apparaît que dans "Mon organisation", pour les personnes qui y sont rattachées.</p>';
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
      html += '<button class="btn-secondary" onclick="moveCompetencyUp(\'' + escapeHtml(c.id) + '\')"' + (i === 0 ? ' disabled' : '') + '>' + icon('action-reorder-up', { size: 14 }) + '</button>';
      html += '<button class="btn-secondary" onclick="moveCompetencyDown(\'' + escapeHtml(c.id) + '\')"' + (i === competencies.length - 1 ? ' disabled' : '') + '>' + icon('action-reorder-down', { size: 14 }) + '</button>';
      html += '<button class="btn-secondary bank-delete-btn" onclick="requestRemoveCompetency(\'' + escapeHtml(c.id) + '\')">Supprimer</button>';
      html += '</div></div>';
      if (displayDescription) html += '<p class="parcours-competency-description">' + escapeHtml(displayDescription) + '</p>';
      if (notYetMigrated) {
        html += '<p class="parcours-bulk-duplicates">' + icon('action-warning', { size: 14 }) + ' Compétence non reliée à la banque (ancienne compétence texte) — utilisez « Migrer » depuis la <a href="competencies.html" target="_blank">Banque des compétences</a>.</p>';
      } else if (brokenLink) {
        html += '<p class="parcours-bulk-duplicates">' + icon('action-warning', { size: 14 }) + ' Fiche introuvable dans la banque (peut-être supprimée définitivement).</p>';
      }
      html += '<div class="parcours-competency-questions">';
      if (c.questionIds.length === 0) {
        html += '<span class="bank-chip">Aucune question liée</span>';
      } else {
        c.questionIds.forEach(function(qid) {
          html += '<span class="bank-chip">' + escapeHtml(qid) + ' <a href="#" onclick="unlinkQuestion(\'' + escapeHtml(c.id) + '\',\'' + escapeHtml(qid) + '\');return false;" title="Retirer">' + icon('action-close-remove', { size: 12 }) + '</a></span>';
        });
      }
      html += ' <button class="btn-secondary" onclick="openLinkQuestionPanel(\'' + escapeHtml(c.id) + '\')">+ Lier une question</button>';
      html += '</div></div>';
    });
    html += '</div>';
  }
  html += '<div class="btn-row"><button class="btn-primary" onclick="openCompetencyPickerPanel()">+ Ajouter une compétence (banque)</button></div>';
  html += '</div>';

  // AJOUT (demande directe de David, 28/07/2026 - "la compétence doit
  // suivre") : competences JAMAIS ajoutees explicitement a ce parcours,
  // mais deduites des questions deja presentes (directQuestionIds,
  // competencies[].questionIds, questions de source) dont la fiche Banque
  // porte deja un `competencyId` - purement informatif, aucune action
  // (retirer la question ou sa competence dans la Banque les fait
  // disparaitre d'elles-memes, voir resolveDerivedCompetenciesFromPool()).
  const derived = derivedCompetencies || [];
  if (derived.length > 0) {
    html += '<div class="bank-detail-section"><h4>Compétences déduites automatiquement (' + derived.length + ')</h4>';
    html += '<p class="admin-users-disclaimer" style="margin:8px 0;">Déduites des questions déjà présentes dans ce parcours (compétence assignée à la question dans la Banque de questions) — pas besoin de les ajouter manuellement.</p>';
    html += '<div class="parcours-competency-list">';
    derived.forEach(function(c) {
      const bank = c.bankData;
      html += '<div class="parcours-competency-card">';
      html += '<div class="parcours-competency-header"><strong>' + escapeHtml(bank ? bank.name : c.competencyId + ' (introuvable)') + '</strong>';
      if (bank && bank.color && COMPETENCY_COLOR_HEX[bank.color]) {
        html += '<span class="bank-chip" style="background:' + escapeHtml(COMPETENCY_COLOR_HEX[bank.color]) + ';color:#fff;">' + escapeHtml(capitalizeFirst(bank.color)) + '</span>';
      }
      html += '<span class="bank-chip">Auto</span>';
      html += '</div>';
      if (bank && bank.description) html += '<p class="parcours-competency-description">' + escapeHtml(bank.description) + '</p>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  // AJOUT : sources documentaires et questions directement liees -
  // PARALLELES aux competences ci-dessus, jamais niches dedans (voir
  // parcours-service.js#resolveParcoursDirectContentDisplay). Meme
  // principe visuel que le bloc competences (liste + retrait direct par
  // element, sans confirmation modale - meme choix que requestRemoveCompetency).
  html += '<div class="bank-detail-section"><h4>Sources documentaires (' + directSources.length + ')</h4>';
  if (directSources.length === 0) {
    html += '<p class="bank-list-empty" style="padding:12px;">Aucune source pour l\'instant.</p>';
  } else {
    html += '<div class="parcours-competency-list">';
    directSources.forEach(function(s) {
      const bank = s.bankData;
      html += '<div class="parcours-competency-card">';
      html += '<div class="parcours-competency-header"><strong>' + escapeHtml(bank ? bank.name : s.id + ' (introuvable)') + '</strong>';
      if (bank) html += '<span class="bank-chip">' + escapeHtml(DOCUMENT_SOURCE_TYPE_LABELS[bank.sourceType] || bank.sourceType) + '</span>';
      html += '<div class="parcours-competency-actions">';
      html += '<button class="btn-secondary bank-delete-btn" onclick="requestRemoveSource(\'' + escapeHtml(s.id) + '\')">Supprimer</button>';
      html += '</div></div></div>';
    });
    html += '</div>';
  }
  html += '<div class="btn-row"><button class="btn-primary" onclick="openSourcePickerPanel()">+ Ajouter une source documentaire</button></div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Questions directement liées (' + directQuestions.length + ')</h4>';
  if (directQuestions.length === 0) {
    html += '<p class="bank-list-empty" style="padding:12px;">Aucune question pour l\'instant.</p>';
  } else {
    html += '<div class="parcours-competency-list">';
    directQuestions.forEach(function(q) {
      const bank = q.bankData;
      const preview = bank ? (bank.question || '').toString().slice(0, 90) : (q.id + ' (introuvable)');
      html += '<div class="parcours-competency-card">';
      html += '<div class="parcours-competency-header"><strong>' + escapeHtml(q.id) + '</strong>';
      html += '<div class="parcours-competency-actions">';
      html += '<button class="btn-secondary bank-delete-btn" onclick="requestRemoveDirectQuestion(\'' + escapeHtml(q.id) + '\')">Supprimer</button>';
      html += '</div></div>';
      html += '<p class="parcours-competency-description">' + escapeHtml(preview) + '</p>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '<div class="btn-row"><button class="btn-primary" onclick="openQuestionPickerPanel()">+ Ajouter une question</button></div>';
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
    html += '<button class="btn-secondary bank-trash-btn" onclick="requestParcoursAction(\'trash\')">' + icon('action-delete', { size: 16 }) + ' Mettre à la corbeille</button>';
  }
  if (p.status === 'trash') {
    html += '<button class="btn-secondary" onclick="requestParcoursAction(\'restore\')">' + icon('action-restore', { size: 16 }) + ' Restaurer</button>';
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
  html += iconPickerHtml('parcours-edit-icon', KNOWN_ICON_KEYS.has(p.icon) ? p.icon : '');
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
  // CORRECTIF : `bankCompetencyId` (banque) et l'identifiant LOCAL de la
  // competence au sein de ce parcours (`localId`, genere par
  // completeCompetency()) sont deux valeurs DISTINCTES - les questions
  // sont taguees avec le premier (question.competencyId), mais
  // linkQuestionToCompetency() n'accepte que le second (voir
  // parcours-service.js:869, `c.id === competencyId`). Bug initial :
  // confondait les deux, chaque appel echouait silencieusement
  // ("Compétence introuvable"), 0 question jamais reellement liee.
  const addedCompetencies = {}; // bankCompetencyId -> { name, localId }
  let lastResult = null;
  for (const bankCompetencyId of ids) {
    lastResult = await addCompetencyFromBank(p, bankCompetencyId);
    if (lastResult.status === 'success') {
      p.competencies = lastResult.competencies;
      const added = lastResult.competencies.find(function(c) { return c.competencyId === bankCompetencyId; });
      if (added) addedCompetencies[bankCompetencyId] = { name: added.name, localId: added.id };
    }
  }

  showParcoursMessage(lastResult ? lastResult.status : 'error', ids.length + ' compétence(s) traitée(s).');
  closeCompetencyPickerPanel();
  await selectParcours(p.id);

  // AJOUT (demande directe de David, 27/07/2026) : propose les questions
  // publiees deja taguees avec chaque competence ajoutee, pour validation
  // avant liaison - jamais silencieusement, voir openSuggestedQuestionsPanel().
  await openSuggestedQuestionsPanel(addedCompetencies);
}

// ---------------------------------------------------------------------------
// Questions suggerees (heritage depuis la Banque de competences)
// ---------------------------------------------------------------------------

async function openSuggestedQuestionsPanel(addedCompetencies) {
  const bankCompetencyIds = Object.keys(addedCompetencies || {});
  if (bankCompetencyIds.length === 0) return;

  const perCompetency = await Promise.all(bankCompetencyIds.map(function(bankCompetencyId) {
    return searchQuestionsForLinking({ filters: { status: 'published', competencyId: bankCompetencyId } })
      .then(function(result) { return { entry: addedCompetencies[bankCompetencyId], result: result }; });
  }));

  suggestedQuestionsItems = [];
  perCompetency.forEach(function(row) {
    if (!row.result.authorized || row.result.error) return;
    row.result.items.forEach(function(q) {
      suggestedQuestionsItems.push({
        competencyLocalId: row.entry.localId, // voir linkQuestionToCompetency()
        competencyName: row.entry.name,
        pedagogicalId: q.pedagogicalId,
        question: q.question,
        checked: true,
      });
    });
  });

  if (suggestedQuestionsItems.length === 0) return; // rien a proposer, pas de panneau vide

  renderSuggestedQuestionsPanel();
  document.getElementById('parcours-suggested-questions-overlay').style.display = 'flex';
}

function renderSuggestedQuestionsPanel() {
  const container = document.getElementById('parcours-suggested-questions-results');
  const byCompetency = new Map();
  suggestedQuestionsItems.forEach(function(item, index) {
    if (!byCompetency.has(item.competencyLocalId)) byCompetency.set(item.competencyLocalId, []);
    byCompetency.get(item.competencyLocalId).push(Object.assign({ index: index }, item));
  });

  let html = '';
  byCompetency.forEach(function(items, competencyLocalId) {
    html += '<p style="margin:10px 0 4px;"><strong>' + escapeHtml(items[0].competencyName || competencyLocalId) + '</strong> (' + items.length + ' question(s))</p>';
    html += items.map(function(item) {
      return '<label style="display:flex;align-items:flex-start;gap:8px;padding:6px 4px;border-bottom:1px solid var(--border);cursor:pointer;">' +
        '<input type="checkbox" onchange="toggleSuggestedQuestion(' + item.index + ')"' + (item.checked ? ' checked' : '') + '>' +
        '<span><span class="bank-row-id">' + escapeHtml(item.pedagogicalId) + '</span><br>' + escapeHtml((item.question || '').slice(0, 100)) + '</span>' +
        '</label>';
    }).join('');
  });
  container.innerHTML = html;
}

export function toggleSuggestedQuestion(index) {
  if (!suggestedQuestionsItems[index]) return;
  suggestedQuestionsItems[index].checked = !suggestedQuestionsItems[index].checked;
}

export function closeSuggestedQuestionsPanel() {
  suggestedQuestionsItems = [];
  document.getElementById('parcours-suggested-questions-overlay').style.display = 'none';
}

export async function confirmSuggestedQuestions() {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  const toLink = suggestedQuestionsItems.filter(function(item) { return item.checked; });
  document.getElementById('parcours-suggested-questions-overlay').style.display = 'none';
  suggestedQuestionsItems = [];
  if (!p || toLink.length === 0) return;

  // CORRECTIF : le message affiche desormais le compte REEL de succes
  // (jamais "N liee(s)" quand certaines/toutes ont en realite echoue -
  // meme principe que partout ailleurs dans ce fichier, ne jamais
  // presenter un succes non confirme).
  //
  // CORRECTIF 2 (bug distinct, meme session) : `p.competencies` DOIT etre
  // rafraichi apres CHAQUE appel reussi - linkQuestionToCompetency() lit
  // l'etat COMPLET de `parcours.competencies` recu en argument et
  // reecrit le tableau entier (jamais une fusion partielle cote serveur).
  // Sans ce rafraichissement, les 4 appels partaient tous du meme etat
  // "avant tout lien" et s'ecrasaient mutuellement - seul le DERNIER lien
  // survivait reellement en base, malgre "4 liee(s) avec succes" affiche
  // (chaque appel individuel reussissait bel et bien, isolement).
  let successCount = 0;
  let lastFailure = null;
  for (const item of toLink) {
    const result = await linkQuestionToCompetency(p, item.competencyLocalId, item.pedagogicalId);
    if (result.status === 'success') {
      successCount += 1;
      p.competencies = result.competencies;
    } else {
      lastFailure = result;
    }
  }
  const status = successCount === toLink.length ? 'success' : (successCount > 0 ? 'success' : (lastFailure ? lastFailure.status : 'error'));
  const message = successCount === toLink.length
    ? successCount + ' question(s) liée(s) avec succès.'
    : successCount + ' question(s) liée(s) sur ' + toLink.length + ' (' + (lastFailure ? lastFailure.message : 'échecs') + ')';
  showParcoursMessage(status, message);
  await selectParcours(p.id);
}

// ---------------------------------------------------------------------------
// AJOUT : selection d'une ou plusieurs sources documentaires EXISTANTES -
// meme principe que le picker de competences ci-dessus, sans champ de
// recherche serveur (browseDocumentSources() ne le supporte pas et le
// volume de sources actives reste tres modeste) - filtre client simple.
// ---------------------------------------------------------------------------

let sourcePickerSelection = new Set();
let sourcePickerResults = [];

export async function openSourcePickerPanel() {
  sourcePickerSelection = new Set();
  document.getElementById('parcours-source-picker-overlay').style.display = 'flex';
  await runSourcePickerSearch();
}
export function closeSourcePickerPanel() {
  document.getElementById('parcours-source-picker-overlay').style.display = 'none';
}

async function runSourcePickerSearch() {
  const container = document.getElementById('parcours-source-picker-results');
  container.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  const alreadyLinkedIds = (p && Array.isArray(p.sourceIds)) ? p.sourceIds : [];

  const result = await browseDocumentSources({ status: 'active' });
  if (!result.authorized || result.error) {
    container.innerHTML = '<p>' + escapeHtml(result.message || 'Impossible de charger les sources documentaires.') + '</p>';
    sourcePickerResults = [];
    return;
  }

  sourcePickerResults = result.items.filter(function(s) { return alreadyLinkedIds.indexOf(s.id) === -1; });

  if (sourcePickerResults.length === 0) {
    container.innerHTML = '<p class="bank-list-empty">Aucune source active disponible (ou déjà toutes liées à ce parcours).</p>';
    return;
  }

  container.innerHTML = sourcePickerResults.map(function(s) {
    return '<label style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer;">' +
      '<input type="checkbox" onchange="toggleSourcePick(\'' + escapeHtml(s.id) + '\')">' +
      '<span><strong>' + escapeHtml(s.name) + '</strong> — ' + escapeHtml(DOCUMENT_SOURCE_TYPE_LABELS[s.sourceType] || s.sourceType) + '</span>' +
      '</label>';
  }).join('');
}

export function toggleSourcePick(sourceId) {
  if (sourcePickerSelection.has(sourceId)) sourcePickerSelection.delete(sourceId);
  else sourcePickerSelection.add(sourceId);
}

export async function confirmSourcePicker() {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p || sourcePickerSelection.size === 0) return;

  const ids = Array.from(sourcePickerSelection);
  let lastResult = null;
  for (const sourceId of ids) {
    lastResult = await addSourceToParcours(p, sourceId);
    if (lastResult.status === 'success') p.sourceIds = lastResult.sourceIds;
  }

  showParcoursMessage(lastResult ? lastResult.status : 'error', ids.length + ' source(s) traitée(s).');
  closeSourcePickerPanel();
  await selectParcours(p.id);
}

export async function requestRemoveSource(sourceId) {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p) return;
  const result = await removeSourceFromParcours(p, sourceId);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    p.sourceIds = result.sourceIds;
    await selectParcours(p.id);
  }
}

// ---------------------------------------------------------------------------
// AJOUT : selection d'une ou plusieurs questions EXISTANTES de la Banque de
// questions, liees DIRECTEMENT au parcours (distinct du panneau "Lier une
// question" existant, qui lie une question a UNE competence precise) -
// meme principe que le picker de competences ci-dessus.
// ---------------------------------------------------------------------------

let questionPickerSelection = new Set();
let questionPickerResults = [];

export async function openQuestionPickerPanel() {
  questionPickerSelection = new Set();
  document.getElementById('parcours-question-picker-search').value = '';
  document.getElementById('parcours-question-picker-overlay').style.display = 'flex';
  await runQuestionPickerSearch('');
}
export function closeQuestionPickerPanel() {
  document.getElementById('parcours-question-picker-overlay').style.display = 'none';
}

let questionPickerDebounce = null;
export function onQuestionPickerSearchInput() {
  clearTimeout(questionPickerDebounce);
  const value = valueOf('parcours-question-picker-search');
  questionPickerDebounce = setTimeout(function() { runQuestionPickerSearch(value); }, 250);
}

async function runQuestionPickerSearch(searchText) {
  const container = document.getElementById('parcours-question-picker-results');
  container.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  const alreadyLinkedIds = (p && Array.isArray(p.directQuestionIds)) ? p.directQuestionIds : [];

  const result = await browseQuestions({ searchText: searchText, pageSize: 50 });
  if (!result.authorized || result.error) {
    container.innerHTML = '<p>' + escapeHtml(result.message || 'Impossible de charger la banque de questions.') + '</p>';
    questionPickerResults = [];
    return;
  }

  questionPickerResults = result.items.filter(function(q) { return alreadyLinkedIds.indexOf(q.pedagogicalId) === -1; });

  if (questionPickerResults.length === 0) {
    container.innerHTML = '<p class="bank-list-empty">Aucune question disponible (ou déjà toutes liées à ce parcours).</p>';
    return;
  }

  container.innerHTML = questionPickerResults.map(function(q) {
    const preview = (q.question || '').toString().slice(0, 90);
    return '<label style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border);cursor:pointer;">' +
      '<input type="checkbox" onchange="toggleQuestionPick(\'' + escapeHtml(q.pedagogicalId) + '\')">' +
      '<span><strong>' + escapeHtml(q.pedagogicalId) + '</strong> — ' + escapeHtml(preview) + '</span>' +
      '</label>';
  }).join('');
}

export function toggleQuestionPick(pedagogicalId) {
  if (questionPickerSelection.has(pedagogicalId)) questionPickerSelection.delete(pedagogicalId);
  else questionPickerSelection.add(pedagogicalId);
}

export async function confirmQuestionPicker() {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p || questionPickerSelection.size === 0) return;

  const ids = Array.from(questionPickerSelection);
  let lastResult = null;
  for (const pedagogicalId of ids) {
    lastResult = await addQuestionDirectlyToParcours(p, pedagogicalId);
    if (lastResult.status === 'success') p.directQuestionIds = lastResult.directQuestionIds;
  }

  showParcoursMessage(lastResult ? lastResult.status : 'error', ids.length + ' question(s) traitée(s).');
  closeQuestionPickerPanel();
  await selectParcours(p.id);
}

export async function requestRemoveDirectQuestion(pedagogicalId) {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p) return;
  const result = await removeQuestionDirectlyFromParcours(p, pedagogicalId);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    p.directQuestionIds = result.directQuestionIds;
    await selectParcours(p.id);
  }
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

export async function requestParcoursAction(kind) {
  const p = state.items.find(function(item) { return item.id === state.selectedId; });
  if (!p) return;
  const verb = ACTION_LABELS[kind] || kind;
  let extra = '';
  if (kind === 'purge') extra = ' Cette action est définitive et ne peut pas être annulée.';
  else if (kind === 'trash') extra = ' Ce parcours pourra être restauré depuis la corbeille, ou supprimé définitivement plus tard.';
  const confirmed = await showAdminConfirm({
    title: 'Confirmation',
    body: 'Voulez-vous vraiment ' + verb + ' le parcours « ' + p.name + ' » ?' + extra,
    destructive: kind === 'purge',
    confirmLabel: kind === 'purge' ? 'Supprimer définitivement' : 'Confirmer',
  });
  if (!confirmed) return;
  let result;
  if (kind === 'publish') result = await publishParcours(p);
  else if (kind === 'archive') result = await archiveParcours(p);
  else if (kind === 'draft') result = await revertParcoursToDraft(p);
  else if (kind === 'trash') result = await moveParcoursToTrash(p);
  else if (kind === 'restore') result = await restoreParcoursFromTrash(p);
  else if (kind === 'purge') result = await permanentlyDeleteParcours(p);
  showParcoursMessage(result.status, result.message);
  if (result.status === 'success') {
    if (kind === 'purge') {
      state.selectedId = null;
      document.getElementById('parcours-detail').style.display = 'none';
      document.getElementById('parcours-detail-placeholder').style.display = 'block';
    }
    await loadPage();
  }
}

export function cancelParcoursAction() {
  pendingAction = null;
  showFeaturedDatesFields(false);
  document.getElementById('parcours-confirm-overlay').style.display = 'none';
}

export async function confirmParcoursAction() {
  document.getElementById('parcours-confirm-overlay').style.display = 'none';
  if (!pendingAction) return;
  const action = pendingAction;
  pendingAction = null;

  // AJOUT (onglet "À la une", demande directe de David, 29/07/2026) : lue
  // une seule fois ici, avant que showFeaturedDatesFields() ne les
  // reinitialise a la prochaine ouverture - ignoree par toute action dont
  // le kind n'est pas lie a la mise en avant.
  const featuredStartDate = document.getElementById('parcours-confirm-start-date').value || null;
  const featuredEndDate = document.getElementById('parcours-confirm-end-date').value || null;

  if (action.kind === 'feature_on_single') {
    const result = await setParcoursFeatured(action.parcours, true, { startDate: featuredStartDate, endDate: featuredEndDate });
    showParcoursMessage(result.status, result.message);
    if (result.status === 'success') {
      action.parcours.featured = true;
      action.parcours.featuredStartDate = featuredStartDate;
      action.parcours.featuredEndDate = featuredEndDate;
      renderList(state.items);
    }
    return;
  }

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

  // AJOUT ("Attribuer à tous les utilisateurs", demande directe de David,
  // 28/07/2026) : double boucle parcours x utilisateurs, reutilise
  // createAssignment() tel quel (deja idempotent via assignmentExists() -
  // jamais de doublon meme si le bouton est cliqué deux fois). "denied" ici
  // ne signifie jamais un echec reel, seulement "deja attribue" - distingue
  // des vrais echecs pour ne jamais alarmer inutilement l'administrateur.
  if (action.kind === 'bulk_assign_all_users') {
    let createdCount = 0, alreadyCount = 0, failCount = 0;
    for (const id of action.ids) {
      for (const u of action.users) {
        const result = await createAssignment({ parcoursId: id, type: ASSIGNMENT_TARGET_TYPES.USER, targetId: u.uid });
        if (result.status === 'success') createdCount++;
        else if (result.status === 'denied') alreadyCount++;
        else failCount++;
      }
    }
    state.selectedIds.clear();
    showParcoursMessage(
      failCount === 0 ? 'success' : 'error',
      createdCount + ' attribution(s) créée(s)' +
        (alreadyCount > 0 ? ', ' + alreadyCount + ' déjà existante(s) (ignorée(s))' : '') +
        (failCount > 0 ? ', ' + failCount + ' échec(s).' : '.')
    );
    await loadPage();
    return;
  }

  // AJOUT (selection multiple, demande directe de David, 28/07/2026) :
  // meme modale de confirmation que les actions unitaires ci-dessous, mais
  // boucle sequentielle sur chaque id selectionne - reutilise les memes
  // fonctions de service unitaires (jamais de route "bulk" cote serveur,
  // jamais de logique metier dupliquee ici).
  if (action.kind === 'bulk_delete' || action.kind === 'bulk_restore' || action.kind === 'bulk_feature' || action.kind === 'bulk_access_tier' || action.kind === 'bulk_publish') {
    let successCount = 0, failCount = 0;
    for (const id of action.ids) {
      const p = state.items.find(function(item) { return item.id === id; });
      if (!p) { failCount++; continue; }

      let itemResult;
      if (action.kind === 'bulk_restore') {
        itemResult = await restoreParcoursFromTrash(p);
      } else if (action.kind === 'bulk_feature') {
        itemResult = await setParcoursFeatured(p, action.featured, { startDate: featuredStartDate, endDate: featuredEndDate });
        if (itemResult && itemResult.status === 'success') { p.featuredStartDate = action.featured ? featuredStartDate : null; p.featuredEndDate = action.featured ? featuredEndDate : null; }
      } else if (action.kind === 'bulk_access_tier') {
        itemResult = await setParcoursAccessTier(p, action.accessTier);
        if (itemResult && itemResult.status === 'success') p.accessTier = action.accessTier;
      } else if (action.kind === 'bulk_publish') {
        itemResult = await publishParcours(p);
      } else if (p.status === PARCOURS_STATUSES.TRASH) {
        itemResult = await permanentlyDeleteParcours(p);
      } else {
        // Meme workflow que la suppression unitaire (Archive -> Corbeille) :
        // un parcours non archive doit d'abord etre archive avant de
        // pouvoir etre mis a la corbeille (voir moveParcoursToTrash(),
        // parcours-service.js) - jamais de raccourci qui saute cette etape.
        if (p.status !== PARCOURS_STATUSES.ARCHIVED) {
          const archiveResult = await archiveParcours(p);
          if (archiveResult.status !== 'success') { failCount++; continue; }
        }
        itemResult = await moveParcoursToTrash(Object.assign({}, p, { status: PARCOURS_STATUSES.ARCHIVED }));
      }

      if (itemResult && itemResult.status === 'success') successCount++; else failCount++;
    }

    state.selectedIds.clear();
    const verb = action.kind === 'bulk_restore' ? 'restauré(s)' : (action.kind === 'bulk_feature' || action.kind === 'bulk_access_tier') ? 'mis à jour' : action.kind === 'bulk_publish' ? 'publié(s)' : 'traité(s)';
    showParcoursMessage(
      failCount === 0 ? 'success' : 'error',
      successCount + ' parcours ' + verb + (failCount > 0 ? ', ' + failCount + ' échec(s).' : '.')
    );
    await loadPage();
    return;
  }

}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function showParcoursMessage(status, text) {
  const el = document.getElementById('parcours-message');
  if (!el) return;
  el.className = 'adm-message adm-message-' + status;
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
window.toggleSuggestedQuestion = toggleSuggestedQuestion;
window.closeSuggestedQuestionsPanel = closeSuggestedQuestionsPanel;
window.confirmSuggestedQuestions = confirmSuggestedQuestions;
window.openSourcePickerPanel = openSourcePickerPanel;
window.closeSourcePickerPanel = closeSourcePickerPanel;
window.toggleSourcePick = toggleSourcePick;
window.confirmSourcePicker = confirmSourcePicker;
window.requestRemoveSource = requestRemoveSource;
window.openQuestionPickerPanel = openQuestionPickerPanel;
window.closeQuestionPickerPanel = closeQuestionPickerPanel;
window.onQuestionPickerSearchInput = onQuestionPickerSearchInput;
window.toggleQuestionPick = toggleQuestionPick;
window.confirmQuestionPicker = confirmQuestionPicker;
window.requestRemoveDirectQuestion = requestRemoveDirectQuestion;
window.openAssignmentPickerPanel = openAssignmentPickerPanel;
window.closeAssignmentPickerPanel = closeAssignmentPickerPanel;
window.pickAssignmentType = pickAssignmentType;
window.onAssignmentSearchInput = onAssignmentSearchInput;
window.pickAssignmentTarget = pickAssignmentTarget;
window.confirmAssignmentPicker = confirmAssignmentPicker;
window.requestRemoveAssignment = requestRemoveAssignment;
window.toggleParcoursFeaturedQuick = toggleParcoursFeaturedQuick;
window.toggleParcoursAccessTierQuick = toggleParcoursAccessTierQuick;
window.onParcoursOrganizationChange = onParcoursOrganizationChange;
window.toggleParcoursSelection = toggleParcoursSelection;
window.toggleParcoursSelectAll = toggleParcoursSelectAll;
window.clearParcoursSelection = clearParcoursSelection;
window.requestBulkParcoursAction = requestBulkParcoursAction;
window.toggleBulkAssignUser = toggleBulkAssignUser;
window.toggleBulkAssignSelectAllUsers = toggleBulkAssignSelectAllUsers;
window.onBulkAssignUserFilterInput = onBulkAssignUserFilterInput;
window.closeBulkAssignUsersPanel = closeBulkAssignUsersPanel;
window.confirmBulkAssignUsersPanel = confirmBulkAssignUsersPanel;

async function downloadParcoursAuditCSV() {
  const btn = document.getElementById('parcours-export-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Export en cours…'; }
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API_BASE_URL + '/api/admin/export-parcours-questions', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'parcours-questions-audit.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[export-parcours-audit]', err);
    alert('Erreur lors de l\'export : ' + (err.message || 'inconnue'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Exporter CSV'; }
  }
}
window.downloadParcoursAuditCSV = downloadParcoursAuditCSV;

async function executeLot1Reassignments(dryRun) {
  const btnId = dryRun ? 'lot1-dryrun-btn' : 'lot1-execute-btn';
  const btn = document.getElementById(btnId);
  const label = dryRun ? 'Dry-run Lot 1' : 'Exécuter Lot 1';
  if (btn) { btn.disabled = true; btn.textContent = dryRun ? 'Analyse…' : 'Exécution…'; }
  if (!dryRun && !confirm('Exécuter les 29 réaffectations + rattachement des 18 nouvelles questions ?\nCette action modifie Firestore. Continuer ?')) {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    return;
  }
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API_BASE_URL + '/api/admin/execute-lot1-reassignments', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const report = await res.json();
    const warnings = report.reassignments.filter(r => r.status === 'warning').length;
    const errors = report.errors.length;
    const newLinksOk = report.newLinks.filter(l => l.status === 'ok').length;
    const mode = report.dryRun ? '[DRY-RUN] ' : '[EXÉCUTÉ] ';
    alert(
      mode + 'Rapport Lot 1\n\n' +
      '✓ Réaffectations : ' + report.reassignments.length + ' (⚠ ' + warnings + ' absentes de la source)\n' +
      '✓ Nouvelles questions rattachées : ' + newLinksOk + '/18\n' +
      (errors > 0 ? '✗ Erreurs : ' + errors + ' (voir console)\n' : '') +
      '\nDétail complet dans la console (F12).'
    );
    console.log('[Lot1-reassignments]', report);
  } catch (err) {
    console.error('[lot1-reassignments]', err);
    alert('Erreur : ' + (err.message || 'inconnue'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
window.executeLot1Reassignments = executeLot1Reassignments;

async function executeLot2Reassignments(dryRun) {
  const btnId = dryRun ? 'lot2-dryrun-btn' : 'lot2-execute-btn';
  const btn = document.getElementById(btnId);
  const label = dryRun ? 'Dry-run Lot 2' : 'Exécuter Lot 2';
  if (btn) { btn.disabled = true; btn.textContent = dryRun ? 'Analyse…' : 'Exécution…'; }
  if (!dryRun && !confirm('Exécuter les 43 réaffectations + rattachement des 21 nouvelles questions ?\nCette action modifie Firestore. Continuer ?')) {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    return;
  }
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API_BASE_URL + '/api/admin/execute-lot2-reassignments', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const report = await res.json();
    const warnings = report.reassignments.filter(r => r.status === 'warning').length;
    const errors = report.errors.length;
    const newLinksOk = report.newLinks.filter(l => l.status === 'ok').length;
    const mode = report.dryRun ? '[DRY-RUN] ' : '[EXÉCUTÉ] ';
    alert(
      mode + 'Rapport Lot 2\n\n' +
      '✓ Réaffectations : ' + report.reassignments.length + ' (⚠ ' + warnings + ' absentes de la source)\n' +
      '✓ Nouvelles questions rattachées : ' + newLinksOk + '/21\n' +
      (errors > 0 ? '✗ Erreurs : ' + errors + ' (voir console)\n' : '') +
      '\nDétail complet dans la console (F12).'
    );
    console.log('[Lot2-reassignments]', report);
  } catch (err) {
    console.error('[lot2-reassignments]', err);
    alert('Erreur : ' + (err.message || 'inconnue'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
window.executeLot2Reassignments = executeLot2Reassignments;
