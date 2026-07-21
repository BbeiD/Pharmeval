/**
 * ===================== RESET DES DONNEES OPERATIONNELLES =====================
 * A executer par une personne disposant des identifiants reels du projet
 * Firebase Pharmeval, pour repartir d'une base propre avant un nouvel import
 * du catalogue (Excel -> Synchronisation du catalogue).
 *
 * SUPPRIME DEFINITIVEMENT, dans Firestore : questions, sources et sections
 * documentaires, competences, progression des competences, tags, parcours,
 * attributions de parcours, resultats et sessions d'evaluation, progression
 * des questions, compteurs d'identifiants (pedagogical_id_counters,
 * document_code_counters), et l'historique legacy V1 (users/{uid}/evaluations).
 *
 * NE TOUCHE JAMAIS : les documents `users` eux-memes, `organizations`,
 * `profiles`, `groups`, ni aucun journal d'audit (question_audit_logs,
 * parcours_audit_logs, competency_audit_logs, audit_logs,
 * reference_bank_audit_logs, importLogs, document_migration_jobs).
 *
 * Contourne firestore.rules via un compte de service (aucune regle modifiee,
 * aucune garantie d'immuabilite existante affaiblie pour l'application).
 *
 * Prerequis :
 *   npm install firebase-admin
 * Usage :
 *   node reset-operational-data.mjs /chemin/vers/service-account.json
 */
import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const keyPath = process.argv[2];
if (!keyPath) {
  console.error('Usage: node reset-operational-data.mjs /chemin/vers/service-account.json');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const CONFIRMATION_PHRASE = 'SUPPRIMER';
const BATCH_SIZE = 400;

// Collections de premier niveau a vider integralement (memes noms que les
// constantes *_COLLECTION des services correspondants, verifies dans le code).
const TOP_LEVEL_COLLECTIONS = [
  { label: 'Questions', path: 'questions' },
  { label: 'Sources documentaires', path: 'document_sources' },
  { label: 'Sections documentaires', path: 'document_sections' },
  { label: "Compteur d'identifiants pedagogiques", path: 'pedagogical_id_counters' },
  { label: 'Compteur de codes documentaires', path: 'document_code_counters' },
  { label: 'Competences', path: 'competencies' },
  { label: 'Progression des competences', path: 'competency_progress' },
  { label: 'Tags', path: 'tags' },
  { label: 'Parcours', path: 'parcours' },
  { label: 'Attributions de parcours', path: 'assignments' },
  { label: "Resultats d'evaluation", path: 'evaluation_results' },
  { label: "Sessions d'evaluation", path: 'evaluation_sessions' },
  { label: 'Progression des questions', path: 'question_progress' },
  { label: 'Marqueurs de progression appliques', path: 'question_progress_applied_results' },
];

async function countCollection(path) {
  const snap = await db.collection(path).count().get();
  return snap.data().count;
}

async function deleteCollectionInBatches(path) {
  let deleted = 0;
  for (;;) {
    const snap = await db.collection(path).limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}

async function listUserIds() {
  // select() sans argument = lecture des identifiants seuls, jamais des
  // donnees du profil utilisateur (jamais lu, jamais modifie, jamais supprime).
  const snap = await db.collection('users').select().get();
  return snap.docs.map((doc) => doc.id);
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

async function main() {
  console.log('=== Apercu des donnees a supprimer ===\n');

  const counts = [];
  for (const { label, path } of TOP_LEVEL_COLLECTIONS) {
    const count = await countCollection(path);
    counts.push({ label, path, count });
    console.log(`  ${label} (${path}) : ${count}`);
  }

  const userIds = await listUserIds();
  let legacyEvalCount = 0;
  for (const uid of userIds) {
    legacyEvalCount += await countCollection(`users/${uid}/evaluations`);
  }
  console.log(`  Historique legacy V1 (users/*/evaluations, sur ${userIds.length} compte(s)) : ${legacyEvalCount}`);

  const total = counts.reduce((sum, c) => sum + c.count, 0) + legacyEvalCount;
  console.log(`\n  TOTAL : ${total} document(s) a supprimer definitivement.`);
  console.log("  Les documents 'users', 'organizations', 'profiles', 'groups' et tous les journaux d'audit ne sont PAS touches.\n");

  if (total === 0) {
    console.log('Rien a supprimer. Fin.');
    return;
  }

  const answer = await ask(`Cette action est IRREVERSIBLE. Tapez "${CONFIRMATION_PHRASE}" pour confirmer, autre chose pour annuler : `);
  if (answer.trim() !== CONFIRMATION_PHRASE) {
    console.log('Annule. Aucune donnee supprimee.');
    return;
  }

  console.log('\n=== Suppression en cours ===\n');

  const results = [];
  for (const { label, path } of TOP_LEVEL_COLLECTIONS) {
    const deleted = await deleteCollectionInBatches(path);
    results.push({ label, path, deleted });
    console.log(`  ${label} (${path}) : ${deleted} supprime(s)`);
  }

  let legacyDeleted = 0;
  for (const uid of userIds) {
    legacyDeleted += await deleteCollectionInBatches(`users/${uid}/evaluations`);
  }
  console.log(`  Historique legacy V1 (users/*/evaluations) : ${legacyDeleted} supprime(s)`);

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0) + legacyDeleted;
  console.log(`\n=== TERMINE : ${totalDeleted} document(s) supprime(s). ===`);
}

main().catch((err) => { console.error('Erreur inattendue :', err); process.exit(1); });
