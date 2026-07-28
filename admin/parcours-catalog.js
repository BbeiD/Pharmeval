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
// AJOUT (demande directe de David, 28/07/2026) : lignes que l'admin a
// retirees de la selection AVANT creation (voir onReportBodyClick) - un
// index de ligne exclu n'est jamais envoye a generateParcoursCatalog().
const excludedRows = new Set();

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
  qs('pc-report-body').addEventListener('click', onReportBodyClick);
});

async function onAnalyzeClick() {
  qs('pc-analyze-btn').disabled = true;
  qs('pc-analyzing-card').style.display = 'block';
  qs('pc-report-card').style.display = 'none';
  qs('pc-result-card').style.display = 'none';
  excludedRows.clear();

  lastAnalyzeResult = await analyzeParcoursCatalog();

  qs('pc-analyzing-card').style.display = 'none';
  qs('pc-analyze-btn').disabled = false;
  renderReport(lastAnalyzeResult);
  qs('pc-report-card').style.display = 'block';
}

// AJOUT (demande directe de David, 28/07/2026) : avant creation, l'admin
// peut corriger le nom propose par la table et plafonner le nombre de
// questions reellement retenues (tirage aleatoire parmi celles trouvees -
// voir pickRandomSubset() dans parcours-catalog-generator.js, jamais plus
// que ce qui a ete reellement trouve). Un input par ligne, lu au moment du
// clic sur "Créer les brouillons" (voir onGenerateClick ci-dessous).
function overrideFieldsHtml(row, index, matchedCount) {
  const defaultCount = Math.min(matchedCount, 20);
  return (
    '<div class="bank-detail-tags-row" style="margin-top:8px;gap:14px;flex-wrap:wrap;align-items:flex-end;">' +
      '<label class="bank-edit-label" style="margin:0;">Nom du parcours' +
        '<input type="text" class="bank-select pc-name-input" data-row-index="' + index + '" value="' + escapeHtml(row.name) + '" style="max-width:280px;display:block;margin-top:4px;">' +
      '</label>' +
      '<label class="bank-edit-label" style="margin:0;">Questions à inclure (sur ' + matchedCount + ' trouvée(s))' +
        '<input type="number" class="bank-select pc-count-input" data-row-index="' + index + '" value="' + defaultCount + '" min="0" max="' + matchedCount + '" step="1" style="max-width:100px;display:block;margin-top:4px;">' +
      '</label>' +
    '</div>'
  );
}

// AJOUT (demande directe de David, 28/07/2026) : bouton par ligne pour
// retirer une suggestion de la selection avant creation (ex. un theme sans
// correspondance qu'il ne souhaite pas creer en brouillon vide) - voir
// onReportBodyClick (delegation d'evenements, la liste est reconstruite a
// chaque analyse). Reversible via "Annuler" tant que la page n'a pas ete
// rechargee.
function removeButtonHtml(index) {
  return '<button type="button" class="btn-secondary pc-remove-btn" data-row-index="' + index + '" style="flex-shrink:0;">Supprimer cette suggestion</button>';
}

function rowReportInnerHtml(row, index) {
  if (row.allBanks) {
    return (
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
        '<div style="flex:1;">' +
          '<strong>' + escapeHtml(row.name) + '</strong>' +
          '<p class="pv-list-empty" style="margin:4px 0;">Toutes les banques — ' + row.totalPublished + ' question(s) publiée(s)' +
            (row.truncated ? ' (balayage tronqué, voir note ci-dessous)' : '') + '.</p>' +
        '</div>' +
        removeButtonHtml(index) +
      '</div>' +
      overrideFieldsHtml(row, index, row.totalPublished)
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
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
      '<div style="flex:1;">' +
        '<strong>' + escapeHtml(row.name) + '</strong> — ' + row.questionIds.length + ' question(s) unique(s) au total' +
        '<div class="bank-detail-tags-row" style="margin-top:6px;">' + termsHtml + '</div>' +
        zeroWarning +
      '</div>' +
      removeButtonHtml(index) +
    '</div>' +
    overrideFieldsHtml(row, index, row.questionIds.length)
  );
}

function removedRowHtml(index) {
  return '<em class="pv-list-empty">Suggestion supprimée — <a href="#" class="pc-undo-link" data-row-index="' + index + '">annuler</a></em>';
}

function rowReportHtml(row, index) {
  const inner = excludedRows.has(index) ? removedRowHtml(index) : rowReportInnerHtml(row, index);
  return '<div class="bank-detail-section" id="pc-row-' + index + '">' + inner + '</div>';
}

function renderReport(result) {
  const emptyRows = result.rows.filter(function(r) { return r.questionIds.length === 0 && !r.allBanks; });
  const summary = '<p class="pv-list-empty" style="margin-bottom:10px;">' + result.totalRows + ' parcours analysés' +
    (emptyRows.length > 0 ? ' — <strong>' + emptyRows.length + ' sans aucune question trouvée</strong> (à revoir manuellement après création)' : '') + '.</p>';
  qs('pc-report-body').innerHTML = summary + result.rows.map(rowReportHtml).join('');
}

function onReportBodyClick(e) {
  const removeBtn = e.target.closest('.pc-remove-btn');
  if (removeBtn) {
    const index = parseInt(removeBtn.dataset.rowIndex, 10);
    excludedRows.add(index);
    const wrapper = qs('pc-row-' + index);
    if (wrapper) wrapper.innerHTML = removedRowHtml(index);
    return;
  }
  const undoLink = e.target.closest('.pc-undo-link');
  if (undoLink) {
    e.preventDefault();
    const index = parseInt(undoLink.dataset.rowIndex, 10);
    excludedRows.delete(index);
    const wrapper = qs('pc-row-' + index);
    if (wrapper && lastAnalyzeResult) wrapper.innerHTML = rowReportInnerHtml(lastAnalyzeResult.rows[index], index);
  }
}

function readRowOverrides(rowCount) {
  const overrides = [];
  for (let i = 0; i < rowCount; i++) {
    const nameInput = document.querySelector('.pc-name-input[data-row-index="' + i + '"]');
    const countInput = document.querySelector('.pc-count-input[data-row-index="' + i + '"]');
    const parsedCount = countInput ? parseInt(countInput.value, 10) : NaN;
    overrides.push({
      name: nameInput ? nameInput.value : null,
      questionCount: Number.isFinite(parsedCount) ? parsedCount : null,
    });
  }
  return overrides;
}

async function onGenerateClick() {
  if (!lastAnalyzeResult) return;
  qs('pc-generate-btn').disabled = true;
  qs('pc-generating-card').style.display = 'block';

  const overrides = readRowOverrides(lastAnalyzeResult.rows.length).map(function(o, i) {
    return excludedRows.has(i) ? Object.assign({}, o, { skip: true }) : o;
  });
  const result = await generateParcoursCatalog(lastAnalyzeResult, overrides);

  qs('pc-generating-card').style.display = 'none';

  qs('pc-result-body').innerHTML = result.rows.map(function(r) {
    if (r.skipped) {
      return '<div class="bank-detail-row"><strong>' + escapeHtml(r.name) + '</strong> — <em class="pv-list-empty">' + escapeHtml(r.message) + '</em></div>';
    }
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
