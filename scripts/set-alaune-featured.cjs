/**
 * set-alaune-featured.cjs — Pharmeval
 *
 * Marque tous les parcours ALAUNE (field alauneId présent, ou tag 'alaune')
 * comme featured:true sans date de début/fin (permanent jusqu'à retrait manuel).
 *
 * Usage :
 *   node scripts/set-alaune-featured.cjs <service-account.json>
 *   node scripts/set-alaune-featured.cjs <service-account.json> --dry-run
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!keyPath) {
  console.error('Usage: node scripts/set-alaune-featured.cjs <service-account.json> [--dry-run]');
  process.exit(1);
}

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

async function main() {
  console.log('=== SET FEATURED — PARCOURS ALAUNE ===');
  if (DRY_RUN) console.log('⚠ Mode DRY-RUN : aucune écriture\n');
  else console.log('');

  const snap = await db.collection('parcours').get();

  const alaune = snap.docs.filter(d => {
    const data = d.data();
    return data.alauneId || (Array.isArray(data.tags) && data.tags.includes('alaune'));
  });

  console.log(`Parcours ALAUNE trouvés : ${alaune.length}`);
  alaune.forEach(d => {
    const data = d.data();
    console.log(`  ${data.alauneId || '?'} — ${data.name} (featured: ${data.featured})`);
  });

  const toUpdate = alaune.filter(d => !d.data().featured);
  console.log(`\nÀ mettre à jour (featured: false → true) : ${toUpdate.length}`);

  if (toUpdate.length === 0) {
    console.log('✅ Tous les parcours ALAUNE sont déjà featured.');
    process.exit(0);
  }

  if (!DRY_RUN) {
    for (const doc of toUpdate) {
      await db.collection('parcours').doc(doc.id).update({
        featured: true,
        featuredStartDate: null,
        featuredEndDate: null,
        updatedAt: new Date(),
      });
      process.stdout.write('.');
    }
    console.log('\n');
  }

  console.log(`\n✅ ${DRY_RUN ? '[DRY] ' : ''}${toUpdate.length} parcours ALAUNE marqués featured:true`);
  if (DRY_RUN) console.log('⚠ DRY-RUN : relancez sans --dry-run pour appliquer.');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
