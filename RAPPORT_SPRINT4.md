# RAPPORT_SPRINT4.md — Synchronisation des résultats et historique Firestore

**Sprint 4 — Pharmeval v1.4.0 (base) → v1.5.0**

## Objectif du sprint

Créer le moteur de synchronisation des résultats d'évaluation dans Firestore, en couche additionnelle au stockage local existant — jamais en remplacement. Aucune interface d'historique, aucune statistique globale, aucune migration massive des anciennes données : uniquement les fondations (service, identifiants stables, anti-doublon, file d'attente).

---

## Architecture retenue

```
Évaluation terminée (showResults(), js/app.js)
        ↓
Enregistrement local existant (stats.total/correct, quiz_stats_<profil>) — INCHANGÉ
        ↓
Construction d'un objet normalisé (evaluation-service.js : buildEvaluationObject)
        ↓
Enregistrement local NOUVEAU (quiz_evaluations_<profil>, tableau d'évaluations)
        ↓
Tentative d'écriture Firestore (users/{uid}/evaluations/{evaluationId}, idempotente)
        ↓
Statut "synced" ou "pending" → indicateur discret affiché, jamais bloquant
```

Le pont entre le moteur de quiz (`js/app.js`, script classique sans import ES) et le service Firestore (`js/services/evaluation-service.js`, module ES) se fait via `window.PharmevalEvaluationSync`, exactement comme les modules d'authentification et d'administration exposent déjà leurs fonctions à `window` pour les gestionnaires `onclick` du HTML classique.

---

## Fichiers modifiés

| Fichier | Nature de la modification |
|---|---|
| `js/app.js` | **6 ajouts minimaux et isolés**, tous documentés en ligne par un commentaire `// Sprint 4` : (1) dans `answer()`, `answerArbre()`, `answerFlux()`, `answerCasEvolutif()` et `onRelierClick()` : 2 lignes chacune, stockant `q._evalAnswerGiven`/`q._evalCorrect` sur l'objet question en mémoire (propriétés transitoires, jamais persistées dans `data/questions.js`) ; (2) dans `showResults()` : un appel unique et défensif à `window.PharmevalEvaluationSync.recordCompletedEvaluation(...)`, placé **après** l'affichage du score, avec mise à jour asynchrone d'un indicateur discret. **Aucune ligne de calcul de score existante n'a été modifiée** — uniquement des lectures/ajouts de propriétés annexes. |
| `js/auth.js` | 2 ajouts : import de `syncPendingEvaluations`, et un appel non bloquant (`.catch()`, pas de `await`) juste après `setCurrentUserContext()`, pour tenter une synchronisation des évaluations en attente à chaque connexion/ouverture. **Aucune fonction d'authentification existante modifiée.** |
| `js/admin.js` | 1 ligne : `APP_VERSION` mis à jour vers `'Pharmeval v1.5.0'`. |
| `index.html` | Ajout d'un unique élément `<div id="res-sync-status">` dans `#results-view`, pour l'indicateur discret de synchronisation. Aucune autre ligne touchée. |
| `css/styles.css` | Ajout d'une règle CSS pour `.results-sync-status`. Aucune règle existante modifiée. |

## Fichiers créés

| Fichier | Rôle |
|---|---|
| `js/services/evaluation-service.js` | Centralise toute la logique Firestore liée aux évaluations : génération d'identifiant stable, construction de l'objet normalisé, enregistrement local, synchronisation (avec anti-doublon), lecture de l'historique, file d'attente différée. |
| `firestore.rules` | Règles Firestore proposées pour `users/{userId}/evaluations/{evaluationId}` (documentées, **non appliquées**). |

`data/questions.js`, `js/services/user-service.js`, `js/services/app-context.js`, `js/services/authorization-service.js`, `js/onboarding.js`, `js/firebase-config.js` : **strictement inchangés**.

---

## Modèle Firestore exact

Document : `users/{uid}/evaluations/{evaluationId}`

```json
{
  "id": "identifiant stable (crypto.randomUUID() ou repli)",
  "userId": "uid Firebase",

  "createdAt": "serverTimestamp — fige a la premiere synchronisation reussie, jamais reecrit ensuite",
  "completedAt": "date ISO locale, calculee au moment ou l'utilisateur termine le quiz",
  "syncedAt": "serverTimestamp — mis a jour a chaque synchronisation reussie",

  "space": "student | pharmacist (valeur du profil actif, currentProfile)",
  "mode": "evaluation",

  "score": {
    "correctAnswers": 18,
    "totalQuestions": 25,
    "percentage": 72
  },

  "selection": {
    "difficulty": "essentiel | approfondi | avance | all",
    "theme": "le theme actif (activeTheme) au moment du quiz"
  },

  "questions": [
    { "questionId": "leg_amm-a1b2c3", "answerGiven": "texte ou cle de la reponse donnee", "correct": true }
  ],

  "appVersion": "1.5.0",
  "schemaVersion": 1,
  "source": "pharmeval-web"
}
```

**Écarts assumés par rapport au modèle d'exemple fourni**, documentés comme demandé :
- **`selection.themes`/`selection.pathologies` (tableaux) → `selection.theme` (chaîne unique)** : Pharmeval ne permet pas aujourd'hui de composer un quiz sur plusieurs thèmes ou pathologies à la fois (`activeTheme` est une valeur unique) ; un tableau aurait suggéré une capacité que l'application n'a pas.
- **`questions[].questionId`** : voir section dédiée ci-dessous — **aucune question de la banque actuelle ne possède de champ `id` stable**, ce point est documenté en détail plus bas, comme explicitement demandé par la mission.
- Le champ **`syncStatus`** (`pending`/`synced`) existe uniquement dans la copie **locale** de l'évaluation ; il n'est **jamais écrit dans Firestore** (un document Firestore existant est par définition synchronisé — le statut n'a de sens que côté local, avant confirmation).

### Important — identifiant des questions

**Constat vérifié** : sur les 949 questions de `data/questions.js`, **aucune ne possède de champ `id` explicite** (vérifié par inspection programmatique de l'objet `QDB` complet). Les questions ne sont distinguées que par leur position dans le tableau et leurs champs de contenu (`sub`, `q`/`question`/`situation`, `a`, `r`, etc.).

**Solution proposée et implémentée dans ce sprint** : `computeQuestionId(q)` calcule un identifiant synthétique déterministe à partir du sous-thème (`q.sub`) et d'un hachage simple du texte de la question (`q.q`, ou `q.question`/`q.situation` selon le type de question — les champs de texte ne portent pas tous le même nom selon le format). Exemple : `leg_amm-a1b2c3`.

**Limite assumée et documentée** :
- Cet identifiant est **stable tant que le texte de la question ne change pas** et **indépendant de l'ordre des questions dans le fichier** (contrairement à un identifiant fondé sur la position, qui aurait changé à chaque réorganisation du fichier).
- Il **changera** si une question est corrigée (voir `CHARTE_QUALITE_PHARMEVAL.md` / le travail déjà réalisé sur le lot pilote Législation) : une correction de distracteur ne change pas le texte de la question elle-même donc ne devrait pas affecter cet identifiant, mais une reformulation de l'énoncé le ferait.
- **Recommandation pour un sprint dédié futur** : ajouter un champ `id` explicite et permanent à chaque question dans `data/questions.js` (généré une fois, au format `banque-sous_theme-position` déjà utilisé pour la traçabilité dans le Protocole Opérationnel Qualité), qui ne bougerait plus jamais ensuite, y compris en cas de correction de contenu. Ce sprint-ci ne le fait pas : modifier `data/questions.js` est explicitement hors périmètre ("ne pas modifier les questions").

### Conformément à la consigne "ne pas dupliquer le texte des questions"

Seuls `questionId`, `answerGiven` et `correct` sont stockés par question — **jamais l'énoncé complet, jamais les propositions, jamais l'explication**. Vérifié par test automatisé (voir section Tests).

---

## Structure locale exacte

**Existant, inchangé** : `quiz_stats_student` / `quiz_stats_pharmacist` (`{total, correct}`), `quiz_reports_student` / `quiz_reports_pharmacist` (tableau de signalements). Ce sprint ne touche à aucune de ces deux clés.

**Nouveau, additif** : `quiz_evaluations_student` / `quiz_evaluations_pharmacist` — un tableau JSON d'objets d'évaluation normalisés (structure ci-dessus + champ local `syncStatus`), sérialisé dans `localStorage`. Une entrée est ajoutée à chaque évaluation terminée ; une entrée existante est mise à jour (jamais dupliquée) lorsque son statut change (`pending` → `synced`), grâce à une recherche par `id`.

### Réponse aux questions posées par la mission (« Compatibilité avec les données existantes »)

- **Où sont stockées les données historiques aujourd'hui ?** Nulle part sous forme d'historique détaillé : avant ce sprint, seuls des **compteurs agrégés** (`stats.total`, `stats.correct`) existaient par profil, sans trace d'une évaluation individuelle (ni date, ni thème, ni détail des réponses). C'est un constat factuel vérifié dans le code, pas une supposition.
- **Disposent-elles d'identifiants ?** Non, les compteurs agrégés n'ont pas d'identifiant unitaire — il n'y a rien à identifier puisqu'il ne s'agit pas d'enregistrements individuels.
- **Pourront-elles être migrées plus tard ?** Non, pas telles quelles : un compteur agrégé (`total: 47, correct: 32`) ne peut pas être rétroactivement décomposé en 47 évaluations individuelles distinctes (thème, date, détail des réponses inconnus). Ces compteurs resteront ce qu'ils sont ; seules les **nouvelles** évaluations, à partir de ce sprint, alimenteront le nouvel historique détaillé.
- **Quelles données manquent ?** L'historique détaillé des évaluations passées (avant ce sprint) n'existe donc simplement pas et ne peut pas être reconstitué a posteriori. C'est une limite de fond, pas seulement technique.

---

## Mécanisme anti-doublon

1. **Identifiant unique et stable par évaluation**, généré une seule fois (`crypto.randomUUID()`, avec repli horodatage+aléatoire si indisponible), conservé identique en local et dans Firestore.
2. **Écriture idempotente** : le document Firestore est adressé directement par cet identifiant (`users/{uid}/evaluations/{evaluationId}`), via `setDoc(ref, payload, {merge:true})`. Écrire deux fois la même évaluation **met à jour le même document**, elle n'en crée jamais un second.
3. **Protection après coup** : les règles Firestore proposées (voir plus bas) interdisent explicitement la modification des champs de résultat (`score`, `questions`, `completedAt`) une fois le document créé — seul `syncedAt` peut légitimement changer lors d'un nouvel essai de synchronisation.

Vérifié par test automatisé : une resynchronisation volontaire de la même évaluation ne crée pas de second document (voir Tests, scénario 2).

---

## Mécanisme de synchronisation différée (file d'attente locale)

- Toute évaluation est **toujours** enregistrée localement en premier, avec `syncStatus: "pending"` par défaut.
- Si Firestore répond avec succès, le statut local passe à `"synced"` et `syncedAt` est renseigné.
- Si Firestore échoue (réseau, permissions, service indisponible) : l'erreur est journalisée en console (jamais affichée telle quelle à l'utilisateur), l'évaluation reste `"pending"` localement, **le score reste affiché normalement**.
- `syncPendingEvaluations()` relit les évaluations `"pending"` de chaque profil connu et retente **une seule fois par appel** (pas de boucle de nouvelles tentatives en interne — appelée une fois par connexion/ouverture d'application, voir `js/auth.js`). Aucun risque de boucle infinie : un appel sans évaluation en attente ne fait rien (`attempted: 0`).

---

## Règles Firestore proposées

Voir le fichier séparé **`firestore.rules`** (livré avec ce rapport). Résumé :

- **Lecture** : uniquement ses propres évaluations (`request.auth.uid == userId`).
- **Création** : uniquement sous son propre UID, avec cohérence `id`/`userId` obligatoire.
- **Mise à jour** : réservée à la synchronisation — tous les champs de résultat (`score`, `questions`, `completedAt`, `selection`) et d'identité (`id`, `userId`, `createdAt`) doivent rester **strictement identiques** à la valeur déjà stockée ; seul `syncedAt` peut différer. Impossible pour un utilisateur de modifier un résultat après coup.
- **Suppression** : désactivée côté client pour ce sprint.
- **Piste pour un futur accès administrateur** : documentée en commentaire dans `firestore.rules`, **non activée**, avec un rappel explicite du piège à éviter (fonder la règle sur le rôle de l'auteur de la requête via `get()`, jamais sur le document ciblé).

---

## Index Firestore potentiellement nécessaires (Sprint 5)

Aucun index n'a été créé (aucun ne peut l'être depuis le code : la création d'index Firestore se fait dans la console ou via la CLI Firebase, pas depuis l'application). Recommandations pour le Sprint 5, selon les requêtes qu'il introduira :

| Requête envisagée | Index probablement nécessaire |
|---|---|
| Historique trié par date de fin (`orderBy(completedAt, desc)`, déjà utilisé par `getUserEvaluations()`) | Index simple sur `completedAt` — généralement automatique dans Firestore, à confirmer à l'usage |
| Filtrer par espace **et** trier par date (`where(space == ...) + orderBy(completedAt)`) | Index composite `(space, completedAt)` |
| Trier par score (`orderBy(score.percentage)`) | Index simple sur `score.percentage` (attention : champ imbriqué, à vérifier lors de la création) |
| Filtrer par période **et** trier (`where(completedAt >= ...) + orderBy(completedAt)`) | Généralement couvert par l'index simple sur `completedAt` (inégalité + tri sur le même champ) |

---

## Tests réalisés

**Rappel du contexte, déjà signalé lors des sprints précédents** : cet environnement de travail n'a pas d'accès réseau à Firebase/Firestore. Les tests utilisent un **Firestore simulé en mémoire, avec une vraie sémantique de fusion (`merge:true`)** fidèle au comportement réel, ce qui permet de vérifier authentiquement le mécanisme anti-doublon et la protection de `createdAt`, mais ne remplace pas un test contre le projet réel.

### Suite 1 — `test_evaluation_service.js` (29 vérifications, 29/29 réussies)
Couvre explicitement les 5 scénarios demandés :
- **Enregistrement normal** : utilisateur connecté, évaluation enregistrée localement ET dans Firestore, identifiant identique des deux côtés, aucune donnée de question complète dupliquée (seuls `questionId`/`answerGiven`/`correct`).
- **Nouvelle synchronisation** : la même évaluation resynchronisée ne crée aucun second document ; `createdAt` reste strictement identique après le resync (vérifié explicitement), seul `syncedAt` change.
- **Erreur réseau simulée** : le score reste enregistré localement avec `syncStatus: "pending"`, aucune exception ne remonte à l'appelant.
- **Reconnexion** : `syncPendingEvaluations()` synchronise automatiquement l'évaluation restée en attente, passage à `"synced"` confirmé ; un appel supplémentaire sans rien en attente n'effectue aucune tentative (pas de boucle).
- **Sécurité** : un utilisateur B ne peut lire aucune évaluation appartenant à un utilisateur A (testé avec deux contextes utilisateur distincts sur le même Firestore simulé) ; l'utilisateur propriétaire retrouve bien les siennes.
- **Compatibilité utilisateur non connecté** : aucun utilisateur en contexte → l'évaluation est tout de même enregistrée localement, marquée `"pending"`, sans erreur bloquante.

### Suite 2 — `test_app_integration.js` (12 vérifications, 12/12 réussies)
Exécute le **vrai `js/app.js`**, déroule un quiz complet (thème Législation, uniquement QCM) de bout en bout jusqu'à `showResults()`, et vérifie que :
- `window.PharmevalEvaluationSync.recordCompletedEvaluation` est appelée **exactement une fois**, avec les bonnes données (nombre de questions, score, profil, thème) ;
- chaque question répondue porte bien `_evalAnswerGiven`/`_evalCorrect` ;
- l'indicateur discret affiche un message en français compréhensible, sans aucun terme technique Firebase, cohérent avec le statut renvoyé.

### Suite 3 — Non-régression (rejouée après ce sprint)
- Les 49 tests fonctionnels du moteur de quiz existant (profils, thèmes, QCM, Relier, Arbre décisionnel, Cas évolutif, Flux, statistiques) : **49/49**, rejoués 3 fois consécutives.
- Les 16 tests des modales (signalement, zoom d'image) : **16/16**.
- Les 25 + 16 + 9 tests des Sprints 3 (contexte utilisateur, autorisation, administration) : rejoués sans modification, **tous réussis**, confirmant qu'aucune régression n'a été introduite dans la gestion des rôles ou l'espace d'administration.

**Total : 29 + 12 + 147 + 50 = 238 vérifications automatisées dans cette session, toutes réussies.**

### Non testé dans cet environnement (à valider par vous après déploiement)
- Écriture/lecture réelles contre le projet Firestore `pharmeval-ea3d3`.
- Comportement réel des règles Firestore proposées une fois déployées (test manuel recommandé après publication : tenter de modifier le `score` d'une évaluation existante via la console/dev tools et confirmer le rejet).
- Rendu visuel réel de l'indicateur discret dans un navigateur.

---

## Limites connues

1. **`questionId` synthétique**, pas un vrai identifiant permanent — voir section dédiée ci-dessus. Recommandation formulée pour un sprint de contenu futur.
2. **`answerGiven` hétérogène selon le type de question** : capturé fidèlement pour les QCM classiques (texte de la réponse choisie) ; pour Relier, Arbre décisionnel, Flux et Cas évolutif, une représentation simplifiée est stockée (voir commentaires dans `js/app.js`), suffisante pour l'exactitude (`correct`) mais pas pour un rejeu détaillé exact de ces formats. Documenté comme limite assumée plutôt que de complexifier davantage les 5 gestionnaires de réponse dans ce sprint.
3. **Pas de vraie garantie d'unicité cryptographique** dans le mécanisme de repli si `crypto.randomUUID()` est indisponible (navigateurs très anciens) — acceptable en pratique (horodatage + aléatoire), mais pas une garantie formelle.
4. **Aucune donnée historique antérieure à ce sprint n'est récupérable** (voir section « Structure locale exacte »).
5. **Règles Firestore non déployées** : tant qu'elles ne le sont pas, la protection contre la modification a posteriori d'un résultat n'existe que dans le comportement du code client actuel, pas dans une garantie serveur.

## Possibilité de migrer les anciennes évaluations

**Non, pas dans l'état actuel des données** (voir « Structure locale exacte » ci-dessus) : les compteurs agrégés existants (`quiz_stats_*`) ne contiennent pas assez d'information (pas de date, pas de détail par question, pas de thème) pour être décomposés en évaluations individuelles réalistes. Une « migration » consisterait au mieux à créer une unique évaluation de synthèse par profil résumant les compteurs actuels, mais ce serait une reconstruction approximative, pas une migration fidèle — non recommandé, et de toute façon hors périmètre de ce sprint.

## Recommandations pour le Sprint 5

- Construire l'interface d'historique (déjà préparée : `getUserEvaluations({limit, order})` existe et est testée).
- Ajouter un champ `id` permanent aux questions dans `data/questions.js` (chantier de contenu séparé), pour remplacer `computeQuestionId()` par un vrai identifiant stable.
- Envisager les index composites documentés ci-dessus selon les requêtes réellement utilisées par l'interface d'historique.
- Décider si `answerGiven` doit être enrichi pour les formats non-QCM (Relier, Arbre, Flux, Cas évolutif), si un rejeu détaillé de ces formats s'avère nécessaire.
- Publier les règles Firestore proposées (Sprint 3 + Sprint 4) après relecture humaine, avant toute activation de fonctionnalités s'appuyant sur des données sensibles.
