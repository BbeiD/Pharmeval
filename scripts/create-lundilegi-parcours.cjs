/**
 * create-lundilegi-parcours.cjs — Pharmeval
 *
 * Crée un parcours "Lundi Légi" en statut DRAFT (jamais publié) regroupant
 * toutes les questions éditoriales de déontologie et législation.
 * Ce parcours n'est pas destiné aux utilisateurs — il sert uniquement à
 * donner une structure visible depuis admin/parcours.html.
 *
 * Questions incluses : LEG_QDB + DEO_QDB + BPP_QDB (editorialOnly=true)
 * trouvées dans Firestore au moment de l'exécution.
 *
 * Usage :
 *   node scripts/create-lundilegi-parcours.cjs <service-account.json>
 *   node scripts/create-lundilegi-parcours.cjs <service-account.json> --dry-run
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const crypto = require('crypto');

const keyPath = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!keyPath) {
  console.error('Usage: node scripts/create-lundilegi-parcours.cjs <service-account.json> [--dry-run]');
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

// Banks considérées comme "Lundi Légi"
const LUNDI_LEGI_BANKS = new Set(['LEG_QDB', 'DEON_QDB', 'CBIP_QDB', 'BPP_QDB']);

async function main() {
  console.log('=== CRÉATION PARCOURS LUNDI LÉGI (DRAFT) ===');
  if (DRY_RUN) console.log('⚠ Mode DRY-RUN : aucune écriture\n');
  else console.log('');

  // 1. Vérifier que le parcours n'existe pas déjà
  const pSnap = await db.collection('parcours').get();
  const existing = pSnap.docs.find(d => {
    const data = d.data();
    return data.lundiLegiParcours === true ||
           (data.name && data.name.toLowerCase().includes('lundi légi'));
  });
  if (existing) {
    console.log('✅ Parcours Lundi Légi existe déjà :', existing.id, '—', existing.data().name);
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

  // 3. Charger toutes les questions éditoriales des banques Lundi Légi
  console.log('2. Chargement des questions Lundi Légi (LEG_QDB, DEON_QDB, CBIP_QDB, BPP_QDB)...');
  const qSnap = await db.collection('questions').where('editorialOnly', '==', true).get();
  const legiQuestions = [];
  for (const doc of qSnap.docs) {
    const data = doc.data();
    const legId = data.externalIds && data.externalIds.editorialCatalog;
    if (!legId) continue;
    const m = legId.match(/^LEGACY-([A-Z0-9_]+)-([a-z0-9_]+)-(\d+)$/);
    if (!m) continue;
    if (!LUNDI_LEGI_BANKS.has(m[1])) continue;
    legiQuestions.push({
      id: doc.id,
      legId,
      bank: m[1],
      sub: m[2],
      pos: parseInt(m[3], 10),
      primaryCompetency: data.primaryCompetency || null,
    });
  }
  legiQuestions.sort((a, b) => a.bank.localeCompare(b.bank) || a.sub.localeCompare(b.sub) || a.pos - b.pos);
  console.log(`   → ${legiQuestions.length} questions trouvées`);

  if (legiQuestions.length === 0) {
    console.error('❌ Aucune question Lundi Légi trouvée. Vérifiez l\'import.');
    process.exit(1);
  }

  // 4. Grouper par compétence principale
  const compGroups = new Map();
  for (const q of legiQuestions) {
    const label = (q.primaryCompetency && q.primaryCompetency.label) || 'Droit pharmaceutique';
    if (!compGroups.has(label)) compGroups.set(label, []);
    compGroups.get(label).push(q.id);
  }

  // 5. Compétences embarquées
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

  // 6. Document parcours
  const parcoursId = generateParcoursId();
  const directQuestionIds = legiQuestions.map(q => q.id);

  const parcoursDoc = {
    id: parcoursId,
    name: 'Lundi Légi',
    description: 'Regroupement interne des questions de législation et de déontologie pharmaceutique. Ce parcours reste en brouillon — les questions sont diffusées individuellement via le calendrier Lundi Légi.',
    targetAudience: 'Étudiants en pharmacie et pharmaciens',
    status: 'draft',
    color: 'violet',
    icon: 'academic-scales-legal',
    competencies,
    modules: [],
    tags: ['lundi-legi', 'editorial', 'legislation', 'deontologie'],
    sourceIds: [],
    directQuestionIds,
    accessTier: 'free',
    organizationId: null,
    featured: false,
    featuredStartDate: null,
    featuredEndDate: null,
    editorialOnly: true,
    lundiLegiParcours: true,
    questionCount: directQuestionIds.length,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // 7. Affichage
  console.log('\n3. Parcours à créer :');
  console.log(`   ID        : ${parcoursId}`);
  console.log(`   Titre     : ${parcoursDoc.name}`);
  console.log(`   Statut    : ${parcoursDoc.status} (jamais publié)`);
  console.log(`   Questions : ${directQuestionIds.length}`);
  console.log(`   Compétences (${competencies.length}) :`);
  competencies.forEach(c => {
    const linked = c.competencyId ? `→ ${c.competencyId}` : '⚠ non liée';
    console.log(`     - ${c.name} (${c.questionIds.length}q) ${linked}`);
  });

  if (DRY_RUN) {
    console.log('\n⚠ DRY-RUN : relancez sans --dry-run pour écrire dans Firestore.');
    process.exit(0);
  }

  // 8. Écriture
  console.log('\n4. Écriture dans Firestore...');
  await db.collection('parcours').doc(parcoursId).set(parcoursDoc);
  console.log(`   ✅ Parcours créé : ${parcoursId}`);
  console.log('\n✅ Parcours Lundi Légi (draft) créé avec', directQuestionIds.length, 'questions.');
  console.log('→ Visible dans admin/parcours.html, jamais dans l\'app utilisateur.');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
