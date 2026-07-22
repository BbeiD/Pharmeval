// ===================== RENDU — "MES PARCOURS" (écran Mes évaluations) =====================
// Rendu PUR à partir de données déjà chargées (aucun accès Firestore ici) -
// même principe que js/statistics.js / js/recommendation.js. La lecture
// elle-même (js/services/parcours-completion-service.js) est déclenchée
// par js/history.js, jamais depuis ce fichier.

const BUCKET_ICONS = { competency: '🧩', source: '📚', question: '❓' };

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function progressBarHtml(percent) {
  const hasValue = typeof percent === 'number';
  const pct = hasValue ? percent : 0;
  const label = hasValue ? (percent + ' %') : '—';
  return (
    '<div class="mpc-progress-row">' +
      '<div class="ev-progress-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
        '<div class="ev-progress-bar-fill" style="width:' + pct + '%;"></div>' +
      '</div>' +
      '<span class="mpc-progress-label">' + escapeHtml(label) + '</span>' +
    '</div>'
  );
}

function parcoursNodeHtml(item) {
  let html = '<div class="mpc-parcours-card">';
  html += '<div class="mpc-parcours-header">';
  html += '<a href="parcours-detail.html?id=' + encodeURIComponent(item.parcoursId) + '"><strong>' + escapeHtml(item.name) + '</strong></a>';
  html += '<span class="bank-chip">' + item.questionCount + ' question(s)</span>';
  html += '</div>';
  html += progressBarHtml(item.percent);

  if (item.buckets.length > 0) {
    html += '<div class="mpc-bucket-list">' + item.buckets.map(function(b) {
      return (
        '<div class="mpc-bucket-row">' +
          '<span class="mpc-bucket-label">' + (BUCKET_ICONS[b.type] || '') + ' ' + escapeHtml(b.label) + ' (' + b.count + ')</span>' +
          progressBarHtml(b.percent) +
        '</div>'
      );
    }).join('') + '</div>';
  }

  html += '</div>';
  return html;
}

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
    container.innerHTML = '<p class="bank-list-empty">Aucun parcours ne vous a été attribué pour l\'instant.</p>';
    return;
  }
  container.innerHTML = items.map(parcoursNodeHtml).join('');
}

export function renderParcoursCompletionLoading() {
  const container = document.getElementById('parcours-completion-body');
  if (container) container.innerHTML = '<div class="stats-loading">Chargement de vos parcours…</div>';
}

export function renderParcoursCompletionError() {
  const container = document.getElementById('parcours-completion-body');
  if (container) container.innerHTML = '<p class="admin-message admin-message-error">Impossible de charger vos parcours pour le moment.</p>';
}
