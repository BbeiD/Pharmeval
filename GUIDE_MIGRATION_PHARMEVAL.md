# Guide de migration Pharmeval — vers une architecture frontend/backend réelle

## Statut

Projet personnel de David, **non lié à Familia** — ce n'est pas une
demande de mise en production Familia nécessitant le circuit IT
(`informatique@pharmacie-familia.be`). David est seul décideur des choix
d'infra/hébergement pour ce chantier ; les règles générales de prudence
(pas d'action destructive sans confirmation, pas de gestion
d'identifiants, etc.) restent bien sûr valables.

## 1. Architecture actuelle (avant migration)

- **Frontend** : HTML/JS statique, servi via **GitHub Pages** depuis la
  branche `main` (pas Firebase Hosting — `firebase.json` n'a qu'une clé
  `firestore`, pas de clé `hosting`). Un simple `git push origin main`
  publie donc les changements de code (quelques minutes de latence).
- **"Backend"** : simulé — le navigateur appelle directement le SDK
  Firestore client, la logique d'autorisation vit dans `firestore.rules`.
  Aucun serveur/API réel aujourd'hui.
- **Déploiement Firestore** (`firebase deploy --only firestore:rules` /
  `firestore:indexes`) est **séparé** du déploiement du code : nécessite
  Node.js, donc uniquement possible depuis l'ordinateur personnel de
  David (son ordinateur de travail n'a pas Node.js — seuls git/PowerShell/
  Bash y fonctionnent). Un `git push` ne publie JAMAIS les règles/index
  Firestore, et inversement.
- Projet Firebase : `pharmeval-ea3d3` (voir `.firebaserc`).

## 2. Décisions d'architecture validées (2026-07-23)

1. **Backend** : Firebase Cloud Functions (Node.js serverless, même
   projet Firebase, déploiement via `firebase deploy --only functions`
   depuis l'ordinateur personnel — pas de nouvelle plateforme
   d'hébergement à gérer).
2. **Base de données** : on garde Firestore tel quel (modèle de données
   inchangé) — seul l'accès change : SDK Admin côté Cloud Functions au
   lieu du SDK client direct depuis le navigateur.
3. **Stratégie** : migration **progressive**, fonctionnalité par
   fonctionnalité — le reste de l'application continue en accès direct
   Firestore pendant la transition. Pas de gel prolongé, pas de
   réécriture big-bang.
4. **Déclencheur concret retenu** : rapports partenaires automatisés
   (agrégation multi-utilisateurs + envoi d'e-mails programmés) — la
   première brique impossible à faire en pur client-side, donc le
   premier cas d'usage à migrer vers une vraie fonction serveur.

## 3. Première brique pilote prévue

Une Cloud Function qui agrège les évaluations d'un utilisateur sur une
période donnée (base technique du futur rapport partenaire) — reprend la
même collection `evaluation_results` et la même logique de normalisation
que `js/services/history-service.js` (`getRecentEvaluationsForUid`),
simplement exécutée côté serveur avec le SDK Admin plutôt que le SDK
client.

## 4. Prérequis avant d'écrire du code Cloud Functions

Ce travail nécessite Node.js/npm et la CLI Firebase (`firebase init
functions`) — à faire depuis l'ordinateur personnel de David, pas depuis
son ordinateur de travail (voir section 1).

## 5. Suite

Ce guide sera mis à jour au fil de la migration (prochaines briques
migrées, retours d'expérience) — même logique que
[GUIDE_GENERATION_QUESTIONS_PDF.md](GUIDE_GENERATION_QUESTIONS_PDF.md)
pour le processus PDF → questions : documenter dans le repo, pas
seulement dans la mémoire de session.
