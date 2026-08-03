// ===================== CONTROLEUR "MES FORMATIONS" (Sprint 15 + UI v2, 2026-08) =====================
// Espace UTILISATEUR : accessible à toute personne connectée, pour SA PROPRE liste de parcours.
// Aucune permission d'administration requise (voir assignment-service.js + firestore.rules).
//
// Sprint 15 original : métrique "par tentative" (attemptsCount + bestPercent) + session EN COURS
// détectée séparément — remplace l'affichage du % de réponses correctes (jugé peu lisible).
//
// UI v2 (2026-08) : titre structuré Famille — Titre : Sous-titre, barre de recherche, filtre
// catégorie, tri, section "Continuer", barre de stats compacte, couleurs par famille.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getAssignedParcoursForUser } from "./services/assignment-service.js";
import { getSelfServiceCatalogParcours, getOrganizationParcours } from "./services/parcours-service.js";
import { resolveParcoursColorHex, resolveParcoursIconKey, isParcoursCurrentlyFeatured, ACCESS_TIERS, PREMIUM_REQUIRED_MESSAGE } from "./services/parcours-metadata-service.js";
import { getParcoursAttemptSummaryForUser } from "./services/evaluation-result-service.js";
import { getActiveSession } from "./services/evaluation-session-service.js";
import { renderSiteHeader } from "./site-header.js";
import { icon, renderAnyIcon, ICONS, DOT_ICONS } from "./icons.js";
import { classificationFromParcoursName } from "./services/parcours-classification-logic.js";
import { todayDateStr } from "./services/date-utils.js";

const KNOWN_ICON_KEYS = new Set([...Object.keys(ICONS), ...Object.keys(DOT_ICONS)]);

// Couleur de bande supérieure dérivée de la famille du parcours (cohérence visuelle).
// Tous les parcours d'une même famille ont la même couleur, indépendamment du champ `color`
// individuel — le champ individuel sert uniquement de fallback pour les ALAUNE sans famille.
const CATEGORY_COLORS = {
  'Bon usage et sécurité':           '#1D9E75',
  'Déontologie':                     '#6B46C1',
  'Douleur et fièvre':               '#D97A2A',
  'Galénique et préparations':       '#547A68',
  'Gynéco-obstétrique':              '#C83E8A',
  'Immunité':                        '#2EA0A0',
  'Infections':                      '#DC4444',
  'Médicaments antitumoraux':        '#B84C28',
  'Minéraux et vitamines':           '#58A048',
  'Pathologies ostéo-articulaires':  '#B87A28',
  'Patient âgé':                     '#8B6940',
  'Pratique officinale':             '#2D7A60',
  'Prévention et santé publique':    '#28A060',
  'Sang et coagulation':             '#DD7744',
  'Système cardio-vasculaire':       '#E05050',
  'Système gastro-intestinal':       '#C8982A',
  'Système hormonal':                '#3B82C4',
  'Système nerveux':                 '#7C5AC8',
  'Système respiratoire':            '#2E9E70',
  'Système urogénital':              '#3B74C0',
};

function categoryColorFor(category, fallbackHex) {
  return (category && CATEGORY_COLORS[category]) || fallbackHex || '#1D9E75';
}

// Décompose "Famille — Titre : Sous-titre" → { category, title, subtitle }
// Fonctionne aussi pour les formats ALAUNE courts ("Titre : Sous-titre" ou "Titre seul").
function parseParcoursTitleParts(name) {
  const s = (name || '').toString();
  const dashIdx = s.indexOf(' — ');
  if (dashIdx >= 0) {
    const category = s.slice(0, dashIdx).trim();
    const rest = s.slice(dashIdx + 3).trim();
    const colonIdx = rest.indexOf(' : ');
    if (colonIdx >= 0) {
      return { category, title: rest.slice(0, colonIdx).trim(), subtitle: rest.slice(colonIdx + 3).trim() };
    }
    return { category, title: rest, subtitle: null };
  }
  const colonIdx = s.indexOf(' : ');
  if (colonIdx >= 0) {
    return { category: null, title: s.slice(0, colonIdx).trim(), subtitle: s.slice(colonIdx + 3).trim() };
  }
  return { category: null, title: s, subtitle: null };
}

