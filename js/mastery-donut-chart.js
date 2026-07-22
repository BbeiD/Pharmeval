// ===================== DONUT "PROGRESSION GLOBALE" (refonte visuelle, phase 1) =====================
// Petit composant de rendu PARTAGE - construit le donut de repartition
// mastered/to_reinforce/not_acquired a partir de summarizeMasteryStatus()
// (js/services/competency-progress-service.js), reutilise A L'IDENTIQUE
// par l'accueil (index.html) et "Mes compétences" (mes-competences.html) -
// jamais deux implementations paralleles du meme graphique. Fonction pure,
// aucun appel Firestore ici.

import { COMPETENCY_STATUS_LABELS } from "./services/correction-policy-service.js";
import { icon } from "./icons.js";

const STATUS_ORDER = ['mastered', 'to_reinforce', 'not_acquired'];
const STATUS_COLOR = {
  mastered: 'var(--green)',
  to_reinforce: 'var(--accent-orange)',
  not_acquired: 'var(--red)',
};

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * @param {{total:number, counts:Object<string,number>, percentages:Object<string,number>}} summary
 *   voir summarizeMasteryStatus() (competency-progress-service.js)
 * @returns {string} HTML complet (donut SVG + legende), ou un etat vide
 *   explicite si `summary.total === 0` - jamais un donut a 0% trompeur.
 */
export function renderMasteryDonutHtml(summary) {
  if (!summary || summary.total === 0) {
    return (
      '<div class="mastery-donut-empty">' +
        '<div class="mastery-donut-empty-icon">' + icon('highlight-star-premium', { size: 32 }) + '</div>' +
        '<p class="mastery-donut-empty-title">Aucune compétence évaluée pour le moment</p>' +
        '<p class="pv-list-empty">Vos compétences apparaîtront ici dès votre première évaluation terminée.</p>' +
      '</div>'
    );
  }

  const size = 160, stroke = 18, radius = (size - stroke) / 2, center = size / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = STATUS_ORDER.map(function(status) {
    const pct = summary.percentages[status] || 0;
    const arcLength = (pct / 100) * circumference;
    const circle = '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="none" stroke="' + STATUS_COLOR[status] + '" stroke-width="' + stroke +
      '" stroke-dasharray="' + arcLength.toFixed(1) + ' ' + (circumference - arcLength).toFixed(1) +
      '" stroke-dashoffset="' + (-offset).toFixed(1) + '" transform="rotate(-90 ' + center + ' ' + center + ')"></circle>';
    offset += arcLength;
    return circle;
  }).join('');

  const dominant = summary.percentages.mastered || 0;

  const legend = STATUS_ORDER.map(function(status) {
    return (
      '<div class="mastery-donut-legend-row">' +
        '<span class="mastery-donut-dot" style="background:' + STATUS_COLOR[status] + ';"></span>' +
        '<span class="mastery-donut-legend-label">' + escapeHtml(COMPETENCY_STATUS_LABELS[status]) + '</span>' +
        '<span class="mastery-donut-legend-value">' + summary.percentages[status] + '&nbsp;% (' + summary.counts[status] + ')</span>' +
      '</div>'
    );
  }).join('');

  return (
    '<div class="mastery-donut-widget">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '" width="160" height="160" role="img" aria-label="Répartition de vos compétences par niveau de maîtrise">' +
        '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="none" stroke="var(--border)" stroke-width="' + stroke + '"></circle>' +
        arcs +
        '<text x="' + center + '" y="' + (center - 2) + '" text-anchor="middle" font-size="26" font-weight="700" fill="var(--text)">' + dominant + '%</text>' +
        '<text x="' + center + '" y="' + (center + 16) + '" text-anchor="middle" font-size="11" fill="var(--text2)">Maîtrisées</text>' +
      '</svg>' +
      '<div class="mastery-donut-legend">' + legend + '</div>' +
    '</div>'
  );
}
