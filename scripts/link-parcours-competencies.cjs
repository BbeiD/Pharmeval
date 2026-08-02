/**
 * link-parcours-competencies.cjs — Pharmeval
 *
 * Pour chaque parcours d'entraînement libre (editorialOnly absent),
 * résout le competencyId (SKILL-*) de chaque compétence embarquée
 * en croisant les noms avec la collection `competencies` de Firestore.
 *
 * Sans ce lien, l'admin affiche le double des compétences réelles car
 * resolveDerivedCompetenciesFromPool() ne peut pas dédupliquer
 * (competencyId: null bloque le filtre Set).
 *
 * Usage :
 *   node scripts/link-parcours-competencies.cjs <service-account.json>
 *   node scripts/link-parcours-competencies.cjs <service-account.json> --dry-run
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!keyPath) {
  console.error('Usage: node scripts/link-parcours-competencies.cjs <service-account.json> [--dry-run]');
  process.exit(1);
}

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

function normalizeCompetencyKey(label) {
  return (label || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

async function main() {
  console.log('=== LIAISON COMPÉTENCES PARCOURS → SKILL-* ===');
  if (DRY_RUN) console.log('⚠ Mode DRY-RUN : aucune écriture\n');
  else console.log('');

  // 1. Charger tous les SKILL-* depuis la collection competencies
  console.log('1. Chargement de la banque de compétences (SKILL-*)...');
  const compSnap = await db.collection('competencies').get();

  // Map par nom normalisé → { id, name }
  const skillByKey = new Map();
  const skillByName = new Map(); // exact match fallback
  for (const doc of compSnap.docs) {
    const data = doc.data();
    const name = data.name || data.label || '';
    if (!name) continue;
    const key = normalizeCompetencyKey(name);
    skillByKey.set(key, { id: doc.id, name: name });
    skillByName.set(name.trim(), { id: doc.id, name: name });
  }
  console.log(`   → ${compSnap.size} compétences SKILL-* chargées\n`);

  // 2. Charger les 65 parcours d'entraînement libre
  console.log('2. Chargement des parcours entraînement libre...');
  const parcSnap = await db.collection('parcours').get();
  const trainingParcours = parcSnap.docs.filter(d => {
    const data = d.data();
    return data.accessTier === 'free' &&
           Array.isArray(data.competencies) &&
           data.competencies.length > 0 &&
           data.competencies.some(c => c.competencyId === null || c.competencyId === undefined);
  });
  console.log(`   → ${trainingParcours.length} parcours avec des compétences à lier\n`);

  // 3. Pour chaque parcours, résoudre les competencyId
  console.log('3. Liaison des compétences...\n');

  let updated = 0, skipped = 0, notFound = 0;
  const notFoundNames = new Set();

  for (const doc of trainingParcours) {
    const data = doc.data();
    const competencies = data.competencies || [];
    let changed = false;

    const newCompetencies = competencies.map(c => {
      if (c.competencyId) return c; // déjà lié
      const key = normalizeCompetencyKey(c.name);
      const match = skillByKey.get(key) || skillByName.get(c.name);
      if (match) {
        changed = true;
        return { ...c, competencyId: match.id };
      } else {
        notFoundNames.add(c.name);
        notFound++;
        return c;
      }
    });

    if (!changed) { skipped++; continue; }

    if (!DRY_RUN) {
      await db.collection('parcours').doc(doc.id).update({ competencies: newCompetencies });
    }
    updated++;
    process.stdout.write(`\r  ${DRY_RUN ? '[DRY] ' : ''}Mis à jour : ${updated}...`);
  }

  console.log(`\n\n=== RÉSUMÉ ===`);
  console.log(`  Parcours mis à jour   : ${updated}`);
  console.log(`  Déjà liés (ignorés)   : ${skipped}`);
  if (notFoundNames.size > 0) {
    console.log(`  Noms sans SKILL-* (${notFoundNames.size}) :`);
    [...notFoundNames].forEach(n => console.log('    -', n));
  }

  if (DRY_RUN) {
    console.log('\n⚠ DRY-RUN : relancez sans --dry-run pour appliquer.');
  } else {
    console.log('\n✅ Liaison terminée :', new Date().toISOString());
    console.log('→ Recharge la page admin/parcours pour voir les vrais compteurs.');
  }

  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
