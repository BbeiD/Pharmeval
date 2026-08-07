# Sprint 21.5 — Phase B0 : socle fonctionnel de l'Entraînement libre

## Fichiers créés
| Fichier | Rôle |
|---|---|
| `js/services/question-filter-utils.js` | Logique pure des filtres (`buildFilterDescriptors`) + décision « peut-on lancer l'entraînement » (`evaluateTrainingPoolReadiness`, point 4) |
| `js/services/tag-catalog-service.js` | Service de tags de production (Firestore réel), réutilisant `normalizeForDedup()` du moteur de synchronisation |
| `js/services/question-progress-logic.js` | Logique pure de progression par question (définitions exactes du cadrage) |
| `js/services/question-progress-catalog-service.js` | I/O Firestore brut : `question_progress` + marqueur d'idempotence `question_progress_applied_results` |
| `js/services/question-progress-service.js` | Couche métier : point d'entrée unique `updateQuestionProgressFromResult()` + `classifyCandidatePoolForUser()` |

## Fichiers modifiés (additifs uniquement)
- **`js/services/question-catalog-service.js`** — `buildFilterClauses` étendu (`documentSourceId`, `documentSectionId`, `tag`), délègue maintenant à `question-filter-utils.js` ; détection d'index manquant (`isIndexMissingError`) ajoutée sur `queryQuestionsPage`/`searchQuestionsBounded`, aucun filtre existant modifié.
- **`js/services/evaluation-result-service.js`** — un appel additionnel à `updateQuestionProgressFromResult()`, au même point et avec la même philosophie « best effort » que la mise à jour de compétence existante.
- **`firestore.indexes.json`** — **3 nouveaux index** (pas 4, voir ci-dessous), rien retiré ni modifié.

## Décisions techniques actées

- **Index réduits à 3** (`status+documentSourceId+createdAt`, `+documentSectionId`, `+difficulty`) : les tags et la difficulté-après-section sont volontairement traités **côté client sur un pool déjà borné**, jamais en clause Firestore — c'est ce qui évite un 4ᵉ (voire plus) index.
- **Le seuil du pool candidat n'a pas de nouveau mécanisme** : il réutilise `getDefaultSearchScanLimit`/`setDefaultSearchScanLimit`, déjà existants. `evaluateTrainingPoolReadiness()` est la seule pièce neuve, et centralise la décision « on peut lancer ou pas ».
- **Idempotence** : marqueur dédié (`question_progress_applied_results/{resultId}`), posé dans une transaction Firestore avant tout incrément — limite honnête documentée dans le code (les incréments eux-mêmes ne sont pas dans la même transaction que la pose du marqueur).

## Tests exécutés — 44/44 réels

| Fichier | Tests | Nature |
|---|---|---|
| `test-question-catalog-filters.mjs` | 11 | Unitaire réel (aucun mock) |
| `test-question-progress-logic.mjs` | 16 | Unitaire réel — définitions exactes, cas limites, rétrocompatibilité |
| `test-training-pool-bounds.mjs` | 6 | Unitaire réel — point 4 (jamais de lancement silencieux) |
| `test-question-progress-idempotency.mjs` | 11 | Intégration, backend simulé fidèle à l'algorithme réel |

**Ce qui n'a pas pu être testé ici** (nécessite Firestore réel, comme documenté depuis le début de ce sprint) : le comportement réel des transactions Firestore, le déploiement effectif des 3 nouveaux index, les permissions réelles sur `tags`/`question_progress`.

## Rétrocompatibilité — rappel explicite
`question_progress` ne se peuple qu'à partir des évaluations finalisées **après** le déploiement de cette phase. Aucun backfill. Une question déjà répondue avant cette date apparaîtra « jamais vue » jusqu'à sa prochaine réponse — documenté dans le code et assumé, pas un défaut.

## Prochaine étape
Prêt pour la Phase B1 (interface Entraînement libre) dès ton feu vert — ou pour le câblage réel sur Firestore si tu préfères valider ce socle en conditions réelles d'abord.
