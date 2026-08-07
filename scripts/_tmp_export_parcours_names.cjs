/**
 * Exporte les noms de tous les parcours d'entraînement (non editorialOnly, publiés)
 * dans un fichier Excel.
 * Usage : node scripts/_tmp_export_parcours_names.cjs <service-account.json>
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const { execSync } = require('child_process');

const keyPath = process.argv[2];
initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

function getXLSX() {
  try { return require('xlsx'); } catch (_) {
    console.log('Installation de xlsx...');
    execSync('npm install xlsx --no-save --prefix "' + __dirname + '/.."', { stdio: 'inherit' });
    return require('xlsx');
  }
}

async function main() {
  const snap = await db.collection('parcours').where('status', '==', 'published').get();

  const items = [];
  snap.docs.forEach(d => {
    const data = d.data();
    if (data.editorialOnly || data.lundiLegiParcours || data.organizationId) return;
    items.push({ id: d.id, name: data.name || '(sans nom)', color: data.color || '' });
  });
  items.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  console.log(`\n${items.length} parcours d'entraînement trouvés.\n`);

  const XLSX = getXLSX();
  const rows = [['#', 'Nom actuel', 'Nouveau nom proposé', 'ID']];
  items.forEach((p, i) => rows.push([i + 1, p.name, '', p.id]));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 4 }, { wch: 50 }, { wch: 50 }, { wch: 30 }];

  // En-têtes en gras
  ['A1','B1','C1','D1'].forEach(ref => {
    if (ws[ref]) ws[ref].s = { font: { bold: true }, fill: { fgColor: { rgb: 'D6E4F0' } } };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Parcours');

  const outPath = path.join('C:\\Users\\beida\\Documents', 'parcours_a_renommer.xlsx');
  XLSX.writeFile(wb, outPath);
  console.log('✅ Fichier créé :', outPath);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
