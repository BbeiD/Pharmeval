/**
 * create-parcours.cjs — Pharmeval
 *
 * Crée 65 documents parcours dans Firestore à partir de :
 *   - Pharmeval_975_questions_65_parcours_IMPORT_FINAL.csv  (source vérité)
 *   - Questions déjà importées dans Firestore (LEGACY-PARC_* → PHARM-*)
 *
 * Usage :
 *   node scripts/create-parcours.cjs <chemin-service-account.json>
 *   node scripts/create-parcours.cjs <service-account.json> --dry-run
 *
 * Chaque parcours est créé en statut 'published', accessTier 'free',
 * avec ses compétences regroupées par competence_principale du CSV.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const keyPath = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!keyPath) {
  console.error('Usage: node scripts/create-parcours.cjs <service-account.json> [--dry-run]');
  process.exit(1);
}

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

const CSV_PATH = 'C:\\Users\\beida\\Downloads\\Pharmeval_975_questions_65_parcours_IMPORT_FINAL.csv';

// ── ID generators (même format que parcours-metadata-service.js) ─────────────
function randomHex8() { return crypto.randomBytes(4).toString('hex'); }
function generateParcoursId() { return 'PARC-' + randomHex8(); }
function generateCompetencyId() { return 'COMP-' + randomHex8(); }

// ── Mapping domaine → banque LEGACY (identique à generate-combined-catalog-sync.cjs) ──
const DOMAIN_TO_BANK = {
  conseil:    'PARC_CONSEIL',
  medicaments:'PARC_MED',
  bapcoc:     'PARC_BAP',
  bppo:       'PARC_BPP',
  deon:       'PARC_DEO',
  ftm:        'PARC_FTM',
};

// ── Couleur par domaine principal ─────────────────────────────────────────────
const COLOR_BY_DOMAIN = {
  medicaments: 'bleu',
  conseil:     'vert',
  bapcoc:      'orange',
  bppo:        'violet',
  deon:        'rouge',
  ftm:         'gris',
};

// ── Normalisation sous-thème (identique à generate-combined-catalog-sync.cjs) ─
function normSub(s) {
  return (s || 'general').toLowerCase().trim()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'general';
}

// ── Nom lisible depuis parcours_id ────────────────────────────────────────────
// PARC-ADDICTIONS-ALCOOL-ET-TABAC → "Addictions Alcool et Tabac"
const LOWER_WORDS = new Set(['et', 'de', 'du', 'des', 'la', 'le', 'les', 'au', 'aux', 'en', 'ou']);
function nameFromParcoursId(pid) {
  return pid.replace(/^PARC-/, '').split('-').map((part, i) => {
    const low = part.toLowerCase();
    return (i > 0 && LOWER_WORDS.has(low)) ? low : low.charAt(0).toUpperCase() + low.slice(1);
  }).join(' ');
}

// ── CSV parser (robuste : gère les champs multi-lignes entre guillemets) ──────
function parseCSV(text) {
  const rows = [];
  let col = '', curRow = [], inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], nx = text[i + 1];
    if (inQuote) {
      if (c === '"' && nx === '"') { col += '"'; i++; }
      else if (c === '"') inQuote = false;
      else col += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { curRow.push(col); col = ''; }
      else if (c === '\n' || (c === '\r' && nx === '\n')) {
        if (c === '\r') i++;
        curRow.push(col); col = '';
        if (curRow.some(f => f !== '')) rows.push(curRow);
        curRow = [];
      } else col += c;
    }
  }
  if (col || curRow.length) { curRow.push(col); if (curRow.some(f => f !== '')) rows.push(curRow); }
  return rows;
}

function readCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(raw);
  const hdrs = rows[0].map(h => h.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map(r => {
    const o = {};
    hdrs.forEach((h, i) => o[h] = (r[i] || '').trim());
    return o;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== CRÉATION 65 PARCOURS PHARMEVAL ===');
  if (DRY_RUN) console.log('⚠ Mode DRY-RUN : aucune écriture Firestore\n');
  else console.log('');

  // 1. Lire CSV + reconstruire les LEGACY IDs (même logique que l'Excel)
  console.log('1. Lecture CSV et reconstruction des LEGACY IDs...');
  const csvRows = readCSV(CSV_PATH);

  const counters = {};
  // parcoursGroups[parcours_id] = { questions: [{legacyId, competence, type, domain}], domains: {} }
  const parcoursGroups = {};

  for (const r of csvRows) {
    const domain = (r['domain'] || '').trim();
    const sub    = normSub(r['subtheme']);
    const bank   = DOMAIN_TO_BANK[domain];
    if (!bank) { console.warn('  ⚠ Domaine inconnu ignoré :', domain); continue; }

    const key = bank + '|' + sub;
    counters[key] = (counters[key] || 0) + 1;
    const legacyId = `LEGACY-${bank}-${sub}-${String(counters[key]).padStart(3, '0')}`;

    const parcoursId = r['parcours_id'];
    if (!parcoursGroups[parcoursId]) parcoursGroups[parcoursId] = { questions: [], domainCounts: {} };
    parcoursGroups[parcoursId].questions.push({ legacyId, competence: r['competence_principale'], type: r['type_question'], domain });
    parcoursGroups[parcoursId].domainCounts[domain] = (parcoursGroups[parcoursId].domainCounts[domain] || 0) + 1;
  }

  const parcoursKeys = Object.keys(parcoursGroups).sort();
  console.log(`   → ${csvRows.length} questions, ${parcoursKeys.length} parcours identifiés\n`);

  // 2. Récupérer toutes les questions PARC_* depuis Firestore
  console.log('2. Récupération questions Firestore (editorialOnly=false)...');
  const snap = await db.collection('questions').where('editorialOnly', '==', false).get();
  console.log(`   → ${snap.size} questions non-éditoriales`);

  // Map: legacyId → Firestore docId (PHARM-*)
  // Le LEGACY ID est stocké dans externalIds.editorialCatalog (canonical-question-factory.js)
  const legacyToPharm = {};
  let parcMapped = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const legId = data.externalIds && data.externalIds.editorialCatalog;
    if (legId && legId.startsWith('LEGACY-PARC_')) {
      legacyToPharm[legId] = doc.id;
      parcMapped++;
    }
  }
  console.log(`   → ${parcMapped} questions PARC_* mappées (sur ${csvRows.length} attendues)\n`);

  if (parcMapped < csvRows.length) {
    console.warn(`  ⚠ ${csvRows.length - parcMapped} questions LEGACY-PARC_* non trouvées dans Firestore.`);
    console.warn('  → Assurez-vous que l\'import catalog-sync a bien été fait avant ce script.\n');
  }

  // 3. Créer les 65 documents parcours
  console.log('3. Création des parcours...\n');

  let created = 0, warnings = 0;
  const report = [];

  for (const parcoursId of parcoursKeys) {
    const group = parcoursGroups[parcoursId];

    // Résoudre LEGACY IDs → PHARM IDs
    const resolvedQuestions = [];
    const unmapped = [];
    for (const q of group.questions) {
      const pharmId = legacyToPharm[q.legacyId];
      if (pharmId) resolvedQuestions.push({ ...q, pharmId });
      else unmapped.push(q.legacyId);
    }

    if (unmapped.length > 0) {
      console.warn(`  ⚠ ${parcoursId} : ${unmapped.length} question(s) non trouvée(s)`);
      unmapped.forEach(id => console.warn('      -', id));
      warnings++;
    }

    // Déterminer la couleur (domaine le plus représenté)
    const primaryDomain = Object.entries(group.domainCounts).sort((a, b) => b[1] - a[1])[0][0];
    const color = COLOR_BY_DOMAIN[primaryDomain] || 'gris';

    // Regrouper par competence_principale → competencies[]
    const compOrder = [];
    const compMap = {};
    for (const q of resolvedQuestions) {
      if (!compMap[q.competence]) { compMap[q.competence] = []; compOrder.push(q.competence); }
      compMap[q.competence].push(q.pharmId);
    }
    const competencies = compOrder.map((compName, idx) => ({
      id: generateCompetencyId(),
      name: compName,
      description: '',
      order: idx,
      questionIds: compMap[compName],
      competencyId: null,
    }));

    const allPharmIds = resolvedQuestions.map(q => q.pharmId);
    const name = nameFromParcoursId(parcoursId);
    const docId = generateParcoursId();

    const parcoursDoc = {
      id: docId,
      name: name,
      description: '',
      targetAudience: '',
      status: 'published',
      createdAt: null,
      updatedAt: null,
      author: null,
      color: color,
      icon: 'content-formation-diploma',
      competencies: competencies,
      modules: [],
      tags: [],
      sourceIds: [],
      directQuestionIds: allPharmIds,
      accessTier: 'free',
      organizationId: null,
      featured: false,
      featuredStartDate: null,
      featuredEndDate: null,
    };

    report.push({
      parcoursId,
      docId,
      name,
      color,
      questions: allPharmIds.length,
      competencies: competencies.length,
      unmapped: unmapped.length,
    });

    if (!DRY_RUN) {
      await db.collection('parcours').doc(docId).set(parcoursDoc);
    }
    created++;
    process.stdout.write(`\r  ${DRY_RUN ? '[DRY] ' : ''}Créés : ${created}/${parcoursKeys.length}...`);
  }

  // Résumé
  console.log(`\n\n=== RÉSUMÉ ===`);
  console.log(`  Parcours créés   : ${created}`);
  console.log(`  Avec avertissements : ${warnings}`);
  console.log('');
  report.forEach(r => {
    const warn = r.unmapped > 0 ? ` ⚠ ${r.unmapped} q manquantes` : '';
    console.log(`  ${r.docId}  ${r.name.padEnd(50)} [${r.questions}q, ${r.competencies} comp, ${r.color}]${warn}`);
  });

  if (DRY_RUN) {
    console.log('\n⚠ DRY-RUN : aucun document écrit. Relancez sans --dry-run pour créer.');
  } else {
    console.log('\n✅ Parcours créés :', new Date().toISOString());
    console.log('→ Ouvre la console Firebase pour vérifier la collection "parcours".');
  }

  process.exit(0);
}

main().catch(e => { console.error('\n❌ ERREUR :', e); process.exit(1); });
