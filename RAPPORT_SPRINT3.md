# RAPPORT_SPRINT3.md — Gestion des rôles et contrôle d'accès

**Sprint 3 — Pharmeval v1.3.0 (base) → v1.4.0**

## Objectif du sprint

Construire les fondations du premier moteur d'autorisation de Pharmeval : un contexte utilisateur centralisé, un service de rôles, et une première zone d'administration minimale, à double contrôle d'accès (interface + logique métier). Aucun espace d'administration complet, aucune gestion d'utilisateurs/campagnes/questions n'est développée ici — uniquement les fondations qui les rendront possibles sans réécriture.

---

## Fichiers modifiés

| Fichier | Nature de la modification |
|---|---|
| `js/auth.js` | Ajout de 2 imports (`setCurrentUserContext`/`clearCurrentUserContext` depuis `app-context.js`, `updateAdminUI` depuis `admin.js`). Dans `onAuthStateChanged` : appel de `setCurrentUserContext(user, userData)` juste après `ensureUserDocument()` (avant la décision onboarding/application), et `clearCurrentUserContext()` dans la branche de déconnexion. `revealApp()` appelle désormais `updateAdminUI()`. **Aucune fonction d'authentification existante n'a été modifiée** (`handleAuthSubmit`, `doGoogleSignIn`, `doSignOut`, `mapAuthError`, `toggleAuthMode` sont identiques). |
| `index.html` | Ajout d'un bouton « Administration » dans l'en-tête (masqué par défaut, `display:none` dans le HTML brut) et d'un panneau `#admin-view` minimal (masqué par défaut) après `#results-view`. Aucune autre ligne touchée (vérifié par diff). |
| `css/styles.css` | Ajout des styles du panneau d'administration (`#admin-view`, `.admin-info-row`), à la suite des styles existants. Aucune règle existante modifiée. |

## Fichiers créés

| Fichier | Rôle |
|---|---|
| `js/services/app-context.js` | Contexte utilisateur en mémoire (uid, e-mail, rôle, statut, profil...), peuplé une seule fois par connexion. Toute lecture d'information utilisateur par un autre module passe désormais par ce contexte plutôt que de relire Firestore. C'est l'exigence d'architecture suggérée pour ce sprint. |
| `js/services/authorization-service.js` | Centralise **toute** la logique de rôle : `ROLES` (objet extensible), `getCurrentRole()`, `hasRole(role)`, `isAdmin()`, et un point d'extension `hasPermission(permission)` pour une matrice de permissions plus fine dans un sprint futur. Aucune comparaison de rôle en dur ailleurs dans le code. |
| `js/admin.js` | Zone d'administration minimale : `updateAdminUI()` (affiche/masque le bouton selon le rôle), `openAdminZone()` / `closeAdminZone()`. |

`js/app.js`, les 3 fichiers de `data/`, et toutes les images sont **strictement inchangés** (comparaison octet pour octet effectuée, voir « Tests »).

---

## Fonctionnement du contrôle d'accès (double barrière, comme demandé)

