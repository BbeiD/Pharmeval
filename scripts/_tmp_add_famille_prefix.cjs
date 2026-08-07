/**
 * Ajoute le préfixe "Famille — " aux 33 parcours publiés sans famille.
 * Le champ `name` est mis à jour dans Firestore. Aucune autre donnée touchée.
 * Usage : node scripts/_tmp_add_famille_prefix.cjs <service-account.json>
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const keyPath = process.argv[2];
if (!keyPath) { console.error('Usage: node script.cjs <service-account.json>'); process.exit(1); }

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

const RENAMES = [
  { id: 'PARC-0da80efd', name: 'Bon usage et sécurité — Alcool : risques, interactions et sevrage' },
  { id: 'PARC-eed443e5', name: 'Gastro-entérologie — Alcool, digestion et interactions' },
  { id: 'PARC-853cf7e5', name: 'Santé de la femme — Allaitement et médicaments' },
  { id: 'PARC-1a62a13e', name: 'Maladies infectieuses — Antibiotiques : le bon choix, au bon moment' },
  { id: 'PARC-b45b7cb1', name: 'Maladies infectieuses — Antibiotiques : recommandations BAPCOC et délivrance à l\'unité' },
  { id: 'PARC-035640eb', name: 'Maladies respiratoires — Asthme : inhalateurs et contrôle' },
  { id: 'PARC-f4d2be14', name: 'Maladies respiratoires — BPCO et inhalateurs' },
  { id: 'PARC-93f80356', name: 'Oncologie — Cancer colorectal : dépistage et symptômes' },
  { id: 'PARC-2b499f41', name: 'Oncologie — Cancer du sein : traitement et accompagnement' },
  { id: 'PARC-99829b3c', name: 'Santé de la femme — Contraception : interactions et sécurité' },
  { id: 'PARC-51845d60', name: 'Endocrinologie — Diabète : traitements et vigilance' },
  { id: 'PARC-cf14b388', name: 'Gastro-entérologie — Foie et médicaments' },
  { id: 'PARC-d0a0ecb9', name: 'Maladies infectieuses — Grippe : vacciner et conseiller' },
  { id: 'PARC-8a51e8d5', name: 'Maladies cardiovasculaires — Hypertension : efficacité et sécurité' },
  { id: 'PARC-14c8fa9d', name: 'Bon usage et sécurité — La preuve au service du patient' },
  { id: 'PARC-242d66e1', name: 'Bon usage et sécurité — Les réflexes essentiels au comptoir' },
  { id: 'PARC-21003a1e', name: 'Oncologie — Médicaments anticancéreux : vigilance officinale' },
  { id: 'PARC-518cf48c', name: 'Psychiatrie et neurologie — Médicaments et troubles cognitifs' },
  { id: 'PARC-08a95548', name: 'Nutrition et métabolisme — Obésité : accompagner sans simplifier' },
  { id: 'PARC-8290ad3a', name: 'Psychiatrie et neurologie — Parkinson : traitements et pièges' },
  { id: 'PARC-47e2d2dc', name: 'Pédiatrie — Pédiatrie pratique de rentrée' },
  // PARC-f40cf133 "Pharmacie du voyageur" : nom = famille, pas de préfixe ajouté
  { id: 'PARC-da053209', name: 'Nutrition et métabolisme — Poids, nutrition et médicaments' },
  { id: 'PARC-ea3ac86c', name: 'Psychiatrie et neurologie — Psychotropes au comptoir' },
  { id: 'PARC-1528958b', name: 'Maladies cardiovasculaires — Sang, fer et anticoagulants' },
  { id: 'PARC-e0849d4a', name: 'Urologie et néphro — Santé masculine : prostate, HBP et dysfonction érectile' },
  { id: 'PARC-142924a5', name: 'Santé de la femme — Santé sexuelle sans tabou' },
  { id: 'PARC-b8b5e707', name: 'Bon usage et sécurité — Sécuriser la délivrance' },
  { id: 'PARC-6d6a71d0', name: 'Maladies respiratoires — Sevrage tabagique au comptoir' },
  { id: 'PARC-e7b8e5f7', name: 'Bon usage et sécurité — Soleil, chaleur et médicaments' },
  { id: 'PARC-15da76fe', name: 'Psychiatrie et neurologie — Sommeil : mieux conseiller, moins dépendre' },
  { id: 'PARC-6135d803', name: 'Maladies infectieuses — Tuberculose : traitement et interactions' },
  { id: 'PARC-fcd8e693', name: 'Maladies infectieuses — Vaccination : vrai, faux, pratique' },
  { id: 'PARC-6bd5921b', name: 'Maladies infectieuses — VIH : interactions et accompagnement' },
];

async function main() {
  console.log(`\nRenommage de ${RENAMES.length} parcours…\n`);
  let ok = 0;
  for (const { id, name } of RENAMES) {
    const ref = db.collection('parcours').doc(id);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`⚠️  ${id} introuvable — ignoré`); continue; }
    const oldName = snap.data().name;
    await ref.update({ name });
    console.log(`✅ ${id}`);
    console.log(`   ${oldName}`);
    console.log(`   → ${name}\n`);
    ok++;
  }
  console.log(`\n✅ Terminé — ${ok}/${RENAMES.length} parcours renommés.`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
