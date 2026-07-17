// ===================== UTILITAIRE DE LIBELLES DE THEMES (PARTAGE) =====================
// Fonction unique de formatage d'un identifiant de theme en libelle humain,
// reutilisable dans toute l'application (js/statistics.js,
// js/services/recommendation-service.js, et tout futur ecran affichant un
// theme). Extraite ici pour ne jamais dupliquer cette logique - un theme ne
// doit jamais s'afficher sous sa forme technique brute (ex. "bapcoc",
// "preparations-magistrales").
//
// Ce fichier n'effectue aucun appel Firestore : c'est un utilitaire pur, au
// meme titre que date-utils.js et score-utils.js.

// Reprend exactement les libelles deja utilises ailleurs dans l'interface
// (voir les onglets de themes dans index.html). Ne modifie aucune donnee :
// formatage d'affichage uniquement, jamais applique a evaluation.selection.theme
// lui-meme (qui reste tel quel dans Firestore et en memoire).
const THEME_LABELS = {
  conseil: 'Conseil',
  dermo: 'Dermo-cosmétiques',
  procedures: 'Procédures',
  medicaments: 'Médicaments',
  bppo: 'BPP Officinales',
  ftm: 'Préparations',
  deon: 'Déontologie',
  bapcoc: 'BAPCOC',
  etudiant: 'Pharmacothérapie',
  legislation: 'Législation',
  galenique: 'Galénique',
  adm: 'ADM',
};

/**
 * Retourne un libelle humain pour un identifiant de theme. Utilise la table
 * ci-dessus si l'identifiant est connu ; sinon, formate legerement
 * l'identifiant technique brut (tirets/underscores remplaces par des
 * espaces, premiere lettre en majuscule) plutot que de l'afficher tel quel
 * (ex. "preparations-magistrales" -> "Preparations magistrales" si ce
 * theme precis n'est pas dans la table ci-dessus). Ne modifie jamais la
 * donnee source : formatage d'affichage uniquement.
 *
 * @param {string} theme
 * @returns {string}
 */
export function formatThemeLabel(theme) {
  if (!theme) return theme;
  if (THEME_LABELS[theme]) return THEME_LABELS[theme];
  return theme
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\p{L}/u, function(c) { return c.toUpperCase(); });
}
