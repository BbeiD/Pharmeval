// ===================== BIBLIOTHEQUE D'ICONES =====================
// CORRECTIF (nouvelle identite visuelle sombre, demande directe de David,
// 29/07/2026 - "je n'aime plus la bibliotheque d'icones qu'on avait") :
// remplace le pack SVG "trait" livre par ChatGPT (assets/icons/svg/*.svg)
// par les icones Tabler (webfont deja chargee sur CHAQUE page via
// <link ... tabler-icons-webfont ...>, deja utilisee ponctuellement
// ailleurs - ex. "ti ti-target-arrow", "ti ti-medal"). API PUBLIQUE
// INCHANGEE (icon()/renderAnyIcon(), memes cles ICONS) : aucun des ~120
// appels existants dans le reste du projet n'a besoin d'etre modifie,
// seul CE fichier change de rendu (une balise <i class="ti ti-xxx">
// plutot qu'un <svg> inline). Une police d'icones herite nativement de
// `color` (comme du texte), donc reste theme-adaptive exactement comme
// stroke="currentColor" auparavant - aucune icone "trop sombre sur fond
// sombre" possible.
//
// DOT_ICONS (pastilles de couleur libre, ex. picker de couleur d'une
// source documentaire) restent en SVG inline : ce ne sont pas des
// pictogrammes mais des choix de couleur figes, hors du perimetre de ce
// changement (voir leur commentaire plus bas).

export const ICONS = Object.freeze({
  'academic-bookmark': 'bookmark',
  'academic-diploma': 'certificate',
  'academic-growth-chart': 'chart-line',
  'academic-institution': 'school',
  'academic-label': 'tag',
  'academic-pen-signature': 'signature',
  'academic-pin': 'map-pin',
  'academic-scales-legal': 'scale',
  'academic-scroll-official': 'scroll',
  'action-close-remove': 'x',
  'action-confirm-validate-publish': 'check',
  'action-delete': 'trash',
  'action-error': 'alert-circle',
  'action-chevron-right': 'chevron-right',
  'action-reorder-down': 'arrow-down',
  'action-reorder-up': 'arrow-up',
  'action-restore': 'arrow-back-up',
  'action-sync': 'refresh',
  'action-warning': 'alert-triangle',
  'action-quick-flash': 'bolt',
  'admin-analysis': 'chart-bar',
  'admin-disable': 'ban',
  'admin-test-simulation': 'flask',
  'content-category-folder': 'folder',
  'content-document-sheet': 'file-text',
  'content-formation-diploma': 'certificate',
  'content-organisation': 'building',
  'content-question-bank': 'database',
  'content-question': 'help',
  'content-skills': 'settings',
  'content-sources-catalog': 'books',
  'content-tag-label': 'tag',
  'content-users-groups': 'users',
  'doc-01-closed-book': 'book',
  'doc-02-open-book': 'book-2',
  'doc-03-notebook': 'notebook',
  'doc-04-clipboard': 'clipboard-text',
  'doc-05-binder': 'books',
  'doc-06-text-sheet': 'file-text',
  'doc-07-stacked-pages': 'copy',
  'doc-08-bookmark-book': 'bookmark',
  'doc-09-journal': 'notebook',
  'doc-10-report': 'report-analytics',
  'doc-11-manual': 'book',
  'doc-12-reference-card': 'id-badge-2',
  'feedback-advice-recommendation': 'bulb',
  'feedback-correct': 'circle-check',
  'feedback-incorrect': 'circle-x',
  'feedback-mastery-excellence': 'star',
  'feedback-recent-time': 'clock',
  // CANONIQUE (demande directe de David, 29/07/2026) : "l'icone defi doit
  // toujours etre la flamme des qu'elle apparait" - CETTE cle est LA
  // reference flamme du projet (streak du defi quotidien, sidebar,
  // en-tete de page defi.html, badge accueil) - ne jamais introduire une
  // autre icone pour ce meme concept ailleurs.
  'feedback-streak-regularity': 'flame',
  'feedback-success-achievement': 'trophy',
  'feedback-trend-down': 'trending-down',
  'feedback-trend-up': 'trending-up',
  'feedback-welcome': 'sparkles',
  'highlight-brain': 'brain',
  'highlight-check-validated': 'circle-check',
  'highlight-heart': 'heart',
  'highlight-lightbulb': 'bulb',
  'highlight-search': 'search',
  'highlight-star-filled': 'star-filled',
  'highlight-star-premium': 'award',
  'medical-bacteria': 'bacteria',
  'medical-bandage': 'bandage',
  'medical-bottle-lotion': 'droplet',
  'medical-dna': 'dna',
  'medical-flask': 'flask',
  'medical-hospital-cross': 'building-hospital',
  'medical-microscope': 'microscope',
  'medical-petri-dish': 'test-pipe',
  'medical-pill': 'pill',
  'medical-stethoscope': 'stethoscope',
  'medical-syringe': 'vaccine',
  'medical-test-tube': 'test-pipe',
  'nav-administration': 'shield-check',
  'nav-evaluations-stats': 'chart-bar',
  'nav-free-training': 'target',
  'nav-home': 'home',
  'nav-paths-formations': 'route',
  'nav-profile': 'user',
  'nav-skills': 'settings',
  'status-archived': 'archive',
  'status-draft': 'edit',
  'status-published-active': 'circle-check',
  'status-review': 'eye',
  'status-trash': 'trash',
});

