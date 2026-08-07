/**
 * Liste tous les parcours publiés dont le nom ne contient pas " — "
 * (pas de préfixe famille), triés alphabétiquement.
 * Usage : node scripts/_tmp_list_parcours_sans_prefixe.cjs <service-account.json>
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
if (!keyPath) { console.error('Usage: node script.cjs <service-account.json>'); process.exit(1); }

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

async function main() {
  const snap = await db.collection('parcours')
    .where('status', '==', 'published')
    .get();

  const sansPrefixe = snap.docs
    .map(d => ({ id: d.id, name: d.data().name || '' }))
    .filter(p => !p.name.includes(' — '))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  console.log(`\n${sansPrefixe.length} parcours sans préfixe famille :\n`);
  sansPrefixe.forEach(p => console.log(`  ${p.id}  ${p.name}`));
  console.log('');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
