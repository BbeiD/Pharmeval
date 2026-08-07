// ===================== RENDU — "MES PARCOURS" (écran Mes évaluations) =====================
// Rendu PUR à partir de données déjà chargées (aucun accès Firestore ici) -
// même principe que js/statistics.js / js/recommendation.js. La lecture
// elle-même (js/services/parcours-completion-service.js) est déclenchée
// par js/history.js, jamais depuis ce fichier.

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function medalImgForName(name) {
  const n = (name || '').toLowerCase();
  if (n.indexOf('expert') !== -1) return 'assets/medals/medal-expert.png';
  if (n.indexOf('approfondi') !== -1) return 'assets/medals/medal-approfondi.png';
  return 'assets/medals/medal-fondamental.png';
}

// Même table que home.js — dupliquée ici pour ne pas créer de dépendance circulaire.
const CATEGORY_COLORS = {
  'Bon usage et sécurité': '#1D9E75',
  'Déontologie': '#6B46C1',
  'Douleur et fièvre': '#D97A2A',
  'Maladies cardiovasculaires': '#E53E3E',
  'Maladies infectieuses': '#D69E2E',
  'Maladies respiratoires': '#3182CE',
  'Nutrition et métabolisme': '#38A169',
  'Oncologie': '#9F4F96',
  'Pédiatrie': '#319795',
  'Pharmacovigilance': '#C05621',
  'Psychiatrie et neurologie': '#553C9A',
  'Rhumatologie': '#744210',
  'Santé de la femme': '#B83280',
  'Skincare et dermatologie': '#2C7A7B',
  'Soins palliatifs': '#4A5568',
  'Urologie et néphro': '#2B6CB0',
  'Gastro-entérologie': '#276749',
  'Ophtalmologie': '#2D3748',
  'Endocrinologie': '#6B4226',
  'Pharmacie du voyageur': '#2F855A',
};

function categoryColorFor(category, fallbackHex) {
  return (category && CATEGORY_COLORS[category]) || fallbackHex || '#1D9E75';
}

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

function progressBarHtml(percent, parcoursName) {
  const hasValue = typeof percent === 'number';
  const pct = hasValue ? percent : 0;
  const earned = pct === 100;
  const label = earned
    ? '<img src="' + medalImgForName(parcoursName) + '" class="mpc-medal-img" alt="Médaille obtenue" title="Médaille obtenue">'
    : '<span class="mpc-progress-label">' + (hasValue ? (percent + ' %') : '—') + '</span>';
  return (
    '<div class="mpc-progress-row">' +
      '<div class="ev-progress-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
        '<div class="ev-progress-bar-fill' + (earned ? ' ev-progress-bar-fill-gold' : '') + '" style="width:' + pct + '%;"></div>' +
      '</div>' +
      label +
    '</div>'
  );
}

function parcoursNodeHtml(item) {
  const parts = parseParcoursTitleParts(item.name);
  const hex = categoryColorFor(parts.category, '#1D9E75');

  let html = '<div class="mpc-parcours-card">';

  if (parts.category) {
    html += '<div class="mpc-category-label" style="color:' + escapeHtml(hex) + ';">' + escapeHtml(parts.category) + '</div>';
  }

  html += '<div class="mpc-parcours-header">';
  html += '<a class="mpc-parcours-link" href="parcours-detail.html?id=' + encodeURIComponent(item.parcoursId) + '"' +
    (!parts.category ? ' style="color:' + escapeHtml(hex) + ';"' : '') + '>' +
    escapeHtml(parts.title) + '</a>';
  html += '<span class="bank-chip">' + item.questionCount + ' question(s)</span>';
  html += '</div>';

  if (parts.subtitle) {
    html += '<div class="mpc-parcours-subtitle">' + escapeHtml(parts.subtitle) + '</div>';
  }

  html += progressBarHtml(item.percent, item.name);

  if (item.percent === 100) {
    html += '<div class="mpc-cert-row">' +
      '<a class="btn-secondary mpc-cert-btn" href="certificate.html?type=parcours&parcoursId=' + encodeURIComponent(item.parcoursId) + '">' +
        'Voir mon certificat' +
      '</a>' +
    '</div>';
  }

  html += '</div>';
  return html;
}

const PAGE_SIZE = 10;
let allItems = [];
let shownCount = 0;
let currentFilter = 'all'; // 'all' | 'done' | 'inprogress'

function filteredItems() {
  if (currentFilter === 'done') return allItems.filter(function(i) { return i.percent === 100; });
  if (currentFilter === 'inprogress') return allItems.filter(function(i) { return typeof i.percent === 'number' && i.percent > 0 && i.percent < 100; });
  return allItems;
}