1. **Interface** : le bouton « Administration » est `display:none` **dans le HTML brut lui-même** (pas seulement via JavaScript après coup) et n'est révélé que par `updateAdminUI()` si `isAdmin()` est vrai. Un utilisateur classique ne le voit jamais apparaître, même une fraction de seconde.
2. **Logique métier** : `openAdminZone()` revérifie elle-même `isAdmin()` en tout premier, indépendamment du bouton. Un utilisateur qui appellerait `openAdminZone()` directement depuis la console du navigateur (en contournant totalement l'interface) se voit refuser l'accès de la même manière — testé explicitement (voir « Tests »).

**Limite honnête à souligner** : ces deux contrôles sont **côté client**. Un utilisateur techniquement averti peut toujours lire ou modifier le code JavaScript exécuté dans son propre navigateur. Ils empêchent un usage normal ou accidentel, mais **ne constituent pas, à eux seuls, une sécurité réelle des données**. La sécurité réelle repose entièrement sur les règles Firestore (section suivante) : même si quelqu'un parvenait à afficher le panneau `#admin-view` de force, cela ne lui donnerait accès à aucune donnée qu'il ne pourrait pas déjà lire, et il ne pourrait toujours pas s'auto-attribuer le rôle `admin` dans Firestore.

---

## Rôles (extensibilité)

Ce sprint définit deux rôles (`user`, `admin`) sous la forme d'un objet gelé (`Object.freeze`) dans `authorization-service.js` :

```js
export const ROLES = Object.freeze({ USER: 'user', ADMIN: 'admin' });
```

Ajouter un rôle futur (`teacher`, `quality_manager`, `super_admin`... voir `VISION_PHARMEVAL.md`) ne demande qu'une ligne dans cet objet — aucune autre fonction (`hasRole`, `isAdmin`, `getCurrentRole`) n'a besoin d'être réécrite, puisqu'elles raisonnent déjà en termes de rôle nommé plutôt que de valeur codée en dur ailleurs dans l'application.

---

## Préparation des futures fonctionnalités

L'architecture mise en place ce sprint est pensée pour que les prochains chantiers n'aient qu'à ajouter un fichier, pas à modifier le moteur de rôles :

- **Gestion des utilisateurs / campagnes / questions / signalements / statistiques globales** : chacun pourra devenir un `js/services/xxx-service.js` dédié, qui importe `isAdmin()` (ou la future `hasPermission('xxx')`) depuis `authorization-service.js`, exactement comme `admin.js` le fait déjà.
- **`hasPermission(permission)`** existe déjà comme point d'extension : aujourd'hui, elle équivaut à `isAdmin()`, mais elle permettra plus tard d'introduire une matrice de permissions par rôle (ex. un `quality_manager` pourrait valider des signalements sans être administrateur complet) sans changer la signature ni les appels déjà écrits dans le reste du code.
- **`app-context.js`** est déjà conçu pour porter davantage de champs sans rupture : toute donnée ajoutée au document Firestore (voir `VERSION.md`/`RAPPORT_SPRINT2.md` — pays, langue, université, numéro INAMI...) n'aura qu'à être ajoutée à `setCurrentUserContext()`.

---

## Règles Firestore proposées (non appliquées)

Conformément à la consigne, ces règles sont **proposées et documentées ici uniquement** — elles n'ont pas été déployées sur le projet Firebase.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {

      // Lecture : un utilisateur ne peut lire que son propre document.
      allow read: if request.auth != null && request.auth.uid == userId;

      // Creation : uniquement son propre document, et uniquement avec les
      // valeurs par defaut attendues (aucune auto-promotion possible des
      // la creation du compte).
      allow create: if request.auth != null
                    && request.auth.uid == userId
                    && request.resource.data.uid == userId
                    && request.resource.data.role == 'user'
                    && request.resource.data.status == 'active'
                    && request.resource.data.profileCompleted == false;

      // Mise a jour : uniquement son propre document, et uniquement si les
      // champs sensibles restent strictement inchanges par rapport a la
      // valeur deja stockee (resource.data = valeur AVANT ecriture).
      allow update: if request.auth != null
                    && request.auth.uid == userId
                    && request.resource.data.uid == resource.data.uid
                    && request.resource.data.role == resource.data.role
                    && request.resource.data.status == resource.data.status
                    && request.resource.data.createdAt == resource.data.createdAt;

      // Suppression : desactivee pour tous cote client. Une suppression de
      // compte devra passer par une fonction serveur (Cloud Function) dans
      // un sprint dedie, pas par une regle client.
      allow delete: if false;
    }
  }
}
```

**Ce que ces règles empêchent concrètement**, comme demandé :
- un utilisateur ne peut pas modifier son `role` (la règle exige `request.resource.data.role == resource.data.role`, donc toute tentative de changer cette valeur fait échouer l'écriture) ;
- un utilisateur ne peut pas modifier son `status` (même mécanisme) ;
- un utilisateur ne peut pas modifier son `uid` (même mécanisme, et de toute façon `uid` sert d'identifiant de document) ;
- un utilisateur ne peut pas modifier sa `createdAt` (même mécanisme) ;
- un utilisateur ne peut pas non plus s'attribuer le rôle `admin` **dès la création** du document (la règle `create` impose `role == 'user'`).

**Point important à anticiper pour un sprint futur (pas encore nécessaire aujourd'hui)** : ces règles ne permettent à personne — pas même un administrateur — de modifier le document d'un *autre* utilisateur ; c'est volontaire et suffisant tant qu'aucune fonctionnalité d'administration réelle n'écrit dans Firestore. Le jour où une gestion des utilisateurs sera développée, la règle d'écriture pour un administrateur **ne devra jamais** se fonder sur `resource.data.role == 'admin'` **de l'utilisateur ciblé** (cela n'aurait aucun sens), mais sur le rôle de l'**auteur de la requête**, via une relecture de son propre document, par exemple :
```
allow write: if request.auth != null &&
  get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
