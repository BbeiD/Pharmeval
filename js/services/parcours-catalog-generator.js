// ===================== GENERATEUR DE CATALOGUE DE PARCOURS (chantier "propositions de parcours", demande directe de David, 28/07/2026) =====================
// Cree une vingtaine de Parcours EN BROUILLON a partir d'une liste de
// themes/sources a combiner (table fournie par David) - JAMAIS publie
// automatiquement (voir createParcours(), toujours status: 'draft').
//
// Aucune donnee inventee : le contenu de chaque parcours vient
// EXCLUSIVEMENT de questions REELLEMENT publiees, trouvees par recherche
// plein texte (meme mecanisme que la Banque de questions,
// browseQuestions()/matchesSearchText - voir question-bank-service.js) sur
// le libelle de chaque terme. Un terme qui ne correspond a AUCUNE question
// reste a 0 resultat dans le rapport - jamais remplace par une supposition.
//
// Suit le meme principe qu'analyze()/synchronize() de
// catalog-sync-engine.js : analyzeParcoursCatalog() est PUREMENT EN
// LECTURE (aucune ecriture Firestore) et produit un rapport complet ;
// generateParcoursCatalog() ne peut etre appelee qu'APRES relecture de ce
// rapport par un administrateur, et cree reellement les brouillons.

import { browseQuestions } from "./question-bank-service.js";
import { createParcours } from "./parcours-service.js";
import { updateParcoursFields } from "./parcours-catalog-service.js";
import { PARCOURS_COLORS } from "./parcours-metadata-service.js";
import { pickRandomSubset } from "./free-training-logic.js";

// Table fournie par David (28/07/2026) - "Parcours" / "Sources a combiner".
// Chaque terme est recherche INDEPENDAMMENT (recherche plein texte sur
// l'enonce/theme/sous-theme/source/tags d'une question, voir
// matchesSearchText()) ; l'union des questions trouvees pour tous les
// termes d'une ligne compose le parcours.
export const PARCOURS_CATALOG_TABLE = Object.freeze([
  { name: 'Anti-infectieux', terms: ['BAPCOC', 'Interactions', 'EI', 'Contre-indications', 'CBIP', 'Grossesse', 'Allaitement'] },
  { name: 'Hypertension', terms: ['CBIP', 'Interactions', 'EI', 'Posologies', 'Déprescription'] },
  { name: 'Diabète', terms: ['CBIP', 'Interactions', 'EI', 'Insuline', 'Grossesse', 'CI'] },
  { name: 'Anticoagulants & thrombose', terms: ['CBIP', 'Interactions', 'EI', 'Déontologie', 'Posologies'] },
  { name: 'Douleur et antalgiques', terms: ['CBIP', 'Interactions', 'EI', 'CI', 'BAPCOC'] },
  { name: 'Asthme & BPCO', terms: ['CBIP', 'EI', 'Interactions', "Technique d'inhalation"] },
  { name: 'Santé cardiovasculaire', terms: ['HTA', 'Dyslipidémie', 'Insuffisance cardiaque', 'Antiagrégants', 'AVK', 'AOD'] },
  { name: 'Grossesse & allaitement', terms: ['CBIP', 'CI', 'EI', 'Interactions', 'BAPCOC'] },
  { name: 'Gériatrie', terms: ['Gériatrie', 'Déprescription', 'EI', 'Interactions', 'Posologies'] },
  { name: 'Psychiatrie', terms: ['Antidépresseurs', 'Benzodiazépines', 'Lithium', 'EI', 'Interactions'] },
  { name: 'Neurologie', terms: ['Antiépileptiques', 'Parkinson', 'Migraine', 'EI', 'CI'] },
  { name: 'Dermatologie', terms: ['CBIP', 'FTM', 'Anti-infectieux', 'EI'] },
  { name: 'Gastro-entérologie', terms: ['IPP', 'MICI', 'Constipation', 'Diarrhée', 'Hélicobacter'] },
  { name: 'Endocrinologie', terms: ['Thyroïde', 'Corticoïdes', 'Ostéoporose', 'Diabète'] },
  { name: 'Pédiatrie', terms: ['Posologies', 'BAPCOC', 'CI', 'Vaccination'] },
  { name: 'Oncologie & immunosuppresseurs', terms: ['EI', 'Interactions', 'Vaccins', 'Déontologie'] },
  { name: 'Vaccination', terms: ['CBIP', 'BAPCOC', 'Déontologie', 'Arrêté royal'] },
  { name: 'Officine & réglementation', terms: ['Déontologie', 'AR 2009', 'FTM', 'BPPO'] },
  { name: 'Sécurité médicamenteuse', terms: ['EI', 'Interactions', 'CI', 'Posologies', 'Erreurs fréquentes'] },
  { name: 'Cas cliniques mixtes', terms: [], allBanks: true },
]);