function filterPillsHtml() {
  const inProgressCount = allItems.filter(function(i) { return typeof i.percent === 'number' && i.percent > 0 && i.percent < 100; }).length;
  const doneCount = allItems.filter(function(i) { return i.percent === 100; }).length;

  const filters = [
    { key: 'all', label: 'Tous', count: allItems.length },
    { key: 'inprogress', label: 'En cours', count: inProgressCount },
    { key: 'done', label: 'Terminés', count: doneCount },
  ];

  return '<div class="mpc-filter-row">' +
    filters.map(function(f) {
      const active = currentFilter === f.key ? ' mpc-filter-active' : '';
      return '<button class="mpc-filter-pill' + active + '" onclick="setParcoursCompletionFilter(\'' + f.key + '\')">' +
        f.label + ' <span class="mpc-filter-count">' + f.count + '</span>' +
      '</button>';
    }).join('') +
    '<a class="mpc-catalogue-link" href="mes-parcours.html">Catalogue →</a>' +
  '</div>';
}

function certGlobalHtml() {
  return '<div class="mpc-attestation-row">' +
    '<a class="btn-secondary mpc-attestation-btn" href="certificate.html?type=custom">' +
      'Créer mon attestation de formation' +
    '</a>' +
  '</div>';
}

function renderSlice() {
  const container = document.getElementById('parcours-completion-body');
  if (!container) return;

  const doneItems = allItems.filter(function(i) { return i.percent === 100; });
  const hasDone = doneItems.length > 0;

  let html = filterPillsHtml();

  if (currentFilter === 'all') {
    const inProgress = allItems.filter(function(i) { return typeof i.percent === 'number' && i.percent > 0 && i.percent < 100; });
    const done = doneItems;
    const notStarted = allItems.filter(function(i) { return !i.percent; });

    if (inProgress.length === 0 && done.length === 0) {
      html += '<div class="mpc-empty-section">Vous n\'avez encore commencé aucun parcours. <a href="mes-parcours.html">Découvrir le catalogue →</a></div>';
    } else {
      if (inProgress.length > 0) {
        html += '<div class="mpc-group-header">En cours</div>';
        html += inProgress.map(parcoursNodeHtml).join('');
      }
      if (done.length > 0) {
        html += '<div class="mpc-group-header">Terminés</div>';
        html += done.map(parcoursNodeHtml).join('');
      }
      if (hasDone) {
        html += certGlobalHtml();
      }
      if (notStarted.length > 0) {
        html += '<div class="mpc-notstarted-row">' +
          notStarted.length + ' parcours non encore commencé' + (notStarted.length > 1 ? 's' : '') +
          '. <a href="mes-parcours.html">Voir le catalogue →</a>' +
        '</div>';
      }
    }
  } else {
    const items = filteredItems();
    const visible = items.slice(0, shownCount);
    const remaining = items.length - shownCount;

    if (items.length === 0) {
      const msg = currentFilter === 'done'
        ? 'Aucun parcours terminé pour l\'instant — la médaille est au bout du chemin.'
        : 'Aucun parcours en cours. Commencez-en un depuis le catalogue !';
      html += '<p class="bank-list-empty">' + msg + '</p>';
    } else {
      html += visible.map(parcoursNodeHtml).join('');
      if (remaining > 0) {
        html += '<div style="text-align:center;margin-top:12px;">' +
          '<button class="btn-secondary" onclick="showMoreParcours()">' +
            'Voir les ' + Math.min(remaining, PAGE_SIZE) + ' suivants' +
          '</button>' +
        '</div>';
      }
    }

    if (currentFilter === 'done' && hasDone) {
      html += certGlobalHtml();
    }
  }

  container.innerHTML = html;
}

export function setParcoursCompletionFilter(filter) {
  currentFilter = filter;
  shownCount = Math.min(PAGE_SIZE, filteredItems().length);
  renderSlice();
}
window.setParcoursCompletionFilter = setParcoursCompletionFilter;

export function showMoreParcours() {
  shownCount = Math.min(shownCount + PAGE_SIZE, filteredItems().length);
  renderSlice();
}
window.showMoreParcours = showMoreParcours;

/**
 * Rendu pur a partir d'une liste deja chargee (voir
 * parcours-completion-service.js#getParcoursCompletionForUser) - aucun
 * acces Firestore ici.
 * @param {Array<object>} items
 */
export function renderParcoursCompletionFromData(items) {
  const container = document.getElementById('parcours-completion-body');
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<p class="bank-list-empty">Aucun parcours disponible pour le moment.</p>';
    return;
  }
  allItems = items;
  currentFilter = 'all';
  shownCount = Math.min(PAGE_SIZE, items.length);
  renderSlice();
}

export function renderParcoursCompletionLoading() {
  const container = document.getElementById('parcours-completion-body');
  if (container) container.innerHTML = '<div class="stats-loading">Chargement de vos parcours…</div>';
}

export function renderParcoursCompletionError() {
  const container = document.getElementById('parcours-completion-body');
  if (container) container.innerHTML = '<p class="admin-message admin-message-error">Impossible de charger vos parcours pour le moment.</p>';
}