// AJOUT (nouvelle identite visuelle sombre) : pastilles de couleur libre
// (picker de couleur d'une source documentaire/parcours - "je choisis un
// simple point de couleur", pas un pictogramme) - restent en SVG inline
// avec un fill FIXE, jamais recolorable par CSS ni par le changement de
// bibliotheque ci-dessus (ce n'est pas la meme nature d'icone).
export const DOT_ICONS = Object.freeze({
  'dot-black': '<circle cx="12" cy="12" r="8" fill="#111827" stroke="#D1D5DB" stroke-width="1"/>',
  'dot-blue': '<circle cx="12" cy="12" r="8" fill="#3B82F6" stroke="#D1D5DB" stroke-width="1"/>',
  'dot-green': '<circle cx="12" cy="12" r="8" fill="#0F9F74" stroke="#D1D5DB" stroke-width="1"/>',
  'dot-orange': '<circle cx="12" cy="12" r="8" fill="#F59E0B" stroke="#D1D5DB" stroke-width="1"/>',
  'dot-red': '<circle cx="12" cy="12" r="8" fill="#DC4C64" stroke="#D1D5DB" stroke-width="1"/>',
  'dot-violet': '<circle cx="12" cy="12" r="8" fill="#7357E8" stroke="#D1D5DB" stroke-width="1"/>',
  'dot-white-grey': '<circle cx="12" cy="12" r="8" fill="#E5E7EB" stroke="#D1D5DB" stroke-width="1"/>',
  'dot-yellow': '<circle cx="12" cy="12" r="8" fill="#EAB308" stroke="#D1D5DB" stroke-width="1"/>',
});

/**
 * Construit la balise <i> Tabler d'une icone (voir ICONS ci-dessus).
 * Herite `color` de son parent (police, exactement comme du texte) -
 * pilotable par CSS comme n'importe quel texte.
 * @param {string} name - cle de ICONS (ex. 'nav-home')
 * @param {{size?: number, className?: string}} [opts]
 * @returns {string} balise <i> inline, ou chaine vide si le nom est inconnu
 */
export function icon(name, opts) {
  const tablerName = ICONS[name];
  if (!tablerName) return '';
  const size = (opts && opts.size) || 20;
  const cls = (opts && opts.className) ? ' ' + opts.className : '';
  return '<i class="ti ti-' + tablerName + cls + '" style="font-size:' + size + 'px" aria-hidden="true" data-icon="' + name + '"></i>';
}

/**
 * Construit le SVG inline d'une pastille de couleur (voir DOT_ICONS ci-dessus).
 * @param {string} name - cle de DOT_ICONS (ex. 'dot-red')
 * @param {{size?: number, className?: string}} [opts]
 * @returns {string} balise <svg> inline, ou chaine vide si le nom est inconnu
 */
export function dotIcon(name, opts) {
  const inner = DOT_ICONS[name];
  if (!inner) return '';
  const size = (opts && opts.size) || 12;
  const cls = (opts && opts.className) ? ' class="' + opts.className + '"' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"' + cls + '>' + inner + '</svg>';
}

/**
 * Rend n'importe quelle cle du pack (ICONS ou DOT_ICONS) sans que l'appelant
 * ait a savoir de laquelle des deux tables elle vient - utilise partout ou
 * une valeur stockee en base (ex. document.display.icon) peut etre soit un
 * pictogramme, soit une pastille de couleur (voir admin/document-sources.js).
 * @param {string} name
 * @param {{size?: number, className?: string}} [opts]
 * @returns {string} balise inline, ou chaine vide si le nom est inconnu des deux tables
 */
export function renderAnyIcon(name, opts) {
  if (DOT_ICONS[name]) return dotIcon(name, opts);
  return icon(name, opts);
}
