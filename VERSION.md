# VERSION.md

## Pharmeval — version actuelle : v2.4.0 (Sprint 13 — Banque des compétences)

| Champ | Valeur |
|---|---|
| Version précédente | v2.3.1 (correctif Sprint 12 — Parcours) |
| Version actuelle | **v2.4.0** |
| Date | 19 juillet 2026 |
| Objectif de cette version | MINOR : nouvelle « Banque des compétences » (fiches indépendantes et réutilisables, collection Firestore `competencies`), adaptation des Parcours pour sélectionner une compétence existante dans cette banque au lieu d'en créer une en texte libre, migration automatique des anciennes compétences texte. Statut proposé : À_TESTER (aucun test fonctionnel réel sur un projet Firebase disponible dans cet environnement — voir `RAPPORT_SPRINT13.md`, section 8). |

Ce fichier décrit l'état **courant** du projet. L'historique complet de chaque version (v1.0.x à v2.4.0) est documenté dans `CHANGELOG.md`. Le détail de ce sprint est documenté dans `RAPPORT_SPRINT13.md` et `GUIDE_MIGRATION_SPRINT13.md`.

---

## Fichiers modifiés / créés (cumulé v1.9.0 + v1.9.1 + v2.0.0 + v2.1.0 + v2.1.1 + v2.2.0 + v2.2.1 + v2.3.0 + v2.3.1 + v2.4.0)

**v2.4.0 (Sprint 13)** — voir `RAPPORT_SPRINT13.md` :
- Modifiés : `js/services/authorization-service.js` (permissions MANAGE_COMPETENCIES/PURGE_COMPETENCIES), `js/services/parcours-metadata-service.js` (champ additif `competencyId`), `js/services/parcours-service.js` (`addCompetencyFromBank()`, `resolveParcoursCompetenciesDisplay()` ; ancien texte libre conservé pour compatibilité/migration, non exposé côté interface), `admin/parcours.js`, `admin/parcours.html` (sélection depuis la banque), `index.html`, `css/styles.css` (additif), `firestore.rules` (nouvelles collections, aucune règle existante modifiée), `firestore.indexes.json` (6 nouveaux index).
- Créés : `js/services/competency-metadata-service.js`, `competency-catalog-service.js`, `competency-audit-service.js`, `competency-service.js`, `competency-migration-service.js`, `admin/competencies.html`, `admin/competencies.js`.


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

**v2.2.0 (Sprint 11)** — voir `RAPPORT_SPRINT11.md` :
- Modifiés : `js/services/question-catalog-service.js` (extension additive : pagination, recherche bornée, statut, édition, suppression), `index.html`, `css/styles.css`, `firestore.rules` (questions/ étendue, question_audit_logs/ nouvelle).
- Créés : `admin/bank.html`, `admin/bank.js`, `js/services/question-bank-service.js`, `js/services/question-completeness-service.js`, `js/services/question-audit-service.js`, `firestore.indexes.json`.

**v2.2.1 (correctifs avant validation)** — voir `RAPPORT_SPRINT11.md`, section « Correctifs avant validation » :
- Modifiés : `js/services/question-metadata-service.js` (statut TRASH), `js/services/authorization-service.js` (permission PURGE_QUESTIONS), `js/services/question-catalog-service.js` (limite de recherche configurable), `js/services/question-bank-service.js` (workflow de suppression sécurisée, timeline), `admin/bank.js`, `admin/bank.html`, `css/styles.css`, `firestore.rules` (règle générale resserrée + règle dédiée archived↔trash).
- Créés : `js/services/question-search-provider.js`.

**v2.3.0 (Sprint 12)** — voir `RAPPORT_SPRINT12.md` :
- Modifiés : `js/services/authorization-service.js` (permissions MANAGE_PARCOURS/PURGE_PARCOURS), `index.html`, `css/styles.css` (additif), `firestore.rules` (nouvelles collections parcours/ et parcours_audit_logs/), `firestore.indexes.json` (4 nouveaux index).
- Créés : `admin/parcours.html`, `admin/parcours.js`, `js/services/parcours-service.js`, `js/services/parcours-catalog-service.js`, `js/services/parcours-metadata-service.js`, `js/services/parcours-audit-service.js`.

