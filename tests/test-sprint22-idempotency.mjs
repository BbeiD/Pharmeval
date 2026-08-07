// Test d'idempotence, tel qu'explicitement demande pour le Sprint 22.
//
// LIMITE HONNETE (a lire avant d'interpreter ces resultats) : ce test ne
// peut pas s'executer contre un vrai Firestore dans cet environnement
// (aucun acces reseau a un projet Firebase reel). Il verifie deux choses
// distinctes, chacune reelle mais partielle :
//
// 1. Le comportement de l'ENGINE (catalog-sync-engine.js, INCHANGE dans
//    sa logique de detection create/update/unchanged) sur une
//    resynchronisation, via FakeFirestoreBackend (etat en memoire
//    persistant entre les deux passes de CE test).
// 2. Le comportement des fonctions de DEDOUBLONNAGE REELLEMENT ECRITES
//    ce sprint (catalog-sync-resolution-logic.js), simulees sur deux
//    passes successives sur une liste en memoire representant l'etat
//    Firestore avant/apres la premiere synchronisation.
//
// Une verification definitive necessite un vrai projet Firestore (ou
// l'emulateur Firebase) - recommandee avant la premiere synchronisation
// reelle du catalogue complet (voir RAPPORT_SPRINT22.md).

import assert from 'assert';
import { CatalogSyncEngine } from '../js/services/catalog-sync-engine.js';
import { validateImportPayload } from '../js/services/question-import-validator.js';
import { FakeFirestoreBackend } from '../js/services/catalog-sync-demo-backend.js';
import { buildCanonicalQuestion } from '../js/services/connectors/canonical-question-factory.js';
import { findMatchingSource, findMatchingSection, findMatchingCompetency } from '../js/services/catalog-sync-resolution-logic.js';

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

function makeFakeConnector(questions) {
  return { connectorId: 'fake-idempotency', load: async function() { return { success: true, catalog: { questions: questions, generator: 'test', generatedAt: new Date().toISOString() }, rowErrors: [] }; } };
}
function makeQuestion(editorialId, sourceName, level1, competencyLabel, tags) {
  return buildCanonicalQuestion({
    domain: 'medicaments', theme: 'medicaments', subtheme: 'cbip', difficulty: 'essentiel',
    question: 'Question ' + editorialId + ' ?', answers: ['A', 'B', 'C', 'D'], correctAnswer: 0,
    explanation: 'Explication.', editorialCatalogId: editorialId,
    sourceDocument: { name: sourceName, level1: level1, level2: '', level3: '', preciseReference: '' },
    primaryCompetencyLabel: competencyLabel || null, tags: tags || [], pendingResourceRefs: [],
  });
}
function makeEngine(backend, onChunkWritten) {
  return new CatalogSyncEngine({
    validateImportPayload: validateImportPayload,
    resolveQuestionIdentity: backend.resolveQuestionIdentity,
    listExistingEditorialCatalogIds: backend.listExistingEditorialCatalogIds,
    allocatePedagogicalId: backend.allocatePedagogicalId,
    resolveDocumentReferential: backend.resolveDocumentReferential,
    resolveCompetency: backend.resolveCompetency,
    resolveTags: backend.resolveTags,
    writeQuestionsChunk: backend.writeQuestionsChunk,
    onChunkWritten: onChunkWritten,
  });
}

