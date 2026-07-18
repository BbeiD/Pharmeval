# VERSION.md

## Pharmeval — version actuelle : v2.1.1 (correctif de sécurité et d'atomicité, Sprint 10)

| Champ | Valeur |
|---|---|
| Version précédente | v2.1.0 (Sprint 10 — Moteur d'import de contenu pédagogique JSON) |
| Version actuelle | **v2.1.1** |
| Date | 18 juillet 2026 |
| Objectif de cette version | Correctif de sécurité (PATCH) : limite stricte de 500 questions par import (atomicité Firestore garantie sans mécanisme de reprise complexe), et renforcement de `isRequesterAdmin()` dans `firestore.rules` (un administrateur suspendu perd immédiatement ses droits). Aucune nouvelle fonctionnalité, aucune régression. |

Ce fichier décrit l'état **courant** du projet. L'historique complet de chaque version (v1.0.x à v2.1.1) est documenté dans `CHANGELOG.md`. Le détail de ce correctif est documenté dans `RAPPORT_CORRECTIF_SPRINT10.md`.

---

## Fichiers modifiés / créés (cumulé v1.9.0 + v1.9.1 + v2.0.0 + v2.1.0 + v2.1.1)

**v1.9.0 (Sprint 8)** — voir `RAPPORT_SPRINT8.md` :
- Modifiés : `js/services/authorization-service.js` (additif), `js/admin.js`, `index.html`, `css/styles.css`.
- Créés : `js/services/user-management-service.js`, `js/services/admin-service.js`, `js/services/audit-service.js`, `firestore.rules`.

**v1.9.1 (correctif)** — voir `RAPPORT_CORRECTIF_1.9.1.md` :
- Modifiés : `js/services/admin-service.js` (interdiction de l'auto-modification du statut), `js/admin.js` (boutons de statut masqués pour soi-même), `firestore.rules` (restriction stricte des champs `role`/`status` et validation des valeurs autorisées).

**v2.0.0 (Sprint 9)** — voir `RAPPORT_SPRINT9.md` :
- Modifiés : `js/app.js` (exposition de `THEME_CONFIG`/`themeOfQuestion` via `window`, 2 lignes), `js/services/theme-utils.js` (export de `THEME_LABELS`, ajout de `KNOWN_THEMES`/`THEME_CODES`, purement additif).
- Créés : `js/services/question-service.js`, `js/services/question-metadata-service.js`, `js/services/tag-service.js`, `QUESTION_SCHEMA.md`.

**v2.1.0 (Sprint 10)** — voir `RAPPORT_SPRINT10.md` :
- Modifiés : `js/services/authorization-service.js` (admin reçoit aussi MANAGE_QUESTIONS), `js/services/question-metadata-service.js` (correctif : normalisation de la difficulté dans `completeMetadata()`), `index.html`, `css/styles.css`, `firestore.rules`.
- Créés : `js/services/question-import-validator.js`, `js/services/question-parser.js`, `js/services/question-catalog-service.js`, `js/services/import-log-service.js`, `js/services/import-service.js`, `admin/import.html`, `admin/import.js`, `IMPORT_FORMAT.md`.

**v2.1.1 (correctif)** — voir `RAPPORT_CORRECTIF_SPRINT10.md` :
- Modifiés : `js/services/question-import-validator.js` (limite de 500 questions), `js/services/question-catalog-service.js` (un seul writeBatch), `js/services/import-service.js` (suppression de multiBatchWarning), `admin/import.js` (suppression de l'affichage correspondant), `firestore.rules` (isRequesterAdmin() vérifie aussi le statut actif).

## Fonctionnalités conservées

Toutes les fonctionnalités des versions précédentes, sans exception — vérifié par une suite de régression complète rejouée à chaque sprint (voir chaque `RAPPORT_SPRINTx.md` pour le détail) :
- Authentification Firebase, onboarding de première connexion.
- Rôles `user`/`admin` et contexte utilisateur centralisé (Sprint 3), désormais complétés par les statuts `pending`/`active`/`suspended` (Sprint 8).
- Synchronisation des évaluations vers Firestore, avec file d'attente locale en cas d'échec réseau (Sprint 4).
- Centre de progression : historique paginé, recherche, filtres, détail d'une évaluation (Sprint 5).
- Analyse de progression : indicateurs généraux, tendance, performance par espace et par thème (Sprint 6).
- Moteur de recommandations basé sur des règles, avec transparence explicite (« Pourquoi cette recommandation ? ») (Sprint 7).
- **Nouveau (v1.9.0)** : Centre d'administration complet (tableau des utilisateurs, gestion des rôles/statuts, journal d'audit).
- **Nouveau (v2.0.0)** : modèle de métadonnées pédagogiques complet pour chaque question (calculé à la demande, jamais stocké dans `data/questions.js`), prêt pour un futur éditeur de questions, des imports, des campagnes et une recherche enrichie.
- L'intégralité du moteur de quiz d'origine (949 questions, tous types confondus), inchangée depuis la migration multi-fichiers (v1.2.0).

## Fonctionnalités ajoutées par ces versions

Voir `CHANGELOG.md`, sections « v1.9.0 — Sprint 8 », « v1.9.1 — Correctif », « v2.0.0 — Sprint 9 » et « v2.1.0 — Sprint 10 », pour le détail complet.

## Fonctionnalités supprimées

**Aucune**, à aucune version depuis la migration initiale (v1.2.0).

## Anomalies connues (cumulées, non résolues)

1. **Pré-existante dans le fichier source d'origine, non corrigée (hors périmètre)** : 35 questions de type « arbre décisionnel » du thème Conseil utilisent un champ `question` plutôt que `q` pour leur énoncé ; la fonction de signalement (`openReportModal`) suppose `q.q` et échoue sur ce type précis de question. Documenté depuis `RAPPORT_MIGRATION.md` (v1.2.0).
2. **Identifiant de question synthétique** (`computeQuestionId`, Sprint 4) : aucune question de `data/questions.js` ne possède de champ `id` stable ; l'identifiant utilisé pour l'historique est dérivé du sous-thème et d'un hachage du texte, donc stable tant que le texte ne change pas, mais pas un vrai identifiant permanent. **Partiellement compensé depuis le Sprint 9** par le nouvel identifiant pédagogique stable (`pedagogicalId`), lui-même stable par position tant qu'aucune question n'est insérée/supprimée au milieu d'un domaine (voir `QUESTION_SCHEMA.md`).
3. **Statuts `pending`/`suspended` non exploités par la garde d'authentification** (Sprint 8) : un compte suspendu peut aujourd'hui toujours se connecter — préparation uniquement, comme demandé.
4. **Protection du dernier administrateur actif : applicative uniquement** (v1.9.1) : pas encore renforcée par une règle Firestore dédiée ni par une Cloud Function — voir `RAPPORT_CORRECTIF_1.9.1.md`, section 4, pour la justification détaillée de ce choix et la recommandation pour une protection serveur future.
5. **Champ de difficulté historiquement incohérent** (découvert au Sprint 9) : 9 écritures différentes du champ `d` à travers les 949 questions, normalisées à la lecture par `question-metadata-service.js` sans modifier `data/questions.js` — voir `QUESTION_SCHEMA.md` pour le détail. Le fichier source reste tel quel ; une reprise éventuelle pour l'uniformiser resterait une amélioration possible, hors périmètre.
6. **Modèle de métadonnées pédagogiques non encore exploité par une interface** (Sprint 9) : `domain` ≡ `theme` (aucune taxonomie de domaine distincte), `tags`/`keywords`/`learningObjectives` vides pour toutes les questions existantes (aucune analyse de contenu automatique).
7. **Moteur d'import limité au type `single-choice`** (Sprint 10) : les autres types de question (relier, arbre décisionnel, cas évolutif...) ne sont pas encore pris en charge par le format JSON officiel.
8. **Statut toujours forcé à `draft` à l'import, y compris pour une mise à jour d'une question déjà publiée** (Sprint 10) : simplification délibérée, nécessite une republication manuelle après réimport d'une correction.
9. **Aucune interface ne consomme encore la collection Firestore `questions`** (Sprint 10) : ni le moteur de quiz (qui lit toujours `data/questions.js`), ni un futur catalogue public — choix délibéré du sprint, pas un oubli.
10. **Un fichier d'import est strictement limité à 500 questions** (correctif v2.1.1) : au-delà, l'import est refusé avant toute écriture (garantit l'atomicité, sans mécanisme de reprise/rollback) — un fichier plus volumineux doit être divisé en plusieurs imports distincts.
11. Le fichier d'archive du monolithe d'origine (≈ 37 Mo, `archive/Pharmeval-monolithique-v1.1.0.html`) dépasse la limite de 25 Mo de l'interface web de dépôt GitHub (upload par glisser-déposer) ; à ajouter via `git` en ligne de commande ou GitHub Desktop si nécessaire.

Voir chaque `RAPPORT_SPRINTx.md` (et `RAPPORT_CORRECTIF_1.9.1.md`, `RAPPORT_CORRECTIF_SPRINT10.md`) pour les limites propres à chaque version (analyse de progression plafonnée à 100 évaluations, tableau des utilisateurs plafonné à 500 comptes, etc.).
