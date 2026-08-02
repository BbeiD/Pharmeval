/**
 * Supprime l'organisation ORG-97202efe et détache ses membres.
 * Usage : node scripts/_tmp_cleanup_org.cjs <service-account.json>
 *          node scripts/_tmp_cleanup_org.cjs <service-account.json> --dry-run
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');
const ORG_ID = 'ORG-97202efe';

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

async function main() {
  console.log('=== NETTOYAGE ORGANISATION ===');
  console.log('Organisation cible :', ORG_ID);
  if (DRY_RUN) console.log('⚠ Mode DRY-RUN : aucune écriture\n');
  else console.log('');

  // 1. Vérifier que l'organisation existe
  const orgRef = db.collection('organizations').doc(ORG_ID);
  const orgDoc = await orgRef.get();
  if (!orgDoc.exists) {
    console.log('⚠ Organisation introuvable dans Firestore. Déjà supprimée ?');
  } else {
    const data = orgDoc.data();
    console.log('Organisation trouvée :');
    console.log('  Nom :', data.name || '(sans nom)');
    console.log('  Créée :', data.createdAt || '?');
    console.log('  Membres :', JSON.stringify(data.members || data.memberIds || '(voir users)'));
  }

  // 2. Trouver les utilisateurs rattachés à cette org
  const usersSnap = await db.collection('users').where('organizationId', '==', ORG_ID).get();
  console.log(`\nUtilisateurs rattachés : ${usersSnap.size}`);
  usersSnap.docs.forEach(d => {
    const u = d.data();
    console.log(`  ${d.id} — ${u.email || u.displayName || '?'} (role: ${u.role || '?'})`);
  });

  // 3. Chercher aussi dans organization_members si la collection existe
  const membersSnap = await db.collection('organization_members').where('organizationId', '==', ORG_ID).get().catch(() => ({ size: 0, docs: [] }));
  if (membersSnap.size > 0) {
    console.log(`\nDocs organization_members : ${membersSnap.size}`);
    membersSnap.docs.forEach(d => console.log(' ', d.id, JSON.stringify(d.data()).slice(0, 80)));
  }

  if (DRY_RUN) {
    console.log('\nActions qui seraient effectuées :');
    if (orgDoc.exists) console.log(`  - Supprimer organizations/${ORG_ID}`);
    usersSnap.docs.forEach(d => console.log(`  - users/${d.id} : organizationId → null, role → 'user'`));
    membersSnap.docs.forEach(d => console.log(`  - Supprimer organization_members/${d.id}`));
    console.log('\n⚠ DRY-RUN : relancez sans --dry-run pour appliquer.');
    process.exit(0);
  }

  // 4. Exécution
  const batch = db.batch();

  if (orgDoc.exists) batch.delete(orgRef);

  usersSnap.docs.forEach(d => {
    batch.update(d.ref, {
      organizationId: FieldValue.delete(),
      role: 'user',
    });
  });

  membersSnap.docs.forEach(d => batch.delete(d.ref));

  await batch.commit();

  console.log('\n✅ Nettoyage terminé :');
  if (orgDoc.exists) console.log('  - Organisation supprimée');
  console.log(`  - ${usersSnap.size} utilisateur(s) détachés (role → user)`);
  if (membersSnap.size > 0) console.log(`  - ${membersSnap.size} docs organization_members supprimés`);
  console.log('\n→ Recharge la page — "Organisation" disparaît du menu.');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
