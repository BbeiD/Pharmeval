import fs from 'fs';
import assert from 'assert';
import XLSX from 'xlsx';
import { ExcelCatalogConnector, EXPECTED_HEADERS } from '../js/services/connectors/excel-catalog-connector.js';
import { parseEditorialCatalogId, deriveTaxonomyFromLegacyId, BANK_TO_THEME } from '../js/services/connectors/legacy-id-utils.js';
import { answerLetterToIndex, buildNonEmptyAnswerList, splitTagsCell } from '../js/services/connectors/canonical-question-factory.js';

const REAL_CATALOG_PATH = process.argv[2] || '/mnt/user-data/outputs/Catalogue_Pharmeval.xlsx';

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

console.log('=== 1. Unit tests — legacy-id-utils.js ===');
{
  const r1 = parseEditorialCatalogId('LEGACY-CBIP_QDB-cbip-1');
  check('parseEditorialCatalogId reconnait un id valide', r1.valid && r1.bank === 'CBIP_QDB' && r1.subtheme === 'cbip' && r1.position === 1);

  const r2 = parseEditorialCatalogId('PAS-UN-ID-LEGACY');
  check('parseEditorialCatalogId rejette un id mal forme', r2.valid === false);

  const r3 = deriveTaxonomyFromLegacyId('LEGACY-BAPCOC_QDB-bapcoc_respi-5');
  check('deriveTaxonomyFromLegacyId derive le bon theme (BAPCOC_QDB -> bapcoc)', r3.valid && r3.domain === 'bapcoc' && r3.theme === 'bapcoc' && r3.subtheme === 'bapcoc_respi');

  const r4 = deriveTaxonomyFromLegacyId('LEGACY-INCONNU_QDB-x-1');
  check('deriveTaxonomyFromLegacyId signale une banque non mappee (jamais une supposition)', r4.valid === false && /BANK_TO_THEME/.test(r4.message));

  check('BANK_TO_THEME couvre les 18 banques du catalogue editorial', Object.keys(BANK_TO_THEME).length === 18);
}

console.log('=== 2. Unit tests — canonical-question-factory.js ===');
{
  check('answerLetterToIndex("B") === 1', answerLetterToIndex('B') === 1);
  check('answerLetterToIndex("z") === null', answerLetterToIndex('z') === null);
  check('buildNonEmptyAnswerList compacte les cellules vides', JSON.stringify(buildNonEmptyAnswerList(['A', '', 'C', ''])) === JSON.stringify(['A', 'C']));
  check('splitTagsCell decoupe correctement "a; b;  c "', JSON.stringify(splitTagsCell('a; b;  c ')) === JSON.stringify(['a', 'b', 'c']));
}

console.log('=== 3. ExcelCatalogConnector — erreurs de structure ===');
{
  const connector = new ExcelCatalogConnector(XLSX);

  // 3a. Colonne obligatoire manquante
  const wsMissing = XLSX.utils.json_to_sheet([{ 'Question ID': 'LEGACY-QDB-derma-1', 'Statut': 'Brouillon' }]);
  const wbMissing = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbMissing, wsMissing, 'Catalogue');
  const bufMissing = XLSX.write(wbMissing, { type: 'buffer', bookType: 'xlsx' });
  const resMissing = await connector.load({ buffer: bufMissing });
  check('Colonne manquante -> success=false, aucune question produite', resMissing.success === false && resMissing.catalog === null);
  check('Colonne manquante -> message liste les colonnes absentes', /Colonne\(s\) obligatoire\(s\) absente\(s\)/.test(resMissing.fatalErrors[0].message));

  // 3b. Fichier vide (aucune ligne)
  const wsEmpty = XLSX.utils.aoa_to_sheet([EXPECTED_HEADERS]);
  const wbEmpty = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbEmpty, wsEmpty, 'Catalogue');
  const bufEmpty = XLSX.write(wbEmpty, { type: 'buffer', bookType: 'xlsx' });
  const resEmpty = await connector.load({ buffer: bufEmpty });
  check('Fichier sans donnees -> success=false', resEmpty.success === false);
}

