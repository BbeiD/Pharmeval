import fs from 'fs';
import XLSX from 'xlsx';
import { ExcelCatalogConnector } from '../js/services/connectors/excel-catalog-connector.js';
import { validateImportPayload } from '../js/services/question-import-validator.js';
import { CatalogSyncEngine } from '../js/services/catalog-sync-engine.js';
import { FakeFirestoreBackend } from '../js/services/catalog-sync-demo-backend.js';

const REAL_CATALOG_PATH = process.argv[2] || '/mnt/user-data/outputs/Catalogue_Pharmeval.xlsx';

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label + (typeof condition !== 'boolean' ? ' (valeur: ' + JSON.stringify(condition) + ')' : '')); }
}

function makeEngine(backend) {
  return new CatalogSyncEngine({
    validateImportPayload: validateImportPayload,
    resolveQuestionIdentity: backend.resolveQuestionIdentity,
    listExistingEditorialCatalogIds: backend.listExistingEditorialCatalogIds,
    allocatePedagogicalId: backend.allocatePedagogicalId,
    resolveDocumentReferential: backend.resolveDocumentReferential,
    resolveCompetency: backend.resolveCompetency,
    resolveTags: backend.resolveTags,
    writeQuestionsChunk: backend.writeQuestionsChunk,
  });
}

if (!fs.existsSync(REAL_CATALOG_PATH)) {
  console.log('Fichier introuvable : ' + REAL_CATALOG_PATH);
  process.exit(1);
}
const buffer = fs.readFileSync(REAL_CATALOG_PATH);
const connector = new ExcelCatalogConnector(XLSX);

console.log('=== SYNCHRONISATION 1 (base Firestore simulée VIDE) ===');
const backend = new FakeFirestoreBackend();
const engine = makeEngine(backend);

const t0 = Date.now();
const analysis1 = await engine.analyze(connector, { buffer });
const analyzeDuration1 = Date.now() - t0;

check('analyze() réussit', analysis1.success === true);
check('0 erreur de validation', (analysis1.validationErrors || []).length === 0);
check('760 questions analysées', analysis1.analysis.counts.totalQuestions === 760);
check('760 créations prévues (base vide)', analysis1.analysis.counts.toCreate === 760);
check('0 mise à jour prévue', analysis1.analysis.counts.toUpdate === 0);
check('0 candidat à l\'archivage (base vide)', analysis1.analysis.counts.archivedCandidates === 0);
check('2 lots de validation/écriture prévus (760 > 500)', analysis1.analysis.chunkCount === 2);
check('14 sources documentaires à créer (14 sources distinctes du catalogue)', analysis1.analysis.counts.sourcesToCreate === 14);
check('correspondance éditorial <-> pédagogique présente pour les 760', analysis1.analysis.idCorrespondence.length === 760);
check('Aucune écriture Firestore pendant analyze() (backend toujours vide)', backend.questions.size === 0 && backend.competencies.size === 0);

console.log('  (durée analyze() : ' + analyzeDuration1 + ' ms)');
console.log('  Compétences à créer : ' + analysis1.analysis.counts.competenciesToCreate + ' | Tags à créer : ' + analysis1.analysis.counts.tagsToCreate);

const sync1 = await engine.synchronize(analysis1, { dryRun: false });
check('synchronize() réussit', sync1.success === true);
check('760 questions créées', sync1.report.questionsCreated === 760);
check('0 question mise à jour', sync1.report.questionsUpdated === 0);
check('2 lots écrits avec succès', sync1.report.chunkResults.length === 2 && sync1.report.chunkResults.every(c => c.success));
check('Backend contient bien 760 questions après synchronisation', backend.questions.size === 760);
check('Compétences réellement créées dans le backend', backend.competencies.size === sync1.report.competenciesCreated && sync1.report.competenciesCreated > 0);
check('Tags réellement créés dans le backend', backend.tags.size === sync1.report.tagsCreated && sync1.report.tagsCreated > 0);
check('Sources réellement créées dans le backend (14)', backend.sources.size === 14);

console.log('  Rapport sync 1 : créées=' + sync1.report.questionsCreated + ' maj=' + sync1.report.questionsUpdated +
  ' compétences=' + sync1.report.competenciesCreated + ' tags=' + sync1.report.tagsCreated +
  ' sources=' + sync1.report.sourcesCreated + ' sections=' + sync1.report.sectionsCreated);

