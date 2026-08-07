import assert from 'assert';
import { createAuthGateController } from '../admin/catalog-sync-auth-gate.js';

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

// --- Petit faux DOM minimal, suffisant pour ce controleur ---------------
function makeFakeDocument() {
  const els = {};
  ['cs-loading', 'cs-denied', 'cs-denied-message', 'cs-view'].forEach(function(id) {
    els[id] = { style: { display: '' }, textContent: '' };
  });
  return { getElementById: function(id) { return els[id] || null; }, _els: els };
}

function makeDeps(doc, options) {
  const opts = options || {};
  let historyLoadCount = 0;
  let subscribeCount = 0;
  let capturedCallback = null;

  return {
    document: doc,
    onAuthStateChanged: function(auth, cb) {
      subscribeCount++;
      capturedCallback = cb;
      return function unsubscribe() {};
    },
    auth: {},
    ensureUserDocument: async function(user) {
      if (opts.ensureUserDocumentThrows) throw new Error('panne Firestore simulée');
      return { role: opts.role || 'admin' };
    },
    setCurrentUserContext: function() {},
    clearCurrentUserContext: function() {},
    hasPermission: function() { return opts.hasPermission !== undefined ? opts.hasPermission : true; },
    PERMISSIONS: { MANAGE_QUESTIONS: 'manage_questions' },
    loadHistory: function() { historyLoadCount++; },
    _getSubscribeCount: function() { return subscribeCount; },
    _getHistoryLoadCount: function() { return historyLoadCount; },
    _fireAuthChange: function(user) { return capturedCallback(user); },
  };
}

console.log('=== SCENARIO REPRODUISANT LE SIGNALEMENT — "null transitoire" puis utilisateur réel ===');
{
  // C'est exactement le scenario a risque diagnostique : Firebase declenche
  // le callback une premiere fois avec null (session pas encore restauree),
  // PUIS une seconde fois avec le vrai utilisateur Administrateur.
  const doc = makeFakeDocument();
  const deps = makeDeps(doc, { hasPermission: true });
  const gate = createAuthGateController(deps);

  gate.init();
  check('Un seul abonnement onAuthStateChanged après init()', deps._getSubscribeCount() === 1);
  check('État initial : "loading"', gate.getState() === 'loading');
  check('#cs-loading visible au départ', doc._els['cs-loading'].style.display === 'block');

  // 1er declenchement : null (session pas encore restauree)
  await deps._fireAuthChange(null);
  check('Après le "null" transitoire : état "denied" (jamais de redirection)', gate.getState() === 'denied');
  check('#cs-denied affiché, pas de crash, pas de redirection', doc._els['cs-denied'].style.display === 'block');
  check('#cs-loading masqué (plus de blocage indéfini)', doc._els['cs-loading'].style.display === 'none');

  // 2e declenchement : le vrai utilisateur Administrateur arrive ENSUITE.
  // AVANT le correctif, ce cas ne pouvait jamais être atteint car le code
  // avait déjà exécuté window.location.href sur le premier null.
  await deps._fireAuthChange({ uid: 'admin-1', email: 'admin@pharmeval.test' });
  check('Après l\'arrivée du vrai utilisateur : état "authorized"', gate.getState() === 'authorized');
  check('#cs-view devient visible', doc._els['cs-view'].style.display === 'block');
  check('#cs-denied redevient masqué', doc._els['cs-denied'].style.display === 'none');
  check('loadHistory() appelée exactement 1 fois', deps._getHistoryLoadCount() === 1);
}

console.log('=== GARDE ANTI-DOUBLE-APPEL — init() appelé plusieurs fois ===');
{
  const doc = makeFakeDocument();
  const deps = makeDeps(doc, { hasPermission: true });
  const gate = createAuthGateController(deps);

  gate.init();
  gate.init();
  gate.init();
  check('Un seul abonnement onAuthStateChanged malgré 3 appels à init()', deps._getSubscribeCount() === 1);
  check('isInitialized() reste cohérent après plusieurs appels', gate.isInitialized() === true);
}

console.log('=== FIREBASE DECLENCHE PLUSIEURS FOIS LE MEME UTILISATEUR (rafraîchissement de jeton) ===');
{
  const doc = makeFakeDocument();
  const deps = makeDeps(doc, { hasPermission: true });
  const gate = createAuthGateController(deps);
  gate.init();

  await deps._fireAuthChange({ uid: 'admin-1' });
  await deps._fireAuthChange({ uid: 'admin-1' }); // meme utilisateur, redeclenche (cas reel : refresh de token)
  await deps._fireAuthChange({ uid: 'admin-1' });

  check('Toujours 1 seul abonnement (aucun "polling" ni ré-abonnement)', deps._getSubscribeCount() === 1);
  check('loadHistory() appelée UNE SEULE fois malgré 3 déclenchements identiques (jamais rechargée en boucle)', deps._getHistoryLoadCount() === 1);
  check('État final toujours cohérent : "authorized"', gate.getState() === 'authorized');
}

console.log('=== UTILISATEUR CONNECTÉ MAIS SANS PERMISSION ===');
{
  const doc = makeFakeDocument();
  const deps = makeDeps(doc, { hasPermission: false });
  const gate = createAuthGateController(deps);
  gate.init();
  await deps._fireAuthChange({ uid: 'etudiant-1' });

  check('État "denied" pour un utilisateur non autorisé', gate.getState() === 'denied');
  check('Message explicite affiché (pas une page blanche)', doc._els['cs-denied-message'].textContent.indexOf('administrateurs') !== -1);
  check('#cs-view reste masqué', doc._els['cs-view'].style.display === 'none');
  check('loadHistory() jamais appelée pour un accès refusé', deps._getHistoryLoadCount() === 0);
}

console.log('=== PANNE LORS DE LA LECTURE DU PROFIL (ensureUserDocument échoue) ===');
{
  const doc = makeFakeDocument();
  const deps = makeDeps(doc, { hasPermission: false, ensureUserDocumentThrows: true }); // hasPermission=false: contexte non peuplé => repli prudent
  const gate = createAuthGateController(deps);
  gate.init();
  await deps._fireAuthChange({ uid: 'admin-1' });

  check('Panne de lecture du profil -> repli prudent sur "denied" (jamais un accès accordé par erreur)', gate.getState() === 'denied');
}

console.log('=== AUCUN POLLING : aucun minuteur créé ===');
{
  const originalSetInterval = globalThis.setInterval;
  const originalSetTimeout = globalThis.setTimeout;
  let intervalCalls = 0, timeoutCalls = 0;
  globalThis.setInterval = function() { intervalCalls++; return originalSetInterval.apply(this, arguments); };
  globalThis.setTimeout = function() { timeoutCalls++; return originalSetTimeout.apply(this, arguments); };

  const doc = makeFakeDocument();
  const deps = makeDeps(doc, { hasPermission: true });
  const gate = createAuthGateController(deps);
  gate.init();
  await deps._fireAuthChange({ uid: 'admin-1' });

  globalThis.setInterval = originalSetInterval;
  globalThis.setTimeout = originalSetTimeout;

  check('setInterval jamais appelé (aucun polling)', intervalCalls === 0);
  check('setTimeout jamais appelé (aucun rappel différé/récursif)', timeoutCalls === 0);
}

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);
