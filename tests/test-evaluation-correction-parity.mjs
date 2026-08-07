// ===================== PARITE CLIENT/SERVEUR — MOTEUR DE CORRECTION =====================
// functions/lib/evaluation-correction-service.js est une copie manuelle de
// js/services/evaluation-correction-service.js (voir en-tete de ce fichier
// serveur : "IMPORTANT : garder cette copie manuellement synchronisee").
// Une copie manuelle qui diverge silencieusement est exactement le genre
// de bug qui a cause l'incident FTM (voir MEMORY, feedback_no_escalation_
// without_verification) - ce test compare les DEUX implementations sur un
// jeu de sessions representatives et echoue des que leurs resultats
// different, AVANT qu'un deploiement ne fige la divergence en production.
//
// A relancer manuellement (`node tests/test-evaluation-correction-parity.mjs`)
// apres toute modification de l'un OU l'autre fichier - aucun CI ne
// l'execute automatiquement a ce jour (voir package.json, aucun script
// "test" defini pour ce projet).

import { createRequire } from 'module';
import { correctEvaluationSession as correctClient } from '../docs/js/services/evaluation-correction-service.js';

const require = createRequire(import.meta.url);
const { correctEvaluationSession: correctServer } = require('../functions/lib/evaluation-correction-service.js');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}

// Retire les champs horodates (createdAt, events[].at) - TOUJOURS
// differents entre deux appels (Date.now()), jamais une divergence de
// logique. Tout le reste doit etre rigoureusement identique.
function stripTimestamps(result) {
  const copy = JSON.parse(JSON.stringify(result));
  delete copy.createdAt;
  if (Array.isArray(copy.events)) copy.events.forEach(function(e) { delete e.at; });
  return copy;
}

function snapshot(pedagogicalId, answers, correctAnswer) {
  return { pedagogicalId: pedagogicalId, version: 1, questionType: 'qcm', question: 'Q ' + pedagogicalId, answers: answers, correctAnswer: correctAnswer, points: null };
}

function session(overrides) {
  return Object.assign({
    id: 'EVALSESS-parity-test',
    userId: 'uid-test',
    organizationId: null,
    parcoursId: 'PARC-test',
    dailyChallengeDate: null,
    competencyId: 'COMP-test',
    questionIds: [],
    questionSnapshot: {},
    answers: {},
  }, overrides || {});
}

const cases = [
  {
    label: 'Toutes reponses correctes (3/3)',
    session: session({
      questionIds: ['Q1', 'Q2', 'Q3'],
      questionSnapshot: { Q1: snapshot('Q1', ['a', 'b'], 0), Q2: snapshot('Q2', ['a', 'b'], 1), Q3: snapshot('Q3', ['a', 'b', 'c'], 2) },
      answers: { Q1: { value: 0, answeredAt: 't' }, Q2: { value: 1, answeredAt: 't' }, Q3: { value: 2, answeredAt: 't' } },
    }),
  },
  {
    label: 'Melange correct/incorrect/non-repondu',
    session: session({
      questionIds: ['Q1', 'Q2', 'Q3', 'Q4'],
      questionSnapshot: {
        Q1: snapshot('Q1', ['a', 'b'], 0), Q2: snapshot('Q2', ['a', 'b'], 1),
        Q3: snapshot('Q3', ['a', 'b'], 0), Q4: snapshot('Q4', ['a', 'b'], 1),
      },
      answers: { Q1: { value: 0, answeredAt: 't' }, Q2: { value: 0, answeredAt: 't' } }, // Q3/Q4 jamais repondues
    }),
  },
  {
    label: 'Toutes incorrectes (0/2)',
    session: session({
      questionIds: ['Q1', 'Q2'],
      questionSnapshot: { Q1: snapshot('Q1', ['a', 'b'], 0), Q2: snapshot('Q2', ['a', 'b'], 1) },
      answers: { Q1: { value: 1, answeredAt: 't' }, Q2: { value: 0, answeredAt: 't' } },
    }),
  },
  {
    label: 'Exactement au seuil "a renforcer" (50%, 1/2)',
    session: session({
      questionIds: ['Q1', 'Q2'],
      questionSnapshot: { Q1: snapshot('Q1', ['a', 'b'], 0), Q2: snapshot('Q2', ['a', 'b'], 0) },
      answers: { Q1: { value: 0, answeredAt: 't' }, Q2: { value: 1, answeredAt: 't' } },
    }),
  },
  {
    label: 'Question unique, non repondue (0/1, denominateur inclut les non-repondues)',
    session: session({
      questionIds: ['Q1'],
      questionSnapshot: { Q1: snapshot('Q1', ['a', 'b'], 0) },
      answers: {},
    }),
  },
  {
    label: 'Aucune question (edge case, denominateur=0)',
    session: session({ questionIds: [], questionSnapshot: {}, answers: {} }),
  },
  {
    label: 'Session de parcours mixte (competencyId absent, entrainement libre)',
    session: session({
      competencyId: null,
      questionIds: ['Q1', 'Q2'],
      questionSnapshot: { Q1: snapshot('Q1', ['a', 'b'], 0), Q2: snapshot('Q2', ['a', 'b'], 0) },
      answers: { Q1: { value: 0, answeredAt: 't' }, Q2: { value: 1, answeredAt: 't' } },
    }),
  },
  {
    label: 'Defi du jour (dailyChallengeDate renseigne)',
    session: session({
      dailyChallengeDate: '2026-08-10',
      questionIds: ['Q1'],
      questionSnapshot: { Q1: snapshot('Q1', ['a', 'b'], 1) },
      answers: { Q1: { value: 1, answeredAt: 't' } },
    }),
  },
];

console.log('=== Parite client/serveur du moteur de correction ===');
for (const c of cases) {
  const client = stripTimestamps(correctClient(c.session));
  const server = stripTimestamps(correctServer(c.session));
  check(c.label, JSON.stringify(client) === JSON.stringify(server), { client, server });
}

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
