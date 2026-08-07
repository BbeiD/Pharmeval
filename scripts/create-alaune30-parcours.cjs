/**
 * create-alaune30-parcours.cjs — Pharmeval
 *
 * Crée le parcours ALAUNE-30 "Pharmacie du voyageur" (11 questions VYG_QDB).
 * Les 4 questions MED4 n'ont pas été importées via catalog-sync et sont absentes.
 *
 * Usage :
 *   node scripts/create-alaune30-parcours.cjs <service-account.json>
 *   node scripts/create-alaune30-parcours.cjs <service-account.json> --dry-run
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const crypto = require('crypto');

const keyPath = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!keyPath) {
  console.error('Usage: node scripts/create-alaune30-parcours.cjs <service-account.json> [--dry-run]');
  process.exit(1);
}

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

function randomHex8() { return crypto.randomBytes(4).toString('hex'); }
function generateParcoursId() { return 'PARC-' + randomHex8(); }
function generateCompetencyId() { return 'COMP-' + randomHex8(); }

function normalizeCompetencyKey(label) {
  return (label || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

async function main() {
  console.log('=== CREATION PARCOURS ALAUNE-30 ===');
  if (DRY_RUN) console.log('⚠ Mode DRY-RUN : aucune écriture\n');
  else console.log('');

  // 1. Vérifier que le parcours n'existe pas déjà
  const pSnap = await db.collection('parcours').get();
  const existing = pSnap.docs.find(d => {
    const data = d.data();
    return data.name && (
      data.name.toLowerCase().includes('voyage') ||
      (data.tags || []).some(t => t.includes('alaune-30'))
    );
  });
  if (existing) {
    console.log('✅ Parcours ALAUNE-30 existe déjà :', existing.id, '—', existing.data().name);
    process.exit(0);
  }

  // 2. Charger les compétences SKILL-*
  console.log('1. Chargement des compétences SKILL-*...');
  const compSnap = await db.collection('competencies').get();
  const skillByKey = new Map();
  for (const doc of compSnap.docs) {
    const data = doc.data();
    const name = data.name || data.label || '';
    if (name) skillByKey.set(normalizeCompetencyKey(name), { id: doc.id, name });
  }
  console.log(`   → ${compSnap.size} compétences chargées`);

  // 3. Charger les questions VYG_QDB
  console.log('2. Chargement des questions VYG_QDB...');
  const qSnap = await db.collection('questions').where('editorialOnly', '==', true).get();
  const vygQuestions = [];
  for (const doc of qSnap.docs) {
    const data = doc.data();
    const legId = data.externalIds && data.externalIds.editorialCatalog;
    if (!legId) continue;
    const m = legId.match(/^LEGACY-(VYG_QDB)-([a-z0-9_]+)-(\d+)$/);
    if (!m) continue;
    vygQuestions.push({
      id: doc.id,
      legId,
      sub: m[2],
      pos: parseInt(m[3], 10),
      primaryCompetency: data.primaryCompetency || null,
      data,
    });
  }
  vygQuestions.sort((a, b) => a.sub.localeCompare(b.sub) || a.pos - b.pos);
  console.log(`   → ${vygQuestions.length} questions VYG_QDB trouvées`);

  if (vygQuestions.length === 0) {
    console.error('❌ Aucune question VYG_QDB trouvée. Vérifiez l\'import.');
    process.exit(1);
  }

  // 4. Grouper par compétence principale
  const compGroups = new Map();
  for (const q of vygQuestions) {
    const label = (q.primaryCompetency && q.primaryCompetency.label) || 'Pharmacie du voyageur';
    if (!compGroups.has(label)) compGroups.set(label, []);
    compGroups.get(label).push(q.id);
  }

  // 5. Construire les compétences embarquées
  const competencies = [];
  for (const [label, questionIds] of compGroups) {
    const key = normalizeCompetencyKey(label);
    const skill = skillByKey.get(key);
    competencies.push({
      id: generateCompetencyId(),
      name: label,
      description: '',
      order: competencies.length + 1,
      questionIds,
      competencyId: skill ? skill.id : null,
    });
  }

  // 6. Construire le document parcours
  const parcoursId = generateParcoursId();
  const directQuestionIds = vygQuestions.map(q => q.id);

  const parcoursDoc = {
    id: parcoursId,
    name: 'Pharmacie du voyageur',
    description: 'Les incontournables du conseil voyage au comptoir : vaccination, paludisme, trousse de secours, urgences en déplacement.',
    targetAudience: 'Étudiants en pharmacie et pharmaciens',
    status: 'published',
    color: 'vert',
    icon: '✈️',
    competencies,
    modules: [],
    tags: ['alaune', 'alaune-30', 'voyage', 'editorial'],
    sourceIds: [],
    directQuestionIds,
    accessTier: 'free',
    organizationId: null,
    featured: false,
    featuredStartDate: null,
    featuredEndDate: null,
    editorialOnly: true,
    alauneId: 'ALAUNE-30',
    questionCount: directQuestionIds.length,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // 7. Affichage dry-run
  console.log('\n3. Parcours à créer :');
  console.log(`   ID        : ${parcoursId}`);
  console.log(`   Titre     : ${parcoursDoc.name}`);
  console.log(`   Questions : ${directQuestionIds.length}`);
  console.log(`   Compétences (${competencies.length}) :`);
  competencies.forEach(c => {
    const linked = c.competencyId ? `→ ${c.competencyId}` : '⚠ non liée';
    console.log(`     - ${c.name} (${c.questionIds.length}q) ${linked}`);
  });
  console.log('\n   Questions (leg ID → doc ID) :');
  vygQuestions.forEach(q => console.log(`     ${q.legId}  →  ${q.id}`));

  if (DRY_RUN) {
    console.log('\n⚠ DRY-RUN : relancez sans --dry-run pour écrire dans Firestore.');
    process.exit(0);
  }

  // 8. Écriture
  console.log('\n4. Écriture dans Firestore...');
  await db.collection('parcours').doc(parcoursId).set(parcoursDoc);
  console.log(`   ✅ Parcours créé : ${parcoursId}`);

  console.log('\n✅ ALAUNE-30 créé avec', directQuestionIds.length, 'questions.');
  console.log('→ Recharge admin/parcours.html pour vérifier.');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
