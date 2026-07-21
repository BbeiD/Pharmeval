import assert from 'assert';
import { CatalogSyncEngine } from '../js/services/catalog-sync-engine.js';
import { validateImportPayload } from '../js/services/question-import-validator.js';
import { FakeFirestoreBackend } from '../js/services/catalog-sync-demo-backend.js';
import { buildCanonicalQuestion } from '../js/services/connectors/canonical-question-factory.js';

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

function makeFakeConnector(questions) {
  return {
    connectorId: 'fake-test-connector',
    load: async function() {
      return { success: true, catalog: { questions: questions, generator: 'test', generatedAt: new Date().toISOString() }, rowErrors: [] };
    },
  };
}

function makeQuestion(editorialId, sourceName, level1) {
  return buildCanonicalQuestion({
    domain: 'medicaments', theme: 'medicaments', subtheme: 'cbip',
    difficulty: 'essentiel',
    question: 'Question de test ' + editorialId + ' ?', answers: ['A', 'B', 'C', 'D'], correctAnswer: 0,
    explanation: 'Explication de test.',
    editorialCatalogId: editorialId,
    sourceDocument: { name: sourceName, level1: level1, level2: '', level3: '', preciseReference: '' },
    primaryCompetencyLabel: null,
    tags: [],
    pendingResourceRefs: [],
  });
}

async function run() {
  console.log('=== Retrocompatibilite : FakeFirestoreBackend SANS onChunkWritten (aucune regression) ===');
  {
    const backend = new FakeFirestoreBackend();
    const engine = new CatalogSyncEngine({
      validateImportPayload: validateImportPayload,
      resolveQuestionIdentity: backend.resolveQuestionIdentity,
      listExistingEditorialCatalogIds: backend.listExistingEditorialCatalogIds,
      allocatePedagogicalId: backend.allocatePedagogicalId,
      resolveDocumentReferential: backend.resolveDocumentReferential,
      resolveCompetency: backend.resolveCompetency,
      resolveTags: backend.resolveTags,
      writeQuestionsChunk: backend.writeQuestionsChunk,
      // PAS de onChunkWritten ici - simule tous les backends existants (tests, demo)
    });
    const connector = makeFakeConnector([makeQuestion('EDIT-001', 'CBIP', 'Cardiologie')]);
    const analysis = await engine.analyze(connector, {});
    check('analyze() reussit toujours sans onChunkWritten', analysis.success === true);
    const sync = await engine.synchronize(analysis, { dryRun: false });
    check('synchronize() reussit toujours sans onChunkWritten (aucune erreur levee)', sync.success === true);
    check('la question est bien creee', sync.report.questionsCreated === 1);
  }

  console.log('=== onChunkWritten est appelee UNE FOIS PAR CHUNK REUSSI, avec le bon contenu ===');
  {
    const backend = new FakeFirestoreBackend();
    const calls = [];
    const engine = new CatalogSyncEngine({
      validateImportPayload: validateImportPayload,
      resolveQuestionIdentity: backend.resolveQuestionIdentity,
      listExistingEditorialCatalogIds: backend.listExistingEditorialCatalogIds,
      allocatePedagogicalId: backend.allocatePedagogicalId,
      resolveDocumentReferential: backend.resolveDocumentReferential,
      resolveCompetency: backend.resolveCompetency,
      resolveTags: backend.resolveTags,
      writeQuestionsChunk: backend.writeQuestionsChunk,
      onChunkWritten: async function(chunk, writeResult, cache) {
        calls.push({ chunkSize: chunk.length, success: writeResult.success, hasCache: !!cache });
      },
    });
    const connector = makeFakeConnector([
      makeQuestion('EDIT-010', 'CBIP', 'Cardiologie'),
      makeQuestion('EDIT-011', 'BAPCOC', 'Antibiothérapie'),
    ]);
    const analysis = await engine.analyze(connector, {});
    const sync = await engine.synchronize(analysis, { dryRun: false });

    check('synchronize() reussit', sync.success === true);
    check('onChunkWritten a ete appelee exactement 1 fois (1 seul chunk pour 2 questions)', calls.length === 1);
    check('onChunkWritten a recu un writeResult.success === true', calls[0] && calls[0].success === true);
    check('onChunkWritten a recu le chunk complet (2 questions)', calls[0] && calls[0].chunkSize === 2);
    check('onChunkWritten a recu le cache referentiel (pour retrouver les sections connues)', calls[0] && calls[0].hasCache === true);
  }

  console.log('=== onChunkWritten n\'est PAS appelee si dryRun===true (aucune ecriture, donc aucun chunk "reussi") ===');
  {
    const backend = new FakeFirestoreBackend();
    let called = false;
    const engine = new CatalogSyncEngine({
      validateImportPayload: validateImportPayload,
      resolveQuestionIdentity: backend.resolveQuestionIdentity,
      listExistingEditorialCatalogIds: backend.listExistingEditorialCatalogIds,
      allocatePedagogicalId: backend.allocatePedagogicalId,
      resolveDocumentReferential: backend.resolveDocumentReferential,
      resolveCompetency: backend.resolveCompetency,
      resolveTags: backend.resolveTags,
      writeQuestionsChunk: backend.writeQuestionsChunk,
      onChunkWritten: async function() { called = true; },
    });
    const connector = makeFakeConnector([makeQuestion('EDIT-020', 'CBIP', 'Cardiologie')]);
    const analysis = await engine.analyze(connector, {});
    await engine.synchronize(analysis, { dryRun: true });
    check('onChunkWritten jamais appelee en dryRun (aucune ecriture reelle)', called === false);
  }

  console.log('=== EXIGENCE CRITIQUE : onChunkWritten n\'est JAMAIS appelee si l\'ecriture du chunk ECHOUE ===');
  {
    const backend = new FakeFirestoreBackend();
    let called = false;
    const engine = new CatalogSyncEngine({
      validateImportPayload: validateImportPayload,
      resolveQuestionIdentity: backend.resolveQuestionIdentity,
      listExistingEditorialCatalogIds: backend.listExistingEditorialCatalogIds,
      allocatePedagogicalId: backend.allocatePedagogicalId,
      resolveDocumentReferential: backend.resolveDocumentReferential,
      resolveCompetency: backend.resolveCompetency,
      resolveTags: backend.resolveTags,
      // Simule un ECHEC d'ecriture reel (ex. panne reseau Firestore)
      writeQuestionsChunk: async function() { return { success: false, writtenCount: 0 }; },
      onChunkWritten: async function() { called = true; },
    });
    const connector = makeFakeConnector([makeQuestion('EDIT-030', 'CBIP', 'Cardiologie')]);
    const analysis = await engine.analyze(connector, {});
    const sync = await engine.synchronize(analysis, { dryRun: false });
    check('synchronize() rapporte bien un chunk en echec', sync.report.chunkResults[0].success === false);
    check('onChunkWritten JAMAIS appelee pour un chunk en echec (exigence explicite)', called === false);
    check('questionsCreated reste a 0 (rien compte comme reussi)', sync.report.questionsCreated === 0);
  }

  console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
  process.exit(failed > 0 ? 1 : 0);
}

run();
