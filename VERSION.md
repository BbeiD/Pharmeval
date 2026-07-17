# VERSION.md

## Pharmeval v1.2.0 — Migration multi-fichiers

| Champ | Valeur |
|---|---|
| Version source | v1.1.0 (fichier monolithique, `Pharmeval-unifie-v1.1.0.html`) |
| Nouvelle version | v1.2.0 |
| Date | 17 juillet 2026 |
| Objectif | Transformer l'application monolithique (≈ 37 Mo, images en base64) en application statique multi-fichiers compatible GitHub Pages, sans aucune perte de contenu ni de fonctionnalité |

## Fichiers modifiés / créés

- `index.html` (nouveau, remplace le HTML monolithique comme page de production)
- `css/styles.css` (nouveau, extrait du `<style>` du fichier source)
- `js/app.js` (nouveau, extrait des fonctions du moteur applicatif)
- `js/firebase-config.js` (nouveau, extrait de la configuration Firebase)
- `js/auth.js` (nouveau, extrait de la logique d'authentification)
- `data/questions.js` (nouveau, extrait des 20 banques de questions)
- `data/fiche-images.js` (nouveau, galerie d'images « fiches procédures », chemins relatifs)
- `data/proc2-images.js` (nouveau, galerie d'images « procédures P2 », chemins relatifs)
- `assets/images/*.png` / `*.jpg` (198 fichiers, nouveaux, images extraites du base64 d'origine)
- `archive/Pharmeval-monolithique-v1.1.0.html` (sauvegarde de référence intacte, ne pas utiliser en production)

## Fonctionnalités conservées

Toutes les fonctionnalités du fichier source v1.1.0, sans exception :
- Authentification Firebase (e-mail/mot de passe, Google, déconnexion, garde d'accès).
- Deux profils (Étudiant / Pharmacien) et l'ensemble de leurs thèmes/sous-thèmes.
- Les 949 questions, tous types confondus (QCM, vrai/faux, Relier, Arbre décisionnel, Détection de risque, Trouver l'erreur, Cas évolutif, Flux).
- Sélection de difficulté, lancement de quiz, réponse, explication, calcul et affichage des résultats.
- Statistiques locales par profil.
- Signalement d'une question (5 catégories + texte libre).
- Galeries d'images des fiches procédures et modale de zoom.
- Changement d'espace (retour au choix de profil) avec confirmation si un quiz est en cours.

## Fonctionnalités ajoutées

Aucune. Cette version est une migration architecturale, pas une évolution fonctionnelle.

## Fonctionnalités supprimées

**Aucune.**

## Anomalies connues

1. **Corrigée pendant cette migration** : une première version du découpage avait accidentellement omis le HTML des modales de signalement et de zoom d'image (situé entre deux blocs `<script>` du fichier source). Détectée par un test dédié et corrigée avant livraison — voir `RAPPORT_MIGRATION.md`, section Phase 10.
2. **Pré-existante dans la source, non corrigée (hors périmètre)** : 35 questions de type « arbre décisionnel » du thème Conseil utilisent un champ `question` plutôt que `q` pour leur énoncé ; la fonction de signalement (`openReportModal`) suppose `q.q` et échoue sur ce type précis de question. Comportement identique confirmé dans le fichier source et dans la version migrée — ce n'est donc pas une régression de la migration. Signalé pour correction future dans un chantier dédié à la qualité du moteur.
3. **Non testé dans cet environnement** : les scénarios nécessitant un navigateur réel et/ou un accès réseau à Firebase (création de compte, connexion e-mail/Google, persistance de session, rendu visuel mobile/desktop réel) restent à valider manuellement par le propriétaire du projet après déploiement (voir `README_DEPLOIEMENT.md`).
4. Le fichier d'archive du monolithe (≈ 37 Mo) dépasse la limite de 25 Mo de l'interface web de dépôt GitHub (upload par glisser-déposer) ; il reste sous la limite réelle de GitHub (100 Mo) et peut être ajouté via `git` en ligne de commande ou GitHub Desktop, ou conservé hors dépôt.
