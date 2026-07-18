# RAPPORT_SPRINT11.md — Banque de questions

**Sprint 11 — Pharmeval v2.1.1 → v2.2.0**

## Objectif du sprint

Construire une véritable interface d'administration pour naviguer, consulter et préparer la gestion de plusieurs centaines ou milliers de questions — pas un éditeur complet, mais un « cockpit » : recherche instantanée, filtres, tri, pagination réellement compatible avec Firestore à grande échelle, fiche détaillée façon « fiche produit », badges visuels sobres, indicateur de complétude des métadonnées, et un jeu d'actions volontairement limité (publier, archiver, remettre en brouillon, supprimer, éditer trois champs).

---

## Architecture

```
admin/bank.html + admin/bank.js              (interface deux colonnes, aucune logique metier)
        │
        ▼
js/services/question-bank-service.js         (orchestration : acces, navigation, actions)
        │
        ├──▶ js/services/question-catalog-service.js   (ETENDU) : pagination reelle, recherche bornee, statut, edition, suppression
        ├──▶ js/services/question-audit-service.js      (NOUVEAU) : journal des actions sur les questions
        ├──▶ js/services/question-completeness-service.js (NOUVEAU) : indicateur de completude ("coup de coeur")
        ├──▶ js/services/authorization-service.js       (inchange, MANAGE_QUESTIONS deja existante depuis le Sprint 10)
        └──▶ js/services/tag-service.js                 (inchange, normalisation des tags a l'edition)
```

