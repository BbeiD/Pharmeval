# CHANGELOG — Pharmeval

Toutes les versions notables du projet sont documentées dans ce fichier.

---

## v1.5.0 — Sprint 4 (Synchronisation des résultats et historique Firestore)

### Fonctionnalités ajoutées
- Enregistrement local (nouveau, additif) de chaque évaluation terminée : `quiz_evaluations_student` / `quiz_evaluations_pharmacist` (tableau détaillé, distinct des compteurs agrégés `quiz_stats_*` déjà existants).
- Synchronisation automatique des évaluations vers Firestore (`users/{uid}/evaluations/{evaluationId}`), avec identifiant stable généré une seule fois (`crypto.randomUUID()`), sans jamais bloquer l'affichage du score en cas d'échec réseau.
- Mécanisme anti-doublon par écriture idempotente (même identifiant = même document, jamais de doublon).
- File d'attente locale : toute évaluation non synchronisée reste marquée `pending` et une nouvelle tentative est effectuée automatiquement à la connexion suivante (`syncPendingEvaluations()`), sans boucle de tentatives répétées.
- Indicateur discret après chaque évaluation : « ✓ Résultat sauvegardé » ou « ✓ Résultat sauvegardé localement — synchronisation en attente » (jamais de message technique Firebase).
- Nouveau service `js/services/evaluation-service.js`, centralisant toute la logique Firestore liée aux évaluations, avec une première fonction de lecture de l'historique (`getUserEvaluations()`) préparée pour le Sprint 5.

### Fichiers modifiés
- `js/app.js` — 6 ajouts minimaux isolés (traçage de la réponse donnée dans les 5 gestionnaires de réponse, appel de synchronisation dans `showResults()`). Aucune logique de score existante modifiée.
- `js/auth.js` — tentative de synchronisation des évaluations en attente à chaque connexion (appel non bloquant).
- `js/admin.js` — version affichée mise à jour vers v1.5.0.
- `index.html` — ajout de l'indicateur discret de synchronisation dans l'écran de résultats.
- `css/styles.css` — style de l'indicateur discret.

### Fichiers créés
- `js/services/evaluation-service.js`
- `firestore.rules` (règles proposées, non déployées)

### Migration nécessaire
Aucune migration de données existantes : les compteurs agrégés (`quiz_stats_*`) restent inchangés et continuent de fonctionner normalement. Le nouvel historique détaillé démarre uniquement à partir des évaluations terminées après le déploiement de cette version — voir `RAPPORT_SPRINT4.md` pour le détail des raisons pour lesquelles les données historiques existantes ne peuvent pas être rétroactivement décomposées en évaluations individuelles.

### Actions Firebase nécessaires
- **Aucune action immédiate obligatoire** : le service fonctionne dès le déploiement du code, en écrivant dans une nouvelle sous-collection Firestore (`users/{uid}/evaluations`), sans configuration préalable requise côté console au-delà de ce qui existe déjà (Firestore déjà activé depuis le Sprint 2).
- **Recommandé avant une mise en production réelle** : publier les règles Firestore proposées dans `firestore.rules`, après relecture humaine.

### Règles Firestore à publier (proposées, non appliquées)
Voir le fichier séparé `firestore.rules` et la section dédiée de `RAPPORT_SPRINT4.md`. Résumé : lecture/écriture strictement limitées à son propre UID, mise à jour restreinte aux seuls champs de synchronisation (le résultat d'une évaluation ne peut pas être modifié après coup), suppression désactivée côté client.

### Tests à effectuer
Voir `RAPPORT_SPRINT4.md`, section « Non testé dans cet environnement » : validation manuelle contre le vrai projet Firebase (écriture/lecture réelles, comportement des règles une fois déployées, rendu visuel de l'indicateur).

### Limites connues
- Identifiant de question synthétique (`computeQuestionId`), en l'absence d'un champ `id` stable dans `data/questions.js` — voir `RAPPORT_SPRINT4.md`.
- Détail de la réponse donnée (`answerGiven`) simplifié pour les formats Relier/Arbre décisionnel/Flux/Cas évolutif (seule l'exactitude `correct` est garantie pour ces formats).
- Aucune donnée historique antérieure à cette version n'est récupérable.

---

## v1.4.0 — Sprint 3 (Gestion des rôles et contrôle d'accès)

- Contexte utilisateur centralisé (`js/services/app-context.js`).
- Service d'autorisation (`js/services/authorization-service.js`) : rôles `user`/`admin`, extensible.
- Première zone d'administration minimale (`js/admin.js`), à double contrôle d'accès (interface + logique métier).
- Règles Firestore proposées pour `users/{userId}` (protection de `role`, `status`, `uid`, `createdAt`).

Voir `RAPPORT_SPRINT3.md` pour le détail complet.

---

## v1.3.0 — Sprint 2 (Moteur de gestion des utilisateurs)

- Création automatique du document utilisateur Firestore à la première connexion.
- Mise à jour automatique (`lastLogin`, `provider`, `displayName`, `photoURL`) à chaque connexion suivante.
- Assistant de première connexion (onboarding) en 4 étapes.

Voir `RAPPORT_SPRINT2.md` pour le détail complet.

---

## v1.2.0 — Migration multi-fichiers

- Transformation de l'application monolithique (~37 Mo, images en base64) en application statique multi-fichiers compatible GitHub Pages.
- 198 images extraites vers `assets/images/`.
- Séparation CSS/JS/données en fichiers dédiés.

Voir `RAPPORT_MIGRATION.md` et `VERSION.md` pour le détail complet.

---

## v1.1.0 — Sprint 1 (Authentification Firebase)

- Authentification Firebase (e-mail/mot de passe, Google), garde d'accès à l'application, déconnexion, persistance de session.

Voir `RAPPORT_TECHNIQUE_PHARMEVAL_v1.1.0.md` pour le détail complet.

---

## v1.0.x — Fusion Étudiant / Pharmacien et corrections qualité

- Fusion des deux applications historiques (Étudiant / Pharmacien) en une version unique à rôles.
- Audit et correction du lot pilote de questions Législation (biais de longueur/style des distracteurs).

Voir les rapports associés (`reinjection-legislation-lot01-rapport.md`, `audit-biais-qcm-synthese.md`, etc.) pour le détail complet.
