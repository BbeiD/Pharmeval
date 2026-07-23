# Étapes détaillées — mise en place de la brique pilote Cloud Functions

Ce document exécute concrètement les décisions actées dans
[GUIDE_MIGRATION_PHARMEVAL.md](GUIDE_MIGRATION_PHARMEVAL.md). Il est écrit
pour être suivi clic par clic, sans expérience préalable de Firebase CLI.

**Important — à faire sur ton ordinateur personnel**, pas sur l'ordinateur
de travail (qui n'a pas Node.js — voir section 1 du guide de migration).
Toutes les commandes ci-dessous s'exécutent dans un terminal PowerShell.

---

## Étape 0 — Vérifier que tu es au bon endroit

1. Ouvre l'explorateur de fichiers Windows.
2. Va dans le dossier où se trouve ton dépôt `Pharmeval` (celui qui contient
   `index.html`, `firebase.json`, `.firebaserc`).
3. Dans la barre d'adresse de l'explorateur (en haut), clique une fois pour
   la sélectionner, tape `powershell` puis appuie sur `Entrée` — un
   terminal PowerShell s'ouvre déjà positionné dans ce dossier.
4. Vérifie que tu es au bon endroit : tape

   ```powershell
   dir .firebaserc
   ```

   Tu dois voir le fichier listé (pas d'erreur "introuvable"). Sinon, tu
   n'es pas dans le bon dossier.

---

## Étape 1 — Vérifier / installer Node.js

1. Dans le même terminal PowerShell, tape :

   ```powershell
   node -v
   ```

2. **Si un numéro de version s'affiche** (ex. `v20.11.0`) : Node.js est déjà
   installé, passe directement à l'Étape 2.

3. **Si tu obtiens une erreur** (`node n'est pas reconnu...`) : Node.js
   n'est pas installé.
   - Ouvre ton navigateur, va sur **nodejs.org**.
   - Sur la page d'accueil, deux gros boutons verts apparaissent. Clique
     sur celui marqué **LTS** (recommandé, version stable) — pas la version
     "Current".
   - Le fichier `.msi` se télécharge. Une fois terminé, clique dessus en
     bas de ton navigateur (ou ouvre-le depuis le dossier Téléchargements)
     pour lancer l'installeur.
   - Clique **Next** sur l'écran d'accueil.
   - Coche la case d'acceptation de la licence, clique **Next**.
   - Laisse le dossier d'installation par défaut, clique **Next**.
   - Laisse les composants par défaut cochés (npm package manager doit
     rester coché), clique **Next**.
   - Écran "Tools for Native Modules" : ne coche rien, clique **Next**.
   - Clique **Install**, patiente, puis clique **Finish**.
   - **Ferme et rouvre PowerShell** (obligatoire pour que la commande
     `node` soit reconnue), puis reviens au dossier `Pharmeval` comme à
     l'Étape 0.
   - Retape `node -v` pour confirmer que ça fonctionne maintenant.

---

## Étape 2 — Installer Firebase CLI

1. Dans PowerShell, toujours dans le dossier `Pharmeval`, tape :

   ```powershell
   npm install -g firebase-tools
   ```

2. Laisse défiler (ça peut prendre une minute ou deux, avec du texte qui
   scrolle — c'est normal).

3. Une fois revenu à l'invite de commande (la ligne `PS C:\...>` réapparaît
   sans erreur rouge), vérifie l'installation :

   ```powershell
   firebase --version
   ```

   Un numéro de version doit s'afficher (ex. `13.x.x`).

---

## Étape 3 — Se connecter à ton compte Firebase

1. Dans PowerShell, tape :

   ```powershell
   firebase login
   ```

2. Le terminal affiche une question `Allow Firebase to collect...` (oui ou
   non selon ta préférence, ça n'a pas d'impact sur la suite) — tape `y` ou
   `n` puis `Entrée`.

3. Ton navigateur par défaut s'ouvre automatiquement sur une page Google.
   - Clique sur le compte Google **avec lequel le projet Firebase
     `pharmeval-ea3d3` a été créé**.
   - Sur l'écran "Firebase CLI souhaite accéder à votre compte Google",
     fais défiler et clique sur le bouton bleu **Autoriser** (ou
     **Continue**).

4. Une page "Firebase CLI Login Successful" s'affiche dans le navigateur —
   tu peux fermer cet onglet. Dans PowerShell, tu dois voir un message vert
   `✔ Success! Logged in as ...` avec ton adresse e-mail.

---

## Étape 4 — Initialiser Cloud Functions dans le projet

1. Toujours dans PowerShell, dans le dossier `Pharmeval`, tape :

   ```powershell
   firebase init functions
   ```

2. Première question — `Are you ready to proceed?` : tape `y`, `Entrée`.

3. `Please select an option:` : utilise les flèches du clavier ↑/↓ pour
   sélectionner **Use an existing project**, puis `Entrée`.

4. Une liste de projets Firebase associés à ton compte s'affiche : utilise
   ↑/↓ pour sélectionner **pharmeval-ea3d3**, puis `Entrée`.

5. `What language would you like to use?` : sélectionne **JavaScript**
   (cohérent avec le reste du projet, qui est déjà en JS vanilla), `Entrée`.

6. `Do you want to use ESLint...?` : tape `N` puis `Entrée` (pas
   indispensable pour une première brique pilote, évite du bruit).

7. `File functions/package.json already exists. Overwrite?` (ne devrait
   pas apparaître la première fois — si ça apparaît, tape `N`).

8. `Do you want to install dependencies with npm now?` : tape `y`,
   `Entrée`. Laisse l'installation se dérouler (peut prendre 1-2 minutes).

9. Un dossier **`functions/`** apparaît maintenant dans `Pharmeval`, avec
   à l'intérieur `index.js`, `package.json`, `node_modules/`.

---

## Étape 5 — Écrire la fonction pilote (agrégation des évaluations)

1. Dans l'explorateur de fichiers, ouvre le dossier `Pharmeval\functions`.
2. Ouvre le fichier **`index.js`** avec ton éditeur habituel (VS Code,
   Notepad++, ou clic droit → Ouvrir avec → Bloc-notes).
3. **Supprime tout le contenu existant** et remplace-le par :

   ```javascript
   const { onCall } = require("firebase-functions/v2/https");
   const { initializeApp } = require("firebase-admin/app");
   const { getFirestore } = require("firebase-admin/firestore");

   initializeApp();

   // Reprend la même collection et la même idée de tri que
   // getRecentEvaluationsForUid() dans js/services/history-service.js,
   // mais côté serveur avec le SDK Admin.
   exports.getRecentEvaluationsForPartnerReport = onCall(async (request) => {
     const uid = request.data && request.data.uid;
     const max = (request.data && request.data.limit) || 20;
     if (!uid) {
       return { items: [], error: "uid manquant" };
     }

     const db = getFirestore();
     const snap = await db
       .collection("evaluation_results")
       .where("userId", "==", uid)
       .orderBy("createdAt", "desc")
       .limit(max)
       .get();

     const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
     return { items, error: null };
   });
   ```

4. Enregistre le fichier (`Ctrl+S`).

**Ce que fait ce code** : c'est une fonction serveur appelable depuis le
frontend (`onCall`), qui exécute exactement la même requête que
`getRecentEvaluationsForUid()` mais avec le SDK Admin — première brique du
rapport partenaire (section 3 du guide de migration), sans toucher à
l'existant.

---

## Étape 6 — Tester en local avant de déployer

1. Retourne dans PowerShell, dans le dossier `Pharmeval` (pas
   `Pharmeval\functions`).
2. Lance l'émulateur :

   ```powershell
   firebase emulators:start --only functions
   ```

3. Le terminal affiche une URL locale (ex.
   `http://127.0.0.1:5001/pharmeval-ea3d3/us-central1/getRecentEvaluationsForPartnerReport`)
   et un lien vers l'interface de l'émulateur
   (`http://127.0.0.1:4000`).
4. Ouvre ce lien `127.0.0.1:4000` dans ton navigateur pour voir le tableau
   de bord de l'émulateur et confirmer que la fonction apparaît dans
   l'onglet **Functions**.
5. Pour arrêter l'émulateur une fois le test terminé : reviens dans
   PowerShell et appuie sur `Ctrl+C`.

**Limite honnête** : l'émulateur simule Firestore par défaut à vide (pas
tes vraies données), donc un test complet avec de vraies évaluations
nécessite soit de démarrer aussi l'émulateur Firestore avec des données
importées, soit de tester directement en production après déploiement
(Étape 7) avec un compte de test.

---

## Étape 7 — Déployer la fonction en production

1. Dans PowerShell, dans le dossier `Pharmeval`, tape :

   ```powershell
   firebase deploy --only functions
   ```

2. Le terminal va : lister les fonctions à déployer, demander confirmation
   si c'est la première fois qu'il active l'API Cloud Functions/Cloud
   Build sur ce projet Google Cloud (tape `y`, `Entrée` si demandé), puis
   afficher une barre de progression.
3. **Ça peut prendre plusieurs minutes** la toute première fois (Google
   Cloud provisionne les ressources). Ne ferme pas le terminal.
4. Message final attendu : `✔ Deploy complete!` suivi d'une ligne
   `Function URL (getRecentEvaluationsForPartnerReport(...))`.

---

## Étape 8 — Vérifier dans la console Firebase

1. Ouvre ton navigateur, va sur **console.firebase.google.com**.
2. Clique sur la tuile du projet **pharmeval-ea3d3**.
3. Dans le menu de gauche, sous la section "Compilation" (Build), clique
   sur **Functions**.
4. Tu dois voir **`getRecentEvaluationsForPartnerReport`** listée, avec un
   statut vert (actif).
5. Clique sur le nom de la fonction pour voir ses logs d'exécution
   (onglet **Logs**) — vide tant que personne ne l'a appelée depuis le
   frontend.

---

## Étape 9 — Et après ?

- La fonction existe mais **rien ne l'appelle encore** depuis Pharmeval —
  câbler un appel frontend (`httpsCallable`) est la prochaine sous-étape,
  hors périmètre de ce document.
- Pour annuler/retirer une fonction déployée par erreur :

  ```powershell
  firebase functions:delete getRecentEvaluationsForPartnerReport
  ```

  (demande confirmation avant suppression réelle — action irréversible,
  à ne taper que si tu es sûr).
- Mettre à jour [GUIDE_MIGRATION_PHARMEVAL.md](GUIDE_MIGRATION_PHARMEVAL.md)
  section 5 une fois cette brique validée en conditions réelles, comme
  prévu.
