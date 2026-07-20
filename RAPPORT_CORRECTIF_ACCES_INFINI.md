# Correctif — Boucle de contrôle d'accès sur `admin/catalog-sync.html`

## Diagnostic (trois causes réelles, pas une seule)

1. **Redirection dure prématurée** (`catalog-sync.js`, ancienne version) : `window.location.href = '../index.html'` exécuté dès le premier appel de `onAuthStateChanged` avec `user === null`. Firebase peut légitimement déclencher ce callback une première fois avec `null` avant d'avoir restauré une session persistée (plus sensible sur un accès direct/rafraîchissement que sur une navigation interne déjà « chaude »). Le compte Administrateur pouvait donc être écarté avant même d'être reconnu.
2. **Aucune garde contre un double appel** de `initAuthGate()` — donc un double abonnement `onAuthStateChanged` possible.
3. **Dépendance de production vers un fichier de test** : `catalog-sync-wiring.js` importait `../tests/fake-firestore-backend.mjs`. Si ce chemin n'est pas déployé tel quel sur l'hébergement réel, le module entier échoue au chargement et rien n'atteint jamais `initAuthGate()` — `#cs-loading` reste alors affiché indéfiniment.

## Corrections apportées

- **`admin/catalog-sync-auth-gate.js`** (nouveau) : machine à 3 états stricte (`loading` / `authorized` / `denied`), dépendances entièrement injectées, garde `initialized` empêchant tout second abonnement, plus de redirection automatique — un refus affiche désormais un message explicite avec un lien « Retour à l'administration ». `loadHistory()` n'est appelée qu'une seule fois par session, même si Firebase redéclenche le callback plusieurs fois (rafraîchissement de jeton).
- **`js/services/catalog-sync-demo-backend.js`** (nouveau, déplacé) : le backend simulé vit désormais dans l'arborescence réellement déployée, plus dans `tests/`.
- **`admin/catalog-sync-wiring.js`** : pointe vers le nouvel emplacement.
- **`admin/catalog-sync.js`** : utilise `createAuthGateController` au lieu de la logique inline fautive.
- **`admin/catalog-sync.html`** : le message de refus porte désormais un `id` (`cs-denied-message`) pour être mis à jour dynamiquement avec la raison précise ; le lien pointe vers « Retour à l'administration ».

## Test ajouté

`tests/test-auth-gate.mjs` (22 tests, tous réels) — reproduit explicitement le scénario diagnostiqué (`null` transitoire puis utilisateur réel), vérifie la garde anti-double-appel, l'absence de rechargement en boucle sur des déclenchements répétés du même utilisateur, le repli prudent en cas de panne, et l'absence de tout `setInterval`/`setTimeout` (aucun polling).

## Menu d'administration

`index.html` : le lien « 📥 Import de questions » a été retiré du menu visible (remplacé par un commentaire explicatif) ; `admin/import.html` et `admin/import.js` restent intacts dans le projet, non liés, comme demandé.

## Résultat des tests (arborescence finale complète, installation à neuf)

**180/180** — `test-auth-gate` (22) + `test-catalog-sync-helpers` (39) + `test-catalog-sync-workflow` (39) + `test-excel-connector` (29) + `test-sync-engine-e2e` (42) + `test-validator-patch` (9).

## Limite honnête

Je ne peux toujours pas reproduire ce bug dans un vrai navigateur avec un vrai projet Firebase dans cet environnement — le diagnostic ci-dessus est bâti sur une lecture précise du code et un test qui reproduit fidèlement le scénario le plus probable (le `null` transitoire), mais je ne peux pas garantir à 100 % qu'il s'agissait exactement de ta situation sans un retour de ta part après ce correctif.