console.log('=== 4. ExcelCatalogConnector — lignes individuellement invalides (non bloquantes) ===');
{
  const connector = new ExcelCatalogConnector(XLSX);
  const rows = [
    // ligne valide
    { 'Question ID': 'LEGACY-QDB-derma-1', 'Statut': 'Brouillon', 'Question': 'Question test valide ?', 'Réponse A': 'Oui', 'Réponse B': 'Non', 'Réponse C': '', 'Réponse D': '', 'Bonne réponse': 'A', 'Justification': 'Justification test.', 'Source documentaire': 'PRO-Officina', 'Niveau 1': 'Conseils en poche', 'Niveau 2': '', 'Niveau 3': '', 'Compétence principale': 'Tester une compétence', 'Tags': 'a; b; c', 'Difficulté': 'Basique', 'Pièces jointes pédagogiques': '', 'Référence documentaire précise': '' },
    // ID mal forme
    { 'Question ID': 'PAS-VALIDE', 'Statut': 'Brouillon', 'Question': 'Q ?', 'Réponse A': 'A', 'Réponse B': 'B', 'Réponse C': '', 'Réponse D': '', 'Bonne réponse': 'A', 'Justification': 'J', 'Source documentaire': '', 'Niveau 1': '', 'Niveau 2': '', 'Niveau 3': '', 'Compétence principale': '', 'Tags': '', 'Difficulté': 'Basique', 'Pièces jointes pédagogiques': '', 'Référence documentaire précise': '' },
    // ID dupliquant la ligne 1
    { 'Question ID': 'LEGACY-QDB-derma-1', 'Statut': 'Brouillon', 'Question': 'Q dupliquee ?', 'Réponse A': 'A', 'Réponse B': 'B', 'Réponse C': '', 'Réponse D': '', 'Bonne réponse': 'A', 'Justification': 'J', 'Source documentaire': '', 'Niveau 1': '', 'Niveau 2': '', 'Niveau 3': '', 'Compétence principale': '', 'Tags': '', 'Difficulté': 'Basique', 'Pièces jointes pédagogiques': '', 'Référence documentaire précise': '' },
    // Bonne reponse pointant vers une cellule vide
    { 'Question ID': 'LEGACY-QDB-derma-2', 'Statut': 'Brouillon', 'Question': 'Q ?', 'Réponse A': 'A', 'Réponse B': '', 'Réponse C': '', 'Réponse D': '', 'Bonne réponse': 'B', 'Justification': 'J', 'Source documentaire': '', 'Niveau 1': '', 'Niveau 2': '', 'Niveau 3': '', 'Compétence principale': '', 'Tags': '', 'Difficulté': 'Basique', 'Pièces jointes pédagogiques': '', 'Référence documentaire précise': '' },
  ];
  const ws = XLSX.utils.json_to_sheet(rows, { header: EXPECTED_HEADERS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Catalogue');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const res = await connector.load({ buffer: buf });

  check('Fichier partiellement invalide -> success=true (des lignes valides existent)', res.success === true);
  check('Exactement 1 question valide produite sur 4 lignes', res.catalog.questions.length === 1);
  check('3 erreurs de ligne remontees (id invalide, doublon, bonne reponse vide)', res.rowErrors.length === 3);
  check('La question valide porte bien externalIds.editorialCatalog', res.catalog.questions[0].externalIds.editorialCatalog === 'LEGACY-QDB-derma-1');
  check('domain/theme derives de l\'id legacy (QDB -> conseil), jamais de Source documentaire', res.catalog.questions[0].domain === 'conseil');
}

console.log('=== 5. Test contre le VRAI catalogue (760 questions) ===');
if (!fs.existsSync(REAL_CATALOG_PATH)) {
  console.log('  [SKIP] Fichier introuvable : ' + REAL_CATALOG_PATH);
} else {
  const buffer = fs.readFileSync(REAL_CATALOG_PATH);
  const connector = new ExcelCatalogConnector(XLSX);
  const t0 = Date.now();
  const result = await connector.load({ buffer: buffer });
  const durationMs = Date.now() - t0;

  check('success === true', result.success === true);
  check('0 erreur fatale', result.fatalErrors.length === 0);
  check('0 erreur de ligne (catalogue déjà validé par les QC précédents)', result.rowErrors.length === 0);
  check('760 questions canoniques produites', result.catalog && result.catalog.questions.length === 760);

  const ids = result.catalog.questions.map(function(q) { return q.externalIds.editorialCatalog; });
  check('760 externalIds.editorialCatalog uniques', new Set(ids).size === 760);

  const domains = new Set(result.catalog.questions.map(function(q) { return q.domain; }));
  check('12 domaines applicatifs distincts utilisés (les 12 themes connus)', domains.size === 12);

  const withCompetency = result.catalog.questions.filter(function(q) { return q.primaryCompetency; }).length;
  check('760/760 questions portent une primaryCompetency.label', withCompetency === 760);

  const withSource = result.catalog.questions.filter(function(q) { return q.sourceDocument.name; }).length;
  check('758/760 questions portent une Source documentaire (2 volontairement vides, voir rapport)', withSource === 758);

  const tagCounts = result.catalog.questions.map(function(q) { return q.tags.length; });
  check('chaque question porte exactement 5 tags', tagCounts.every(function(n) { return n === 5; }));

  // Sanity check on a few known rows
  const sample = result.catalog.questions.find(function(q) { return q.externalIds.editorialCatalog === 'LEGACY-DEON_QDB-deon_secret-1'; });
  check('LEGACY-DEON_QDB-deon_secret-1 -> domain "deon", sourceDocument.name = code de deontologie', !!sample && sample.domain === 'deon' && /éontologie/.test(sample.sourceDocument.name));

  console.log('  (temps de chargement + parsing des 760 lignes : ' + durationMs + ' ms)');

  console.log('=== 6. Test d\'IDEMPOTENCE (memes octets -> meme sortie canonique) ===');
  const result2 = await connector.load({ buffer: buffer });
  assert.deepStrictEqual(
    result.catalog.questions.map(function(q) { return q.externalIds.editorialCatalog; }).sort(),
    result2.catalog.questions.map(function(q) { return q.externalIds.editorialCatalog; }).sort()
  );
  check('Deux parsings successifs du meme fichier produisent le meme jeu de 760 externalIds', true);
  check('Deux parsings successifs produisent un contenu structurellement identique (deep equal)', JSON.stringify(result.catalog.questions) === JSON.stringify(result2.catalog.questions));
}

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