async function run() {
  console.log('=== 1. ENGINE (logique create/update/unchanged, inchangee) : resynchronisation du MEME catalogue ===');
  {
    const backend = new FakeFirestoreBackend(); // MEME instance -> etat conserve entre les deux passes
    const questions = [
      makeQuestion('EDIT-100', 'CBIP', 'Cardiologie', 'Interactions médicamenteuses', ['iec', 'toux']),
      makeQuestion('EDIT-101', 'CBIP', 'Endocrinologie', 'Diabète', ['metformine']),
    ];
    const connector = makeFakeConnector(questions);

    // --- Passe 1 : premiere synchronisation ---
    const analysis1 = await engineAnalyzeAndSync(backend, connector);
    check('Passe 1 : les 2 questions sont creees', analysis1.sync.report.questionsCreated === 2);
    check('Passe 1 : 1 source creee (CBIP)', analysis1.sync.report.sourcesCreated === 1);
    check('Passe 1 : 2 sections creees (Cardiologie, Endocrinologie)', analysis1.sync.report.sectionsCreated === 2);
    check('Passe 1 : 2 competences creees', analysis1.sync.report.competenciesCreated === 2);

    // --- Passe 2 : RESYNCHRONISATION du MEME fichier, sans aucun changement ---
    const analysis2 = await engineAnalyzeAndSync(backend, connector);
    check('Passe 2 : AUCUNE question recreee (0 create)', analysis2.sync.report.questionsCreated === 0);
    check('Passe 2 : les 2 questions sont detectees INCHANGEES', analysis2.sync.report.questionsUnchanged === 2);
    check('Passe 2 : AUCUNE source dupliquee (0 nouvelle creation)', analysis2.sync.report.sourcesCreated === 0);
    check('Passe 2 : AUCUNE section dupliquee', analysis2.sync.report.sectionsCreated === 0);
    check('Passe 2 : AUCUNE competence dupliquee', analysis2.sync.report.competenciesCreated === 0);
  }

  console.log('=== 2. ENGINE : resynchronisation avec UNE question modifiee -> update, pas duplication ===');
  {
    const backend = new FakeFirestoreBackend();
    const original = [makeQuestion('EDIT-200', 'BAPCOC', 'Antibiothérapie', 'Angine', ['amoxicilline'])];
    await engineAnalyzeAndSync(backend, makeFakeConnector(original));

    const modified = [buildCanonicalQuestion({
      domain: 'medicaments', theme: 'medicaments', subtheme: 'cbip', difficulty: 'approfondi', // difficulte changee
      question: 'Question EDIT-200 ?', answers: ['A', 'B', 'C', 'D'], correctAnswer: 0,
      explanation: 'Explication.', editorialCatalogId: 'EDIT-200',
      sourceDocument: { name: 'BAPCOC', level1: 'Antibiothérapie', level2: '', level3: '', preciseReference: '' },
      primaryCompetencyLabel: 'Angine', tags: ['amoxicilline'], pendingResourceRefs: [],
    })];
    const second = await engineAnalyzeAndSync(backend, makeFakeConnector(modified));
    check('Question modifiee detectee comme UPDATE (pas CREATE)', second.sync.report.questionsUpdated === 1 && second.sync.report.questionsCreated === 0);
    check('Aucune nouvelle source/section/competence pour cette mise a jour', second.sync.report.sourcesCreated === 0 && second.sync.report.sectionsCreated === 0 && second.sync.report.competenciesCreated === 0);
  }

  console.log('=== 3. Logique de dedoublonnage REELLEMENT ECRITE ce sprint : simulation deux passes sur une liste en memoire ===');
  {
    // Simule EXACTEMENT ce que resolveDocumentReferential() fait : verifie
    // si une source existe deja (via findMatchingSource), sinon la "cree"
    // (ici : l'ajoute a la liste en memoire, comme le ferait un vrai
    // createDocumentSourceDoc() suivi d'une relecture).
    const existingSources = [];
    function resolveSourceOncePass(name) {
      const match = findMatchingSource(name, existingSources);
      if (match) return { id: match.id, action: 'existing' };
      const created = { id: 'DOCSRC-' + existingSources.length, name: name };
      existingSources.push(created);
      return { id: created.id, action: 'new' };
    }
    const pass1 = resolveSourceOncePass('Vichy Dercos');
    const pass2 = resolveSourceOncePass('Vichy Dercos'); // RESYNCHRONISATION du meme nom
    const pass3 = resolveSourceOncePass('vichy dercos'); // variante casse/accents - doit AUSSI matcher

    check('Passe 1 : source creee (action=new)', pass1.action === 'new');
    check('Passe 2 (resync) : MEME source retrouvee (action=existing)', pass2.action === 'existing' && pass2.id === pass1.id);
    check('Passe 3 (casse differente) : toujours retrouvee, jamais un doublon', pass3.action === 'existing' && pass3.id === pass1.id);
    check('Une SEULE source existe en tout et pour tout apres 3 passes', existingSources.length === 1);
  }

  console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
  process.exit(failed > 0 ? 1 : 0);
}

async function engineAnalyzeAndSync(backend, connector) {
  const engine = makeEngine(backend);
  const analysis = await engine.analyze(connector, {});
  const sync = await engine.synchronize(analysis, { dryRun: false });
  return { analysis: analysis, sync: sync };
}

run();
