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
 *   voir summarizeMasteryStatus() (competency-progress-service.js) ou
 *   summarizeQuestionMastery() (question-progress-logic.js)
 * @param {{statusOrder?:Array<string>, statusColor?:Object<string,string>,
 *   statusLabels?:Object<string,string>, centerLabel?:string, ariaLabel?:string,
 *   emptyTitle?:string, emptySubtitle?:string}} [options] - AJOUT (demande
 *   directe de David, 22/07/2026) : ce composant etait cable EN DUR sur les
 *   3 statuts de competence - reutilise desormais tel quel pour la
 *   "progression globale" par QUESTION (accueil, voir js/home.js), qui n'a
 *   que 2 statuts et un libelle different. AUCUN changement de comportement
 *   pour un appelant existant qui n'en passe pas (mes-competences.js) - les
 *   valeurs par defaut ci-dessous restent EXACTEMENT celles d'avant.
 * @returns {string} HTML complet (donut SVG + legende), ou un etat vide
 *   explicite si `summary.total === 0` - jamais un donut a 0% trompeur.
 */
export function renderMasteryDonutHtml(summary, options) {
  const opts = options || {};
  const statusOrder = opts.statusOrder || STATUS_ORDER;
  const statusColor = opts.statusColor || STATUS_COLOR;
  const statusLabels = opts.statusLabels || COMPETENCY_STATUS_LABELS;
  const centerLabel = opts.centerLabel || 'Maîtrisées';
  const ariaLabel = opts.ariaLabel || 'Répartition de vos compétences par niveau de maîtrise';

  if (!summary || summary.total === 0) {
    return (
      '<div class="mastery-donut-empty">' +
        '<div class="mastery-donut-empty-icon">' + icon('highlight-star-premium', { size: 32 }) + '</div>' +
        '<p class="mastery-donut-empty-title">' + escapeHtml(opts.emptyTitle || 'Aucune compétence évaluée pour le moment') + '</p>' +
        '<p class="pv-list-empty">' + escapeHtml(opts.emptySubtitle || 'Vos compétences apparaîtront ici dès votre première évaluation terminée.') + '</p>' +
      '</div>'
    );
  }

  const size = 160, stroke = 18, radius = (size - stroke) / 2, center = size / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = statusOrder.map(function(status) {
    const pct = summary.percentages[status] || 0;
    const arcLength = (pct / 100) * circumference;
    const circle = '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="none" stroke="' + statusColor[status] + '" stroke-width="' + stroke +
      '" stroke-dasharray="' + arcLength.toFixed(1) + ' ' + (circumference - arcLength).toFixed(1) +
      '" stroke-dashoffset="' + (-offset).toFixed(1) + '" transform="rotate(-90 ' + center + ' ' + center + ')"></circle>';
    offset += arcLength;
    return circle;
  }).join('');

  // AJOUT (mockup 3 etats, demande directe de David) : le chiffre central
  // peut etre une somme de plusieurs statuts (ex. mastered + in_progress =
  // "progression" globale, ni juste "maitrise" ni le premier statut de la
  // liste) - `centerValue` permet a l'appelant de le preciser explicitement ;
  // a defaut, comportement INCHANGE (premier statut de `statusOrder`, voir
  // mes-competences.js qui n'en passe pas).
  const dominant = (typeof opts.centerValue === 'number') ? opts.centerValue : (summary.percentages[statusOrder[0]] || 0);

  const legend = statusOrder.map(function(status) {
    return (
      '<div class="mastery-donut-legend-row">' +
        '<span class="mastery-donut-dot" style="background:' + statusColor[status] + ';"></span>' +
        '<span class="mastery-donut-legend-label">' + escapeHtml(statusLabels[status]) + '</span>' +
        '<span class="mastery-donut-legend-value">' + summary.percentages[status] + '&nbsp;% (' + summary.counts[status] + ')</span>' +
      '</div>'
    );
  }).join('');

  return (
    '<div class="mastery-donut-widget">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '" width="160" height="160" role="img" aria-label="' + escapeHtml(ariaLabel) + '">' +
        '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="none" stroke="var(--border)" stroke-width="' + stroke + '"></circle>' +
        arcs +
        '<text x="' + center + '" y="' + (center - 2) + '" text-anchor="middle" font-size="26" font-weight="700" fill="var(--text)">' + dominant + '%</text>' +
        '<text x="' + center + '" y="' + (center + 16) + '" text-anchor="middle" font-size="11" fill="var(--text2)">' + escapeHtml(centerLabel) + '</text>' +
      '</svg>' +
      '<div class="mastery-donut-legend">' + legend + '</div>' +
    '</div>'
  );
}
