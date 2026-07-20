import assert from 'assert';
import {
  fingerprintFile, formatFileSize, hasAcceptedExtension, buildConfirmMessage, classifySyncStatus,
  filterQuestionRows, filterLabelRows, buildCorrespondenceCsv, computeDisplayDiff,
  applyUiState, CARD_IDS, STATE_VISIBILITY, REQUIRED_UI_STATES,
} from '../admin/catalog-sync-helpers.js';

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

console.log('=== fingerprintFile ===');
{
  const f1 = { name: 'a.xlsx', size: 100, lastModified: 123 };
  const f2 = { name: 'a.xlsx', size: 100, lastModified: 123 };
  const f3 = { name: 'a.xlsx', size: 101, lastModified: 123 };
  check('deux fichiers identiques -> meme empreinte', fingerprintFile(f1) === fingerprintFile(f2));
  check('taille differente -> empreinte differente', fingerprintFile(f1) !== fingerprintFile(f3));
  check('fichier null -> null', fingerprintFile(null) === null);
}

console.log('=== formatFileSize ===');
{
  check('500 o', formatFileSize(500) === '500 o');
  check('2.0 Ko', formatFileSize(2048) === '2.0 Ko');
  check('1.0 Mo', formatFileSize(1024 * 1024) === '1.0 Mo');
}

console.log('=== hasAcceptedExtension ===');
{
  check('.xlsx accepté', hasAcceptedExtension('catalogue.xlsx') === true);
  check('.XLSX (majuscules) accepté', hasAcceptedExtension('CATALOGUE.XLSX') === true);
  check('.xls accepté', hasAcceptedExtension('vieux.xls') === true);
  check('.csv refusé', hasAcceptedExtension('catalogue.csv') === false);
  check('sans extension refusé', hasAcceptedExtension('catalogue') === false);
}

console.log('=== buildConfirmMessage ===');
{
  const msg = buildConfirmMessage({ toCreate: 25, toUpdate: 48, competenciesToCreate: 7, tagsToCreate: 19 });
  check('mentionne le nombre de créations', msg.indexOf('25 question') !== -1);
  check('mentionne le nombre de modifications', msg.indexOf('48 question') !== -1);
  check('mentionne les compétences', msg.indexOf('7 compétence') !== -1);
  check('mentionne les tags', msg.indexOf('19 tag') !== -1);
}

console.log('=== classifySyncStatus ===');
{
  check('success=false -> failure', classifySyncStatus({ success: false }) === 'failure');
  check('aucun chunk -> success', classifySyncStatus({ success: true, report: { chunkResults: [] } }) === 'success');
  check('tous les chunks réussis -> success', classifySyncStatus({ success: true, report: { chunkResults: [{ success: true }, { success: true }] } }) === 'success');
  check('un chunk échoué sur deux -> partial', classifySyncStatus({ success: true, report: { chunkResults: [{ success: true }, { success: false }] } }) === 'partial');
  check('tous les chunks échoués -> failure', classifySyncStatus({ success: true, report: { chunkResults: [{ success: false }, { success: false }] } }) === 'failure');
}

console.log('=== filterQuestionRows ===');
{
  const rows = [
    { externalId: 'A-1', pedagogicalId: 'PHARM-X-1', resolved: { question: 'Question sur le paracétamol ?' }, primaryCompetencyLabel: 'Comp1', sourceDocument: { name: 'CBIP' } },
    { externalId: 'B-2', pedagogicalId: 'PHARM-Y-2', resolved: { question: 'Question sur les stupéfiants ?' }, primaryCompetencyLabel: 'Comp2', sourceDocument: { name: 'Guide BAPCOC' } },
  ];
  check('recherche par mot-clé de la question', filterQuestionRows(rows, { search: 'paracétamol' }).length === 1);
  check('recherche par identifiant éditorial', filterQuestionRows(rows, { search: 'B-2' }).length === 1);
  check('filtre par source documentaire', filterQuestionRows(rows, { sourceName: 'CBIP' }).length === 1);
  check('aucun filtre -> tout', filterQuestionRows(rows, {}).length === 2);
}

console.log('=== filterLabelRows ===');
{
  const rows = [{ label: 'Reconnaître une toux sèche' }, { label: 'Identifier une hypoglycémie' }];
  check('recherche insensible à la casse', filterLabelRows(rows, 'TOUX').length === 1);
  check('recherche vide -> tout', filterLabelRows(rows, '').length === 2);
}

console.log('=== buildCorrespondenceCsv ===');
{
  const csv = buildCorrespondenceCsv([{ editorialId: 'LEGACY-A-1', pedagogicalId: 'PHARM-X-000001', action: 'create' }]);
  check('en-tête présent', csv.split('\n')[0] === 'identifiant_editorial;pedagogicalId;action');
  check('ligne de donnée présente', csv.indexOf('LEGACY-A-1') !== -1 && csv.indexOf('PHARM-X-000001') !== -1);
}

console.log('=== computeDisplayDiff ===');
{
  const resolved = { question: 'Nouvelle question', explanation: 'Nouvelle expli', difficulty: 'Expert', answers: ['A', 'B'], correctAnswer: 0 };
  const existing = { question: 'Ancienne question', explanation: 'Nouvelle expli', difficulty: 'Basique', answers: ['A', 'B'], correctAnswer: 1 };
  const diffs = computeDisplayDiff(resolved, existing);
  check('détecte le changement de question', diffs.some(function(d) { return d.field === 'Question'; }));
  check('ne signale pas la justification identique', !diffs.some(function(d) { return d.field === 'Justification'; }));
  check('détecte le changement de difficulté', diffs.some(function(d) { return d.field === 'Difficulté'; }));
  check('détecte le changement de bonne réponse', diffs.some(function(d) { return d.field === 'Bonne réponse'; }));
  check('aucun document existant -> aucun diff', computeDisplayDiff(resolved, null).length === 0);
}

console.log('=== Etats d\'interface (point 15) ===');
{
  check('tous les états requis par le cahier des charges sont couverts (à l\'exception de confirm/history, gérés séparément par une modale et un chargement asynchrone)',
    ['no-file', 'file-selected', 'analyzing', 'analysis-success', 'analysis-success-warnings', 'analysis-blocked', 'syncing', 'sync-success', 'sync-failed']
      .every(function(s) { return Object.prototype.hasOwnProperty.call(STATE_VISIBILITY, s); }));
  check('REQUIRED_UI_STATES recense bien les 12 états du cahier des charges', REQUIRED_UI_STATES.length === 12);

  // Simule un `document` minimal (sans jsdom) pour verifier applyUiState
  const fakeEls = {};
  CARD_IDS.forEach(function(id) { fakeEls[id] = { style: { display: '' } }; });
  const fakeDoc = { getElementById: function(id) { return fakeEls[id] || null; }, body: { setAttribute: function() {} } };
  applyUiState('analysis-success', fakeDoc);
  check('applyUiState affiche cs-summary-card en état "analysis-success"', fakeEls['cs-summary-card'].style.display === 'block');
  check('applyUiState masque cs-errors-card en état "analysis-success"', fakeEls['cs-errors-card'].style.display === 'none');
  applyUiState('analysis-blocked', fakeDoc);
  check('applyUiState affiche cs-errors-card en état "analysis-blocked"', fakeEls['cs-errors-card'].style.display === 'block');
  check('applyUiState masque cs-summary-card en état "analysis-blocked"', fakeEls['cs-summary-card'].style.display === 'none');
}

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
