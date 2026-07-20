# RAPPORT CORRECTIF SPRINT 20 — Fiabilisation des compteurs documentaires et des migrations par lots

**Pharmeval v2.11.0 → v2.11.1 (PATCH — correction de bug, aucune nouvelle fonctionnalité éditoriale ou graphique)**

## 1. Objectif

Corriger la logique de compteurs documentaires (`document_sources.questionCount`, `document_sections.directQuestionCount`/`totalQuestionCount`) introduite au Sprint 20, avant toute migration réelle des ~900 questions existantes. L'architecture générale du Sprint 20 n'est pas remise en cause — seule la fiabilité du calcul des compteurs et de la migration par lots est corrigée.

## 2. Principe fondamental (documenté explicitement, comme demandé)

**Les questions classifiées constituent la seule vérité métier.** Les compteurs portés par les sources et les sections sont des **données dérivées et reconstruisibles** : ils accélèrent l'affichage, mais ne sont jamais une vérité indépendante. En cas de doute, une fonction de réconciliation peut toujours recalculer la valeur exacte à partir des questions réellement classifiées — jamais l'inverse. Ce principe est documenté en tête de `js/services/document-count-service.js`, le nouveau point d'entrée unique pour toute modification de ces compteurs.

## 3. Défauts identifiés dans la version précédente

1. `classifyQuestion()` (rattachement individuel) décrémentait l'ancienne section/source uniquement au niveau de la feuille — jamais propagé aux ancêtres (`totalQuestionCount` d'une section parente restait faux après un déplacement).
2. `applyMigrationBatch()` (migration par lots) supposait à tort que toutes les questions du lot étaient non classées, et incrémentait la destination du nombre total du lot sans jamais décrémenter les sources/sections d'origine réelles.
3. Les écritures de classification (question) et de compteurs (source/section) étaient deux opérations Firestore indépendantes, sans lien transactionnel — un échec partiel laissait le système incohérent, jamais détecté.
4. Aucun mécanisme de reconstruction des compteurs à partir de la réalité des questions n'existait.

## 4. Stratégie de compteurs (le cœur du correctif)

### 4.1 Résolution des ancêtres

`getSectionAncestorIds(section)` lit le champ `path` déjà maintenu et détecte, sans jamais planter, une arborescence corrompue : cycle (identifiant dupliqué) ou profondeur anormale (> 50 niveaux) déclenchent une anomalie explicitement signalée, jamais une propagation silencieusement fausse.

### 4.2 Calcul de delta exact

`computeClassificationDelta(oldDest, newDest, getAncestorIdsFn)` est la fonction pure (aucun accès Firestore) au centre du correctif : elle retourne le delta exact à appliquer, couvrant nativement les 5 cas du cadrage :

- **Cas 1 (non classée → section)** : source +1, section directe +1, section + tous ses ancêtres total +1.
- **Cas 2 (déplacement même source)** : source inchangée ; ancienne branche -1, nouvelle branche +1.
- **Cas 3 (déplacement entre sources)** : ancienne source -1, nouvelle source +1, branches ajustées.
- **Cas 4 (retrait de classification)** : symétrique du cas 1, en négatif.
- **Cas 5 (destination identique)** : détecté en amont, aucun delta calculé, opération idempotente.

**Ancêtres communs** : un ancêtre partagé entre l'ancienne et la nouvelle section reçoit un -1 puis un +1 dans le **même objet accumulateur** — ces deux contributions s'annulent algébriquement, sans détection explicite d'intersection. Garantie obtenue par construction, pas par un cas particulier fragile.

### 4.3 Deltas agrégés pour un lot

`prepareBulkDeltas()` relit la classification réelle de chaque question du lot et additionne (`mergeDeltas()`) les deltas individuels en une structure agrégée `{sourceDeltas, sectionDeltas}` — exactement la forme donnée en exemple dans le cadrage. Un seul ajustement net est appliqué par document de compteur, jamais un ajustement par question.

