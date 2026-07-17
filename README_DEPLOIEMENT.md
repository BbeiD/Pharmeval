# README — Déploiement de Pharmeval v1.2.0 sur GitHub Pages

Ce guide s'adresse à une personne **non développeuse**. Suivez les étapes dans l'ordre, sans en sauter.

---

## 1. Télécharger l'ensemble du projet

Vous devez récupérer **tous les fichiers et tous les dossiers** livrés, pas seulement `index.html`. La livraison se présente sous la forme d'une archive ZIP (ou d'un dossier) contenant :

```
index.html
css/
js/
data/
assets/
archive/
RAPPORT_MIGRATION.md
VERSION.md
README_DEPLOIEMENT.md
```

Téléchargez cette archive, puis **décompressez-la** sur votre ordinateur (clic droit → « Extraire tout » sous Windows, ou double-clic sous macOS).

---

## 2. Conserver l'organisation des dossiers

**Ne renommez rien. Ne déplacez aucun fichier individuellement.** L'application ne fonctionnera pas si :
- `styles.css` n'est plus dans le dossier `css/` ;
- les fichiers JavaScript ne sont plus dans `js/` ;
- les images ne sont plus dans `assets/images/`.

Gardez le dossier extrait tel quel, avec toute sa structure interne.

---

## 3. Téléverser TOUS les fichiers dans GitHub

Sur la page de votre dépôt GitHub (`bbeid/Pharmeval`) :

1. Cliquez sur **« Add file »** puis **« Upload files »**.
2. **Faites glisser le dossier entier** (ou sélectionnez tous les fichiers ET tous les sous-dossiers `css/`, `js/`, `data/`, `assets/` en une fois) dans la zone de dépôt.
3. Vérifiez, avant de valider, que la liste des fichiers à envoyer inclut bien `index.html`, tout le contenu de `css/`, `js/`, `data/`, et les 198 fichiers du dossier `assets/images/`.
4. Ajoutez un message de commit du type « Migration v1.2.0 - multi-fichiers » puis cliquez sur **« Commit changes »**.

### ⚠️ Pourquoi il ne faut pas téléverser uniquement `index.html`

`index.html` n'est qu'un squelette : il **appelle** les fichiers `css/styles.css`, les fichiers dans `js/`, les fichiers dans `data/` et les images dans `assets/images/`. Si vous n'envoyez que `index.html`, le site s'affichera **sans mise en forme, sans questions et sans images** — il semblera cassé alors qu'il ne manque que les autres fichiers.

### Cas particulier : le dossier `archive/`

Le fichier `archive/Pharmeval-monolithique-v1.1.0.html` fait environ **37 Mo**, ce qui dépasse la limite de 25 Mo de l'interface web « Upload files » de GitHub. Deux options :
- **Option simple** : ne téléversez pas ce fichier via l'interface web ; conservez-le uniquement sur votre ordinateur ou dans un espace de stockage séparé (il ne sert que de sauvegarde de référence, il n'est pas nécessaire au fonctionnement du site).
- **Option avancée** : si vous savez utiliser `git` en ligne de commande ou l'application GitHub Desktop, vous pouvez l'ajouter au dépôt de cette façon (limite réelle de GitHub : 100 Mo par fichier).

---

## 4. Remplacer l'ancienne version