**Chaque service garde une responsabilité unique** : le catalogue ne connaît aucune règle métier (il lit/écrit ce qu'on lui demande) ; l'orchestrateur ne contient aucune requête Firestore directe ; la complétude est un calcul pur, sans aucun accès réseau ; l'interface n'appelle que l'orchestrateur.

**Choix délibéré : étendre `question-catalog-service.js` plutôt que créer un nouveau service de lecture.** Ce fichier était déjà, depuis le Sprint 10, le seul point d'accès Firestore à la collection `questions` — y ajouter la pagination, la recherche bornée, le changement de statut, l'édition limitée et la suppression respecte sa responsabilité unique déjà établie (Firestore I/O sur cette collection), plutôt que de dupliquer une deuxième couche d'accès à la même collection.

---

## Fichiers créés

| Fichier | Rôle |
|---|---|
| `admin/bank.html` | Écran deux colonnes de la Banque de questions. |
| `admin/bank.js` | Contrôleur (recherche, filtres, tri, pagination, sélection, actions, édition limitée) — aucune logique métier. |
| `js/services/question-bank-service.js` | Orchestration : contrôle d'accès, navigation (deux modes), actions de gestion, journalisation systématique. |
| `js/services/question-completeness-service.js` | Calcul de l'indicateur de complétude (« coup de cœur » du Sprint 11). |
| `js/services/question-audit-service.js` | Journal dédié des actions de gestion des questions (`question_audit_logs`). |
| `firestore.indexes.json` | Index composites proposés pour les combinaisons filtre + tri de l'écran. |

## Fichiers modifiés

| Fichier | Nature de la modification |
|---|---|
| `js/services/question-catalog-service.js` | Extension additive : `queryQuestionsPage()` (pagination Firestore réelle par curseur), `searchQuestionsBounded()` (balayage borné pour la recherche textuelle), `updateQuestionStatus()`, `updateQuestionFields()`, `deleteQuestionDocument()`. Aucune fonction existante modifiée. |
| `index.html` | Ajout du lien de navigation « 🗂️ Banque de questions » dans le menu d'administration existant. |
| `css/styles.css` | Styles de l'écran (purement additifs), palette volontairement sobre (voir « UX » ci-dessous). |
| `firestore.rules` | `questions/{pedagogicalId}` : deux nouvelles règles de mise à jour (transition de statut, édition limitée) et suppression désormais autorisée pour un administrateur (voir section dédiée). Nouvelle collection `question_audit_logs/`. |

**Confirmé strictement inchangés** : `data/questions.js`, tous les autres services (`question-service.js`, `question-metadata-service.js`, `question-parser.js`, `question-import-validator.js`, `import-service.js`, `import-log-service.js`, `admin-service.js`, `user-management-service.js`, `audit-service.js`, `evaluation-service.js`, `history-service.js`, `statistics-service.js`, `recommendation-service.js`, `date-utils.js`, `score-utils.js`, `theme-utils.js`, `tag-service.js`), toutes les autres interfaces (`admin.js`, `admin/import.html`, `admin/import.js`, `history.js`, `statistics.js`, `recommendation.js`, `auth.js`, `onboarding.js`).

---

## Interface : deux colonnes, sans popup, sans navigation compliquée

- **Colonne gauche** : liste des questions (identifiant, début de l'énoncé, thème, difficulté, badge de statut), recherche instantanée, filtres, tri, pagination.
- **Colonne droite** : fiche détaillée complète de la question sélectionnée — jamais de fenêtre popup, tout est visible immédiatement en cliquant une ligne.

## Recherche

Instantanée, sur exactement les champs demandés : identifiant pédagogique, énoncé, thème (libellé humain), sous-thème, tags, source. Voir « Performances » ci-dessous pour le détail technique (deux modes distincts).

## Filtres

Statut (4 valeurs), thème (12 valeurs connues), difficulté (3 niveaux), type de question, auteur (recherche libre) — tous combinables, tous appliqués côté serveur (`where` Firestore) sauf en mode recherche textuelle (voir plus bas).

## Tri

Date de création, date de modification, identifiant, thème, difficulté — croissant ou décroissant (bouton d'inversion).

## Affichage de chaque ligne

Identifiant pédagogique, début de l'énoncé (90 caractères), thème, difficulté, badge de statut coloré — exactement le minimum demandé, pensé pour retrouver une question en un coup d'œil.

---

## La fiche détaillée (demande complémentaire n°1 — « une vraie fiche produit »)

La colonne droite affiche, dans des sections clairement séparées : l'énoncé complet, les réponses (la bonne surlignée en vert avec ✅), l'explication, les tags (sous forme de puces), la source, les objectifs pédagogiques, l'auteur, la version, les dates de création/modification (formatées en français), la barre de complétude avec le détail par critère, puis les actions et le formulaire d'édition limitée. Structuré en sections avec titres, jamais un simple dump JSON.

## Badges visuels (demande complémentaire n°2)

🟡 Brouillon · 🔵 En relecture · 🟢 Publiée · ⚫ Archivée — affichés à la fois dans chaque ligne de la liste et dans l'en-tête de la fiche détaillée, avec une couleur de fond douce distincte par statut.

## Indicateur de complétude (demande complémentaire n°3 — « mon coup de cœur »)

`js/services/question-completeness-service.js` vérifie la **présence** (jamais la justesse scientifique) de 6 métadonnées, exactement celles listées : objectifs pédagogiques, tags, source, explication (≥ 10 caractères), auteur, temps estimé. Affiché sous forme de barre de blocs (`████████░░`) plus le pourcentage, avec le détail ✔/✘ de chaque critère juste en dessous.

**Précision volontairement répétée dans le code et cette documentation** (déjà soulignée dans la demande) : cet indicateur ne juge jamais la qualité pédagogique ou scientifique du contenu — une question à 100 % peut contenir une erreur, une question à 40 % peut être parfaite mais simplement pas encore enrichie de métadonnées. C'est un signal purement structurel, utile notamment après un import massif pour repérer d'un coup d'œil les questions encore « incomplètes ».

---

## Actions (limitées, comme demandé)

**Publier, Archiver, Remettre en brouillon, Supprimer** — rien de plus. Chaque action affiche une confirmation explicite avant exécution (la suppression précise en plus qu'elle est définitive et irréversible). Les boutons pertinents seulement sont affichés (ex. pas de bouton « Publier » sur une question déjà publiée).

## Édition limitée (« aucune édition complète », comme demandé)

Seuls l'explication, les tags et la source sont modifiables, dans un formulaire simple au bas de la fiche. Validée côté service (`editQuestionMetadata()`, longueur minimale de l'explication, normalisation des tags via `tag-service.js`), **jamais un champ arbitraire** — même une tentative technique de modifier un autre champ via cette voie serait silencieusement ignorée par `updateQuestionFields()` (qui n'accepte que ces trois clés) et rejetée par la règle Firestore correspondante (voir ci-dessous).

---

## Pagination et performances

### Navigation normale (sans recherche)
**Vraie pagination Firestore par curseur** (`startAfter`), jamais un chargement de toute la collection — compatible, comme demandé, avec plusieurs milliers de questions. Chaque filtre (statut, thème, difficulté, type, auteur) est un `where` Firestore réel, exécuté côté serveur.

### Recherche textuelle
Firestore ne supporte pas nativement la recherche plein texte ou sous-chaîne sur des champs arbitraires (y compris un champ tableau comme `tags`). **Limite honnête, documentée plutôt que cachée** : en mode recherche, un balayage borné (au plus 500 questions correspondant aux filtres actifs) est chargé, puis la correspondance textuelle et la pagination sont effectuées côté client sur ce lot. Si la base dépasse significativement cette taille pour les filtres actifs, des résultats plus anciens peuvent être manqués — signalé explicitement à l'écran (« Recherche limitée aux questions les plus récentes... ») plutôt que de laisser croire à une recherche exhaustive. Une recherche réellement exhaustive à grande échelle nécessiterait un moteur dédié (Algolia, Elasticsearch, ou une Cloud Function d'indexation) — explicitement hors périmètre de ce sprint.

### Préparation des index Firestore
`firestore.indexes.json` (nouveau, proposé) documente 9 combinaisons filtre + tri probables. Sans l'index correspondant déployé, Firestore renvoie une erreur explicite (avec un lien de création automatique) plutôt qu'un résultat incorrect — jamais un risque de donnée erronée, seulement une combinaison indisponible tant que l'index n'est pas créé.

---

## Sécurité

- **Accès réservé aux administrateurs**, à trois niveaux comme partout ailleurs dans Pharmeval : interface masquée par défaut, `question-bank-service.js` revalide indépendamment (`hasPermission(MANAGE_QUESTIONS)`), règles Firestore.
- **Journalisation systématique** : chaque changement de statut, chaque modification de champ (une entrée par champ réellement modifié), chaque suppression est journalisé dans `question_audit_logs/` (date, administrateur, identifiant de la question, ancienne/nouvelle valeur). Écriture « best effort » (jamais bloquante pour l'action elle-même), même principe que `audit-service.js` (Sprint 8) et `import-log-service.js` (Sprint 10).
- **Règles Firestore resserrées, pas relâchées** : la collection `questions/` accepte désormais trois façons distinctes de mettre à jour un document (réécriture complète par l'import, transition de statut seule, édition de champs limités seule), chacune strictement bornée par `diff().affectedKeys().hasOnly([...])` — une transition de statut ne peut jamais modifier le contenu « au passage », et une édition de champ ne peut jamais changer le statut par effet de bord.
- **Suppression assouplie, en connaissance de cause** : le Sprint 10 interdisait toute suppression (`allow delete: if false`) en attendant qu'une vraie interface avec confirmation et journalisation existe — c'est désormais le cas, la règle autorise donc la suppression pour un administrateur actif.

---

## Compatibilité (rien de cassé)

Vérifié explicitement par la suite de régression complète (816 vérifications rejouées, toutes réussies) : import et sa simulation (Sprint 10), historique des évaluations (Sprint 5), statistiques (Sprint 6), moteur de recommandations (Sprint 7), gestion des utilisateurs et dernier administrateur actif (Sprint 8, correctif v1.9.1), architecture pédagogique et normalisation de la difficulté (Sprint 9) — tous intacts.

---

## UX : sobriété demandée

Palette neutre déjà établie par Pharmeval (`--surface`, `--surface2`, `--border`, `--text`, `--text2`), **la couleur n'est utilisée nulle part ailleurs que pour les 4 badges de statut** (jaune/ambre pour brouillon, bleu pour en relecture, vert pour publiée, gris foncé pour archivée) et pour surligner la bonne réponse dans la fiche détaillée. Aucune décoration superflue.

---

## Tests réalisés

### Suite 1 — `test_completeness.js` (28 vérifications, 28/28 réussies)
Cas limites (objet vide, `null`, `undefined`, jamais de plantage) ; question à 100 % (tous les critères présents) ; question partielle (calcul exact du pourcentage) ; limites exactes de chaque critère (ex. explication à 9 vs 10 caractères) ; libellés toujours humains ; rendu de la barre de blocs, y compris l'exemple exact du Sprint 11 (`████████░░` pour 80 %).

### Suite 2 — `test_catalog_extensions_and_audit.js` (25 vérifications, 25/25 réussies)
Pagination réelle par curseur (page 1, page 2, continuité correcte) ; filtre serveur ; panne Firestore gérée proprement ; balayage borné pour la recherche ; changement de statut (persistance, `updatedAt` rafraîchi, autres champs jamais touchés) ; édition de champs (persistance correcte, **un champ non autorisé silencieusement ignoré**) ; suppression (persistance de la suppression, panne gérée sans faux succès) ; journal des actions (écriture, lecture, filtrage par identifiant).

### Suite 3 — `test_question_bank_service.js` (28 vérifications, 28/28 réussies)
Contrôle d'accès à chaque fonction ; navigation (mode normal vs recherche, correspondance textuelle sur tags/identifiant/thème, drapeau de troncature propagé) ; publication/archivage/retour en brouillon (avec refus explicite d'un no-op, jamais un faux succès) ; suppression (avec journalisation) ; édition limitée (normalisation des tags, validation de la longueur minimale de l'explication **avant toute écriture**, refus d'une édition vide).

### Suite 4 — `test_bank_ui.js` (40 vérifications, 40/40 réussies)
Contrôle d'accès réel ; rendu de la liste (identifiant, aperçu, thème, difficulté, badge) ; fiche détaillée complète (énoncé, réponses avec la bonne surlignée, explication, tags, source, objectifs, métadonnées, complétude) ; boutons d'action conditionnels selon le statut actuel ; confirmation avant chaque action (avec mention explicite d'irréversibilité pour la suppression) ; édition limitée (soumission du formulaire, découpage correct des tags) ; recherche avec avertissement de troncature ; états vide et erreur.

### Suite 5 — `test_firestore_rules_bank.js` (29 vérifications, 29/29 réussies)
Simulation fidèle de la logique des 3 règles de mise à jour de `questions/` (transition de statut seule, édition de champs seule, réécriture d'import inchangée) et de leur combinaison ; suppression assouplie ; nouvelle collection `question_audit_logs/` ; **régression vérifiée explicitement** : la règle de création (Sprint 10) et le renforcement `isRequesterAdmin()` (correctif post-Sprint 10) restent pleinement intacts, y compris pour toutes les nouvelles règles de ce sprint.

### Non-régression complète (rejouée après ce sprint)
816 vérifications héritées de tous les sprints précédents, toutes réussies sans exception (voir aussi la section « Correctifs avant validation » ci-dessous pour les 123 vérifications supplémentaires de ce correctif, et 873 vérifications de non-régression rejouées après son application).

**Total (Sprint 11 initial) : 150 (nouvelles vérifications) + 816 (non-régression) = 966 vérifications automatisées, toutes réussies.**
**Total cumulé après le correctif : 966 + 123 (nouvelles vérifications du correctif) = 1089 vérifications automatisées dans cette session, toutes réussies.**

### Non testé dans cet environnement
Aucun accès réseau à Firebase/Firestore réel — le comportement des nouvelles règles et des index composites proposés n'a pas pu être vérifié contre un émulateur ou un projet Firebase réel. Un test manuel après publication reste recommandé (créer/publier/archiver/supprimer une question de test via l'interface, confirmer qu'un utilisateur non-administrateur reçoit un refus serveur, déclencher une recherche sur un gros volume pour valider les index).

### Captures d'écran
Cet environnement ne permet pas de produire de véritables captures d'écran (aucun navigateur graphique disponible ici) — signalé honnêtement plutôt que d'en simuler. L'interface a en revanche été testée exhaustivement via DOM simulé (`test_bank_ui.js`), qui vérifie le contenu HTML réellement généré pour chaque état (liste, fiche détaillée, badges, complétude, confirmations, messages).

---

---

## Correctifs avant validation (post-livraison initiale du Sprint 11)

Quatre améliorations apportées avant le déploiement, à la demande du donneur d'ordre.

### 1. Suppression sécurisée (Question → Archivée → Corbeille → Suppression définitive)

**Avant ce correctif**, `deleteQuestion()` effectuait une suppression Firestore réelle et immédiate depuis n'importe quel statut — un seul clic (après confirmation) suffisait à perdre définitivement une question.

**Après ce correctif**, un nouveau statut `trash` (additif — voir `question-metadata-service.js`, `QUESTION_STATUSES.TRASH`) impose un workflow en trois étapes :
- **`moveQuestionToTrash()`** : uniquement depuis le statut `archived`. Une question en brouillon, en relecture ou publiée doit d'abord être archivée.
- **`restoreQuestionFromTrash()`** : ramène une question de la corbeille vers `archived` — jamais republiée automatiquement.
- **`permanentlyDeleteQuestion()`** : uniquement depuis `trash`, et réservée à une **permission dédiée** `PERMISSIONS.PURGE_QUESTIONS` (nouvelle, distincte de `MANAGE_QUESTIONS`) — un futur rôle `EDITOR` pourra gérer/archiver/mettre à la corbeille des questions, mais jamais les purger définitivement.

Publier/Archiver/Remettre en brouillon sont désormais **explicitement bloqués** depuis le statut `trash` (une question à la corbeille doit d'abord être restaurée).

**Bug critique détecté et corrigé avant livraison** : ma première version de la règle Firestore de transition de statut ne vérifiait que le **nouveau** statut demandé, jamais l'ancien — une question déjà à la corbeille aurait donc pu être renvoyée directement vers `published` via cette règle générale, contournant entièrement l'obligation de repasser par `archived`. Détecté par mes propres tests avant toute livraison, corrigé en ajoutant `resource.data.status != 'trash'` à la règle générale, et vérifié explicitement par un test dédié à ce cas précis.

Une deuxième règle Firestore, dédiée et strictement bornée, autorise uniquement la transition `archived ↔ trash` dans les deux sens. La suppression définitive (`allow delete`) exige désormais que la question soit **déjà** au statut `trash` — défense en profondeur, indépendante de l'application cliente.

### 2. Historique visuel (timeline)

`getQuestionTimeline()` (nouveau, `question-bank-service.js`) combine :
- L'événement de création (dérivé de `createdAt`, avec le libellé « Import (création) » et le fichier source si `importMeta` est présent, sinon simplement « Création ») — sans lecture Firestore supplémentaire, ces informations étant déjà présentes sur le document.
- Toutes les entrées du journal d'audit déjà existant (`question_audit_logs`, Sprint 11), traduites en libellés humains (Publication, Archivage, Mise à la corbeille, Restauration, Modification de l'explication/des tags/de la source, Suppression définitive).

Le tout trié chronologiquement et affiché sous forme de simple liste verticale (timeline) dans une nouvelle section « Historique » de la fiche détaillée.

### 3. Recherche : limite documentée, configurable, préparée pour un futur moteur externe

**Conservée telle quelle pour l'instant** (comme demandé), mais :
- La limite de balayage (`500`) n'est plus une constante figée : `getDefaultSearchScanLimit()`/`setDefaultSearchScanLimit()` (`question-catalog-service.js`) permettent de la reconfigurer sans modifier aucun fichier ; `searchQuestionsBounded()` accepte aussi une surcharge ponctuelle (`options.maxScan`).
- **Nouveau fichier `js/services/question-search-provider.js`** : une abstraction qui isole `question-bank-service.js` du mécanisme de recherche réellement utilisé aujourd'hui (le balayage borné Firestore). Ce fichier ne développe **aucune** intégration réelle avec Algolia ou Meilisearch (explicitement un point de préparation, pas une implémentation, comme demandé) — mais le jour où l'un de ces moteurs sera réellement intégré, seul ce fichier devra changer, ni `question-bank-service.js`, ni `admin/bank.js`.

### 4. Consultation du journal d'audit depuis la fiche

Le point 2 ci-dessus répond directement à cette demande : la timeline s'affiche **dans la fiche de la question elle-même**, sans navigation vers un autre écran ni popup séparée.

### Fichiers modifiés par ce correctif

| Fichier | Nature de la modification |
|---|---|
| `js/services/question-metadata-service.js` | Ajout du statut `TRASH` (purement additif). |
| `js/services/authorization-service.js` | Ajout de `PERMISSIONS.PURGE_QUESTIONS`, accordée à `admin`/`super_admin` uniquement (jamais `editor`). |
| `js/services/question-catalog-service.js` | Limite de recherche rendue configurable (`getDefaultSearchScanLimit`/`setDefaultSearchScanLimit`), `searchQuestionsBounded()` accepte une surcharge `maxScan`. |
| `js/services/question-bank-service.js` | Remplacement de `deleteQuestion()` par le workflow sécurisé (`moveQuestionToTrash`, `restoreQuestionFromTrash`, `permanentlyDeleteQuestion`) ; ajout de `getQuestionTimeline()` ; utilisation du nouveau fournisseur de recherche. |
| `admin/bank.js`, `admin/bank.html` | Badge corbeille, nouveaux boutons d'action conditionnels au statut, section « Historique » avec timeline, filtre de statut étendu. |
| `css/styles.css` | Styles additifs (badge corbeille, timeline). |
| `firestore.rules` | Règle de transition générale resserrée (exclut désormais l'ancien statut `trash`), nouvelle règle dédiée `archived ↔ trash`, suppression contrainte au statut `trash`. |

### Fichier créé

| Fichier | Rôle |
|---|---|
| `js/services/question-search-provider.js` | Abstraction de recherche, préparant une future intégration externe sans modifier les appelants. |

### Compatibilité confirmée

Aucun comportement des sprints précédents modifié — vérifié par 873 vérifications de non-régression rejouées (import, simulation, historique, statistiques, catalogue, administration), toutes réussies. Deux mises à jour d'assertions obsolètes ont été nécessaires (le nombre exact de statuts, et la constante `MAX_SEARCH_SCAN` renommée) — documentées comme des évolutions intentionnelles, pas des régressions.

### Tests dédiés à ce correctif (123 vérifications, toutes réussies)
- `test_search_provider.js` (14) : limite configurable, surcharge par appel, abstraction du fournisseur, échec explicite pour un fournisseur non implémenté.
- `test_secure_deletion_and_timeline.js` (33) : chaque transition du workflow (autorisée et refusée), permission `PURGE_QUESTIONS` distincte, échecs Firestore gérés, timeline combinée et triée.
- `test_bank_ui.js` (55, mis à jour) : badges, boutons conditionnels, confirmations, rendu de la timeline dans l'interface réelle.
- `test_firestore_rules_trash_workflow.js` (21) : simulation fidèle des règles corrigées, **incluant le test qui a détecté le bug critique** avant publication.

---

## Limites connues

1. **Recherche textuelle bornée** (500 questions par défaut, désormais configurable — voir le correctif ci-dessus) — reste un balayage borné, pas un moteur de recherche exhaustif à grande échelle tant qu'aucun fournisseur externe (Algolia, Meilisearch) n'est réellement intégré.
2. **Pas d'action « envoyer en relecture »** : seuls Publier/Archiver/Remettre en brouillon/Mettre à la corbeille/Restaurer/Supprimer définitivement existent — une question ne peut donc atteindre le statut « review » que via une future fonctionnalité (ou une modification manuelle), pas depuis cet écran.
3. **Édition limitée à explication/tags/source** : aucune modification de l'énoncé, des réponses, du thème ou de la difficulté n'est possible depuis cet écran — un éditeur complet reste un sprint futur, explicitement hors périmètre.
4. **Index Firestore proposés, pas déployés** : couvrent les combinaisons les plus probables (un seul filtre + un tri), pas exhaustivement toutes les combinaisons (ex. plusieurs filtres actifs simultanément) — à compléter selon l'usage réel, Firestore signalant explicitement tout index manquant.
5. **Suppression définitive toujours sans corbeille de second niveau** : une fois la suppression définitive confirmée (depuis le statut `trash`), aucun mécanisme de restauration — c'est la dernière étape volontairement irréversible du workflow.

## Recommandations pour le Sprint 12

- Ajouter une interface de consultation du journal `question_audit_logs/` (la lecture existe déjà, `getRecentQuestionAuditLogs()`, non exposée à l'écran ce sprint).
- Envisager un vrai workflow de publication avec une étape « review » explicite, une fois la Banque de questions éprouvée en usage réel.
- Si les fichiers importés grandissent significativement, remplacer le balayage borné de recherche par un moteur dédié (Algolia, Elasticsearch, ou une Cloud Function d'indexation).
- Déployer `firestore.rules` et `firestore.indexes.json` après relecture humaine, puis compléter les index au fil des besoins réels observés.
