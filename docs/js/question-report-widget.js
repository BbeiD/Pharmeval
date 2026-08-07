// ===================== WIDGET "SIGNALER CETTE QUESTION" =====================
// Composant d'affichage PARTAGE entre evaluation.js (retour immediat apres
// reponse) et evaluation-result.js (ecran de resultat final) - demande
// directe de David, 23/07/2026 : "un bouton signaler la question sur
// chaque question". Un seul endroit pour ce markup/comportement, jamais
// duplique entre les deux pages.
//
// Ne modifie JAMAIS la question elle-meme (voir question-report-service.js,
// en-tete) : ce widget ne fait qu'appeler submitQuestionReport().

import { submitQuestionReport, REPORT_REASON_LABELS } from "./services/question-report-service.js";
import { icon } from "./icons.js";

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * @param {string} pedagogicalId
 * @returns {string} markup du bouton "Signaler" + formulaire replie + zone
 *   de confirmation - a inserer a la suite d'une justification.
 */
export function questionReportWidgetHtml(pedagogicalId) {
  const reasonOptions = Object.keys(REPORT_REASON_LABELS).map(function(key) {
    return '<option value="' + escapeHtml(key) + '">' + escapeHtml(REPORT_REASON_LABELS[key]) + '</option>';
  }).join('');

  return (
    '<div class="question-report" data-pedagogical-id="' + escapeHtml(pedagogicalId) + '">' +
      '<button type="button" class="question-report-trigger" onclick="toggleQuestionReportForm(this)">' +
        icon('action-warning', { size: 13 }) + ' Signaler cette question' +
      '</button>' +
      '<div class="question-report-form" style="display:none;">' +
        '<label class="bank-edit-label">Qu\'est-ce qui ne va pas ?</label>' +
        '<select class="question-report-reason bank-select"><option value="">Choisir un motif…</option>' + reasonOptions + '</select>' +
        '<label class="bank-edit-label">Précisions (optionnel)</label>' +
        '<textarea class="question-report-comment bank-edit-textarea" rows="2" placeholder="Décrivez le problème si besoin"></textarea>' +
        '<div class="question-report-error" style="display:none;"></div>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn-secondary" onclick="toggleQuestionReportForm(this)">Annuler</button>' +
          '<button type="button" class="btn-primary" onclick="submitQuestionReportFromWidget(this, \'' + escapeHtml(pedagogicalId) + '\')">Envoyer</button>' +
        '</div>' +
      '</div>' +
      '<div class="question-report-confirmation" style="display:none;"></div>' +
    '</div>'
  );
}

function widgetRootOf(el) {
  return el.closest('.question-report');
}

export function toggleQuestionReportForm(triggerEl) {
  const root = widgetRootOf(triggerEl);
  if (!root) return;
  const form = root.querySelector('.question-report-form');
  form.style.display = (form.style.display === 'none') ? 'block' : 'none';
}

export async function submitQuestionReportFromWidget(buttonEl, pedagogicalId) {
  const root = widgetRootOf(buttonEl);
  if (!root) return;
  const reason = root.querySelector('.question-report-reason').value;
  const comment = root.querySelector('.question-report-comment').value;
  const errorEl = root.querySelector('.question-report-error');

  if (!reason) {
    errorEl.textContent = 'Veuillez choisir un motif.';
    errorEl.style.display = 'block';
    return;
  }
  errorEl.style.display = 'none';
  buttonEl.disabled = true;

  const result = await submitQuestionReport({ pedagogicalId: pedagogicalId, reason: reason, comment: comment });

  buttonEl.disabled = false;
  if (!result.success) {
    errorEl.textContent = result.message;
    errorEl.style.display = 'block';
    return;
  }

  root.querySelector('.question-report-trigger').style.display = 'none';
  root.querySelector('.question-report-form').style.display = 'none';
  const confirmEl = root.querySelector('.question-report-confirmation');
  confirmEl.innerHTML = icon('feedback-correct', { size: 13 }) + ' ' + escapeHtml(result.message);
  confirmEl.style.display = 'block';
}

window.toggleQuestionReportForm = toggleQuestionReportForm;
window.submitQuestionReportFromWidget = submitQuestionReportFromWidget;
