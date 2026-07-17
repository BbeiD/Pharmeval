# VERSION.md

## Pharmeval — version actuelle : v1.9.0 (Sprint 8 — Centre d'administration)

| Champ | Valeur |
|---|---|
| Version précédente | v1.8.0 (Sprint 7 — Moteur de recommandations intelligentes) |
| Version actuelle | **v1.9.0** |
| Date | 17 juillet 2026 |
| Objectif de cette version | Transformer la zone d'administration minimale en un véritable Centre d'administration : gestion des utilisateurs, des rôles et des statuts, journal d'audit — sans jamais passer par la console Firebase. |

Ce fichier décrit l'état **courant** du projet. L'historique complet de chaque version (v1.0.x à v1.9.0) est documenté dans `CHANGELOG.md`.

---

## Fichiers modifiés / créés par cette version (v1.9.0)

Voir `RAPPORT_SPRINT8.md` pour le détail complet. En résumé :
- Modifiés : `js/services/authorization-service.js` (additif), `js/admin.js`, `index.html`, `css/styles.css`.
- Créés : `js/services/user-management-service.js`, `js/services/admin-service.js`, `js/services/audit-service.js`, `firestore.rules`.

## Fonctionnalités conservées

Toutes les fonctionnalités des versions précédentes, sans exception — vérifié par une suite de régression complète rejouée à chaque sprint (voir chaque `RAPPORT_SPRINTx.md` pour le détail) :
- Authentification Firebase, onboarding de première connexion.
- Rôles `user`/`admin` et contexte utilisateur centralisé (Sprint 3), désormais complétés par les statuts `pending`/`active`/`suspended` (Sprint 8).
- Synchronisation des évaluations vers Firestore, avec file d'attente locale en cas d'échec réseau (Sprint 4).
- Centre de progression : historique paginé, recherche, filtres, détail d'une évaluation (Sprint 5).
- Analyse de progression : indicateurs généraux, tendance, performance par espace et par thème (Sprint 6).
- Moteur de recommandations basé sur des règles, avec transparence explicite (« Pourquoi cette recommandation ? ») (Sprint 7).
- **Nouveau (v1.9.0)** : Centre d'administration complet (tableau des utilisateurs, gestion des rôles/statuts, journal d'audit).
- L'intégralité du moteur de quiz d'origine (949 questions, tous types confondus), inchangée depuis la migration multi-fichiers (v1.2.0).

## Fonctionnalités ajoutées par cette version

Voir `CHANGELOG.md`, section « v1.9.0 — Sprint 8 », pour le détail complet.

## Fonctionnalités supprimées

**Aucune**, à aucune version depuis la migration initiale (v1.2.0).

## Anomalies connues (cumulées, non résolues)

1. **Pré-existante dans le fichier source d'origine, non corrigée (hors périmètre)** : 35 questions de type « arbre décisionnel » du thème Conseil utilisent un champ `question` plutôt que `q` pour leur énoncé ; la fonction de signalement (`openReportModal`) suppose `q.q` et échoue sur ce type précis de question. Documenté depuis `RAPPORT_MIGRATION.md` (v1.2.0).
2. **Identifiant de question synthétique** (`computeQuestionId`, Sprint 4) : aucune question de `data/questions.js` ne possède de champ `id` stable ; l'identifiant utilisé pour l'historique est dérivé du sous-thème et d'un hachage du texte, donc stable tant que le texte ne change pas, mais pas un vrai identifiant permanent.
3. **Statuts `pending`/`suspended` non exploités par la garde d'authentification** (Sprint 8) : un compte suspendu peut aujourd'hui toujours se connecter — préparation uniquement, comme demandé.
4. Le fichier d'archive du monolithe d'origine (≈ 37 Mo, `archive/Pharmeval-monolithique-v1.1.0.html`) dépasse la limite de 25 Mo de l'interface web de dépôt GitHub (upload par glisser-déposer) ; à ajouter via `git` en ligne de commande ou GitHub Desktop si nécessaire.

Voir chaque `RAPPORT_SPRINTx.md` pour les limites propres à chaque sprint (analyse de progression plafonnée à 100 évaluations, tableau des utilisateurs plafonné à 500 comptes, etc.).
