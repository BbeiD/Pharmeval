/**
 * Met à jour le champ `name` de chaque parcours d'entraînement
 * avec la valeur "Nom combiné" de l'Excel fourni par David.
 * Usage : node scripts/_tmp_rename_parcours.cjs <service-account.json>
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const XLSX = require('xlsx');
const path = require('path');

const keyPath = process.argv[2];
initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

async function main() {
  const wb = XLSX.readFile('C:\\Users\\beida\\Downloads\\parcours_a_renommer_repere_CBIP.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Ligne 0 = en-tête, on saute
  const updates = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = row[6];          // colonne G = ID
    const nomCombine = row[5];  // colonne F = Nom combiné
    if (!id || !nomCombine) continue;
    updates.push({ id, name: nomCombine });
  }

  console.log(`${updates.length} parcours à renommer...`);

  const batch = db.batch();
  updates.forEach(({ id, name }) => {
    batch.update(db.collection('parcours').doc(id), { name });
  });
  await batch.commit();

  console.log('✅ Tous les noms ont été mis à jour.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
