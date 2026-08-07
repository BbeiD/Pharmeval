/**
 * Déplace 4 questions de Lundi Légi → Pharmacie du voyageur (PARC-f40cf133).
 * Dry-run par défaut — ajouter --confirm pour écrire réellement.
 *
 * Usage :
 *   node scripts/_tmp_reclassify_voyageur_questions.cjs <service-account.json>
 *   node scripts/_tmp_reclassify_voyageur_questions.cjs <service-account.json> --confirm
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
if (!keyPath) { console.error('Usage: node script.cjs <service-account.json> [--confirm]'); process.exit(1); }
const DRY_RUN = !process.argv.includes('--confirm');

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

const QUESTION_IDS = [
  'PHARM-MED-001268',
  'PHARM-MED-001269',
  'PHARM-MED-001270',
  'PHARM-MED-001271',
];
const TARGET_PARCOURS_ID = 'PARC-f40cf133'; // Pharmacie du voyageur

async function main() {
  console.log(DRY_RUN ? '\n🔍 DRY-RUN (aucune écriture)\n' : '\n✍️  MODE ÉCRITURE\n');

  // 1. Trouver le(s) parcours qui contiennent ces questions
  const snap = await db.collection('parcours').get();
  const sources = [];
  snap.forEach(function(doc) {
    const data = doc.data();
    const ids = Array.isArray(data.directQuestionIds) ? data.directQuestionIds : [];
    const matches = QUESTION_IDS.filter(function(q) { return ids.includes(q); });
    if (matches.length > 0) {
      sources.push({ id: doc.id, name: data.name || '(sans nom)', matches, allIds: ids });
    }
  });

  if (sources.length === 0) {
    console.log('⚠️  Aucun parcours ne contient ces question IDs. Rien à faire.');
    process.exit(0);
  }

  // 2. Afficher et traiter les sources
  for (const src of sources) {
    console.log(`📂 Parcours SOURCE : ${src.id} — "${src.name}"`);
    console.log(`   Questions à retirer : ${src.matches.join(', ')}`);
    const newIds = src.allIds.filter(function(id) { return !QUESTION_IDS.includes(id); });
    console.log(`   directQuestionIds : ${src.allIds.length} → ${newIds.length} questions`);

    if (!DRY_RUN) {
      await db.collection('parcours').doc(src.id).update({ directQuestionIds: newIds });
      console.log(`   ✅ Retiré de ${src.id}`);
    }
  }

  // 3. Cible : Pharmacie du voyageur
  const targetSnap = await db.collection('parcours').doc(TARGET_PARCOURS_ID).get();
  if (!targetSnap.exists) {
    console.error(`\n❌ Parcours cible ${TARGET_PARCOURS_ID} introuvable.`);
    process.exit(1);
  }
  const targetData = targetSnap.data();
  const existing = Array.isArray(targetData.directQuestionIds) ? targetData.directQuestionIds : [];
  const toAdd = QUESTION_IDS.filter(function(q) { return !existing.includes(q); });
  const already = QUESTION_IDS.filter(function(q) { return existing.includes(q); });

  console.log(`\n📂 Parcours CIBLE  : ${TARGET_PARCOURS_ID} — "${targetData.name || '(sans nom)'}"`);
  if (already.length > 0) console.log(`   Déjà présentes  : ${already.join(', ')}`);
  console.log(`   Questions à ajouter : ${toAdd.join(', ')}`);
  console.log(`   directQuestionIds : ${existing.length} → ${existing.length + toAdd.length} questions`);

  if (!DRY_RUN && toAdd.length > 0) {
    await db.collection('parcours').doc(TARGET_PARCOURS_ID).update({
      directQuestionIds: [...existing, ...toAdd],
    });
    console.log(`   ✅ Ajouté à ${TARGET_PARCOURS_ID}`);
  }

  console.log(DRY_RUN
    ? '\n✅ Dry-run terminé. Relance avec --confirm pour appliquer.'
    : '\n✅ Reclassification terminée.');
  process.exit(0);
}
main().catch(function(e) { console.error(e); process.exit(1); });
