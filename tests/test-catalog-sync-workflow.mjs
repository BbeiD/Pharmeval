import fs from 'fs';
import { JSDOM } from 'jsdom';
import XLSX from 'xlsx';
import { ExcelCatalogConnector } from '../js/services/connectors/excel-catalog-connector.js';
import { validateImportPayload } from '../js/services/question-import-validator.js';
import { CatalogSyncEngine } from '../js/services/catalog-sync-engine.js';
import { FakeFirestoreBackend } from '../js/services/catalog-sync-demo-backend.js';
import { applyUiState, classifySyncStatus, buildConfirmMessage } from '../admin/catalog-sync-helpers.js';
import { renderAnalysisResult, renderDetailTab, renderSyncReportBody, renderHistory } from '../admin/catalog-sync-render.js';

const REAL_CATALOG_PATH = process.argv[2] || '/mnt/user-data/outputs/Catalogue_Pharmeval.xlsx';

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

if (!fs.existsSync(REAL_CATALOG_PATH)) {
  console.log('Fichier introuvable : ' + REAL_CATALOG_PATH);
  process.exit(1);
}

// Charge la VRAIE page HTML dans un DOM reel (jsdom) — pas un fragment
// reconstruit a la main.
const html = fs.readFileSync('admin/catalog-sync.html', 'utf-8');
const dom = new JSDOM(html, { url: 'https://example.test/admin/catalog-sync.html' });
const document = dom.window.document;

function makeEngineAndBackend() {
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
  });
  return { engine, backend };
}

const buffer = fs.readFileSync(REAL_CATALOG_PATH);
const connector = new ExcelCatalogConnector(XLSX);
const { engine, backend } = makeEngineAndBackend();

console.log('=== ETAT 15 — "aucun fichier sélectionné" ===');
applyUiState('no-file', document);
check('Aucune carte de résultat visible avant sélection de fichier', ['cs-progress-card', 'cs-errors-card', 'cs-summary-card', 'cs-report-card'].every(function(id) { return document.getElementById(id).style.display === 'none'; }));

console.log('=== ETAPE 1 — Sélection du fichier (simulée) ===');
check('Le bouton "Analyser le catalogue" est désactivé par défaut dans le HTML', document.getElementById('cs-analyze-btn').disabled === true);
applyUiState('file-selected', document);

console.log('=== ETAPE 2 — Analyse (sans écriture) — catalogue réel de 760 questions ===');
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const analysis1 = await engine.analyze(connector, { arrayBuffer: arrayBuffer });
check('Analyse réussie', analysis1.success === true);
check('Aucune écriture pendant analyze() (backend toujours vide)', backend.questions.size === 0);

renderAnalysisResult(document, analysis1, 'create', backend);
check('État DOM après analyse : "analysis-success"', document.body.getAttribute('data-cs-state') === 'analysis-success');
check('Carte résumé visible', document.getElementById('cs-summary-card').style.display === 'block');
check('Carte détail visible', document.getElementById('cs-detail-card').style.display === 'block');
check('Carte "synchroniser" visible', document.getElementById('cs-sync-action-card').style.display === 'block');
check('Carte erreurs masquée (aucune erreur)', document.getElementById('cs-errors-card').style.display === 'none');
check('Statistique "à créer" = 760 dans le DOM', document.getElementById('cs-stat-create').textContent === '760');
check('Statistique "inchangées" = 0 dans le DOM (première synchronisation)', document.getElementById('cs-stat-unchanged').textContent === '0');
check('Bouton "Synchroniser" activé après analyse réussie', document.getElementById('cs-open-confirm-btn').disabled === false);

console.log('=== ETAPE 3 — Consultation du détail (onglets, recherche) ===');
renderDetailTab(document, analysis1, 'create', { search: '', sourceName: '' }, backend);
check('Onglet "à créer" affiche un tableau avec des lignes', document.getElementById('cs-detail-body').querySelectorAll('tbody tr').length === 760);

renderDetailTab(document, analysis1, 'create', { search: 'LEGACY-DEON_QDB-deon_secret-1', sourceName: '' }, backend);
check('Recherche textuelle filtre le tableau à 1 ligne', document.getElementById('cs-detail-body').querySelectorAll('tbody tr').length === 1);

renderDetailTab(document, analysis1, 'newCompetencies', { search: '', sourceName: '' }, backend);
check('Onglet "nouvelles compétences" affiche 753 lignes', document.getElementById('cs-detail-body').querySelectorAll('tbody tr').length === 753);

