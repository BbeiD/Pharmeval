/**
 * Vérifie quels pedagogicalIds du planning Lundi Légi existent dans Firestore.
 * Usage : node scripts/_tmp_inspect_lundilegi_ids.cjs <service-account.json>
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

// Copie exacte de lundi-legi-schedule.js
const SCHEDULE = [
  'PHARM-LEG-000095','PHARM-BPP-000060','PHARM-LEG-000096','PHARM-LEG-000097',
  'PHARM-DEO-000064','PHARM-LEG-000098','PHARM-LEG-000099','PHARM-DEO-000065',
  'PHARM-LEG-000100','PHARM-LEG-000101','PHARM-LEG-000102','PHARM-DEO-000066',
  'PHARM-LEG-000103','PHARM-LEG-000104','PHARM-LEG-000105','PHARM-DEO-000067',
  'PHARM-DEO-000068','PHARM-LEG-000106','PHARM-LEG-000107','PHARM-DEO-000069',
  'PHARM-LEG-000108','PHARM-LEG-000109','PHARM-DEO-000070','PHARM-LEG-000110',
  'PHARM-DEO-000071','PHARM-DEO-000072','PHARM-DEO-000073','PHARM-LEG-000111',
  'PHARM-DEO-000074','PHARM-LEG-000112','PHARM-DEO-000075','PHARM-DEO-000076',
  'PHARM-LEG-000113','PHARM-LEG-000114','PHARM-BPP-000061','PHARM-DEO-000077',
  'PHARM-LEG-000115','PHARM-LEG-000116','PHARM-LEG-000117','PHARM-DEO-000078',
  'PHARM-BPP-000062','PHARM-LEG-000118','PHARM-LEG-000119','PHARM-LEG-000120',
  'PHARM-LEG-000121','PHARM-LEG-000122','PHARM-DEO-000079','PHARM-DEO-000080',
  'PHARM-DEO-000081','PHARM-DEO-000082',
];

async function main() {
  console.log(`Vérification de ${SCHEDULE.length} IDs du planning Lundi Légi...\n`);

  // Firestore doc IDs peuvent être = pedagogicalId ou différents
  // On cherche dans les docs ET dans le champ pedagogicalId
  const found = new Set();
  const notFound = [];

  // Méthode 1 : les doc IDs Firestore = pedagogicalId (cas habituel Pharmeval)
  const CHUNK = 30;
  for (let i = 0; i < SCHEDULE.length; i += CHUNK) {
    const batch = SCHEDULE.slice(i, i + CHUNK);
    const snap = await db.collection('questions').where('__name__', 'in', batch).get();
    snap.docs.forEach(d => found.add(d.id));
  }

  // Méthode 2 : chercher par pedagogicalId si différent du doc ID
  for (let i = 0; i < SCHEDULE.length; i += CHUNK) {
    const batch = SCHEDULE.slice(i, i + CHUNK).filter(id => !found.has(id));
    if (batch.length === 0) continue;
    const snap = await db.collection('questions').where('pedagogicalId', 'in', batch).get();
    snap.docs.forEach(d => found.add(d.data().pedagogicalId || d.id));
  }

  SCHEDULE.forEach(id => { if (!found.has(id)) notFound.push(id); });

  console.log(`Trouvés dans Firestore : ${found.size}/${SCHEDULE.length}`);
  console.log(`Manquants : ${notFound.length}\n`);

  if (notFound.length > 0) {
    const byPrefix = {};
    notFound.forEach(id => {
      const prefix = id.replace(/-\d+$/, '');
      if (!byPrefix[prefix]) byPrefix[prefix] = [];
      byPrefix[prefix].push(id);
    });
    console.log('IDs manquants par banque :');
    Object.entries(byPrefix).forEach(([prefix, ids]) => {
      console.log(`  ${prefix} (${ids.length})`);
      ids.forEach(id => console.log('    -', id));
    });
    console.log('\n→ Ces questions n\'ont pas été importées via catalog-sync.');
    console.log('→ Charge le fichier Pharmeval_Lundi_Legi_CatalogSync.xlsx dans admin/catalog-sync.html');
  } else {
    console.log('✅ Les 50 questions du planning sont présentes dans Firestore.');
  }

  // Bonus : afficher les questions trouvées avec leur statut
  const foundArr = Array.from(found);
  for (let i = 0; i < foundArr.length; i += CHUNK) {
    const batch = foundArr.slice(i, i + CHUNK);
    const snap = await db.collection('questions').where('__name__', 'in', batch).get();
    const byStatus = {};
    snap.docs.forEach(d => {
      const s = d.data().status || 'inconnu';
      byStatus[s] = (byStatus[s] || 0) + 1;
    });
    if (i === 0) {
      console.log('\nStatuts des questions trouvées :');
      Object.entries(byStatus).forEach(([s, n]) => console.log(' ', s, ':', n));
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