## 5. Atomicité et cohérence

### 5.1 Rattachement individuel : une transaction unique

`applyClassificationDelta()` utilise `runTransaction()` : la question, l'ancienne/nouvelle source, l'ancienne/nouvelle section et tous leurs ancêtres sont lus puis écrits dans la même transaction Firestore. Un échec annule l'ensemble.

### 5.2 Migration par lots : stratégie explicite en plusieurs étapes

```
Préparer (prepareMigration) → calcule le delta agrégé, crée un job "prepared" — rien n'est écrit
Valider → affiché à l'administrateur avant toute confirmation
Appliquer (applyMigration) → écrit les questions par chunks bornés (25), puis applique le
           delta agrégé via une PETITE TRANSACTION PAR DOCUMENT DE COMPTEUR affecté
Vérifier → le rapport final distingue réussites/échecs/incohérences
Rapporter → job marqué completed / completed_with_errors, jamais silencieusement "réussi"
```

Aucune erreur n'est ignorée silencieusement : `.catch(function() {})` n'est plus utilisé pour les opérations de compteur elles-mêmes (uniquement pour les écritures d'audit, non bloquantes par nature).

## 6. Protection contre les compteurs négatifs

`clampNonNegative()` détecte explicitement une tentative de passage sous zéro, clampe à 0 de façon contrôlée, et journalise systématiquement l'anomalie (`document_count_inconsistency_detected`) avec une recommandation de réconciliation — jamais un `Math.max(0, ...)` silencieux.

## 7. Migration par lots : préparation robuste

`prepareBulkDeltas()` ne présume plus jamais l'origine des questions d'un lot. Chaque question est individuellement comparée ; les questions déjà dans la destination sont automatiquement exclues (idempotence). L'interface affiche désormais un résumé de prévisualisation (deltas par source, deltas par section direct/total) avant toute confirmation, avec un bouton « Confirmer et appliquer » séparé.

## 8. Jobs de migration

Nouvelle collection `document_migration_jobs` (justifiée : aucune structure existante ne modélise un job à états avec progression — `importLogs`, Sprint 10, est un enregistrement immuable après coup, structurellement différent). Statuts `prepared → running → completed/completed_with_errors/failed`. Permet de relancer une migration ciblée uniquement sur les questions en échec.

## 9. Réconciliation

`rebuildSourceCounts(sourceId)` et `rebuildSectionCounts(sourceId)` recalculent les compteurs réels à partir d'un balayage des questions effectivement classifiées, sans rien modifier. `applyReconciliation()` applique les corrections uniquement sur confirmation explicite. `reconcileAllDocumentCounts(organizationId)` étend cette vérification à toutes les sources d'une organisation.

**Interface ajoutée** : bouton « Vérifier les compteurs » sur chaque fiche de source (compteur stocké / réel / écart / sections incohérentes), avec un bouton « Corriger les compteurs » demandant confirmation explicite avant toute écriture. Un bouton « Vérifier toutes les sources » complète la vue par organisation.

## 10. Audit

Événements ajoutés/complétés (réutilisent `audit_logs`, admin-only) : `document_counts_updated`, `document_counts_reconciled`, `document_count_inconsistency_detected`, `question_migration_prepared`, `question_migration_completed`, `question_migration_completed_with_errors`. Toujours par lot pour une migration, jamais un événement par question.

## 11. Fichiers créés

- `js/services/document-count-service.js` — service centralisé des compteurs (cœur du correctif).
- `js/services/document-migration-job-service.js` — suivi des jobs de migration.
- `RAPPORT_CORRECTIF_SPRINT20.md`.

## 12. Fichiers modifiés

- `js/services/document-source-catalog-service.js`, `document-section-catalog-service.js`, `question-catalog-service.js` — exposition de références de documents brutes pour les transactions.
- `js/services/question-classification-service.js` — `classifyQuestion()` réécrit autour de `applyClassificationDelta()`.
- `js/services/question-migration-service.js` — réécriture complète (`prepareMigration()`/`applyMigration()` remplacent l'ancien `applyMigrationBatch()`).
- `admin/document-sources.js`, `admin/document-sources.html` — prévisualisation des deltas ; actions de vérification/correction des compteurs.
- `firestore.rules` — nouvelle collection `document_migration_jobs/`.

**Aucune modification** de `admin/bank.js`, `admin/import.js`/`import-service.js`, `question-parser.js`, `question-metadata-service.js`, ni d'aucune fonctionnalité éditoriale ou graphique.

**Aucun index Firestore modifié.**

## 13. Compatibilité

Aucun impact sur le contenu des questions, réponses, justifications, identifiants techniques/pédagogiques, parcours, évaluations, résultats, progression, présentation générale, ni sur l'architecture documentaire elle-même. Aucune réimportation de question nécessaire.

## 14. Sécurité

Inchangée dans son principe par rapport au Sprint 20 : seuls les administrateurs peuvent classer, migrer ou réconcilier. Même limite déjà documentée : l'isolation entre organisations reste garantie au niveau des données, pas encore au niveau du rôle administrateur.

## 15. Performance

Migration par chunks bornés (25 questions/chunk). Réconciliation bornée (2000 questions/source), jamais automatique. Aucun recalcul de compteur à l'affichage normal.

## 16. Procédure de déploiement

1. Sauvegarder la version stable en production.
2. Déployer `firestore.rules` (nouvelle collection `document_migration_jobs/`) avant le code applicatif.
3. Déployer les fichiers statiques.
4. Exécuter la procédure de test (section 17).
5. Publier en production seulement après validation.

## 17. Procédure de test avant migration réelle

1. Créer 2-3 sources et une arborescence de sections (3-4 niveaux) sur l'environnement de test.
2. Classer des questions de TEST (jamais les questions réelles) : première classification, déplacement entre sections sœurs, déplacement entre branches, déplacement entre sources, retrait, reclassification identique.
3. Après chaque opération, « Vérifier les compteurs » et confirmer un écart de 0.
4. Répéter avec un lot mixte ; vérifier le résumé de deltas avant application, puis l'absence d'écart après.
5. Modifier volontairement un compteur stocké ; vérifier que la réconciliation détecte et corrige l'écart.
6. Seulement après ces vérifications concluantes : procéder à la migration réelle, par petits lots, en vérifiant les compteurs après chaque lot significatif.

## 18. Procédure de retour arrière

Aucune migration de données destructrice. Les schémas restent identiques au Sprint 20. Revenir au code v2.11.0 est possible ; les compteurs déjà corrigés resteront corrects (valeurs numériques ordinaires). Les jobs de migration créés resteront en base, inertes.

## 19. Résultats des tests

**Vérifications effectuées ici** : syntaxe complète, équilibre des règles, cohérence croisée des identifiants DOM et fonctions exposées, relecture manuelle approfondie de `computeClassificationDelta()` sur papier pour chacun des 5 cas (y compris la vérification que les ancêtres communs s'annulent correctement), relecture de la structure transactionnelle.

**Non exécuté ici** (aucun accès Firebase réel) : les 12 tests numérotés du cadrage. À exécuter selon la procédure de la section 17 avant toute migration réelle.

## 20. Limites connues

1. Isolation d'accès administrateur entre organisations non réellement enforcée (héritée du Sprint 20, hors périmètre de ce correctif).
2. Réconciliation bornée à 2000 questions par source.
3. Une corruption d'arborescence antérieure à ce correctif ne serait détectée qu'au prochain déplacement ou à la prochaine réconciliation, jamais rétroactivement de façon proactive.
4. Aucun test fonctionnel réel sur un projet Firebase.

## 21. Statut proposé

**À_TESTER**, avec exigence renforcée : ne procéder à la migration réelle des ~900 questions qu'après exécution complète et concluante de la procédure de test (section 17) sur un environnement Firebase réel.
