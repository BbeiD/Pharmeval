// Test structurel reel (recherche exacte dans les fichiers livres, meme
// methode que test-phase-a.mjs) - verifie la presence effective des
// elements/fonctions attendus pour l'ecran Entrainement libre et son
// branchement sur evaluation.html / evaluation-result.html, SANS DOM
// complet ni Firebase reel.
import fs from 'fs';

const BASE = process.argv[2] || '.';
let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

const etlHtml = fs.readFileSync(BASE + '/entrainement-libre.html', 'utf-8');
const etlJs = fs.readFileSync(BASE + '/js/entrainement-libre.js', 'utf-8');
const evHtml = fs.readFileSync(BASE + '/evaluation.html', 'utf-8');
const evJs = fs.readFileSync(BASE + '/js/evaluation.js', 'utf-8');
const erHtml = fs.readFileSync(BASE + '/evaluation-result.html', 'utf-8');
const erJs = fs.readFileSync(BASE + '/js/evaluation-result.js', 'utf-8');
const indexHtml = fs.readFileSync(BASE + '/index.html', 'utf-8');

console.log('=== entrainement-libre.js — correctif "boucle infinie" (meme cause que RAPPORT_CORRECTIF_ACCES_INFINI.md) ===');
check('id="etl-denied" present dans le HTML (ecran explicite, jamais une redirection automatique)', etlHtml.indexOf('id="etl-denied"') !== -1);
check('aucune redirection automatique vers index.html sur user=null (plus de window.location.href dans le gestionnaire d\'auth)', etlJs.indexOf("window.location.href = 'index.html'") === -1);
check('garde anti-double-appel presente (initDone)', etlJs.indexOf('initDone') !== -1);

console.log('=== entrainement-libre.html — elements requis ===');
['etl-source', 'etl-section', 'etl-difficulty', 'etl-tag', 'etl-with-images', 'etl-never-seen',
 'etl-never-succeeded', 'etl-count', 'etl-compose-btn', 'etl-preview-card', 'etl-launch-btn',
 'etl-active-session-card', 'etl-resume-btn', 'etl-replace-btn', 'etl-errors-card'].forEach(function(id) {
  check('id="' + id + '" present', etlHtml.indexOf('id="' + id + '"') !== -1);
});

console.log('=== js/entrainement-libre.js — branchement sur les services deja livres (aucune reimplementation) ===');
check('importe composeFreeTrainingPool (free-training-service.js, B1)', etlJs.indexOf('composeFreeTrainingPool') !== -1);
check('importe pickRandomSubset (free-training-logic.js, B1)', etlJs.indexOf('pickRandomSubset') !== -1);
check('importe getActiveFreeTrainingSession (evaluation-session-service.js, B1)', etlJs.indexOf('getActiveFreeTrainingSession') !== -1);
check('importe startNewFreeTrainingSession', etlJs.indexOf('startNewFreeTrainingSession') !== -1);
check('importe restartFreeTrainingSession (cas "remplacer un entrainement en cours")', etlJs.indexOf('restartFreeTrainingSession') !== -1);
check('importe browseActiveDocumentSources (variante publique, accessible sans permission d\'administration - correctif acces utilisateur)', etlJs.indexOf('browseActiveDocumentSources') !== -1);
check('importe getActiveSectionTree (idem)', etlJs.indexOf('getActiveSectionTree') !== -1);
check('aucune reimplementation locale de la logique de melange (pas de "function shuffle")', etlJs.indexOf('function shuffle') === -1);
check('redirige vers evaluation.html?sessionType=free_training apres lancement', etlJs.indexOf("evaluation.html?sessionType=free_training") !== -1);

console.log('=== evaluation.html / evaluation.js — acceptation d\'une session free_training ===');
check('evaluation.html : id="ev-breadcrumb-root" present (fil d\'Ariane adaptable)', evHtml.indexOf('id="ev-breadcrumb-root"') !== -1);
check('evaluation.js : fonction initFreeTraining presente', evJs.indexOf('function initFreeTraining') !== -1);
check('evaluation.js : branchement sur sessionType=free_training AVANT l\'exigence parcoursId/competencyId', (function() {
  const idxBranch = evJs.indexOf("sessionType') === 'free_training'");
  const idxRequire = evJs.indexOf('Paramètres manquants');
  return idxBranch !== -1 && idxRequire !== -1 && idxBranch < idxRequire;
})());
check('evaluation.js : reprend via resumeSession(), ne cree JAMAIS de nouvelle session free_training elle-meme', (function() {
  const fn = evJs.slice(evJs.indexOf('async function initFreeTraining'), evJs.indexOf('async function initFreeTraining') + 700);
  return fn.indexOf('resumeSession(') !== -1 && fn.indexOf('startNewFreeTrainingSession(') === -1;
})());
check('evaluation.js : comportement historique parcours toujours present (startNewSession)', evJs.indexOf('await startNewSession(state.parcoursId, state.competencyId)') !== -1);
check('evaluation.js : comportement historique parcours toujours present (getActiveSession)', evJs.indexOf('await getActiveSession(state.parcoursId, state.competencyId)') !== -1);

console.log('=== evaluation-result.html / evaluation-result.js — masquage du bloc competence ===');
check('evaluation-result.html : id="er-competency-section" present (masquable)', erHtml.indexOf('id="er-competency-section"') !== -1);
check('evaluation-result.js : masquage explicite si !result.competencyId', erJs.indexOf('if (!result.competencyId)') !== -1);
check('evaluation-result.js : masque bien er-competency-section dans ce cas', (function() {
  const idx = erJs.indexOf('if (!result.competencyId)');
  const block = erJs.slice(idx, idx + 900);
  return block.indexOf("qs('er-competency-section').style.display = 'none'") !== -1;
})());
check('evaluation-result.js : comportement historique parcours toujours present (getParcoursById)', erJs.indexOf('getParcoursById(result.parcoursId)') !== -1);
check('evaluation-result.js : comportement historique parcours toujours present (renderCompetencyResults)', erJs.indexOf('renderCompetencyResults(result.competencyResults, competencyName)') !== -1);

console.log('=== index.html — point d\'entree de navigation (lecon du sprint precedent) ===');
check('lien vers entrainement-libre.html present dans le header', indexHtml.indexOf('href="entrainement-libre.html"') !== -1);
check('bouton "Administration" toujours present (non affecte)', indexHtml.indexOf('id="btn-admin-zone"') !== -1);
check('lien admin/catalog-sync.html (correctif precedent) toujours present', indexHtml.indexOf('admin/catalog-sync.html') !== -1);

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
