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
  let html = '<div class="mpc-parcours-card">';
  html += '<div class="mpc-parcours-header">';
  html += '<a class="mpc-parcours-link" href="parcours-detail.html?id=' + encodeURIComponent(item.parcoursId) + '">' + escapeHtml(item.name) + '</a>';
  html += '<span class="bank-chip">' + item.questionCount + ' question(s)</span>';
  html += '</div>';
  html += progressBarHtml(item.percent, item.name);
  if (item.percent === 100) {
    html += '<div class="mpc-cert-row">' +
      '<a class="btn-secondary mpc-cert-btn" href="certificate.html?type=parcours&parcoursId=' + encodeURIComponent(item.parcoursId) + '">' +
        'Obtenir mon certificat' +
      '</a>' +
    '</div>';
  }
  html += '</div>';
  return html;
}

const PAGE_SIZE = 10;
let allItems = [];
let shownCount = 0;
let currentFilter = 'all'; // 'all' | 'done' | 'inprogress' | 'notstarted'

function filteredItems() {
  if (currentFilter === 'done') return allItems.filter(function(i) { return i.percent === 100; });
  if (currentFilter === 'inprogress') return allItems.filter(function(i) { return typeof i.percent === 'number' && i.percent > 0 && i.percent < 100; });
  if (currentFilter === 'notstarted') return allItems.filter(function(i) { return !i.percent; });
  return allItems;
}

function filterPillsHtml() {
  const filters = [
    { key: 'all', label: 'Tous' },
    { key: 'done', label: 'Terminés' },
    { key: 'inprogress', label: 'En cours' },
    { key: 'notstarted', label: 'Pas commencé' },
  ];
  const countsByFilter = {
    all: allItems.length,
    done: allItems.filter(function(i) { return i.percent === 100; }).length,
    inprogress: allItems.filter(function(i) { return typeof i.percent === 'number' && i.percent > 0 && i.percent < 100; }).length,
    notstarted: allItems.filter(function(i) { return !i.percent; }).length,
  };
  return '<div class="mpc-filter-row">' +
    filters.map(function(f) {
      const active = currentFilter === f.key ? ' mpc-filter-active' : '';
      return '<button class="mpc-filter-pill' + active + '" onclick="setParcoursCompletionFilter(\'' + f.key + '\')">' +
        f.label + ' <span class="mpc-filter-count">' + countsByFilter[f.key] + '</span>' +
      '</button>';
    }).join('') +
  '</div>';
}

function renderSlice() {
  const container = document.getElementById('parcours-completion-body');
  if (!container) return;

  const items = filteredItems();
  const hasCompleted = allItems.some(function(i) { return i.percent === 100; });
  const visible = items.slice(0, shownCount);
  const remaining = items.length - shownCount;

  let html = filterPillsHtml();
  if (hasCompleted) {
    html += '<div class="mpc-attestation-row">' +
      '<a class="btn-secondary mpc-attestation-btn" href="certificate.html?type=custom">' +
        'Créer mon attestation de formation' +
      '</a>' +
    '</div>';
  }
  if (items.length === 0) {
    html += '<p class="bank-list-empty">Aucun parcours dans cette catégorie.</p>';
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
