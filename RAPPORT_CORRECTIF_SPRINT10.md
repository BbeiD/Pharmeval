# RAPPORT_CORRECTIF_SPRINT10.md — Sécurité et atomicité des imports

**Correctif — Pharmeval v2.1.0 → v2.1.1**

## 1. Limite de 500 questions par fichier d'import

**Problème** : au-delà de 500 questions, `question-catalog-service.js` découpait l'import en plusieurs `writeBatch()` Firestore successifs. L'atomicité n'est garantie que par bloc — un échec du second bloc n'aurait pas annulé le premier, contrairement au cahier des charges (« un import ne peut jamais être partiellement appliqué »).

**Correction** :
- `MAX_QUESTIONS_PER_IMPORT = 500` définie dans `js/services/question-import-validator.js` (emplacement métier : c'est une règle de validation).
- `validateFileStructure()` refuse désormais tout fichier de plus de 500 questions, avec le message exact demandé : *« Ce fichier contient X questions. Un import est limité à 500 questions afin de garantir son atomicité. Divisez le fichier en plusieurs imports. »*
- `validateImportPayload()` court-circuite immédiatement dans ce cas (aucune validation question par question inutile sur un fichier de toute façon rejeté).
- `question-catalog-service.js` : `writeQuestionsBatch()` n'utilise plus qu'**un seul `writeBatch()`**, sans aucun découpage. Défense en profondeur : si elle recevait malgré tout plus de 500 documents (contournement du validateur), elle **refuse d'écrire** plutôt que de redécouper silencieusement.
- `MAX_BATCH_SIZE` et `multiBatchWarning` supprimés partout où ils existaient (`question-catalog-service.js`, `import-service.js`, `admin/import.js`) — plus aucune trace du comportement multi-bloc.

**Résultat** : de 1 à 500 questions → un seul lot atomique. Plus de 500 → validation refusée, aucune écriture Firestore. Vérifié explicitement par test (fichier de exactement 500 accepté, 501 refusé avec le message exact, tentative directe de contournement via `commitImport()` et `writeQuestionsBatch()` également refusée).

## 2. `isRequesterAdmin()` vérifie désormais aussi le statut actif

**Problème** : un administrateur suspendu (`status: "suspended"`) mais dont le champ `role` valait toujours `"admin"` conservait tous ses droits administratifs côté règles Firestore.

**Correction** : la fonction partagée `isRequesterAdmin()` (définie une seule fois, réutilisée par toutes les collections) vérifie désormais `role == 'admin' && status == 'active'`, exactement comme demandé. Une seule modification, appliquée automatiquement à **toutes** les règles qui l'appellent : `users/{userId}` (lecture, mise à jour administrative), `audit_logs/` (Sprint 8), `questions/` et `importLogs/` (Sprint 10). Aucune protection existante des Sprints 3, 4, 8 et 10 n'a été retirée — vérifié explicitement par test de régression sur chacune.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `js/services/question-import-validator.js` | Ajout de `MAX_QUESTIONS_PER_IMPORT = 500` et de la vérification correspondante (avec court-circuit). |
| `js/services/question-catalog-service.js` | `writeQuestionsBatch()` simplifiée à un seul bloc atomique, avec refus en défense en profondeur au-delà de la limite. Suppression de `MAX_BATCH_SIZE`. |
| `js/services/import-service.js` | Suppression du champ `multiBatchWarning` (calcul et retour). |
| `admin/import.js` | Suppression de l'affichage du message d'avertissement multi-bloc. |
| `firestore.rules` | `isRequesterAdmin()` vérifie désormais aussi `status == 'active'`. En-tête du fichier mis à jour. |

**Aucun autre fichier modifié.** Aucune nouvelle fonctionnalité développée.

## Confirmation : aucun autre comportement du Sprint 10 modifié

Vérifié explicitement par la suite de tests complète rejouée après ce correctif (voir détail ci-dessous) : format JSON, validation des champs obligatoires/inconnus/types/longueurs, détection des doublons, versionnement, mode simulation, journal des imports, contrôle d'accès, attribution de l'auteur, préparation du catalogue futur — tout est strictement inchangé. Seuls les deux points ci-dessus ont été modifiés.

## Tests

179 nouvelles vérifications ciblées sur ce correctif (limite de 500 questions : 8 tests dans le validateur, 3 dans le service de catalogue, 5 dans l'orchestrateur, 3 dans l'interface ; renforcement `isRequesterAdmin()` : 21 vérifications via simulation fidèle de la logique des règles, couvrant les 4 collections protégées et confirmant la non-régression des protections existantes), toutes réussies. Suite de régression complète rejouée (tous les sprints précédents), toutes réussies sans exception.
