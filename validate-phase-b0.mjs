/**
 * ===================== VALIDATION REELLE — Sprint 21.5, Phase B0 =====================
 * A executer par une personne disposant des identifiants reels du projet
 * Firebase Pharmeval, APRES deploiement des index (voir
 * DEPLOIEMENT_VALIDATION_B0.md) et une fois leur statut "Enabled" confirme
 * dans la console Firebase.
 *
 * ECRIT REELLEMENT dans Firestore (documents de test prefixes
 * "__phaseb0-validation__"), puis les SUPPRIME en fin de script. N'ECRIT
 * JAMAIS dans `questions` (aucune question reelle touchee).
 *
 * Prerequis :
 *   npm install firebase-admin
 * Usage :
 *   node validate-phase-b0.mjs /chemin/vers/service-account.json
 */
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { normalizeForDedup } from './js/services/normalization-utils.js'; // fichier pur, reellement reutilise (meme fonction que le code client)

const keyPath = process.argv[2];
if (!keyPath) {
  console.error('Usage: node validate-phase-b0.mjs /chemin/vers/service-account.json');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const PREFIX = '__phaseb0-validation__';
let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

async function testIndexes() {
  console.log('=== 1. Les 3 nouveaux index sont-ils utilisables ? ===');
  const testCases = [
    { label: 'status + documentSourceId + createdAt', build: () => db.collection('questions').where('status', '==', 'published').where('documentSourceId', '==', PREFIX + 'source').orderBy('createdAt', 'desc') },
    { label: 'status + documentSourceId + documentSectionId + createdAt', build: () => db.collection('questions').where('status', '==', 'published').where('documentSourceId', '==', PREFIX + 'source').where('documentSectionId', '==', PREFIX + 'section').orderBy('createdAt', 'desc') },
    { label: 'status + documentSourceId + difficulty + createdAt', build: () => db.collection('questions').where('status', '==', 'published').where('documentSourceId', '==', PREFIX + 'source').where('difficulty', '==', 'Basique').orderBy('createdAt', 'desc') },
  ];
  for (const t of testCases) {
    try {
      await t.build().limit(1).get();
      check(t.label + ' → index prêt (aucune erreur)', true);
    } catch (err) {
      const isMissing = err.code === 9 || /index/i.test(err.message || ''); // 9 = FAILED_PRECONDITION (grpc)
      console.log('  [FAIL] ' + t.label + ' → ' + (isMissing ? 'INDEX MANQUANT OU EN CONSTRUCTION' : 'ERREUR INATTENDUE') + ' : ' + err.message);
      failed++;
    }
  }
}

async function testTagCycle() {
  console.log('=== 2. Cycle réel des tags (création, dédoublonnage) ===');
  const label = PREFIX + 'antibiotique';
  const tagId = normalizeForDedup(label); // MEME fonction que tag-catalog-service.js
  const ref = db.collection('tags').doc(tagId);

  try {
    await ref.set({ id: tagId, label: label, usageCount: 1, createdAt: new Date().toISOString() });
    const snap1 = await ref.get();
    check('tag créé et relisible', snap1.exists && snap1.data().label === label);

    // Simule un second passage (comme findOrCreateTag() sur un tag existant)
    await ref.update({ usageCount: FieldValue.increment(1) });
    const snap2 = await ref.get();
    check('second passage → incrémenté, jamais un doublon de document', snap2.data().usageCount === 2);

    // Vérifie qu'un libellé légèrement différent (casse/espaces) produit la MEME clé
    const variantId = normalizeForDedup('  ' + label.toUpperCase() + '.');
    check('normalisation stable (casse/espaces/ponctuation) → même clé', variantId === tagId);
  } finally {
    await ref.delete();
    console.log('  (nettoyage : tag de test supprimé)');
  }
}

async function testProgressIdempotency() {
  console.log('=== 3. Idempotence réelle de la progression par question ===');
  const userId = PREFIX + 'user';
  const pedagogicalId = PREFIX + 'question';
  const resultId = PREFIX + 'result-1';
  const progressRef = db.collection('question_progress').doc(userId + '_' + pedagogicalId);
  const markerRef = db.collection('question_progress_applied_results').doc(resultId);

  async function applyOnce() {
    return db.runTransaction(async (tx) => {
      const markerSnap = await tx.get(markerRef);
      if (markerSnap.exists) return { applied: false };
      tx.set(markerRef, { resultId, appliedAt: new Date().toISOString() });
      return { applied: true };
    });
  }

  try {
    const first = await applyOnce();
    check('premier passage → marqueur posé (applied=true)', first.applied === true);
    if (first.applied) {
      await progressRef.set({ userId, pedagogicalId, timesSeen: FieldValue.increment(1), timesCorrect: FieldValue.increment(1), lastSeenAt: new Date().toISOString() }, { merge: true });
    }

    const second = await applyOnce();
    check('second passage (même resultId) → marqueur déjà présent (applied=false)', second.applied === false);

    const snap = await progressRef.get();
    check('timesSeen = 1 malgré la tentative de double traitement', snap.data().timesSeen === 1);
  } finally {
    await progressRef.delete();
    await markerRef.delete();
    console.log('  (nettoyage : documents de progression de test supprimés)');
  }
}

async function main() {
  await testIndexes();
  await testTagCycle();
  await testProgressIdempotency();
  console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Erreur inattendue :', err); process.exit(1); });