// Normalise pour la recherche : minuscules + sans accents
function normalizeStr(str) {
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showMessage(status, message) {
  const el = document.getElementById('mesparcours-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

// Onglets de statut (inchangés)
const TABS = [
  { key: 'toutes',      label: 'Toutes' },
  { key: 'en-cours',   label: 'En cours' },
  { key: 'a-commencer',label: 'À commencer' },
  { key: 'terminees',  label: 'Terminées' },
];

// Onglets principaux — "Mes parcours" renommé "Catalogue" (demande UI v2)
const TOP_TABS = [
  { key: 'mes-parcours',  label: 'Catalogue' },
  { key: 'organisation',  label: 'Mon organisation' },
  { key: 'a-la-une',      label: 'À la une' },
];

let state = {
  entries: [],
  attemptsByParcoursId: new Map(),
  activeSessionByParcoursId: new Map(),
  activeTab: 'toutes',
  activeTopTab: 'mes-parcours',
  searchQuery: '',
  categoryFilter: '',
  sortKey: 'default',
};

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('mesparcours-loading');
  const viewEl = document.getElementById('mesparcours-view');

  if (!user) {
    clearCurrentUserContext();
    window.location.href = 'index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('mes-parcours');

  renderTopTabs();
  await loadMyParcours();
});

function renderTopTabs() {
  const el = document.getElementById('mesparcours-top-tabs');
  if (!el) return;
  el.innerHTML = TOP_TABS.map(function(t) {
    const activeCls = t.key === state.activeTopTab ? ' folder-tab-active' : '';
    return '<button type="button" class="folder-tab' + activeCls + '" onclick="selectMesFormationsTopTab(\'' + t.key + '\')">' + escapeHtml(t.label) + '</button>';
  }).join('');
}

export function selectMesFormationsTopTab(key) {
  state.activeTopTab = key;
  state.activeTab = 'toutes';
  state.searchQuery = '';
  state.categoryFilter = '';
  state.sortKey = 'default';
  renderTopTabs();
  loadMyParcours();
}
window.selectMesFormationsTopTab = selectMesFormationsTopTab;

export function selectMesFormationsTab(key) {
  state.activeTab = key;
  renderGrid();
}
window.selectMesFormationsTab = selectMesFormationsTab;

export function onMesParcoursSearch(val) {
  state.searchQuery = (val || '').trim();
  renderGrid();
}
window.onMesParcoursSearch = onMesParcoursSearch;

export function onMesParcoursCategory(val) {
  state.categoryFilter = val || '';
  renderGrid();
}
window.onMesParcoursCategory = onMesParcoursCategory;

export function onMesParcoursSort(val) {
  state.sortKey = val || 'default';
  renderGrid();
}
window.onMesParcoursSort = onMesParcoursSort;

// Toolbar : onglets de statut + recherche + filtre catégorie + tri
function renderToolbar() {
  const el = document.getElementById('mesparcours-tabs');
  if (!el) return;

  const cats = (function() {
    const set = new Set();
    state.entries.forEach(function(e) {
      const parts = parseParcoursTitleParts(e.parcours.name);
      if (parts.category) set.add(parts.category);
    });
    return Array.from(set).sort(function(a, b) { return a.localeCompare(b, 'fr'); });
  })();

  const statusTabsHtml = TABS.map(function(t) {
    const activeCls = t.key === state.activeTab ? ' bank-tab-active' : '';
    return '<button type="button" class="bank-tab' + activeCls + '"' +
      ' onclick="selectMesFormationsTab(\'' + t.key + '\')"' +
      ' aria-pressed="' + (t.key === state.activeTab) + '">' +
      escapeHtml(t.label) + '</button>';
  }).join('');

  const clearBtn = state.searchQuery
    ? '<button type="button" class="mesparcours-search-clear" onclick="onMesParcoursSearch(\'\')" aria-label="Effacer la recherche">' +
        '<i class="ti ti-x" aria-hidden="true"></i></button>'
    : '';

  const catHtml = cats.length > 0
    ? '<select class="mesparcours-filter-select" onchange="onMesParcoursCategory(this.value)" aria-label="Filtrer par famille">' +
        '<option value="">Toutes les familles</option>' +
        cats.map(function(c) {
          return '<option value="' + escapeHtml(c) + '"' + (state.categoryFilter === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
        }).join('') +
      '</select>'
    : '';

  const sortHtml = '<select class="mesparcours-filter-select" onchange="onMesParcoursSort(this.value)" aria-label="Trier par">' +
    '<option value="default"'  + (state.sortKey === 'default'  ? ' selected' : '') + '>Recommandés</option>' +
    '<option value="alpha"'    + (state.sortKey === 'alpha'    ? ' selected' : '') + '>Alphabétique</option>' +
    '<option value="progress"' + (state.sortKey === 'progress' ? ' selected' : '') + '>Progression</option>' +
    '<option value="score"'    + (state.sortKey === 'score'    ? ' selected' : '') + '>Meilleur score</option>' +
    '<option value="activity"' + (state.sortKey === 'activity' ? ' selected' : '') + '>Dernière activité</option>' +
    '</select>';

  el.innerHTML =
    '<div class="mesparcours-toolbar">' +
      '<div class="mesparcours-toolbar-top">' +
        '<div class="mesparcours-status-tabs">' + statusTabsHtml + '</div>' +
        '<div class="mesparcours-search-wrap">' +
          '<i class="ti ti-search mesparcours-search-icon" aria-hidden="true"></i>' +
          '<input type="search" id="mesparcours-search-input" class="mesparcours-search-input"' +
            ' placeholder="Rechercher…"' +
            ' value="' + escapeHtml(state.searchQuery) + '"' +
            ' oninput="onMesParcoursSearch(this.value)"' +
            ' aria-label="Rechercher un parcours">' +
          clearBtn +
        '</div>' +
      '</div>' +
      '<div class="mesparcours-toolbar-bottom">' +
        catHtml +
        sortHtml +
      '</div>' +
    '</div>';
}

function statusForEntry(parcoursId) {
  if (state.activeSessionByParcoursId.get(parcoursId)) return 'en-cours';
  const attempts = state.attemptsByParcoursId.get(parcoursId);
  return (attempts && attempts.attemptsCount > 0) ? 'terminees' : 'a-commencer';
}

// Chargement des entrées selon l'onglet principal actif (inchangé par rapport à Sprint 15)
async function loadEntriesForActiveTopTab(ctx) {
  const today = todayDateStr();

  if (state.activeTopTab === 'organisation') {
    const result = await getOrganizationParcours();
    if (result.error) return { error: true, items: [] };
    const items = result.items
      .filter(function(p) { return !isParcoursCurrentlyFeatured(p, today); })
      .map(function(p) { return { parcours: p, assignment: null }; });
    return { error: false, items: items };
  }

  const [assignedResult, catalogResult] = await Promise.all([
    getAssignedParcoursForUser(ctx && ctx.uid),
    getSelfServiceCatalogParcours(),
  ]);
  if (assignedResult.error && catalogResult.error) return { error: true, items: [] };

  const byId = new Map();
  (catalogResult.error ? [] : catalogResult.items).forEach(function(p) {
    byId.set(p.id, { parcours: p, assignment: null });
  });
  (assignedResult.error ? [] : assignedResult.items).forEach(function(entry) {
    byId.set(entry.parcours.id, entry); // version attribuée prioritaire (badges + échéance)
  });

  if (state.activeTopTab === 'a-la-une') {
    const items = Array.from(byId.values()).filter(function(entry) {
      return isParcoursCurrentlyFeatured(entry.parcours, today);
    });
    return { error: false, items: items };
  }

  // "Catalogue" : exclut les parcours "à la une" (réservés à l'onglet dédié)
  const items = Array.from(byId.values()).filter(function(entry) {
    return !isParcoursCurrentlyFeatured(entry.parcours, today);
  });
  return { error: false, items: items };
}

async function loadMyParcours() {
  const ctx = getCurrentUserContext();
  const gridEl = document.getElementById('mesparcours-grid');
  const emptyEl = document.getElementById('mesparcours-empty');
  gridEl.innerHTML = '<div class="bank-list-loading">Chargement de vos parcours…</div>';
  emptyEl.style.display = 'none';
  showMessage(null, null);

  const [entriesResult, attemptResult] = await Promise.all([
    loadEntriesForActiveTopTab(ctx),
    getParcoursAttemptSummaryForUser(ctx && ctx.uid),
  ]);

  if (entriesResult.error) {
    gridEl.innerHTML = '';
    showMessage('error', 'Impossible de charger vos parcours pour le moment. Réessayez plus tard.');
    renderToolbar();
    return;
  }

  if (entriesResult.items.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.textContent = state.activeTopTab === 'organisation'
      ? 'Aucun parcours n\'est encore proposé par votre organisation.'
      : 'Aucun parcours disponible pour l\'instant.';
    emptyEl.style.display = 'block';
    renderToolbar();
    return;
  }

  state.attemptsByParcoursId = attemptResult.error ? new Map() : attemptResult.byParcoursId;
  state.entries = entriesResult.items;
  state.activeSessionByParcoursId = new Map();
  await Promise.all(state.entries.map(async function(entry) {
    const active = await getActiveSession(entry.parcours.id, null).catch(function() { return null; });
    if (active) state.activeSessionByParcoursId.set(entry.parcours.id, active);
  }));

  renderStatsGrid();
  renderGrid();
}

// Barre de stats compacte (option A) : "65 parcours · 2 en cours · 4 terminés"
function renderStatsGrid() {
  const gridEl = document.getElementById('mesparcours-stats-grid');
  if (!gridEl) return;

  const total     = state.entries.length;
  const enCours   = state.entries.filter(function(e) { return statusForEntry(e.parcours.id) === 'en-cours'; }).length;
  const terminees = state.entries.filter(function(e) { return statusForEntry(e.parcours.id) === 'terminees'; }).length;

  gridEl.innerHTML =
    '<div class="mesparcours-summary-bar">' +
      '<span class="mesparcours-summary-count">' + total + '</span>' +
      '<span class="mesparcours-summary-label"> parcours</span>' +
      '<span class="mesparcours-summary-sep"> · </span>' +
      '<span class="mesparcours-summary-count mesparcours-summary-active">' + enCours + '</span>' +
      '<span class="mesparcours-summary-label"> en cours</span>' +
      '<span class="mesparcours-summary-sep"> · </span>' +
      '<span class="mesparcours-summary-count mesparcours-summary-done">' + terminees + '</span>' +
      '<span class="mesparcours-summary-label"> terminé' + (terminees !== 1 ? 's' : '') + '</span>' +
    '</div>';
}

// Tri interne à une classification par niveau de difficulté (Fondamental → Expert) puis partie
const DIFFICULTY_SORT_ORDER = { 'Fondamental': 1, 'Approfondi': 2, 'Expert': 3 };
function levelSortKey(name) {
  const s = (name || '').toString();
  const difficultyMatch = /Fondamental|Approfondi|Expert/.exec(s);
  const level = difficultyMatch ? (DIFFICULTY_SORT_ORDER[difficultyMatch[0]] || 99) : 99;
  const partMatch = /partie (\d+)\/\d+/.exec(s);
  const part = partMatch ? parseInt(partMatch[1], 10) : 0;
  return level * 100 + part;
}

// Regroupement par famille, parcours mis en avant en tête, puis ordre alphabétique
function groupEntriesByClassification(entries) {
  const groups = new Map();
  entries.forEach(function(entry) {
    const key = classificationFromParcoursName(entry.parcours.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });

  const today = todayDateStr();
  const groupKeys = Array.from(groups.keys()).sort(function(a, b) {
    const aFeatured = groups.get(a).some(function(e) { return isParcoursCurrentlyFeatured(e.parcours, today); });
    const bFeatured = groups.get(b).some(function(e) { return isParcoursCurrentlyFeatured(e.parcours, today); });
    if (aFeatured !== bFeatured) return aFeatured ? -1 : 1;
    return a.localeCompare(b, 'fr');
  });

  const result = [];
  groupKeys.forEach(function(key) {
    const groupEntries = groups.get(key).slice().sort(function(a, b) {
      return levelSortKey(a.parcours.name) - levelSortKey(b.parcours.name);
    });
    result.push.apply(result, groupEntries);
  });
  return result;
}

// Applique filtre statut + filtre catégorie + recherche textuelle + tri
function filterAndSortEntries(entries) {
  let result = entries;

  if (state.activeTab !== 'toutes') {
    result = result.filter(function(entry) {
      return statusForEntry(entry.parcours.id) === state.activeTab;
    });
  }

  if (state.categoryFilter) {
    result = result.filter(function(entry) {
      return parseParcoursTitleParts(entry.parcours.name).category === state.categoryFilter;
    });
  }

  if (state.searchQuery) {
    const q = normalizeStr(state.searchQuery);
    result = result.filter(function(entry) {
      const p = entry.parcours;
      const parts = parseParcoursTitleParts(p.name);
      return normalizeStr(p.name).includes(q) ||
        normalizeStr(parts.category).includes(q) ||
        normalizeStr(parts.title).includes(q) ||
        normalizeStr(parts.subtitle).includes(q) ||
        (p.tags || []).some(function(t) { return normalizeStr(t).includes(q); }) ||
        normalizeStr(p.theme || '').includes(q);
    });
  }

  if (state.sortKey === 'alpha') {
    return result.slice().sort(function(a, b) {
      const pa = parseParcoursTitleParts(a.parcours.name);
      const pb = parseParcoursTitleParts(b.parcours.name);
      return (pa.title || a.parcours.name).localeCompare(pb.title || b.parcours.name, 'fr');
    });
  }
  if (state.sortKey === 'progress') {
    const ORDER = { 'en-cours': 0, 'a-commencer': 1, 'terminees': 2 };
    return result.slice().sort(function(a, b) {
      return (ORDER[statusForEntry(a.parcours.id)] || 1) - (ORDER[statusForEntry(b.parcours.id)] || 1);
    });
  }
  if (state.sortKey === 'score') {
    return result.slice().sort(function(a, b) {
      const sA = (state.attemptsByParcoursId.get(a.parcours.id) || {}).bestPercent || -1;
      const sB = (state.attemptsByParcoursId.get(b.parcours.id) || {}).bestPercent || -1;
      return sB - sA;
    });
  }
  if (state.sortKey === 'activity') {
    return result.slice().sort(function(a, b) {
      const nA = (state.attemptsByParcoursId.get(a.parcours.id) || {}).attemptsCount || 0;
      const nB = (state.attemptsByParcoursId.get(b.parcours.id) || {}).attemptsCount || 0;
      return nB - nA;
    });
  }

  // Tri "Recommandés" (défaut) : regroupement par famille
  return groupEntriesByClassification(result);
}

// Section "Continuer" : accès rapide aux parcours avec session active
function renderContinueSection() {
  const sectionsEl = document.getElementById('mesparcours-sections');
  if (!sectionsEl) return;

  const show = state.activeTopTab === 'mes-parcours' &&
    state.activeTab === 'toutes' &&
    !state.searchQuery &&
    !state.categoryFilter;

  if (!show) { sectionsEl.innerHTML = ''; return; }

  const active = state.entries.filter(function(entry) {
    return !!state.activeSessionByParcoursId.get(entry.parcours.id);
  });

  if (active.length === 0) { sectionsEl.innerHTML = ''; return; }

  sectionsEl.innerHTML =
    '<div class="mesparcours-section">' +
      '<div class="mesparcours-section-header">' +
        '<i class="ti ti-player-play-filled" style="color:var(--accent-orange);" aria-hidden="true"></i>' +
        ' <span class="mesparcours-section-title">Continuer</span>' +
      '</div>' +
      '<div class="mesparcours-continue-grid">' +
        active.map(function(entry) {
          const p = entry.parcours;
          const parts = parseParcoursTitleParts(p.name);
          const color = categoryColorFor(parts.category, (p.color ? resolveParcoursColorHex(p.color) : null) || '#1D9E75');
          return (
            '<div class="mesparcours-continue-card" style="border-left-color:' + escapeHtml(color) + ';">' +
              (parts.category ? '<div class="mesparcours-card-category" style="color:' + escapeHtml(color) + ';">' + escapeHtml(parts.category.toUpperCase()) + '</div>' : '') +
              '<div class="mesparcours-continue-card-title">' + escapeHtml(parts.title) + '</div>' +
              '<button class="btn-primary mesparcours-continue-btn" onclick="openParcours(\'' + escapeHtml(p.id) + '\')">' +
                '<i class="ti ti-player-play" aria-hidden="true"></i> Continuer' +
              '</button>' +
            '</div>'
          );
        }).join('') +
      '</div>' +
    '</div>';
}

function renderGrid() {
  const gridEl = document.getElementById('mesparcours-grid');
  const emptyEl = document.getElementById('mesparcours-empty');

  renderToolbar();
  renderContinueSection();

  const filtered = filterAndSortEntries(state.entries);

  if (filtered.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.textContent = (state.searchQuery || state.categoryFilter)
      ? 'Aucun résultat pour cette recherche.'
      : state.activeTab === 'toutes'
        ? 'Aucun parcours disponible pour l\'instant.'
        : 'Aucun parcours dans cette catégorie pour l\'instant.';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  gridEl.innerHTML = filtered.map(function(entry) {
    return cardHtml(entry, state.attemptsByParcoursId.get(entry.parcours.id), !!state.activeSessionByParcoursId.get(entry.parcours.id));
  }).join('');
}

function cardHtml(entry, attempts, hasActiveSession) {
  const p = entry.parcours;
  const parts = parseParcoursTitleParts(p.name);
  const fallbackHex = (p.color ? resolveParcoursColorHex(p.color) : null) || '#1D9E75';
  const hex = categoryColorFor(parts.category, fallbackHex);

  const mandatoryBadge = entry.assignment && entry.assignment.mandatory
    ? '<span class="bank-chip" style="background:#C62828;color:#fff;">Obligatoire</span>' : '';
  const dueBadge = entry.assignment && entry.assignment.dueDate
    ? '<span class="bank-chip">Échéance : ' + escapeHtml(entry.assignment.dueDate) + '</span>' : '';
  const featuredBadge = isParcoursCurrentlyFeatured(p, todayDateStr())
    ? '<span class="bank-chip parcours-featured-badge">' + icon('highlight-star-filled', { size: 13 }) + ' À la une</span>' : '';

  const isMastered = !!(attempts && attempts.bestPercent === 100);
  const masteredCls = isMastered ? ' mesparcours-card-mastered' : '';
  const medalBadge = isMastered
    ? '<i class="ti ti-medal mesparcours-medal" title="Parcours réussi à 100%"></i>' : '';

  const isPremium = p.accessTier === ACCESS_TIERS.PREMIUM;
  const premiumBadge = isPremium
    ? '<span class="bank-chip" style="background:rgba(192,132,252,.15);color:var(--accent-purple);">' + icon('highlight-star-premium', { size: 13 }) + ' Premium</span>' : '';

  // Bouton contextuel : Commencer / Continuer / Recommencer (jamais "Ouvrir" générique)
  let actionBtn;
  if (isPremium) {
    actionBtn = '<button class="btn-secondary" onclick="event.stopPropagation();showPremiumUpsell()">' +
      icon('highlight-star-premium', { size: 14 }) + ' Passer premium</button>';
  } else if (hasActiveSession) {
    actionBtn = '<button class="btn-primary" onclick="openParcours(\'' + escapeHtml(p.id) + '\')">' +
      '<i class="ti ti-player-play" aria-hidden="true"></i> Continuer</button>';
  } else if (attempts && attempts.attemptsCount > 0) {
    actionBtn = '<button class="btn-primary" onclick="openParcours(\'' + escapeHtml(p.id) + '\')">' +
      '<i class="ti ti-refresh" aria-hidden="true"></i> Recommencer</button>';
  } else {
    actionBtn = '<button class="btn-primary" onclick="openParcours(\'' + escapeHtml(p.id) + '\')">' +
      '<i class="ti ti-arrow-right" aria-hidden="true"></i> Commencer</button>';
  }

  // Questions + durée estimée (~30 s/question)
  const qCount = (p.directQuestionIds || []).length || (p.questionCount || 0);
  const estMin  = qCount > 0 ? Math.max(1, Math.round(qCount * 0.5)) : null;
  const metaHtml = (qCount > 0)
    ? '<div class="mesparcours-card-meta">' +
        escapeHtml(qCount + ' question' + (qCount > 1 ? 's' : '') + (estMin ? ' · ~' + estMin + ' min' : '')) +
      '</div>'
    : '';

  // Statut + barre de progression
  let statusHtml;
  if (hasActiveSession) {
    statusHtml =
      '<div class="mesparcours-pills">' +
        '<span class="mesparcours-pill mesparcours-pill-active">Évaluation en cours</span>' +
      '</div>';
  } else if (!attempts || attempts.attemptsCount === 0) {
    statusHtml =
      '<div class="mesparcours-pills">' +
        '<span class="mesparcours-pill">Pas encore commencé</span>' +
      '</div>';
  } else {
    const n = attempts.attemptsCount;
    const pct = attempts.bestPercent;
    const barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? '#D69E2E' : 'var(--accent-orange)';
    statusHtml =
      '<div class="mesparcours-pills">' +
        '<span class="mesparcours-pill">Terminé ' + n + ' fois</span>' +
        '<span class="mesparcours-pill mesparcours-pill-strong">Meilleur score ' + pct + ' %</span>' +
      '</div>' +
      '<div class="mesparcours-progress-bar-wrap" role="progressbar"' +
        ' aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"' +
        ' aria-label="Score ' + pct + '%">' +
        '<div class="mesparcours-progress-bar" style="width:' + pct + '%;background:' + barColor + ';"></div>' +
      '</div>';
  }

  const hasBadges = featuredBadge || premiumBadge || mandatoryBadge || dueBadge;

  // Titre décomposé : catégorie (petite) + titre principal + sous-titre
  const categoryHtml = parts.category
    ? '<div class="mesparcours-card-category" style="color:' + escapeHtml(hex) + ';">' +
        escapeHtml(parts.category.toUpperCase()) + '</div>'
    : '';
  const subtitleHtml = parts.subtitle
    ? '<div class="mesparcours-card-subtitle">' + escapeHtml(parts.subtitle) + '</div>'
    : '';

  return (
    '<div class="mesparcours-card' + masteredCls + '">' +
      '<div class="mesparcours-card-stripe" style="background:' + escapeHtml(hex) + ';"></div>' +
      '<div class="mesparcours-card-body">' +
        '<div class="mesparcours-card-header">' +
          '<div class="mesparcours-card-icon" style="background:' + escapeHtml(hex) + '22;color:' + escapeHtml(hex) + ';">' +
            renderAnyIcon(resolveParcoursIconKey(p, KNOWN_ICON_KEYS), { size: 22 }) +
          '</div>' +
          '<div class="mesparcours-card-title-block">' +
            categoryHtml +
            '<h3 class="mesparcours-card-title">' + escapeHtml(parts.title) + '</h3>' +
            subtitleHtml +
          '</div>' +
          medalBadge +
        '</div>' +
        metaHtml +
        (hasBadges ? '<div class="bank-detail-tags-row">' + featuredBadge + premiumBadge + mandatoryBadge + dueBadge + '</div>' : '') +
        statusHtml +
        actionBtn +
      '</div>' +
    '</div>'
  );
}

export function showPremiumUpsell() {
  showMessage('denied', PREMIUM_REQUIRED_MESSAGE);
}
window.showPremiumUpsell = showPremiumUpsell;

export function openParcours(parcoursId) {
  window.location.href = 'evaluation.html?parcoursId=' + encodeURIComponent(parcoursId);
}
window.openParcours = openParcours;
