/**
 * reset-catalog.cjs — Pharmeval
 *
 * Supprime toutes les données du catalogue Pharmeval pour permettre un
 * réimport propre depuis catalog-sync.html. NE TOUCHE PAS aux comptes
 * utilisateurs (users/) ni au compteur d'IDs pédagogiques ni aux logs.
 *
 * Usage :
 *   node scripts/reset-catalog.cjs <chemin-service-account.json>
 *
 * ⚠ IRRÉVERSIBLE — exécuter uniquement après validation du fichier
 *    Pharmeval_1535_CatalogSync_COMPLET.xlsx et avant son import.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
if (!keyPath) {
  console.error('Usage: node scripts/reset-catalog.cjs <chemin-service-account.json>');
  process.exit(1);
}

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

// ── Utilitaire de suppression par lots ──────────────────────────────────────
async function deleteAll(query, label) {
  let total = 0;
  while (true) {
    const snap = await query.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    total += snap.docs.length;
    process.stdout.write(`\r  ${label} : ${total} supprimés...`);
  }
  console.log(`\r  ${label} : ${total} supprimés.   `);
  return total;
}

// ── Questions anciennes uniquement ───────────────────────────────────────────
// Les nouvelles questions (PARC_*) n'existent pas encore → on supprime tout
// ce qui n'est pas editorialOnly (les 971 non-éditoriales).
// Les questions éditorialOnly (Lundi Légi + ALAUNE-30) seront mises à jour
// en place par catalog-sync, on ne les supprime pas.
async function deleteOldQuestions() {
  const snap = await db.collection('questions')
    .where('editorialOnly', '==', false)
    .get();
  if (snap.empty) {
    // Compat : certaines questions n'ont pas le champ → fallback sur absence du champ
    const snap2 = await db.collection('questions').get();
    const toDelete = snap2.docs.filter(d => {
      const data = d.data();
      return data.editorialOnly !== true;
    });
    if (toDelete.length === 0) { console.log('  questions non-éditoriales : 0 trouvées.'); return 0; }
    let total = 0;
    for (let i = 0; i < toDelete.length; i += 400) {
      const batch = db.batch();
      toDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
      total += Math.min(400, toDelete.length - i);
      process.stdout.write(`\r  questions non-éditoriales : ${total} supprimées...`);
    }
    console.log(`\r  questions non-éditoriales : ${total} supprimées.   `);
    return total;
  }
  let total = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
    total += Math.min(400, docs.length - i);
    process.stdout.write(`\r  questions non-éditoriales : ${total} supprimées...`);
  }
  console.log(`\r  questions non-éditoriales : ${total} supprimées.   `);
  return total;
}

async function main() {
  console.log('=== RESET CATALOGUE PHARMEVAL ===');
  console.log('⚠ Cette opération est irréversible.');
  console.log('Début :', new Date().toISOString(), '\n');

  const results = {};

  // 1. Questions non-éditoriales (vieilles 971)
  console.log('1. Questions non-éditoriales...');
  results.questions = await deleteOldQuestions();

  // 2. Parcours
  console.log('2. Parcours...');
  results.parcours = await deleteAll(db.collection('parcours'), 'parcours');

  // 3. Compétences
  console.log('3. Compétences...');
  results.competencies = await deleteAll(db.collection('competencies'), 'competencies');

  // 4. Tags
  console.log('4. Tags...');
  results.tags = await deleteAll(db.collection('tags'), 'tags');

  // 5. Sources documentaires
  console.log('5. Sources documentaires...');
  results.document_sources = await deleteAll(db.collection('document_sources'), 'document_sources');

  // 6. Sections documentaires
  console.log('6. Sections documentaires...');
  results.document_sections = await deleteAll(db.collection('document_sections'), 'document_sections');

  // 7. Progression par question
  console.log('7. Question progress...');
  results.question_progress = await deleteAll(db.collection('question_progress'), 'question_progress');

  // 8. Progression par compétence
  console.log('8. Competency progress...');
  results.competency_progress = await deleteAll(db.collection('competency_progress'), 'competency_progress');

  // 9. Attributions (parcours assignés)
  console.log('9. Assignments...');
  results.assignments = await deleteAll(db.collection('assignments'), 'assignments');

  // 10. Sessions d'évaluation
  console.log('10. Evaluation sessions...');
  results.evaluation_sessions = await deleteAll(db.collection('evaluation_sessions'), 'evaluation_sessions');

  // 11. Résultats d'évaluation
  console.log('11. Evaluation results...');
  results.evaluation_results = await deleteAll(db.collection('evaluation_results'), 'evaluation_results');

  // 12. Résultats appliqués question_progress
  console.log('12. Question progress applied results...');
  results.qp_applied = await deleteAll(db.collection('question_progress_applied_results'), 'qp_applied_results');

  // 13. Organisations
  console.log('13. Organisations...');
  results.organizations = await deleteAll(db.collection('organizations'), 'organizations');

  // 14. Profils
  console.log('14. Profils...');
  results.profiles = await deleteAll(db.collection('profiles'), 'profiles');

  // 15. Groupes
  console.log('15. Groupes...');
  results.groups = await deleteAll(db.collection('groups'), 'groups');

  // Résumé
  console.log('\n=== RÉSUMÉ ===');
  let grandTotal = 0;
  Object.entries(results).forEach(([k, n]) => {
    console.log(`  ${k.padEnd(30)} : ${n}`);
    grandTotal += n;
  });
  console.log(`  ${'TOTAL'.padEnd(30)} : ${grandTotal}`);
  console.log('\n✅ Reset terminé :', new Date().toISOString());
  console.log('→ Tu peux maintenant charger Pharmeval_1535_CatalogSync_COMPLET.xlsx dans catalog-sync.html');

  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
