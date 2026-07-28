// ===================== GENERATEUR DE CATALOGUE DE PARCOURS (chantier "propositions de parcours", demande directe de David, 28/07/2026) =====================
// Aucune logique metier ici : appelle js/services/parcours-catalog-generator.js
// et affiche le resultat. Meme principe analyse-puis-confirmation que
// admin/catalog-sync.js, en plus simple (pas de fichier a importer).

import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { analyzeParcoursCatalog, generateParcoursCatalog } from "../js/services/parcours-catalog-generator.js";
import { renderSiteHeader } from "../js/site-header.js";
import { icon } from "../js/icons.js";

function qs(id) { return document.getElementById(id); }
function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let lastAnalyzeResult = null;

onAuthStateChanged(auth, async function(user) {
  const loadingEl = qs('pc-loading');
  const deniedEl = qs('pc-denied');
  const viewEl = qs('pc-view');

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
  renderSiteHeader('mes-parcours');

  qs('pc-analyze-btn').addEventListener('click', onAnalyzeClick);
  qs('pc-generate-btn').addEventListener('click', onGenerateClick);
});

async function onAnalyzeClick() {
  qs('pc-analyze-btn').disabled = true;
  qs('pc-analyzing-card').style.display = 'block';
  qs('pc-report-card').style.display = 'none';
  qs('pc-result-card').style.display = 'none';

  lastAnalyzeResult = await analyzeParcoursCatalog();

  qs('pc-analyzing-card').style.display = 'none';
  qs('pc-analyze-btn').disabled = false;
  renderReport(lastAnalyzeResult);
  qs('pc-report-card').style.display = 'block';
}

function rowReportHtml(row) {
  if (row.allBanks) {
    return (
      '<div class="bank-detail-section">' +
        '<strong>' + escapeHtml(row.name) + '</strong>' +
        '<p class="pv-list-empty" style="margin:4px 0;">Toutes les banques — ' + row.totalPublished + ' question(s) publiée(s)' +
          (row.truncated ? ' (balayage tronqué, voir note ci-dessous)' : '') + '.</p>' +
      '</div>'
    );
  }
  const termsHtml = row.terms.map(function(t) {
    const warn = t.matchCount === 0 && !t.error;
    return '<span class="bank-chip' + (warn ? '' : ' bank-badge-published') + '" style="' + (warn ? 'background:var(--accent-orange-light);color:var(--accent-orange);' : '') + '">' +
      escapeHtml(t.term) + ' : ' + (t.error ? 'erreur' : t.matchCount) +
    '</span>';
  }).join(' ');
  const zeroWarning = row.zeroMatchTerms.length > 0
    ? '<p class="admin-users-disclaimer" style="margin-top:6px;">' + icon('action-warning', { size: 14 }) + ' Aucune correspondance pour : ' + escapeHtml(row.zeroMatchTerms.join(', ')) + '.</p>'
    : '';
  return (
    '<div class="bank-detail-section">' +
      '<strong>' + escapeHtml(row.name) + '</strong> — ' + row.questionIds.length + ' question(s) unique(s) au total' +
      '<div class="bank-detail-tags-row" style="margin-top:6px;">' + termsHtml + '</div>' +
      zeroWarning +
    '</div>'
  );
}

function renderReport(result) {
  const emptyRows = result.rows.filter(function(r) { return r.questionIds.length === 0 && !r.allBanks; });
  const summary = '<p class="pv-list-empty" style="margin-bottom:10px;">' + result.totalRows + ' parcours analysés' +
    (emptyRows.length > 0 ? ' — <strong>' + emptyRows.length + ' sans aucune question trouvée</strong> (à revoir manuellement après création)' : '') + '.</p>';
  qs('pc-report-body').innerHTML = summary + result.rows.map(rowReportHtml).join('');
}

async function onGenerateClick() {
  if (!lastAnalyzeResult) return;
  qs('pc-generate-btn').disabled = true;
  qs('pc-generating-card').style.display = 'block';

  const result = await generateParcoursCatalog(lastAnalyzeResult);

  qs('pc-generating-card').style.display = 'none';

  qs('pc-result-body').innerHTML = result.rows.map(function(r) {
    const statusIcon = r.success ? icon('highlight-check-validated', { size: 16 }) : icon('action-error', { size: 16 });
    const link = r.parcoursId ? ' — <a href="parcours.html">Voir dans Mes parcours (admin)</a>' : '';
    return (
      '<div class="bank-detail-row">' +
        statusIcon + ' <strong>' + escapeHtml(r.name) + '</strong> — ' +
        (r.success ? (r.questionCount + ' question(s) liée(s)') : escapeHtml(r.message || 'Échec')) +
        link +
      '</div>'
    );
  }).join('');
  qs('pc-result-card').style.display = 'block';
}
