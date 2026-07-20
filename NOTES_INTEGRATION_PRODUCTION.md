# CatalogSyncEngine — Notes d'intégration production & couverture de tests

## 1. Ce qui est livré ce tour-ci

- `js/services/normalization-utils.js` — normalisation/dédoublonnage (pur, réel, testé)
- `js/services/catalog-sync-engine.js` — le moteur (pur, dépendances injectées, réel, testé)
- **Patch réel** de `js/services/question-import-validator.js` — schemaVersion `"1.1"` additive, 4 nouveaux champs optionnels (`externalIds`, `sourceDocument`, `primaryCompetency`, `pendingResourceRefs`), rétrocompatibilité `"1.0"` vérifiée
- `tests/fake-firestore-backend.mjs` — backend simulé, **utilisé uniquement par les tests**, jamais importé par le moteur lui-même

## 2. Couverture de tests — distinction stricte demandée (point 9)

| Catégorie | Ce qui a été vérifié | Portée |
|---|---|---|
| **Tests unitaires purs** (aucune donnée simulée) | `normalization-utils.js`, patch de `question-import-validator.js` (9 tests), connecteur Excel (parsing, erreurs de structure) | Logique 100 % réelle, exécutée réellement dans ce sandbox |
| **Tests avec Firestore simulé** (`FakeFirestoreBackend`) | Orchestration complète du moteur : analyse → synchronisation → ré-analyse (idempotence), détection de modification, détection d'archivage, chunking à 500, dédoublonnage compétences/tags/référentiels | Vérifie que **le moteur appelle correctement les fonctions de résolution** avec les bons arguments et interprète correctement leurs résultats — **ne vérifie pas** le comportement réel du SDK Firestore, des règles de sécurité, ni des index composites |
| **Non testé ici (nécessite l'environnement Firebase réel)** | Les fonctions de résolution elles-mêmes une fois branchées sur `document-source-service.js`, `competency-service.js`, `question-catalog-service.js` réels ; les permissions (`MANAGE_GLOBAL_CATALOG`, `MANAGE_QUESTIONS`) ; les index composites Firestore ; les temps réels d'écriture sur des lots de 500 | À valider explicitement sur l'environnement de test avant toute mise en production (Charte Développement, section 19) |

**760/760 questions du catalogue réel ont été traitées** par le moteur complet (connecteur → validation → résolution → diff → écriture simulée), avec succès et sans erreur, y compris à travers la limite d'atomicité de 500 (2 lots).

## 3. Fichiers à créer côté production (non livrés ce tour — dépendent du vrai Firestore, donc non exécutables ici)

Ces fichiers doivent implémenter EXACTEMENT les fonctions attendues par le constructeur de `CatalogSyncEngine` (voir sa JSDoc), en réutilisant les services existants :

| Fonction attendue | S'appuie sur (existant, inchangé) | Nouveau code nécessaire |
|---|---|---|
| `resolveQuestionIdentity(externalId)` | `question-catalog-service.js` | **Nouvelle fonction additive** `getQuestionByExternalId()` (requête `where('externalIds.editorialCatalog','==',...)`) — nécessite un **nouvel index composite Firestore** |
| `listExistingEditorialCatalogIds()` | `question-catalog-service.js` | **Nouvelle fonction additive**, requête `where('fromEditorialCatalog','==',true)` |
| `allocatePedagogicalId(theme)` | Même patron que `question-code-service.js` (compteur atomique) | **Nouveau fichier** `pedagogical-id-service.js` (aucun générateur de `pedagogicalId` n'existait avant ce sprint — seul `functionalCode`, Sprint 20, en avait un) |
| `resolveDocumentReferential(...)` | `document-source-service.js` (`createDocumentSource`, `queryDocumentSources`), `document-section-service.js` (équivalent) | **Nouvelle fonction** de recherche par nom normalisé (n'existait pas — ces services n'exposaient que des CRUD pilotés par formulaire admin) |
| `resolveCompetency(...)` | `competency-service.js` (`createCompetency({name:...})`), `competency-catalog-service.js` (`searchCompetenciesBounded`) | Idem : recherche par nom normalisé |
| `resolveTags(...)` | — | `tags` est aujourd'hui un **registre en mémoire seulement** (`tag-service.js`). Nécessite une **nouvelle collection Firestore** `tags` + service associé |
| `writeQuestionsChunk(...)` | `question-catalog-service.js` (`writeQuestionsBatch`) — **directement réutilisable sans modification** | — |

**Permissions requises pour l'exécutant de la synchronisation** (héritées automatiquement en réutilisant les services existants) : `MANAGE_QUESTIONS` (écriture des questions) + `MANAGE_GLOBAL_CATALOG` (création de sources/sections/compétences) — aucune nouvelle permission inventée.

## 4. Limites connues

- La synchronisation d'un catalogue de plus de 500 questions n'est **pas atomique dans son ensemble** : chaque lot de 500 est atomique individuellement (garantie Firestore `writeBatch`), mais l'échec du second lot ne peut pas annuler le premier déjà écrit. C'est la même limite déjà documentée pour `question-import-validator.js` — le moteur l'automatise (découpage) mais ne la supprime pas.
- `MAX_QUESTIONS_PER_WRITE_CHUNK` dans `catalog-sync-engine.js` doit rester égal à `MAX_QUESTIONS_PER_IMPORT` (`question-import-validator.js`) — actuellement dupliqué en valeur (500 des deux côtés) plutôt qu'importé, faute de pouvoir importer une constante d'un fichier qui n'était pas prévu pour ça sans risque de cycle d'import. À surveiller si l'une des deux valeurs change un jour.
- Les 2 questions `CBIP_QDB` sans source documentaire (`demande_spontanee`) n'ont ni `documentSourceId` ni `documentSectionId` — comportement voulu, pas une anomalie.

## 5. Pistes pour le Sprint 22

- Câblage réel des résolveurs sur Firestore + tests sur l'environnement de test réel (section 19 de la Charte Développement)
- `admin/catalog-sync.html` — l'interface qui utilisera ce moteur
- Migration effective des questions historiques codées en dur (explicitement hors périmètre de ce sprint, point 8)
- Architecture des ressources pédagogiques (`pendingResourceRefs` est déjà porté par le modèle canonique, mais non traité)
