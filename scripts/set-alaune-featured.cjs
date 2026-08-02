/**
 * set-alaune-featured.cjs — Pharmeval
 *
 * Marque tous les parcours ALAUNE comme featured:true ET leur ajoute
 * alauneId + editorialOnly:true + tags pour une identification future.
 *
 * Identification des parcours ALAUNE : un parcours est ALAUNE si au moins
 * un de ses directQuestionIds appartient à une question editorialOnly=true.
 * (Les 65 parcours d'entraînement libre n'ont que des questions editorialOnly=false.)
 *
 * Le parcours Lundi Légi (lundiLegiParcours:true) est exclu.
 *
 * Usage :
 *   node scripts/set-alaune-featured.cjs <service-account.json>
 *   node scripts/set-alaune-featured.cjs <service-account.json> --dry-run
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!keyPath) {
  console.error('Usage: node scripts/set-alaune-featured.cjs <service-account.json> [--dry-run]');
  process.exit(1);
}

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

// Mapping titre → alauneId (source de vérité : create-alaune-parcours.cjs)
const TITRE_TO_ALAUNE_ID = {
  'Les réflexes essentiels au comptoir':               'ALAUNE-01',
  'Sécuriser la délivrance':                           'ALAUNE-02',
  'Médicaments et troubles cognitifs':                 'ALAUNE-03',
  'Contraception : interactions et sécurité':          'ALAUNE-04',
  "Antibiotiques : recommandations BAPCOC et délivrance à l'unité": 'ALAUNE-05',
  'Cancer du sein : traitement et accompagnement':     'ALAUNE-05B',
  'Psychotropes au comptoir':                          'ALAUNE-06',
  'Grippe : vacciner et conseiller':                   'ALAUNE-07',
  'Diabète : traitements et vigilance':                'ALAUNE-08',
  'Santé masculine : prostate, HBP et dysfonction érectile': 'ALAUNE-09',
  "Antibiotiques : le bon choix, au bon moment":       'ALAUNE-10',
  'BPCO et inhalateurs':                               'ALAUNE-11',
  'VIH : interactions et accompagnement':              'ALAUNE-12',
  'Alcool, digestion et interactions':                 'ALAUNE-13',
  'Alcool : risques, interactions et sevrage':         'ALAUNE-14',
  'Poids, nutrition et médicaments':                   'ALAUNE-15',
  'Médicaments anticancéreux : vigilance officinale':  'ALAUNE-16',
  'Santé sexuelle sans tabou':                         'ALAUNE-17',
  'Douleur chronique et médicaments':                  'ALAUNE-18',
  'Cardiovasculaire : traitements avancés':            'ALAUNE-19',
  'Cancer colorectal : dépistage et symptômes':        'ALAUNE-20',
  'Tuberculose : traitement et interactions':           'ALAUNE-21',
  'La preuve au service du patient':                   'ALAUNE-22',
  'Parkinson : traitements et pièges':                 'ALAUNE-23',
  'Vaccination : vrai, faux, pratique':                'ALAUNE-24',
  'Asthme : inhalateurs et contrôle':                  'ALAUNE-25',
  'Hypertension : efficacité et sécurité':             'ALAUNE-26',
  'Sevrage tabagique au comptoir':                     'ALAUNE-27',
  'Sang, fer et anticoagulants':                       'ALAUNE-28',
  'Soleil, chaleur et médicaments':                    'ALAUNE-29',
  'Pharmacie du voyageur':                             'ALAUNE-30',
  'Foie et médicaments':                               'ALAUNE-31',
  'Allaitement et médicaments':                        'ALAUNE-32',
  'Pédiatrie pratique de rentrée':                     'ALAUNE-33',
};

async function main() {
  console.log('=== SET FEATURED — PARCOURS ALAUNE ===');
  if (DRY_RUN) console.log('⚠ Mode DRY-RUN : aucune écriture\n');
  else console.log('');

  // 1. Collecter les IDs des questions éditoriales (editorialOnly=true)
  console.log('1. Chargement des questions éditoriales...');
  const qSnap = await db.collection('questions').where('editorialOnly', '==', true).get();
  const editorialIds = new Set(qSnap.docs.map(d => d.id));
  console.log(`   → ${editorialIds.size} questions éditoriales\n`);

  // 2. Charger tous les parcours
  console.log('2. Chargement des parcours...');
  const pSnap = await db.collection('parcours').get();
  console.log(`   → ${pSnap.size} parcours au total\n`);

  // 3. Identifier les parcours ALAUNE
  const alaune = [];
  for (const doc of pSnap.docs) {
    const data = doc.data();

    // Exclure Lundi Légi
    if (data.lundiLegiParcours) continue;

    // Déjà identifié comme ALAUNE
    if (data.alauneId) {
      alaune.push({ doc, data, alauneId: data.alauneId });
      continue;
    }

    // Identifier par intersection directQuestionIds ∩ questions éditoriales
    const ids = data.directQuestionIds || [];
    const isAlaune = ids.some(id => editorialIds.has(id));
    if (isAlaune) {
      const alauneId = TITRE_TO_ALAUNE_ID[data.name] || null;
      alaune.push({ doc, data, alauneId });
    }
  }

  console.log(`3. Parcours ALAUNE identifiés : ${alaune.length}`);
  const unrecognized = alaune.filter(p => !p.alauneId);
  if (unrecognized.length > 0) {
    console.log(`   ⚠ ${unrecognized.length} parcours sans alauneId reconnu :`);
    unrecognized.forEach(p => console.log(`     - "${p.data.name}" (${p.doc.id})`));
  }

  const toUpdate = alaune.filter(p => !p.data.featured || !p.data.alauneId);
  console.log(`   À mettre à jour : ${toUpdate.length}\n`);

  toUpdate.forEach(p => {
    console.log(`  ${(p.alauneId || '???').padEnd(10)} featured:${p.data.featured} alauneId:${p.data.alauneId || 'absent'}  — ${p.data.name}`);
  });

  if (toUpdate.length === 0) {
    console.log('✅ Tous les parcours ALAUNE sont déjà à jour.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log('\n⚠ DRY-RUN : relancez sans --dry-run pour appliquer.');
    process.exit(0);
  }

  // 4. Mise à jour
  console.log('\n4. Mise à jour Firestore...');
  let updated = 0;
  for (const p of toUpdate) {
    const update = {
      featured: true,
      featuredStartDate: null,
      featuredEndDate: null,
      editorialOnly: true,
      tags: ['alaune', 'editorial'],
      updatedAt: new Date(),
    };
    if (p.alauneId) update.alauneId = p.alauneId;
    await db.collection('parcours').doc(p.doc.id).update(update);
    updated++;
    process.stdout.write(`\r   Mis à jour : ${updated}/${toUpdate.length}...`);
  }

  console.log('\n');
  console.log(`✅ ${updated} parcours ALAUNE marqués featured:true + alauneId + editorialOnly:true`);
  console.log('→ Recharge la page d\'accueil pour voir la section "À la une".');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
