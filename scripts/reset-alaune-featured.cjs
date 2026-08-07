/**
 * Remet tous les parcours ALAUNE (editorialOnly:true) à featured:false.
 * À lancer une fois pour corriger le set-alaune-featured.cjs qui les avait
 * tous mis featured:true en bloc.
 * Usage : node scripts/reset-alaune-featured.cjs <service-account.json>
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

async function main() {
  const snap = await db.collection('parcours').where('editorialOnly', '==', true).get();
  console.log(`Parcours editorialOnly trouvés : ${snap.size}`);

  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.lundiLegiParcours) continue; // garder Lundi Légi intact
    await doc.ref.update({ featured: false, featuredStartDate: null, featuredEndDate: null });
    updated++;
    console.log(`  ✓ ${data.alauneId || doc.id} — ${data.name}`);
  }
  console.log(`\n✅ ${updated} parcours ALAUNE remis à featured:false.`);
  console.log('→ Dans admin/parcours.html, clique sur ★ pour activer un à la une.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