Si un ancien fichier `index.html` (ou l'ancien fichier monolithique) existe déjà à la racine du dépôt :
1. Téléversez d'abord tous les nouveaux fichiers et dossiers comme indiqué ci-dessus.
2. Une fois que vous avez confirmé que la nouvelle version fonctionne (voir étape 7), vous pouvez supprimer l'ancien fichier monolithique de la racine du dépôt s'il y était présent, pour éviter toute confusion.

---

## 5. Conserver une sauvegarde

Avant toute manipulation :
- Gardez une copie de l'archive ZIP complète reçue, sur votre ordinateur (pas seulement sur GitHub).
- Gardez également une copie de l'ancienne version qui fonctionnait (le fichier monolithique `Pharmeval-unifie-v1.1.0.html`), en dehors du dépôt GitHub actif, par exemple dans un dossier « Sauvegardes » sur votre ordinateur.

---

## 6. Vérifier GitHub Pages

1. Sur la page du dépôt GitHub, allez dans **« Settings »** (Paramètres).
2. Dans le menu de gauche, cliquez sur **« Pages »**.
3. Vérifiez que la source est bien configurée sur la branche principale (`main`) et le dossier racine (`/`).
4. Attendez quelques minutes après un envoi de fichiers : GitHub Pages met un peu de temps à republier le site.
5. L'adresse du site est : **https://bbeid.github.io/Pharmeval/**

---

## 7. Vider le cache du navigateur (Ctrl + F5)

Si vous ouvrez le site et qu'il semble ne pas avoir changé (ancienne version encore affichée), votre navigateur affiche probablement une version enregistrée en mémoire (« cache »).

- **Windows / Linux** : appuyez sur **Ctrl + F5** (ou Ctrl + Maj + R) sur la page du site.
- **Mac** : appuyez sur **Cmd + Maj + R**.

Cela force le navigateur à recharger complètement la page, sans utiliser la mémoire cache.

---

## 8. Tester l'authentification Firebase

Une fois le site chargé sur `https://bbeid.github.io/Pharmeval/` :

1. Vous devez voir un écran de connexion (« Connexion » avec champs e-mail/mot de passe, et un bouton Google).
2. Testez la **création d'un compte** : cliquez sur « Créer un compte », renseignez un e-mail et un mot de passe (6 caractères minimum), validez.
3. Testez la **connexion avec Google** : cliquez sur « Continuer avec Google » et suivez la fenêtre qui s'ouvre.
4. Une fois connecté, vous devez arriver sur l'écran « Choisir votre espace ».
5. Testez la **déconnexion** (bouton « Déconnexion » en haut de l'écran) : vous devez revenir à l'écran de connexion.
6. **Rechargez la page** (F5) après vous être connecté : vous ne devriez pas être redéconnecté (la session doit persister).

Si l'une de ces étapes échoue, notez précisément le message d'erreur affiché — il est traduit en français et devrait vous indiquer la cause probable (mot de passe trop faible, adresse déjà utilisée, etc.).

---

## 9. Vérifier le contenu de l'application

Une fois connecté :
1. Choisissez un profil (Étudiant ou Pharmacien).
2. Sélectionnez un thème et lancez un quiz.
3. Répondez à quelques questions, vérifiez que l'explication s'affiche.
4. Terminez le quiz et vérifiez que le score s'affiche.
5. Si vous êtes en profil Pharmacien, essayez d'ouvrir une question contenant une image (procédures) et vérifiez qu'elle s'affiche et qu'un clic dessus l'agrandit correctement.
6. Testez le signalement d'une question (bouton drapeau 🚩 pendant un quiz).

---

## 10. Revenir à l'ancienne version en cas de problème

Si quelque chose ne fonctionne pas et que vous devez revenir en arrière rapidement :

1. Sur GitHub, allez dans l'onglet **« Code »** du dépôt.
2. Supprimez (ou renommez) `index.html`, les dossiers `css/`, `js/`, `data/`, `assets/` que vous venez d'ajouter.
3. Remettez en place votre ancienne sauvegarde du fichier monolithique (`Pharmeval-unifie-v1.1.0.html`), en le renommant en `index.html` à la racine du dépôt.
4. Commitez ce changement.
5. Attendez quelques minutes, puis videz à nouveau le cache de votre navigateur (Ctrl + F5) pour vérifier que l'ancienne version est bien revenue.

**C'est précisément pour permettre ce retour en arrière que le fichier `archive/Pharmeval-monolithique-v1.1.0.html` et votre sauvegarde personnelle doivent être conservés précieusement.**

---

## En cas de doute

En cas d'incertitude sur une étape, il est toujours préférable de **ne rien supprimer** et de demander de l'aide plutôt que de continuer à l'aveugle. Toutes les données de vos utilisateurs (statistiques, signalements) sont stockées localement dans leur propre navigateur et ne sont pas affectées par une republication du site.
