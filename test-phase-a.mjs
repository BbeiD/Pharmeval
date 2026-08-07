import fs from 'fs';
import vm from 'vm';

const BASE = process.argv[2] || '/home/claude/sprint215';
let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

const html = fs.readFileSync(BASE + '/index.html', 'utf-8');
const appJs = fs.readFileSync(BASE + '/app.js', 'utf-8');
const authJs = fs.readFileSync(BASE + '/auth.js', 'utf-8');

console.log('=== index.html — éléments hérités effectivement supprimés ===');
check('#profile-selector absent', html.indexOf('id="profile-selector"') === -1);
check('#btn-change-space absent', html.indexOf('id="btn-change-space"') === -1);
check('#active-profile-badge absent', html.indexOf('id="active-profile-badge"') === -1);
check('Aucun onclick="selectProfile(' + "'" + '...' + "'" + ')" résiduel', !/onclick="selectProfile\(/.test(html));
check('Aucun onclick="changeSpace()" résiduel', html.indexOf('onclick="changeSpace()"') === -1);
check('Titre de la page ne mentionne plus "Étudiant / Pharmacien"', html.indexOf('Étudiant / Pharmacien') === -1);

console.log('=== index.html — "Mes évaluations" conservé (analyse corrigée), filtre espace retiré ===');
check('#btn-history toujours présent (fonctionnalité conservée)', html.indexOf('id="btn-history"') !== -1);
check('#history-view toujours présent', html.indexOf('id="history-view"') !== -1);
check('#history-search toujours présent', html.indexOf('id="history-search"') !== -1);
check('#recommendations-section toujours présent (non affecté)', html.indexOf('id="recommendations-section"') !== -1);
check('#statistics-section toujours présent (non affecté)', html.indexOf('id="statistics-section"') !== -1);
check('Filtre "history-filter-btn" (Étudiant/Pharmacien) retiré', html.indexOf('history-filter-btn') === -1);
check('data-space="pharmacist"/"student" retirés', !/data-space="(pharmacist|student)"/.test(html));

console.log('=== app.js — fonctions orphelines supprimées, selectProfile conservée ===');
check('function changeSpace absente', !/function\s+changeSpace\s*\(/.test(appJs));
check('function goToProfileSelector absente', !/function\s+goToProfileSelector\s*\(/.test(appJs));
check('function resetSessionState absente', !/function\s+resetSessionState\s*\(/.test(appJs));
check('function isQuizInProgressWithAnswer absente', !/function\s+isQuizInProgressWithAnswer\s*\(/.test(appJs));
check('function selectProfile toujours présente (appelée automatiquement désormais)', /function\s+selectProfile\s*\(/.test(appJs));
check('function applyProfileVisibility toujours présente (non affectée)', /function\s+applyProfileVisibility\s*\(/.test(appJs));
check("selectProfile() ne référence plus l'élément #profile-selector supprimé", !/selectProfile[\s\S]{0,400}getElementById\('profile-selector'\)/.test(appJs));
check("updateHeaderCount() ne référence plus #active-profile-badge", !appJs.includes("getElementById('active-profile-badge')"));

console.log('=== auth.js — dérivation automatique du profil ===');
check('getCurrentUserContext importé', /import\s*{[^}]*getCurrentUserContext[^}]*}\s*from\s*"\.\/services\/app-context\.js"/.test(authJs));
check('deriveLegacyProfileFromProfession définie', /function\s+deriveLegacyProfileFromProfession\s*\(/.test(authJs));
check('revealApp() appelle window.selectProfile', /revealApp[\s\S]*window\.selectProfile\(/.test(authJs));
check("Plus d'appel direct à window.location.href vers l'ancien écran depuis revealApp", !/revealApp[\s\S]{0,2000}profile-selector/.test(authJs));

console.log('=== Comportement réel de deriveLegacyProfileFromProfession (extraite du VRAI fichier livré, pas une copie) ===');
{
  const match = /function deriveLegacyProfileFromProfession\(profession\)\s*{[\s\S]*?\n}/.exec(authJs);
  if (!match) {
    failed++;
    console.log('  [FAIL] Impossible de localiser la fonction dans le fichier réel — test invalide');
  } else {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(match[0] + '\nthis.__fn = deriveLegacyProfileFromProfession;', sandbox);
    const fn = sandbox.__fn;

    check('profession="student" -> "student"', fn('student') === 'student');
    check('profession="pharmacist" -> "pharmacist"', fn('pharmacist') === 'pharmacist');
    check('profession="pharmacy_technician" -> repli documenté "pharmacist"', fn('pharmacy_technician') === 'pharmacist');
    check('profession="teacher" -> repli documenté "pharmacist"', fn('teacher') === 'pharmacist');
    check('profession="other" -> repli documenté "pharmacist"', fn('other') === 'pharmacist');
    check('profession="" (non renseignée) -> repli documenté "pharmacist"', fn('') === 'pharmacist');
    check('profession=undefined -> repli documenté "pharmacist" (utilisateur pré-existant sans profil)', fn(undefined) === 'pharmacist');
  }
}

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
