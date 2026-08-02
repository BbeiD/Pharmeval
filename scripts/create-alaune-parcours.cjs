/**
 * create-alaune-parcours.cjs — Pharmeval
 *
 * Crée les 33 parcours "À la une" dans Firestore, en reconstituant chaque
 * groupe de 15 questions depuis les questions éditorialOnly=true déjà
 * importées (ALAUNE_BAPCOC, ALAUNE_CONSEIL, ALAUNE_MEDICAMENTS, BPPO_QDB,
 * GAL_QDB).
 *
 * Le mapping parcours → sous-thèmes est issu de :
 *   Pharmeval_A_la_Une_33_publications_LinkedIn_comparatif.xlsx
 * et de l'analyse des LEGACY IDs en Firestore.
 *
 * Usage :
 *   node scripts/create-alaune-parcours.cjs <service-account.json>
 *   node scripts/create-alaune-parcours.cjs <service-account.json> --dry-run
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const crypto = require('crypto');

const keyPath = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!keyPath) {
  console.error('Usage: node scripts/create-alaune-parcours.cjs <service-account.json> [--dry-run]');
  process.exit(1);
}

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

function randomHex8() { return crypto.randomBytes(4).toString('hex'); }
function generateParcoursId() { return 'PARC-' + randomHex8(); }
function generateCompetencyId() { return 'COMP-' + randomHex8(); }

// ── Définition des 33 parcours ALAUNE ─────────────────────────────────────────
// Chaque `groups` liste les (bank, sub-thème, nombre max de questions à prendre).
// count: null = prendre toutes les questions de ce groupe.
// count: N = prendre les N premières (triées par position LEGACY ID).
const ALAUNE_PARCOURS = [
  {
    alauneId: 'ALAUNE-01',
    titre: 'Les réflexes essentiels au comptoir',
    color: 'bleu',
    groups: [{ bank: 'ALAUNE_MEDICAMENTS', sub: 'reflexes_comptoir', count: null }],
  },
  {
    alauneId: 'ALAUNE-02',
    titre: 'Sécuriser la délivrance',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'securite_delivrance', count: null },
      { bank: 'BPPO_QDB',           sub: 'bppo_stock',          count: null },
      { bank: 'GAL_QDB',            sub: 'ftm_etiquetage',       count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-03',
    titre: 'Médicaments et troubles cognitifs',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'troubles_cognitifs', count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'troubles_cognitifs', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-04',
    titre: 'Contraception : interactions et sécurité',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'contraception',         count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'contraception_urgence', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-05',
    titre: 'Antibiotiques : recommandations BAPCOC et délivrance à l\'unité',
    color: 'orange',
    groups: [
      { bank: 'ALAUNE_BAPCOC',      sub: 'antibiotiques_unite', count: null },
      { bank: 'ALAUNE_BAPCOC',      sub: 'bapcoc_principes',    count: null },
      { bank: 'ALAUNE_BAPCOC',      sub: 'bapcoc_gastro',       count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'bapcoc_clinique',     count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-05B',
    titre: 'Cancer du sein : traitement et accompagnement',
    color: 'bleu',
    groups: [{ bank: 'ALAUNE_MEDICAMENTS', sub: 'cancer_sein', count: null }],
  },
  {
    alauneId: 'ALAUNE-06',
    titre: 'Psychotropes au comptoir',
    color: 'bleu',
    groups: [{ bank: 'ALAUNE_MEDICAMENTS', sub: 'psychotropes', count: null }],
  },
  {
    alauneId: 'ALAUNE-07',
    titre: 'Grippe : vacciner et conseiller',
    color: 'vert',
    groups: [
      { bank: 'ALAUNE_CONSEIL',     sub: 'grippe', count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'grippe', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-08',
    titre: 'Diabète : traitements et vigilance',
    color: 'bleu',
    groups: [{ bank: 'ALAUNE_MEDICAMENTS', sub: 'diabete', count: null }],
  },
  {
    alauneId: 'ALAUNE-09',
    titre: 'Santé masculine : prostate, HBP et dysfonction érectile',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'sante_masculine', count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'sante_masculine', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-10',
    titre: 'Antibiotiques : le bon choix, au bon moment',
    color: 'orange',
    groups: [
      { bank: 'ALAUNE_BAPCOC', sub: 'bapcoc_peau',  count: null },
      { bank: 'ALAUNE_BAPCOC', sub: 'bapcoc_respi', count: null },
      { bank: 'ALAUNE_BAPCOC', sub: 'bapcoc_uro',   count: null },
      { bank: 'ALAUNE_BAPCOC', sub: 'bapcoc_dental', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-11',
    titre: 'BPCO et inhalateurs',
    color: 'vert',
    groups: [
      { bank: 'ALAUNE_CONSEIL',     sub: 'bpco',              count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'bpco',              count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'bpco_sante_publique', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-12',
    titre: 'VIH : interactions et accompagnement',
    color: 'vert',
    groups: [
      { bank: 'ALAUNE_CONSEIL',     sub: 'vih', count: null }, // 13 questions
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'vih', count: 2    }, // 2 des 4 MED
    ],
  },
  {
    alauneId: 'ALAUNE-13',
    titre: 'Alcool, digestion et interactions',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_CONSEIL',     sub: 'alcool_digestion',    count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'alcool_interactions', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-14',
    titre: 'Alcool : risques, interactions et sevrage',
    color: 'vert',
    groups: [
      { bank: 'ALAUNE_CONSEIL',     sub: 'alcool_sevrage', count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'alcool_sevrage', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-15',
    titre: 'Poids, nutrition et médicaments',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'poids_nutrition', count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'poids_nutrition', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-16',
    titre: 'Médicaments anticancéreux : vigilance officinale',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'anticancereux',           count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'anticancereux_vigilance', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-17',
    titre: 'Santé sexuelle sans tabou',
    color: 'vert',
    groups: [
      { bank: 'ALAUNE_CONSEIL',     sub: 'sante_sexuelle',        count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'sante_sexuelle',        count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'contraception_oubli',   count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'contraception_securite', count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'vih',                   count: 2, offset: 2 }, // 2 derniers MED vih
    ],
  },
  {
    alauneId: 'ALAUNE-18',
    titre: 'Obésité : accompagner sans simplifier',
    color: 'vert',
    groups: [{ bank: 'ALAUNE_CONSEIL', sub: 'obesite_prise_en_charge', count: null }],
  },
  {
    alauneId: 'ALAUNE-19',
    titre: 'Sommeil : mieux conseiller, moins dépendre',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'sommeil', count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'sommeil', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-20',
    titre: 'Cancer colorectal : dépistage et symptômes',
    color: 'vert',
    groups: [{ bank: 'ALAUNE_CONSEIL', sub: 'cancer_colorectal', count: null }],
  },
  {
    alauneId: 'ALAUNE-21',
    titre: 'Tuberculose : traitement et interactions',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'tuberculose', count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'tuberculose', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-22',
    titre: 'La preuve au service du patient',
    color: 'violet',
    groups: [{ bank: 'BPPO_QDB', sub: 'ebp', count: null }],
  },
  {
    alauneId: 'ALAUNE-23',
    titre: 'Parkinson : traitements et pièges',
    color: 'bleu',
    groups: [{ bank: 'ALAUNE_MEDICAMENTS', sub: 'parkinson', count: null }],
  },
  {
    alauneId: 'ALAUNE-24',
    titre: 'Vaccination : vrai, faux, pratique',
    color: 'vert',
    groups: [
      { bank: 'ALAUNE_CONSEIL', sub: 'vaccination', count: null },
      { bank: 'BPPO_QDB',       sub: 'vaccination', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-25',
    titre: 'Asthme : inhalateurs et contrôle',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'asthme', count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'asthme', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-26',
    titre: 'Hypertension : efficacité et sécurité',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'hypertension', count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'hypertension', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-27',
    titre: 'Sevrage tabagique au comptoir',
    color: 'vert',
    groups: [
      { bank: 'ALAUNE_CONSEIL',     sub: 'sevrage_tabagique', count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'sevrage_tabagique', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-28',
    titre: 'Sang, fer et anticoagulants',
    color: 'bleu',
    groups: [{ bank: 'ALAUNE_MEDICAMENTS', sub: 'sang_anticoagulants', count: null }],
  },
  {
    alauneId: 'ALAUNE-29',
    titre: 'Soleil, chaleur et médicaments',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'soleil_chaleur', count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'soleil_chaleur', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-31',
    titre: 'Foie et médicaments',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'foie',              count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'foie_medicaments',  count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'foie_medicaments',  count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-32',
    titre: 'Allaitement et médicaments',
    color: 'bleu',
    groups: [
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'allaitement', count: null },
      { bank: 'ALAUNE_CONSEIL',     sub: 'allaitement', count: null },
    ],
  },
  {
    alauneId: 'ALAUNE-33',
    titre: 'Pédiatrie pratique de rentrée',
    color: 'vert',
    groups: [
      { bank: 'ALAUNE_CONSEIL',     sub: 'pediatrie_rentree', count: null },
      { bank: 'ALAUNE_MEDICAMENTS', sub: 'pediatrie_rentree', count: null },
    ],
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== CRÉATION 33 PARCOURS ALAUNE ===');
  if (DRY_RUN) console.log('⚠ Mode DRY-RUN : aucune écriture\n');
  else console.log('');

  // 1. Charger toutes les questions éditoriales ALAUNE depuis Firestore
  console.log('1. Chargement questions éditoriales (editorialOnly=true)...');
  const snap = await db.collection('questions').where('editorialOnly', '==', true).get();
  console.log(`   → ${snap.size} questions`);

  // 2. Charger la banque de compétences pour lier les competencyId
  console.log('2. Chargement banque compétences SKILL-*...');
  const compSnap = await db.collection('competencies').get();
  const skillById = new Map();
  compSnap.docs.forEach(d => { skillById.set(d.id, d.data().name || d.data().label || d.id); });
  console.log(`   → ${skillById.size} compétences SKILL-*\n`);

  // 3. Indexer les questions par (bank, sub-thème, position)
  const questionIndex = new Map(); // key `BANK|sub` → [{pos, pharmId, competencyId, primaryCompLabel}]
  let unmappedCount = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const legId = data.externalIds && data.externalIds.editorialCatalog;
    if (!legId) { unmappedCount++; continue; }
    const m = legId.match(/^LEGACY-([A-Z0-9_]+)-([a-z0-9_]+)-(\d+)$/);
    if (!m) { unmappedCount++; continue; }
    const bank = m[1], sub = m[2], pos = parseInt(m[3], 10);
    const key = bank + '|' + sub;
    if (!questionIndex.has(key)) questionIndex.set(key, []);
    questionIndex.get(key).push({
      pos,
      pharmId: doc.id,
      competencyId: data.competencyId || null,
      compLabel: (data.primaryCompetency && data.primaryCompetency.label) || null,
    });
  }
  // Trier par position dans chaque groupe
  questionIndex.forEach(arr => arr.sort((a, b) => a.pos - b.pos));
  if (unmappedCount > 0) console.warn(`  ⚠ ${unmappedCount} questions sans LEGACY ID ignorées\n`);

  // 4. Créer les 33 parcours
  console.log('3. Création des parcours...\n');

  let created = 0;
  const report = [];
  const usedKeys = new Map(); // pour tracker les offsets vih

  for (const def of ALAUNE_PARCOURS) {
    // Résoudre les questions de ce parcours
    const allPharmIds = [];
    const warnings = [];

    for (const g of def.groups) {
      const key = g.bank + '|' + g.sub;
      const pool = questionIndex.get(key) || [];
      const offset = g.offset || 0;
      const slice = pool.slice(offset, g.count !== null ? offset + g.count : undefined);
      if (slice.length === 0) {
        warnings.push(`  ⚠ Aucune question pour ${key}`);
      }
      slice.forEach(q => allPharmIds.push({ pharmId: q.pharmId, competencyId: q.competencyId, compLabel: q.compLabel }));
    }

    // Grouper par compétence (competencyId ou compLabel) pour créer competencies[]
    const compOrder = [];
    const compMap = {};
    for (const q of allPharmIds) {
      const label = q.compLabel || q.competencyId || 'Compétence générale';
      if (!compMap[label]) { compMap[label] = { pharmIds: [], skillId: q.competencyId }; compOrder.push(label); }
      compMap[label].pharmIds.push(q.pharmId);
    }
    const competencies = compOrder.map((label, idx) => ({
      id: generateCompetencyId(),
      name: label,
      description: '',
      order: idx,
      questionIds: compMap[label].pharmIds,
      competencyId: compMap[label].skillId || null,
    }));

    const docId = generateParcoursId();
    const parcoursDoc = {
      id: docId,
      name: def.titre,
      description: '',
      targetAudience: '',
      status: 'published',
      createdAt: null,
      updatedAt: null,
      author: null,
      color: def.color,
      icon: 'content-formation-diploma',
      competencies: competencies,
      modules: [],
      tags: [],
      sourceIds: [],
      directQuestionIds: allPharmIds.map(q => q.pharmId),
      accessTier: 'free',
      organizationId: null,
      featured: false,
      featuredStartDate: null,
      featuredEndDate: null,
    };

    report.push({
      alauneId: def.alauneId,
      docId,
      titre: def.titre,
      qCount: allPharmIds.length,
      compCount: competencies.length,
      color: def.color,
      warnings,
    });

    if (!DRY_RUN) {
      await db.collection('parcours').doc(docId).set(parcoursDoc);
    }
    created++;
    process.stdout.write(`\r  ${DRY_RUN ? '[DRY] ' : ''}Créés : ${created}/33...`);
  }

  // Résumé
  console.log('\n\n=== RÉSUMÉ ===');
  let totalQ = 0;
  report.forEach(r => {
    const warn = r.warnings.length ? ' ⚠ ' + r.warnings.join(', ') : '';
    console.log(`  ${r.alauneId.padEnd(10)}  ${r.docId}  ${String(r.qCount).padStart(2)}q  ${String(r.compCount).padStart(2)}comp  ${r.color.padEnd(6)}  ${r.titre.slice(0,50)}${warn}`);
    totalQ += r.qCount;
  });
  console.log(`\n  Total questions liées : ${totalQ} / 495 attendues`);

  if (DRY_RUN) {
    console.log('\n⚠ DRY-RUN : relancez sans --dry-run pour créer.');
  } else {
    console.log('\n✅ Parcours ALAUNE créés :', new Date().toISOString());
  }
  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
