/**
 * Remplace la "Compétence générale" non liée des 34 parcours ALAUNE
 * par des compétences correctement liées à la banque de compétences,
 * en regroupant les questions selon leur competencyId.
 * Usage : node scripts/_tmp_fix_alaune_competencies.cjs <service-account.json>
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const crypto = require('crypto');

const keyPath = process.argv[2];
initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

function compId() {
  return 'COMP-' + crypto.randomBytes(4).toString('hex');
}

async function main() {
  // 1. Récupérer les noms de compétences depuis les parcours d'entraînement bien liés
  const trainSnap = await db.collection('parcours')
    .where('status', '==', 'published').get();

  const skillNames = {};
  trainSnap.docs.forEach(d => {
    (d.data().competencies || []).forEach(c => {
      if (c.competencyId && c.name && !skillNames[c.competencyId]) {
        skillNames[c.competencyId] = c.name;
      }
    });
  });
  console.log('Skills trouvés dans la banque:', Object.keys(skillNames).length);
  Object.entries(skillNames).forEach(([k, v]) => console.log(' ', k, '->', v));

  // 2. Trouver les 34 parcours ALAUNE avec compétences non liées
  const alauneSnap = await db.collection('parcours')
    .where('status', '==', 'published')
    .where('editorialOnly', '==', true).get();

  const toFix = alauneSnap.docs.filter(d => {
    const comps = d.data().competencies || [];
    return comps.some(c => !c.competencyId || c.competencyId === '');
  });
  console.log('\nParcours ALAUNE à corriger:', toFix.length);

  // 3. Pour chaque parcours, regrouper les questions par competencyId
  let updated = 0;
  for (const pDoc of toFix) {
    const pData = pDoc.data();
    const qIds = pData.directQuestionIds || [];

    // Récupérer les questions
    const qMap = {}; // competencyId -> [questionId]
    for (const qId of qIds) {
      const qDoc = await db.collection('questions').doc(qId).get();
      if (!qDoc.exists) continue;
      const skillId = qDoc.data().competencyId || '__none__';
      if (!qMap[skillId]) qMap[skillId] = [];
      qMap[skillId].push(qId);
    }

    // Construire le nouveau tableau de compétences
    const newComps = [];
    let order = 0;
    for (const [skillId, ids] of Object.entries(qMap)) {
      if (skillId === '__none__') {
        // Questions sans compétence → garder comme "Compétence générale" mais on tente quand même
        newComps.push({
          id: compId(),
          name: 'Compétence générale',
          description: '',
          order: order++,
          questionIds: ids,
          competencyId: '',
        });
      } else {
        newComps.push({
          id: compId(),
          name: skillNames[skillId] || skillId,
          description: '',
          order: order++,
          questionIds: ids,
          competencyId: skillId,
        });
      }
    }

    // Trier par nombre de questions décroissant pour mettre les plus grosses en premier
    newComps.sort((a, b) => b.questionIds.length - a.questionIds.length);
    newComps.forEach((c, i) => { c.order = i; });

    await db.collection('parcours').doc(pDoc.id).update({ competencies: newComps });
    const names = newComps.map(c => c.name + '(' + c.questionIds.length + ')').join(', ');
    console.log('✅', pData.name, '->', names);
    updated++;
  }

  console.log('\n✅ Terminé —', updated, 'parcours mis à jour.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