```
Ce point est noté ici pour éviter une erreur de conception classique (et potentiellement grave) lors de l'écriture des règles du prochain sprint.

---

## Tests réalisés

**Rappel du contexte, déjà signalé lors des sprints précédents** : cet environnement de travail n'a pas d'accès réseau à Firebase/Firestore. Les tests ci-dessous utilisent donc des mocks fidèles des fonctions Firebase (`onAuthStateChanged`, etc.) et de `ensureUserDocument()`, et exécutent le **vrai code de production** (`js/auth.js`, `js/admin.js`, `js/services/*.js`, tels que livrés, sans aucune modification pour les besoins du test) dans un DOM simulé construit à partir du vrai `index.html`.

### Suite 1 — `test_authorization.js` (25 vérifications, 25/25 réussies)
`app-context.js` : état initial vide, peuplement correct, valeurs par défaut sûres (rôle `user` si absent du document Firestore), effacement à la déconnexion.
`authorization-service.js` : `getCurrentRole`/`hasRole`/`isAdmin`/`hasPermission` corrects pour un rôle admin, un rôle user, et un rôle manquant ; `ROLES` bien gelé.

### Suite 2 — `test_admin.js` (16 vérifications, 16/16 réussies)
- Bouton et panneau bien masqués par défaut **dans le HTML brut** (pas seulement via JS).
- Pour un utilisateur classique : bouton reste masqué, et **`openAdminZone()` appelée directement refuse l'accès** (panneau reste fermé) — validation explicite de l'exigence « même en appelant directement les fonctions JavaScript ».
- Pour un administrateur : bouton révélé, panneau ouvert avec les bonnes informations (version, e-mail, rôle), fermeture correcte.
- Après effacement du contexte (déconnexion) : bouton se remasque.

### Suite 3 — `test_integration_auth_admin.js` (9 vérifications, 9/9 réussies)
Exécute le **vrai fichier `js/auth.js`** avec des mocks Firebase, de bout en bout :
- connexion d'un administrateur → application révélée, bouton d'administration visible, panneau fonctionnel ;
- déconnexion puis connexion d'un **utilisateur différent, non admin** → confirmation qu'**aucun privilège ne fuit d'une session à l'autre** sur un même poste (scénario réaliste : poste partagé en officine ou salle informatique universitaire).

### Suite 4 — Non-régression (rejouée après ce sprint, 65 vérifications, 65/65 réussies)
Les 49 tests fonctionnels du moteur de quiz existant + les 16 tests des modales (signalement, zoom d'image), rejoués sans modification pour confirmer qu'aucune régression n'a été introduite par les changements d'`index.html`/`css/styles.css`/`auth.js`. `js/app.js` et les 3 fichiers de données ont également été comparés **octet pour octet** à la version précédente : identiques.

**Total : 115 vérifications automatisées, 115/115 réussies.**

### Non testé dans cet environnement (à valider par vous après déploiement)
- Comportement réel des règles Firestore proposées ci-dessus (elles ne sont pas appliquées, donc non testables tant qu'elles ne sont pas déployées dans la console Firebase — un test manuel après déploiement est nécessaire : tenter de modifier son propre `role` via la console/dev tools et confirmer que Firestore rejette l'écriture).
- Rendu visuel réel du panneau d'administration dans un navigateur.

---

## Limites connues

1. **Règles Firestore non déployées** (conformément à la consigne « ne pas les appliquer automatiquement ») : tant qu'elles ne le sont pas, un utilisateur techniquement capable de modifier une requête Firestore directement pourrait en théorie modifier son propre `role` dans la base — le contrôle actuel n'est que côté client. Ceci est un point bloquant à traiter avant toute mise en production réelle avec du contenu sensible derrière le rôle `admin`.
2. **Attribution du rôle `admin`** : aucun mécanisme n'existe encore pour désigner un administrateur (ni interface, ni script). À ce stade, cela doit être fait manuellement dans la console Firebase (modifier le champ `role` d'un document utilisateur), en dehors de l'application.
3. **`hasPermission()`** reste une équivalence stricte avec `isAdmin()` pour l'instant : ce n'est pas encore une vraie matrice de permissions, volontairement, pour rester dans le périmètre minimal demandé.
4. **Un seul rôle par utilisateur** : le champ Firestore `role` reste une simple chaîne, pas un tableau. La vision produit évoque des rôles multiples simultanés (`VISION_PHARMEVAL.md`, section 6) ; ce sprint ne le met pas en place, mais `authorization-service.js` a été conçu pour que ce changement futur (passer `role` à un tableau) ne touche qu'une poignée de fonctions internes à ce fichier, pas les appelants.

## Évolutions prévues (non développées ce sprint)

- Déploiement effectif des règles Firestore proposées, après relecture humaine (conformément à `CHARTE_DEVELOPPEMENT_PHARMEVAL.md`, section 14.2).
- Interface d'attribution des rôles (probablement un premier vrai écran dans `#admin-view`, une fois qu'un administrateur existe réellement).
- `evaluation-service.js`, `statistics-service.js`, `campaign-service.js` dans `js/services/`, rattachés au même contexte utilisateur et au même service d'autorisation.
- Matrice de permissions plus fine si de nouveaux rôles (`teacher`, `quality_manager`...) sont introduits.