// Abreviations trop courtes/ambigues pour une recherche plein texte fiable
// (2 lettres) - developpees vers leur forme complete, plus susceptible de
// correspondre reellement a l'enonce d'une question. Les abreviations
// specifiques au domaine (BAPCOC, CBIP, FTM, BPPO, AVK, AOD, IPP, MICI,
// HTA) restent telles quelles : ce sont des termes reels, pas des
// raccourcis generiques.
const TERM_EXPANSIONS = Object.freeze({
  'EI': 'effets indésirables',
  'CI': 'contre-indications',
});

const COLOR_ROTATION = [PARCOURS_COLORS.VERT, PARCOURS_COLORS.BLEU, PARCOURS_COLORS.ORANGE, PARCOURS_COLORS.VIOLET, PARCOURS_COLORS.ROUGE, PARCOURS_COLORS.GRIS];

// Plafond par terme : au-dela, le rapport signale un balayage tronque
// (truncatedScan) plutot que de pretendre avoir tout trouve - jamais un
// silence sur une donnee partielle.
const MAX_QUESTIONS_PER_TERM = 200;
const MAX_QUESTIONS_ALL_BANKS = 500;

async function searchTermQuestionIds(term) {
  const searchText = TERM_EXPANSIONS[term] || term;
  const result = await browseQuestions({
    searchText: searchText,
    filters: { status: 'published' },
    pageSize: MAX_QUESTIONS_PER_TERM,
    page: 0,
  });
  if (!result || !result.authorized || result.error) {
    return { term: term, matchCount: 0, questionIds: [], error: true, truncated: false };
  }
  const ids = (result.items || []).map(function(q) { return q.pedagogicalId || q.id; }).filter(Boolean);
  return {
    term: term,
    matchCount: result.totalMatched || ids.length,
    questionIds: ids,
    error: false,
    truncated: !!(result.totalMatched && result.totalMatched > ids.length),
  };
}

async function searchAllPublishedQuestionIds() {
  const result = await browseQuestions({ filters: { status: 'published' }, pageSize: MAX_QUESTIONS_ALL_BANKS, page: 0 });
  if (!result || !result.authorized || result.error) return { questionIds: [], truncated: false, totalPublished: 0 };
  const ids = (result.items || []).map(function(q) { return q.pedagogicalId || q.id; }).filter(Boolean);
  return {
    questionIds: ids,
    totalPublished: result.totalMatched || ids.length,
    truncated: !!(result.totalMatched && result.totalMatched > ids.length),
  };
}

/**
 * Analyse PURE LECTURE : pour chaque ligne de PARCOURS_CATALOG_TABLE,
 * recherche chaque terme dans la banque de questions publiees et rapporte
 * les correspondances - AUCUNE ecriture Firestore. A relire integralement
 * avant d'appeler generateParcoursCatalog() avec ce meme resultat.
 *
 * @returns {Promise<{rows: Array<object>, totalRows: number}>}
 */
