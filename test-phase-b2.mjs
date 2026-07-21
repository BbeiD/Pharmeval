// Test structurel reel Phase B2 (meme methode que test-phase-a.mjs et
// test-phase-b1-screen.mjs) - verifie par recherche exacte dans les
// fichiers reellement livres, pas une supposition.
import fs from 'fs';

const BASE = process.argv[2] || '.';
let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}
function fileExists(p) { try { fs.statSync(BASE + '/' + p); return true; } catch (e) { return false; } }

const html = fs.readFileSync(BASE + '/index.html', 'utf-8');
const appJs = fs.readFileSync(BASE + '/js/app.js', 'utf-8');

console.log('=== Fichiers de donnees V1 effectivement supprimes ===');
check('data/questions.js absent', !fileExists('data/questions.js'));
check('data/fiche-images.js absent', !fileExists('data/fiche-images.js'));
check('data/proc2-images.js absent', !fileExists('data/proc2-images.js'));

console.log('=== index.html — references aux donnees/ecrans V1 effectivement retirees ===');
check('<script src="data/questions.js"> absent', html.indexOf('data/questions.js') === -1);
check('<script src="data/fiche-images.js"> absent', html.indexOf('data/fiche-images.js') === -1);
check('<script src="data/proc2-images.js"> absent', html.indexOf('data/proc2-images.js') === -1);
check('#quiz-view absent', html.indexOf('id="quiz-view"') === -1);
check('#results-view absent', html.indexOf('id="results-view"') === -1);
check('#cats-grid (grille pathologies V1) absent', html.indexOf('id="cats-grid"') === -1);
check('#report-overlay (modale de signalement V1) absent', html.indexOf('id="report-overlay"') === -1);
check('#fim-overlay (modale image V1) absent', html.indexOf('id="fim-overlay"') === -1);
check('#stat-bank-total (statistique V1) absent', html.indexOf('id="stat-bank-total"') === -1);
check('#stat-total (statistique V1) absent', html.indexOf('id="stat-total"') === -1);
check('#stat-pct (statistique V1) absent', html.indexOf('id="stat-pct"') === -1);
check('Aucun onclick="setTheme(" résiduel', html.indexOf('onclick="setTheme(') === -1);
check('Aucun onclick="startQuiz(" résiduel', html.indexOf('onclick="startQuiz(') === -1);
check('Aucun onclick="selectAllVisible(" résiduel', html.indexOf('onclick="selectAllVisible(') === -1);
check('Aucun onclick="openReportModal(" résiduel', html.indexOf('onclick="openReportModal(') === -1);

console.log('=== index.html — nouvel accueil Phase B2 ===');
check('#home-view toujours présent (repensé, pas supprimé)', html.indexOf('id="home-view"') !== -1);
check('Lien vers entrainement-libre.html présent dans le nouvel accueil', html.indexOf('href="entrainement-libre.html"') !== -1);

console.log('=== index.html — panneaux non V1 intégralement conservés ===');
check('#admin-view toujours présent', html.indexOf('id="admin-view"') !== -1);
check('#history-view toujours présent', html.indexOf('id="history-view"') !== -1);
check('#recommendations-section toujours présent', html.indexOf('id="recommendations-section"') !== -1);
check('#statistics-section toujours présent', html.indexOf('id="statistics-section"') !== -1);
check('btn-entrainement-libre (Phase B1) toujours présent', html.indexOf('id="btn-entrainement-libre"') !== -1);
check('lien admin/catalog-sync.html (correctif précédent) toujours présent', html.indexOf('admin/catalog-sync.html') !== -1);

console.log('=== js/app.js — moteur de quiz V1 effectivement supprimé ===');
['setTheme', 'startQuiz', 'renderCats', 'selectAllVisible', 'getVisibleKeys', 'getQuestionsForKey',
 'setDiff', 'updateStatsDisplay', 'renderQuestion', 'renderCasEvolutif', 'renderArbreDecisionnel',
 'renderRelier', 'renderFlux', 'nextQuestion', 'showResults', 'buildFicheImgGallery',
 'buildProc2ImgGallery', 'openFicheImgModal', 'openReportModal', 'submitReport', 'themeOfQuestion',
 'isThemeAllowed', 'applyProfileVisibility', 'updateHeaderCount'].forEach(function(fn) {
  check('function ' + fn + ' absente', !new RegExp('function\\s+' + fn + '\\s*\\(').test(appJs));
});
check('QDB (variable V1) absent', !/\bQDB\b/.test(appJs));
check('THEME_CONFIG (objet V1) absent', !/\bTHEME_CONFIG\b/.test(appJs));
check('window.PharmevalQDB (exposition V1) absent', appJs.indexOf('PharmevalQDB') === -1);
check('window.PharmevalThemeConfig (exposition V1) absent', appJs.indexOf('PharmevalThemeConfig') === -1);
check('window.PharmevalThemeOfQuestion (exposition V1) absent', appJs.indexOf('PharmevalThemeOfQuestion') === -1);

console.log('=== js/app.js — fonctions minimales conservées (navigation, compatibilité auth.js) ===');
check('function show conservée', /function\s+show\s*\(/.test(appJs));
check('function goHome conservée', /function\s+goHome\s*\(/.test(appJs));
check('function selectProfile conservée (compatibilité js/auth.js, inchangé)', /function\s+selectProfile\s*\(/.test(appJs));
check('show() bascule bien home-view/history-view/admin-view (plus quiz/results)', appJs.indexOf("'home-view', 'history-view', 'admin-view'") !== -1);

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
