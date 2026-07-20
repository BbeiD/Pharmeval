// ===================== UTILITAIRES D'IDENTIFIANT EDITORIAL LEGACY (Sprint 21) =====================
// Analyse les identifiants `LEGACY-{BANQUE}-{sous_theme}-{position}` produits
// par le Catalogue Editorial Pharmeval (voir Rapport_Export_Catalogue_QCM.md,
// section 5 : "clé de correspondance temporaire avec l'ancien système").
//
// SEPARATION STRICTE (rappel explicite du cadrage Sprint 21) :
//   - domain/theme/subtheme = taxonomie APPLICATIVE Pharmeval (theme-utils.js)
//   - Source documentaire / Niveau 1-3 = provenance EDITORIALE (colonnes J-M/R)
// Ce fichier ne lit JAMAIS les colonnes documentaires pour en deduire une
// taxonomie applicative : la seule source de domain/theme/subtheme est
// l'identifiant LEGACY lui-meme, croise avec theme-utils.js (non modifie).
//
// Ce fichier n'effectue aucun appel Firestore : utilitaire pur, meme role
// que theme-utils.js lui-meme.

import { KNOWN_THEMES } from "../theme-utils.js";

/**
 * Table de correspondance ENTRE LES 17 "grandes banques" du Catalogue
 * Editorial (identifiees lors du chantier d'enrichissement Source/Niveau,
 * voir Rapport_Enrichissement_Sources.md) ET les 12 themes connus de
 * Pharmeval (theme-utils.js, THEME_LABELS). Cette table est PROPRE au
 * connecteur Excel : elle ne remplace ni ne duplique THEME_LABELS, elle
 * fait uniquement le pont entre le vocabulaire du catalogue editorial et
 * celui de l'application.
 *
 * Si une banque inconnue apparait dans un futur catalogue, parseEditorial
 * CatalogId() la laisse "non mappee" explicitement (jamais une supposition
 * silencieuse) - voir deriveTaxonomyFromLegacyId().
 */
export const BANK_TO_THEME = Object.freeze({
  QDB: 'conseil',
  GI_QDB: 'conseil',
  RESP_QDB: 'conseil',
  LRP_QDB: 'dermo',
  DERCOS_QDB: 'dermo',
  CERAVE_QDB: 'dermo',
  CBIP_QDB: 'medicaments',
  PROC_QDB: 'procedures',
  PROC2_QDB: 'procedures',
  RETOURS_QDB: 'procedures',
  BPPO_QDB: 'bppo',
  FTM_QDB: 'ftm',
  DEON_QDB: 'deon',
  BAPCOC_QDB: 'bapcoc',
  ETUDIANT_QDB: 'etudiant',
  LEG_QDB: 'legislation',
  GAL_QDB: 'galenique',
  ADM_QDB: 'adm',
});

const LEGACY_ID_PATTERN = /^LEGACY-([A-Z0-9]+(?:_[A-Z0-9]+)*)-([a-z0-9_]+)-(\d+)$/;

/**
 * Decompose un identifiant editorial `LEGACY-{BANQUE}-{sous_theme}-{position}`.
 * Ne leve jamais d'exception : retourne `valid:false` avec un message
 * explicite si le format ne correspond pas.
 *
 * @param {string} editorialId
 * @returns {{valid:boolean, bank:(string|null), subtheme:(string|null), position:(number|null), message?:string}}
 */
export function parseEditorialCatalogId(editorialId) {
  const raw = (editorialId || '').toString().trim();
  if (!raw) {
    return { valid: false, bank: null, subtheme: null, position: null, message: 'Question ID vide.' };
  }
  const match = LEGACY_ID_PATTERN.exec(raw);
  if (!match) {
    return { valid: false, bank: null, subtheme: null, position: null, message: 'Question ID "' + raw + '" ne respecte pas le format LEGACY-{BANQUE}-{sous_theme}-{position}.' };
  }
  return { valid: true, bank: match[1], subtheme: match[2], position: parseInt(match[3], 10) };
}

/**
 * Derive domain/theme/subtheme (taxonomie APPLICATIVE) a partir d'un
 * identifiant editorial LEGACY, en croisant BANK_TO_THEME (ci-dessus) et
 * KNOWN_THEMES (theme-utils.js, source unique deja existante). N'utilise
 * JAMAIS les colonnes Source documentaire/Niveau - voir en-tete de fichier.
 *
 * @param {string} editorialId
 * @returns {{valid:boolean, domain:(string|null), theme:(string|null), subtheme:(string|null), message?:string}}
 */
export function deriveTaxonomyFromLegacyId(editorialId) {
  const parsed = parseEditorialCatalogId(editorialId);
  if (!parsed.valid) {
    return { valid: false, domain: null, theme: null, subtheme: null, message: parsed.message };
  }
  const themeKey = BANK_TO_THEME[parsed.bank];
  if (!themeKey) {
    return { valid: false, domain: null, theme: null, subtheme: parsed.subtheme, message: 'Banque "' + parsed.bank + '" absente de BANK_TO_THEME (aucune correspondance de theme applicatif connue).' };
  }
  if (!KNOWN_THEMES.includes(themeKey)) {
    // Defense en profondeur : BANK_TO_THEME ne devrait jamais pointer vers
    // un theme inconnu de theme-utils.js, mais on ne le suppose jamais.
    return { valid: false, domain: null, theme: null, subtheme: parsed.subtheme, message: 'Le theme "' + themeKey + '" mappe depuis "' + parsed.bank + '" n\'existe pas dans KNOWN_THEMES (theme-utils.js).' };
  }
  return { valid: true, domain: themeKey, theme: themeKey, subtheme: parsed.subtheme };
}
