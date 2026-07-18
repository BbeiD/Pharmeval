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
//
// EXPORTEE depuis le Sprint 9 (etait interne jusque-la) : cette table est
// desormais la SOURCE UNIQUE de la liste des themes connus, reutilisee par
// js/services/question-metadata-service.js pour valider qu'un domaine/theme
// existe, sans jamais redefinir cette liste ailleurs. C'est aussi le point
// de depart naturel d'une future internationalisation (Sprint 9, demande
// complementaire "Prevoir les traductions") : chaque cle technique (ex.
// "bapcoc") est deja separee de son libelle affiche ("BAPCOC"), il suffira
// demain de remplacer cette simple table par une table par langue.
export const THEME_LABELS = {
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

/** Liste des identifiants de themes connus, derivee de THEME_LABELS - ne
 * jamais redefinir cette liste en dur ailleurs (voir question-metadata-
 * service.js, validation de `domain`/`theme`). */
export const KNOWN_THEMES = Object.freeze(Object.keys(THEME_LABELS));

/**
 * Codes courts (3 lettres) par theme, utilises par
 * js/services/question-service.js pour construire l'identifiant
 * pedagogique stable (ex. "PHARM-BAP-000124" pour un theme "bapcoc").
 * Centralises ici pour la meme raison que THEME_LABELS : une seule source,
 * jamais dupliquee.
 */
export const THEME_CODES = Object.freeze({
  conseil: 'CON',
  dermo: 'DER',
  procedures: 'PRO',
  medicaments: 'MED',
  bppo: 'BPP',
  ftm: 'FTM',
  deon: 'DEO',
  bapcoc: 'BAP',
  etudiant: 'ETU',
  legislation: 'LEG',
  galenique: 'GAL',
  adm: 'ADM',
});

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
