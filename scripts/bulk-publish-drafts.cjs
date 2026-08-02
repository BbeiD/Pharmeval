/**
 * bulk-publish-drafts.cjs — Pharmeval
 *
 * Publie toutes les questions en statut "draft" dont editorialOnly === false
 * (les 975 questions des parcours d'entraînement libre).
 * Les questions éditoriales (ALAUNE, Lundi Légi) restent en draft pour
 * validation séparée.
 *
 * Usage :
 *   node scripts/bulk-publish-drafts.cjs <chemin-service-account.json>
 *
 * Option --all : publie aussi les questions éditoriales (editorialOnly=true)
 *   node scripts/bulk-publish-drafts.cjs <service-account.json> --all
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
const publishAll = process.argv.includes('--all');

if (!keyPath) {
  console.error('Usage: node scripts/bulk-publish-drafts.cjs <chemin-service-account.json> [--all]');
  process.exit(1);
}

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

async function main() {
  console.log('=== BULK PUBLISH DRAFTS ===');
  console.log('Mode :', publishAll ? 'TOUTES les questions draft' : 'Questions entraînement libre uniquement (editorialOnly=false)');
  console.log('Début :', new Date().toISOString(), '\n');

  // Requête : toutes les questions draft
  let query = db.collection('questions').where('status', '==', 'draft');

  const snap = await query.get();
  console.log(`Questions draft trouvées : ${snap.size}`);

  // Filtre selon le mode
  const toPublish = publishAll
    ? snap.docs
    : snap.docs.filter(d => d.data().editorialOnly !== true);

  console.log(`Questions à publier : ${toPublish.length}`);

  if (toPublish.length === 0) {
    console.log('Rien à publier.');
    process.exit(0);
  }

  // Mise à jour par lots de 400
  let total = 0;
  for (let i = 0; i < toPublish.length; i += 400) {
    const chunk = toPublish.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach(d => {
      batch.update(d.ref, {
        status: 'published',
        publishedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    total += chunk.length;
    process.stdout.write(`\r  Publiées : ${total}/${toPublish.length}...`);
  }

  console.log(`\r  Publiées : ${total}/${toPublish.length}.   `);
  console.log('\n✅ Bulk publish terminé :', new Date().toISOString());
  console.log(`→ ${total} questions maintenant visibles dans l'app.`);

  // Résumé des questions éditoriales restantes en draft
  if (!publishAll) {
    const editorialDraft = snap.docs.filter(d => d.data().editorialOnly === true);
    if (editorialDraft.length > 0) {
      console.log(`\nℹ ${editorialDraft.length} questions éditoriales (ALAUNE/Lundi Légi) restent en draft — à publier séparément.`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
