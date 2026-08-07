import assert from 'assert';
import { validateImportPayload, SUPPORTED_SCHEMA_VERSIONS } from '../js/services/question-import-validator.js';

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

function baseQuestion(overrides) {
  return Object.assign({
    pedagogicalId: 'PHARM-BAP-000001',
    domain: 'bapcoc', theme: 'bapcoc', subtheme: 'bapcoc_respi',
    difficulty: 'essentiel', questionType: 'single-choice',
    question: 'Quel antibiotique est recommandé en première intention ?',
    answers: ['Amoxicilline', 'Azithromycine', 'Ciprofloxacine', 'Vancomycine'],
    correctAnswer: 0,
    explanation: 'L\'amoxicilline reste le traitement de première intention.',
  }, overrides || {});
}

console.log('=== Retro-compatibilite stricte du schema 1.0 ===');
{
  const payload10 = { schemaVersion: '1.0', questions: [baseQuestion()] };
  const res = validateImportPayload(payload10);
  check('Un fichier 1.0 "classique" (sans champs 1.1) reste valide', res.valid === true && res.errors.length === 0);
}

console.log('=== schemaVersion "1.1" desormais acceptee ===');
{
  check('SUPPORTED_SCHEMA_VERSIONS contient 1.0 ET 1.1', SUPPORTED_SCHEMA_VERSIONS.includes('1.0') && SUPPORTED_SCHEMA_VERSIONS.includes('1.1'));
  const payload = { schemaVersion: '1.1', questions: [baseQuestion({
    externalIds: { editorialCatalog: 'LEGACY-BAPCOC_QDB-bapcoc_respi-5' },
    sourceDocument: { name: 'Guide BAPCOC', level1: 'Infections respiratoires', level2: '', level3: '', preciseReference: '' },
    primaryCompetency: { label: 'Appliquer les recommandations BAPCOC pour limiter une antibiothérapie non indiquée' },
    tags: ['antibiotique', 'bronchite aiguë', 'BAPCOC', 'bon usage', 'résistance antibiotique'],
    pendingResourceRefs: [],
  })] };
  const res = validateImportPayload(payload);
  check('Un fichier 1.1 avec les 4 champs additifs est valide', res.valid === true && res.errors.length === 0);
}

console.log('=== Defense en profondeur sur les nouveaux champs ===');
{
  const badExternalIds = { schemaVersion: '1.1', questions: [baseQuestion({ externalIds: { editorialCatalog: '' } })] };
  const r1 = validateImportPayload(badExternalIds);
  check('externalIds.editorialCatalog vide -> invalide', r1.valid === false);

  const badCompetency = { schemaVersion: '1.1', questions: [baseQuestion({ primaryCompetency: { label: '' } })] };
  const r2 = validateImportPayload(badCompetency);
  check('primaryCompetency.label vide -> invalide', r2.valid === false);

  const nullCompetency = { schemaVersion: '1.1', questions: [baseQuestion({ primaryCompetency: null })] };
  const r3 = validateImportPayload(nullCompetency);
  check('primaryCompetency: null est toléré (compétence non résolue)', r3.valid === true);

  const badSourceDoc = { schemaVersion: '1.1', questions: [baseQuestion({ sourceDocument: { name: 42 } })] };
  const r4 = validateImportPayload(badSourceDoc);
  check('sourceDocument.name non-string -> invalide', r4.valid === false);
}

console.log('=== Champ inconnu toujours rejete (aucune regression) ===');
{
  const payload = { schemaVersion: '1.1', questions: [baseQuestion({ champInvente: 'x' })] };
  const res = validateImportPayload(payload);
  check('Un champ totalement inconnu reste rejeté même en 1.1', res.valid === false && res.errors.some(function(e) { return /Champ inconnu/.test(e.message); }));
}

console.log('=== Limite MAX_QUESTIONS_PER_IMPORT toujours active en 1.1 ===');
{
  const many = [];
  for (let i = 0; i < 501; i++) {
    many.push(baseQuestion({ pedagogicalId: 'PHARM-BAP-' + String(i).padStart(6, '0') }));
  }
  const payload = { schemaVersion: '1.1', questions: many };
  const res = validateImportPayload(payload);
  check('501 questions en 1.1 -> toujours rejeté (limite d\'atomicité)', res.valid === false && res.errors.some(function(e) { return /limitée? à 500/.test(e.message); }));
}

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