console.log('=== SYNCHRONISATION 2 — TEST D\'IDEMPOTENCE (même fichier, base déjà synchronisée) ===');
const analysis2 = await engine.analyze(connector, { buffer });
check('analyze() n°2 réussit', analysis2.success === true);
check('0 création prévue (idempotence)', analysis2.analysis.counts.toCreate === 0);
check('0 mise à jour prévue (idempotence — contenu strictement identique)', analysis2.analysis.counts.toUpdate === 0);
check('760 questions inchangées', analysis2.analysis.counts.unchanged === 760);
check('0 candidat à l\'archivage (même catalogue)', analysis2.analysis.counts.archivedCandidates === 0);
check('0 compétence à créer (toutes déjà réutilisées)', analysis2.analysis.counts.competenciesToCreate === 0);
check('0 tag à créer (tous déjà réutilisés)', analysis2.analysis.counts.tagsToCreate === 0);
check('0 source à créer (toutes déjà réutilisées)', analysis2.analysis.counts.sourcesToCreate === 0);

const sync2 = await engine.synchronize(analysis2, { dryRun: false });
check('synchronize() n°2 : 0 création réelle', sync2.report.questionsCreated === 0);
check('synchronize() n°2 : 0 mise à jour réelle', sync2.report.questionsUpdated === 0);
check('Backend toujours à 760 questions (aucun doublon créé)', backend.questions.size === 760);
check('Backend toujours au même nombre de compétences (aucun doublon)', backend.competencies.size === sync1.report.competenciesCreated);
check('Backend toujours au même nombre de tags (aucun doublon)', backend.tags.size === sync1.report.tagsCreated);

console.log('=== SCENARIO — modification d\'une question dans le catalogue puis re-synchronisation ===');
{
  // On modifie DIRECTEMENT le classeur en memoire (une seule cellule) pour
  // simuler une correction editoriale, sans toucher au fichier disque.
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets['Catalogue'];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const targetIdx = rows.findIndex(r => r['Question ID'] === 'LEGACY-DEON_QDB-deon_secret-1');
  rows[targetIdx]['Justification'] = rows[targetIdx]['Justification'] + ' [correction test]';
  const newSheet = XLSX.utils.json_to_sheet(rows);
  wb.Sheets['Catalogue'] = newSheet;
  const modifiedBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const analysis3 = await engine.analyze(connector, { buffer: modifiedBuffer });
  check('1 seule mise à jour détectée après modification d\'une justification', analysis3.analysis.counts.toUpdate === 1);
  check('759 questions toujours inchangées', analysis3.analysis.counts.unchanged === 759);
  check('0 création (aucune nouvelle question)', analysis3.analysis.counts.toCreate === 0);

  const updated = analysis3.analysis.questionActions.find(a => a.externalId === 'LEGACY-DEON_QDB-deon_secret-1');
  check('La question modifiée conserve son pedagogicalId existant (pas de duplication)', updated.pedagogicalId === backend.externalIdIndex.get('LEGACY-DEON_QDB-deon_secret-1'));

  const sync3 = await engine.synchronize(analysis3, { dryRun: false });
  check('1 question réellement mise à jour', sync3.report.questionsUpdated === 1);
  check('Backend toujours à 760 questions (une mise à jour, pas une création)', backend.questions.size === 760);
}

console.log('=== SCENARIO — une question retirée du catalogue (détection d\'archivage, sans suppression) ===');
{
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets['Catalogue'];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }).filter(r => r['Question ID'] !== 'LEGACY-GI_QDB-demande_spontanee-26');
  const newSheet = XLSX.utils.json_to_sheet(rows);
  wb.Sheets['Catalogue'] = newSheet;
  const reducedBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const analysis4 = await engine.analyze(connector, { buffer: reducedBuffer });
  check('759 questions dans ce catalogue réduit', analysis4.analysis.counts.totalQuestions === 759);
  check('1 candidat à l\'archivage détecté', analysis4.analysis.counts.archivedCandidates === 1);
  check('Le candidat détecté est bien la question retirée', analysis4.analysis.archivedCandidates[0] === 'LEGACY-GI_QDB-demande_spontanee-26');

  const sync4 = await engine.synchronize(analysis4, { dryRun: false });
  check('Point 8 : aucune suppression/archivage réel effectué ce sprint', sync4.report.questionsArchivedOrDeleted === 0);
  check('La question retirée du catalogue reste présente dans Firestore (non supprimée)', backend.questions.has(backend.externalIdIndex.get('LEGACY-GI_QDB-demande_spontanee-26')));
}

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