export async function analyzeParcoursCatalog() {
  const rows = [];
  for (const row of PARCOURS_CATALOG_TABLE) {
    if (row.allBanks) {
      const all = await searchAllPublishedQuestionIds();
      rows.push({
        name: row.name, terms: [], allBanks: true,
        questionIds: all.questionIds, totalPublished: all.totalPublished, truncated: all.truncated,
      });
      continue;
    }
    const termResults = [];
    const idSet = new Set();
    for (const term of row.terms) {
      const r = await searchTermQuestionIds(term);
      termResults.push({ term: r.term, matchCount: r.matchCount, truncated: r.truncated, error: r.error });
      r.questionIds.forEach(function(id) { idSet.add(id); });
    }
    rows.push({
      name: row.name, terms: termResults, allBanks: false,
      questionIds: Array.from(idSet),
      zeroMatchTerms: termResults.filter(function(t) { return t.matchCount === 0 && !t.error; }).map(function(t) { return t.term; }),
    });
  }
  return { rows: rows, totalRows: rows.length };
}

/**
 * Cree REELLEMENT les brouillons de parcours, un par ligne du rapport
 * fourni par analyzeParcoursCatalog() (jamais relance une nouvelle
 * recherche - reutilise exactement ce qui a ete montre a l'admin). Chaque
 * parcours est cree en status "draft" (createParcours(), jamais publie
 * automatiquement) avec ses questions en directQuestionIds - AUCUNE
 * competence inventee, AUCUN sourceId invente.
 *
 * `overrides[i]` permet a l'admin de personnaliser la ligne i AVANT
 * creation (demande directe de David, 28/07/2026) :
 * - `name` : remplace le nom de la table si fourni et non vide ;
 * - `questionCount` : nombre de questions a retenir parmi celles
 *   REELLEMENT trouvees (tirage aleatoire via pickRandomSubset - jamais
 *   plus que ce qui a ete trouve, voir pickRandomSubset()). Absent/invalide
 *   => on garde toutes les questions trouvees pour cette ligne, comportement
 *   identique a avant l'ajout de ce parametre.
 *
 * @param {{rows: Array<object>}} analyzeResult - resultat de analyzeParcoursCatalog()
 * @param {Array<{name?:string, questionCount?:number}>} [overrides] - une entree par ligne, meme ordre que analyzeResult.rows
 * @returns {Promise<{rows: Array<{name:string, success:boolean, parcoursId:string|null, questionCount:number, message:string|null}>}>}
 */
export async function generateParcoursCatalog(analyzeResult, overrides) {
  const rows = (analyzeResult && analyzeResult.rows) || [];
  const overrideList = overrides || [];
  const results = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const override = overrideList[i] || {};
    const color = COLOR_ROTATION[i % COLOR_ROTATION.length];
    const name = (override.name && override.name.toString().trim()) || row.name;
    const allQuestionIds = row.questionIds || [];
    const requestedCount = Number.isFinite(override.questionCount) ? override.questionCount : allQuestionIds.length;
    const picked = pickRandomSubset(allQuestionIds, Math.max(0, requestedCount));
    const description = row.allBanks
      ? 'Généré automatiquement — questions tirées de l\'ensemble des banques publiées.'
      : 'Généré automatiquement à partir des thèmes suivants : ' + (row.terms || []).map(function(t) { return t.term; }).join(', ') + '.';

    const createResult = await createParcours({ name: name, description: description });
    if (!createResult.success) {
      results.push({ name: name, success: false, parcoursId: null, questionCount: 0, message: createResult.message || 'Création échouée.' });
      continue;
    }

    const parcoursId = createResult.parcours.id;
    const fieldsResult = await updateParcoursFields(parcoursId, {
      color: color,
      directQuestionIds: picked.selected,
    });

    results.push({
      name: name,
      success: !!(fieldsResult && fieldsResult.success),
      parcoursId: parcoursId,
      questionCount: picked.actualCount,
      message: (fieldsResult && fieldsResult.success) ? null : 'Parcours créé mais l\'ajout des questions a échoué - à compléter manuellement.',
    });
  }

  return { rows: results };
}
