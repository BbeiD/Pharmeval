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
  const hasCompleted = items.some(function(i) { return i.percent === 100; });
  let html = items.map(parcoursNodeHtml).join('');
  if (hasCompleted) {
    html += '<div class="mpc-attestation-row">' +
      '<a class="btn-secondary mpc-attestation-btn" href="certificate.html?type=global">' +
        'Attestation globale de formation' +
      '</a>' +
    '</div>';
  }
  container.innerHTML = html;
}

export function renderParcoursCompletionLoading() {
  const container = document.getElementById('parcours-completion-body');
  if (container) container.innerHTML = '<div class="stats-loading">Chargement de vos parcours…</div>';
}

export function renderParcoursCompletionError() {
  const container = document.getElementById('parcours-completion-body');
  if (container) container.innerHTML = '<p class="admin-message admin-message-error">Impossible de charger vos parcours pour le moment.</p>';
}
