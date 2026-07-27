// ===================== UTILITAIRE DE THEMES — COPIE SERVEUR (partielle) =====================
// Copie fidele de la seule table necessaire de js/services/theme-utils.js
// (KNOWN_THEMES), convertie en CommonJS - voir correction-policy-service.js
// (ce dossier) pour l'explication de la copie plutot qu'un import relatif
// hors de functions/. Garder synchronisee si un theme est ajoute/retire.

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

const KNOWN_THEMES = Object.freeze(Object.keys(THEME_LABELS));

module.exports = { KNOWN_THEMES };
