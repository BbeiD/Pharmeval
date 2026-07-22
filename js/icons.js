// ===================== BIBLIOTHEQUE D'ICONES (remplace les emojis) =====================
// Genere UNE FOIS par assets/icons/generate-icons-module.mjs a partir du pack livre par
// ChatGPT (assets/icons/svg/*.svg, voir assets/icons/README.md) - a relancer manuellement
// (node assets/icons/generate-icons-module.mjs) si le pack est mis a jour, jamais depuis le
// navigateur (pas de fetch() runtime). Le SVG est inline directement dans le HTML construit
// par chaque page, exactement comme le reste de l'appli (voir site-header.js) - un seul
// fichier statique, coherent avec l'absence de bundler/build step du projet.
//
// ICONS (icones "trait", ex. navigation/statuts/actions) : stroke="currentColor" - la
// couleur suit celle du texte de l'element parent, pilotable par CSS comme n'importe quel
// texte (color:). DOT_ICONS (pastilles de couleur) : couleur FIXE (fill code en dur dans le
// SVG source), jamais recolorable par CSS - usage : code couleur libre, pas un statut fixe.

export const ICONS = Object.freeze({
  'academic-bookmark': '<path d="M7 3h10v18l-5-3-5 3V3z"/>',
  'academic-diploma': '<rect x="4" y="5" width="16" height="12" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/><path d="M9 17v4l3-2 3 2v-4"/>',
  'academic-growth-chart': '<polyline points="3,18 9,12 13,15 21,7"/><polyline points="16,7 21,7 21,12"/><line x1="3" y1="21" x2="21" y2="21"/>',
  'academic-institution': '<path d="M3 9 12 3l9 6"/><line x1="5" y1="10" x2="19" y2="10"/><line x1="7" y1="10" x2="7" y2="18"/><line x1="11" y1="10" x2="11" y2="18"/><line x1="15" y1="10" x2="15" y2="18"/><line x1="19" y1="10" x2="19" y2="18"/><line x1="4" y1="21" x2="20" y2="21"/>',
  'academic-label': '<path d="M3 12V5h7l9 9-7 7-9-9z"/><circle cx="7.5" cy="8.5" r="1"/>',
  'academic-pen-signature': '<path d="M4 18l4-1 10-10-3-3L5 14l-1 4z"/><path d="M12 18c2-2 3 2 5 0s2 1 3 0"/>',
  'academic-pin': '<path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6z"/><line x1="12" y1="14" x2="12" y2="22"/>',
  'academic-scales-legal': '<line x1="12" y1="4" x2="12" y2="20"/><line x1="6" y1="7" x2="18" y2="7"/><line x1="6" y1="7" x2="3" y2="13"/><line x1="6" y1="7" x2="9" y2="13"/><path d="M3 13h6a3 3 0 0 1-6 0z"/><line x1="18" y1="7" x2="15" y2="13"/><line x1="18" y1="7" x2="21" y2="13"/><path d="M15 13h6a3 3 0 0 1-6 0z"/><line x1="8" y1="20" x2="16" y2="20"/>',
  'academic-scroll-official': '<path d="M6 4h11a2 2 0 0 1 0 4H8v12a2 2 0 0 1-4 0V6a2 2 0 0 1 2-2z"/><path d="M8 20h10a2 2 0 0 0 2-2"/><line x1="10" y1="11" x2="16" y2="11"/><line x1="10" y1="15" x2="16" y2="15"/>',
  'action-close-remove': '<circle cx="12" cy="12" r="9"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>',
  'action-confirm-validate-publish': '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  'action-delete': '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 14h8l1-14"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  'action-error': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="7" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.7"/>',
  'action-reorder-down': '<line x1="12" y1="4" x2="12" y2="19"/><polyline points="6,13 12,19 18,13"/>',
  'action-reorder-up': '<line x1="12" y1="20" x2="12" y2="5"/><polyline points="6,11 12,5 18,11"/>',
  'action-restore': '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3,4 3,9 8,9"/>',
  'action-sync': '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.5 7.5A7 7 0 0 1 18 8"/><path d="M17.5 16.5A7 7 0 0 1 6 16"/>',
  'action-warning': '<polygon points="12,3 22,20 2,20"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.7"/>',
  'admin-analysis': '<line x1="4" y1="20" x2="4" y2="11"/><line x1="10" y1="20" x2="10" y2="5"/><line x1="16" y1="20" x2="16" y2="8"/><polyline points="2,8 8,12 14,4 21,9"/>',
  'admin-disable': '<circle cx="12" cy="12" r="9"/><line x1="5.5" y1="5.5" x2="18.5" y2="18.5"/>',
  'admin-test-simulation': '<path d="M9 3h6"/><path d="M10 3v5l-5 9a3 3 0 0 0 2.6 4h8.8A3 3 0 0 0 19 17l-5-9V3"/><line x1="7" y1="15" x2="17" y2="15"/>',
  'content-category-folder': '<path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/>',
  'content-document-sheet': '<path d="M6 3h8l4 4v14H6z"/><polyline points="14,3 14,7 18,7"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>',
  'content-formation-diploma': '<rect x="4" y="5" width="16" height="12" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/><path d="M9 17v4l3-2 3 2v-4"/>',
  'content-organisation': '<path d="M4 21V8l8-5 8 5v13"/><line x1="8" y1="12" x2="8" y2="16"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="16" y1="12" x2="16" y2="16"/><line x1="3" y1="21" x2="21" y2="21"/>',
  'content-question-bank': '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M11 9a1.5 1.5 0 1 1 2.5 1.1c-.8.7-1.5 1.1-1.5 2"/><circle cx="12" cy="15.5" r="0.7"/>',
  'content-question': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.8 2.8 0 1 1 4.7 2c-1.2 1-2.2 1.5-2.2 3"/><circle cx="12" cy="17" r="0.7"/>',
  'content-skills': '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  'content-sources-catalog': '<path d="M4 5c3-1 5-1 8 1v14c-3-2-5-2-8-1V5z"/><path d="M20 5c-3-1-5-1-8 1v14c3-2 5-2 8-1V5z"/>',
  'content-tag-label': '<path d="M3 12V5h7l9 9-7 7-9-9z"/><circle cx="7.5" cy="8.5" r="1"/>',
  'content-users-groups': '<circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 20c.8-4 3.2-6 6-6s5.2 2 6 6"/><path d="M14 15c3 0 5 1.5 6 5"/>',
  'doc-01-closed-book': '<rect x="5" y="4" width="14" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/>',
  'doc-02-open-book': '<path d="M4 5c3-1 5-1 8 1v14c-3-2-5-2-8-1V5z"/><path d="M20 5c-3-1-5-1-8 1v14c3-2 5-2 8-1V5z"/>',
  'doc-03-notebook': '<rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="7" y1="7" x2="9" y2="7"/><line x1="7" y1="11" x2="9" y2="11"/><line x1="7" y1="15" x2="9" y2="15"/>',
  'doc-04-clipboard': '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="16" y2="15"/>',
  'doc-05-binder': '<rect x="5" y="3" width="14" height="18" rx="2"/><line x1="8" y1="3" x2="8" y2="21"/><circle cx="6.5" cy="7" r="0.6"/><circle cx="6.5" cy="12" r="0.6"/><circle cx="6.5" cy="17" r="0.6"/>',
  'doc-06-text-sheet': '<path d="M6 3h8l4 4v14H6z"/><polyline points="14,3 14,7 18,7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="18" x2="13" y2="18"/>',
  'doc-07-stacked-pages': '<path d="M8 3h10v14H8z"/><path d="M6 6H4v15h10v-2"/>',
  'doc-08-bookmark-book': '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M13 4v7l2-1.5L17 11V4"/>',
  'doc-09-journal': '<rect x="4" y="5" width="16" height="14" rx="2"/><line x1="8" y1="5" x2="8" y2="19"/><line x1="11" y1="9" x2="17" y2="9"/><line x1="11" y1="13" x2="17" y2="13"/>',
  'doc-10-report': '<path d="M6 3h8l4 4v14H6z"/><polyline points="14,3 14,7 18,7"/><line x1="9" y1="17" x2="9" y2="13"/><line x1="12" y1="17" x2="12" y2="10"/><line x1="15" y1="17" x2="15" y2="8"/>',
  'doc-11-manual': '<rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="4" x2="8" y2="20"/><path d="M11 9h6M11 13h6M11 17h4"/>',
  'doc-12-reference-card': '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><line x1="12" y1="10" x2="18" y2="10"/><line x1="12" y1="14" x2="17" y2="14"/>',
  'feedback-advice-recommendation': '<path d="M8 15c-2-1.4-3-3.2-3-5.5A7 7 0 0 1 19 9.5c0 2.3-1 4.1-3 5.5v2H8v-2z"/><line x1="9" y1="21" x2="15" y2="21"/><line x1="9" y1="18" x2="15" y2="18"/>',
  'feedback-correct': '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  'feedback-incorrect': '<circle cx="12" cy="12" r="9"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>',
  'feedback-mastery-excellence': '<polygon points="12,3 14.7,8.5 21,9.3 16.5,13.6 17.6,20 12,17 6.4,20 7.5,13.6 3,9.3 9.3,8.5"/>',
  'feedback-recent-time': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="7" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="14"/>',
  'feedback-streak-regularity': '<path d="M12 3c3 4 5 6.3 5 10a5 5 0 1 1-10 0c0-2.6 1.3-4.7 3-6.8.2 2.2 1 3.5 2 4.3.4-2.2.2-4.5 0-7.5z"/>',
  'feedback-success-achievement': '<circle cx="12" cy="12" r="8"/><path d="M9 20h6"/><path d="M8 4H5v3c0 2 1.5 3 3 3"/><path d="M16 4h3v3c0 2-1.5 3-3 3"/><path d="M10 16v4M14 16v4"/>',
  'feedback-trend-down': '<polyline points="3,7 9,13 13,9 21,17"/><polyline points="16,17 21,17 21,12"/>',
  'feedback-trend-up': '<polyline points="3,17 9,11 13,15 21,7"/><polyline points="16,7 21,7 21,12"/>',
  'feedback-welcome': '<path d="M7 12V7a1.5 1.5 0 0 1 3 0v4"/><path d="M10 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M13 11V7a1.5 1.5 0 0 1 3 0v5"/><path d="M16 12V9a1.5 1.5 0 0 1 3 0v5c0 4-2.7 7-7 7-4 0-7-2.2-8-5l-1-3a1.7 1.7 0 0 1 3-1l2 2"/>',
  'highlight-brain': '<path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 5 2V5a3 3 0 0 0-2-1z"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-5 2V5a3 3 0 0 1 2-1z"/><line x1="12" y1="7" x2="12" y2="17"/>',
  'highlight-check-validated': '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  'highlight-heart': '<path d="M12 21S3 15.5 3 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 9 2.5C21 15.5 12 21 12 21z"/>',
  'highlight-lightbulb': '<path d="M8 15c-2-1.4-3-3.2-3-5.5A7 7 0 0 1 19 9.5c0 2.3-1 4.1-3 5.5v2H8v-2z"/><line x1="9" y1="21" x2="15" y2="21"/><line x1="9" y1="18" x2="15" y2="18"/>',
  'highlight-search': '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15" y1="15" x2="21" y2="21"/>',
  'highlight-star-filled': '<polygon points="12,3 14.7,8.5 21,9.3 16.5,13.6 17.6,20 12,17 6.4,20 7.5,13.6 3,9.3 9.3,8.5"/>',
  'highlight-star-premium': '<polygon points="12,3 14.7,8.5 21,9.3 16.5,13.6 17.6,20 12,17 6.4,20 7.5,13.6 3,9.3 9.3,8.5"/><path d="M20 3v4M18 5h4M4 4v3M2.5 5.5h3"/>',
  'medical-bacteria': '<circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/><circle cx="10" cy="11" r="0.6"/><circle cx="14" cy="13" r="0.6"/>',
  'medical-bandage': '<path d="M7 17a4 4 0 0 1 0-6l4-4a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0z"/><circle cx="10" cy="11" r="0.7"/><circle cx="13" cy="14" r="0.7"/>',
  'medical-bottle-lotion': '<rect x="7" y="7" width="10" height="14" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="12" y1="7" x2="12" y2="3"/><line x1="9" y1="13" x2="15" y2="13"/>',
  'medical-dna': '<path d="M7 3c10 6 0 12 10 18"/><path d="M17 3C7 9 17 15 7 21"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/>',
  'medical-flask': '<path d="M9 3h6"/><path d="M10 3v5l-5 9a3 3 0 0 0 2.6 4h8.8A3 3 0 0 0 19 17l-5-9V3"/><line x1="7" y1="15" x2="17" y2="15"/>',
  'medical-hospital-cross': '<path d="M5 21V7h14v14"/><rect x="9" y="3" width="6" height="6" rx="1"/><line x1="12" y1="4.5" x2="12" y2="7.5"/><line x1="10.5" y1="6" x2="13.5" y2="6"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="12" y1="9" x2="12" y2="15"/>',
  'medical-microscope': '<path d="M10 3h4v5h-4z"/><line x1="12" y1="8" x2="9" y2="13"/><path d="M7 13a5 5 0 0 0 5 5h4"/><line x1="5" y1="21" x2="19" y2="21"/><line x1="15" y1="18" x2="18" y2="21"/><circle cx="8" cy="13" r="1"/>',
  'medical-petri-dish': '<circle cx="12" cy="12" r="8"/><path d="M5 15c4-2 10-2 14 0"/><circle cx="9" cy="10" r="0.8"/><circle cx="14" cy="8" r="0.8"/><circle cx="15" cy="14" r="0.8"/>',
  'medical-pill': '<path d="M7 17a4 4 0 0 1 0-6l5-5a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0z"/><line x1="9" y1="9" x2="15" y2="15"/>',
  'medical-stethoscope': '<path d="M6 3v6a5 5 0 0 0 10 0V3"/><line x1="4" y1="3" x2="8" y2="3"/><line x1="14" y1="3" x2="18" y2="3"/><path d="M11 14v2a4 4 0 0 0 8 0v-1"/><circle cx="19" cy="13" r="2"/>',
  'medical-syringe': '<path d="M14 4l6 6"/><line x1="17" y1="3" x2="21" y2="7"/><path d="M13 7 5 15l4 4 8-8"/><line x1="4" y1="20" x2="8" y2="16"/><line x1="3" y1="21" x2="5" y2="19"/>',
  'medical-test-tube': '<path d="M9 3h6"/><path d="M10 3v12a4 4 0 0 0 8 0V3"/><line x1="10" y1="11" x2="18" y2="11"/>',
  'nav-administration': '<path d="M12 3 20 6v5c0 5-3.4 8.1-8 10-4.6-1.9-8-5-8-10V6l8-3z"/><path d="m9 12 2 2 4-5"/>',
  'nav-evaluations-stats': '<line x1="4" y1="20" x2="4" y2="10"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="7"/><line x1="22" y1="20" x2="2" y2="20"/>',
  'nav-free-training': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/><line x1="18" y1="6" x2="21" y2="3"/><line x1="18" y1="6" x2="18" y2="3"/><line x1="18" y1="6" x2="21" y2="6"/>',
  'nav-home': '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><rect x="9" y="14" width="6" height="7" rx="1"/>',
  'nav-paths-formations': '<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="3" x2="8" y2="21"/><line x1="12" y1="7" x2="17" y2="7"/><line x1="12" y1="11" x2="17" y2="11"/><line x1="12" y1="15" x2="16" y2="15"/>',
  'nav-profile': '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.3-4.6 4-7 8-7s6.7 2.4 8 7"/>',
  'nav-skills': '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  'status-archived': '<rect x="4" y="7" width="16" height="13" rx="2"/><rect x="3" y="3" width="18" height="4" rx="1"/><line x1="9" y1="11" x2="15" y2="11"/>',
  'status-draft': '<path d="M4 20h4l10-10-4-4L4 16v4z"/><line x1="13" y1="7" x2="17" y2="11"/>',
  'status-published-active': '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  'status-review': '<path d="M3 12a9 9 0 1 0 2.6-6.4"/><polyline points="3,4 3,9 8,9"/><path d="m9 12 2 2 4-4"/>',
  'status-trash': '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 14h8l1-14"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
});

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
 * Construit le SVG inline d'une icone "trait" (voir ICONS ci-dessus).
 * @param {string} name - cle de ICONS (ex. 'nav-home')
 * @param {{size?: number, className?: string}} [opts]
 * @returns {string} balise <svg> inline, ou chaine vide si le nom est inconnu
 */
export function icon(name, opts) {
  const inner = ICONS[name];
  if (!inner) return '';
  const size = (opts && opts.size) || 20;
  const cls = (opts && opts.className) ? ' class="' + opts.className + '"' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"' + cls + '>' +
    inner + '</svg>';
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
 * @returns {string} balise <svg> inline, ou chaine vide si le nom est inconnu des deux tables
 */
export function renderAnyIcon(name, opts) {
  if (DOT_ICONS[name]) return dotIcon(name, opts);
  return icon(name, opts);
}
