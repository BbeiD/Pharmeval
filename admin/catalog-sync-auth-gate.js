// ===================== CONTROLE D'ACCES — Synchronisation du catalogue (Sprint 21, correctif) =====================
// CORRECTIF suite au signalement "boucle infinie de controle d'acces".
// Trois problemes reels identifies et corriges ici (voir RAPPORT_CORRECTIF
// _ACCES_INFINI.md pour le detail complet du diagnostic) :
//
// 1. L'ancien code redirigeait durement vers ../index.html des le premier
//    appel de onAuthStateChanged avec user=null. Or Firebase peut
//    legitimement declencher ce callback une premiere fois avec null
//    avant d'avoir fini de restaurer une session persistee (plus visible
//    sur un acces direct/rafraichissement que sur une navigation interne
//    deja "chaude") - la page pouvait alors rebondir vers l'accueil AVANT
//    que le compte Administrateur soit reconnu, ce qui, repete a chaque
//    nouvelle tentative, ressemble a une boucle. Corrige : on n'affiche
//    plus jamais un "refus" tant qu'une decision definitive n'a pas ete
//    prise - voir handleAuthChange() ci-dessous, qui affiche desormais un
//    ecran "acces refuse" AVEC UN LIEN, jamais une redirection automatique.
//
// 2. Aucun garde-fou contre un double appel de initAuthGate() (donc un
//    double abonnement a onAuthStateChanged). Corrige par le drapeau
//    `initialized` ci-dessous.
//
// 3. loadHistory() pouvait etre appelee a chaque declenchement de
//    onAuthStateChanged (potentiellement plusieurs fois pour la meme
//    session). Corrige par le drapeau `historyLoaded`.
//
// Ce fichier n'importe AUCUN service Firebase directement - toutes ses
// dependances sont INJECTEES (meme principe que catalog-sync-render.js),
// ce qui permet de le tester reellement (voir tests/test-auth-gate.mjs)
// sans navigateur ni projet Firebase.

/**
 * @param {object} deps
 * @param {function} deps.onAuthStateChanged
 * @param {object} deps.auth
 * @param {function(object):Promise<object>} deps.ensureUserDocument
 * @param {function(object,object):void} deps.setCurrentUserContext
 * @param {function():void} deps.clearCurrentUserContext
 * @param {function(string):boolean} deps.hasPermission
 * @param {{MANAGE_QUESTIONS:string}} deps.PERMISSIONS
 * @param {function():void} deps.loadHistory
 * @param {Document} deps.document
 */
export function createAuthGateController(deps) {
  let initialized = false;
  let historyLoaded = false;
  let currentState = 'loading'; // 'loading' | 'authorized' | 'denied' — TROIS etats, jamais un quatrieme implicite

  function setState(state, message) {
    currentState = state;
    const d = deps.document;
    const loadingEl = d.getElementById('cs-loading');
    const deniedEl = d.getElementById('cs-denied');
    const deniedMsgEl = d.getElementById('cs-denied-message');
    const viewEl = d.getElementById('cs-view');

    if (loadingEl) loadingEl.style.display = state === 'loading' ? 'block' : 'none';
    if (deniedEl) deniedEl.style.display = state === 'denied' ? 'block' : 'none';
    if (deniedMsgEl && state === 'denied') deniedMsgEl.textContent = message || 'Accès refusé.';
    // "en cas d'utilisateur autorise, l'interface doit s'afficher
    // immediatement" : bascule synchrone, pas de delai artificiel.
    if (viewEl) viewEl.style.display = state === 'authorized' ? 'block' : 'none';
  }

  async function handleAuthChange(user) {
    if (!user) {
      deps.clearCurrentUserContext();
      // JAMAIS de redirection automatique ici (voir point 1 ci-dessus) -
      // seulement un ecran explicite avec un lien de retour. Si un
      // evenement ulterieur de onAuthStateChanged confirme un utilisateur
      // reel (cas du "null transitoire" au demarrage), handleAuthChange
      // sera rappele par Firebase avec le vrai utilisateur et l'etat
      // basculera alors normalement vers "authorized" - aucun risque de
      // l'avoir manque en ayant deja quitte la page.
      setState('denied', 'Vous devez être connecté pour accéder à cette page.');
      return;
    }

    try {
      const userData = await deps.ensureUserDocument(user);
      deps.setCurrentUserContext(user, userData);
    } catch (err) {
      console.error('Erreur lors de la vérification du compte :', err);
      // Panne Firestore lors de la lecture du profil : on ne bloque pas
      // silencieusement, mais on ne suppose pas non plus un acces par
      // defaut - hasPermission() ci-dessous se repliera sur "aucune
      // permission" tant que le contexte n'est pas correctement peuple.
    }

    if (!deps.hasPermission(deps.PERMISSIONS.MANAGE_QUESTIONS)) {
      setState('denied', 'La synchronisation du catalogue éditorial est réservée aux administrateurs.');
      return;
    }

    setState('authorized');
    // AJOUT (refonte visuelle, phase 1) : optionnel et defensif - garde le
    // controleur testable SANS avoir a fournir cette dependance dans
    // tests/test-auth-gate.mjs (aucun rendu DOM reel dans ces tests).
    if (typeof deps.renderSiteHeader === 'function') deps.renderSiteHeader('administration');
    if (!historyLoaded) {
      historyLoaded = true;
      deps.loadHistory();
    }
  }

  function init() {
    // GARDE ANTI-DOUBLE-APPEL (exigence explicite : "l'initialisation de
    // la page ne doit s'executer qu'une seule fois"). Un second appel est
    // un no-op silencieux, jamais un second abonnement.
    if (initialized) return;
    initialized = true;
    setState('loading');
    deps.onAuthStateChanged(deps.auth, function(user) { handleAuthChange(user); });
  }

  return {
    init: init,
    isInitialized: function() { return initialized; },
    getState: function() { return currentState; },
  };
}