**v2.3.1 (correctif Sprint 12)** — voir `NOTE_CORRECTIF_SPRINT12.md` :
- Modifiés : `js/services/parcours-metadata-service.js` (palette de couleurs fermée), `js/services/parcours-service.js` (ajout multiple de compétences, historique robuste), `admin/parcours.js`, `admin/parcours.html`, `css/styles.css` (additif), `firestore.indexes.json` (2 index composites manquants ajoutés : parcours_audit_logs et question_audit_logs).

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
- **Nouveau (v2.2.0)** : interface d'administration « Banque de questions » (recherche, filtres, tri, pagination Firestore réelle, fiche détaillée, badges de statut, indicateur de complétude, actions limitées avec confirmation et journalisation).
- **Nouveau (v2.3.0)** : Parcours (organisation logique de compétences, liaison de questions existantes), fondations structurelles pour de futurs déploiements (universités, officines, entreprises).
- L'intégralité du moteur de quiz d'origine (949 questions, tous types confondus), inchangée depuis la migration multi-fichiers (v1.2.0).

## Fonctionnalités ajoutées par ces versions

Voir `CHANGELOG.md`, sections « v1.9.0 — Sprint 8 », « v1.9.1 — Correctif », « v2.0.0 — Sprint 9 », « v2.1.0 — Sprint 10 », « v2.1.1 — Correctif » et « v2.2.0 — Sprint 11 », pour le détail complet.

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
9. **Le moteur de quiz ne consomme toujours pas la collection Firestore `questions`** (Sprint 10) : il continue de lire exclusivement `data/questions.js`. La Banque de questions (Sprint 11) gère bien ce catalogue côté administration, mais aucun pont vers le moteur de quiz lui-même n'existe encore — choix délibéré, pas un oubli.
10. **Un fichier d'import est strictement limité à 500 questions** (correctif v2.1.1) : au-delà, l'import est refusé avant toute écriture (garantit l'atomicité, sans mécanisme de reprise/rollback) — un fichier plus volumineux doit être divisé en plusieurs imports distincts.
11. **Recherche textuelle de la Banque de questions bornée** (500 par défaut, désormais configurable — correctif v2.2.1) par filtres actifs : limite Firestore native (pas de recherche plein texte), documentée, pas cachée. Une abstraction (`question-search-provider.js`) prépare une future intégration externe, non encore développée.
12. **Édition limitée à explication/tags/source dans la Banque de questions** (Sprint 11) : pas d'éditeur complet, aucune modification de l'énoncé, des réponses, du thème ou de la difficulté possible depuis cet écran.
13. **Suppression définitive irréversible une fois confirmée** (correctif v2.2.1) : le workflow Archivée → Corbeille → Suppression définitive protège contre une perte accidentelle, mais la dernière étape (purge, réservée à la permission `PURGE_QUESTIONS`) reste volontairement sans mécanisme de restauration.
14. **Compétences des Parcours en champ imbriqué, pas en sous-collection Firestore** (Sprint 12) : choix délibéré pour ce sprint « fondations » — voir `RAPPORT_SPRINT12.md` pour la justification et la piste de migration si le besoin évolue.
15. **Aucun lien entre les Parcours et le moteur de quiz** (Sprint 12) : structure organisationnelle côté administration uniquement, explicitement hors périmètre de ce sprint.
16. Le fichier d'archive du monolithe d'origine (≈ 37 Mo, `archive/Pharmeval-monolithique-v1.1.0.html`) dépasse la limite de 25 Mo de l'interface web de dépôt GitHub (upload par glisser-déposer) ; à ajouter via `git` en ligne de commande ou GitHub Desktop si nécessaire.
17. **Sélection d'une compétence de la banque depuis un parcours exige la permission `MANAGE_COMPETENCIES` en plus de `MANAGE_PARCOURS`** (Sprint 13) : sans conséquence aujourd'hui (seul le rôle admin existe réellement et possède les deux), mais un futur rôle gérant les parcours sans gérer la banque de compétences ne pourrait pas encore lier de compétence depuis cet écran.
18. **Aucun test fonctionnel réel sur un projet Firebase pour le Sprint 13** : cet environnement de livraison n'a pas accès à un projet Firebase réel ; seules des vérifications statiques (syntaxe, JSON, cohérence des identifiants/exports) ont pu être effectuées — voir `RAPPORT_SPRINT13.md`, section 8. Statut proposé : À_TESTER.
19. **Migration des anciennes compétences texte non exécutée automatiquement** (Sprint 13, comme demandé) : reste une action manuelle, déclenchée depuis `admin/competencies.html` — voir `GUIDE_MIGRATION_SPRINT13.md`.

Voir chaque `RAPPORT_SPRINTx.md` (et `RAPPORT_CORRECTIF_1.9.1.md`, `RAPPORT_CORRECTIF_SPRINT10.md`) pour les limites propres à chaque version (analyse de progression plafonnée à 100 évaluations, tableau des utilisateurs plafonné à 500 comptes, etc.).