console.log('=== ETAPE 4 — Confirmation (modale) ===');
const confirmMsg = buildConfirmMessage(analysis1.analysis.counts);
check('Le message de confirmation mentionne 760 créations', confirmMsg.indexOf('760 question') !== -1);

console.log('=== ETAPE 5 — Synchronisation (confirmée) ===');
const sync1 = await engine.synchronize(analysis1, { dryRun: false });
const status1 = classifySyncStatus(sync1);
check('Statut classifié "success"', status1 === 'success');

renderSyncReportBody(document, sync1, status1, { dateLabel: '20/07/2026 10:00', fileName: 'Catalogue_Pharmeval.xlsx', durationMs: 1234, logSucceeded: true, isDemoBackend: true });
check('État DOM après synchronisation : "sync-success"', document.body.getAttribute('data-cs-state') === 'sync-success');
check('Carte rapport visible', document.getElementById('cs-report-card').style.display === 'block');
check('Le rapport affiche "760" quelque part (créées)', document.getElementById('cs-report-body').innerHTML.indexOf('>760<') !== -1);
check('Le rapport signale le mode démonstration', document.getElementById('cs-report-body').innerHTML.indexOf('démonstration') !== -1);
check('La table de correspondance contient des lignes', document.getElementById('cs-report-body').querySelectorAll('tbody tr').length > 0);

console.log('=== ETAPE 6 — Historique (rendu) ===');
renderHistory(document, [{ date: new Date().toISOString(), fileName: 'Catalogue_Pharmeval.xlsx', createdCount: 760, updatedCount: 0, errorCount: 0, simulated: false, adminEmail: 'admin@pharmeval.test' }]);
check('Table d\'historique visible quand des entrées existent', document.getElementById('cs-history-table').style.display === 'table');
check('Message vide masqué quand des entrées existent', document.getElementById('cs-history-empty').style.display === 'none');
renderHistory(document, []);
check('Message "historique vide" affiché quand aucune entrée', document.getElementById('cs-history-empty').style.display === 'block');

console.log('=== ETAPE 7 — SECOND IMPORT IDENTIQUE (idempotence) ===');
const analysis2 = await engine.analyze(connector, { arrayBuffer: arrayBuffer });
check('Deuxième analyse réussie', analysis2.success === true);
check('0 création prévue au second passage', analysis2.analysis.counts.toCreate === 0);
check('0 modification prévue au second passage', analysis2.analysis.counts.toUpdate === 0);
check('760 questions inchangées au second passage', analysis2.analysis.counts.unchanged === 760);

renderAnalysisResult(document, analysis2, 'create', backend);
check('DOM reflète 0 création au second passage', document.getElementById('cs-stat-create').textContent === '0');
check('DOM reflète 760 inchangées au second passage', document.getElementById('cs-stat-unchanged').textContent === '760');

const sync2 = await engine.synchronize(analysis2, { dryRun: false });
check('0 création réelle au second passage', sync2.report.questionsCreated === 0);
check('0 modification réelle au second passage', sync2.report.questionsUpdated === 0);
check('Toujours 760 questions dans le backend (aucun doublon)', backend.questions.size === 760);

renderSyncReportBody(document, sync2, classifySyncStatus(sync2), { dateLabel: '20/07/2026 10:05', fileName: 'Catalogue_Pharmeval.xlsx', durationMs: 300, logSucceeded: true, isDemoBackend: true });
check('Le rapport du second passage affiche "0" créées', document.getElementById('cs-report-body').innerHTML.indexOf('<span>0</span><label>créées</label>') !== -1);

console.log('=== ETAT — analyse bloquée par des erreurs (fichier structurellement invalide) ===');
{
  const badWb = XLSX.utils.book_new();
  const badWs = XLSX.utils.json_to_sheet([{ 'Question ID': 'x' }]);
  XLSX.utils.book_append_sheet(badWb, badWs, 'Catalogue');
  const badBuf = XLSX.write(badWb, { type: 'array', bookType: 'xlsx' });
  const { engine: engine2 } = makeEngineAndBackend();
  const badAnalysis = await engine2.analyze(connector, { arrayBuffer: badBuf });
  check('Fichier invalide -> analyse en échec', badAnalysis.success === false);
  renderAnalysisResult(document, badAnalysis, 'create', backend);
  check('État DOM : "analysis-blocked"', document.body.getAttribute('data-cs-state') === 'analysis-blocked');
  check('Carte erreurs visible', document.getElementById('cs-errors-card').style.display === 'block');
  check('Message d\'erreur lisible affiché (pas une stack trace)', document.getElementById('cs-errors-list').textContent.indexOf('Colonne') !== -1);
}

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
