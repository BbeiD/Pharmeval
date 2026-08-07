# RAPPORT SPRINT 19 — Progression des compétences

**Pharmeval v2.9.0 → v2.10.0**

## 1. Objectif

Transformer une succession de résultats d'évaluation (Sprint 18) en une véritable **progression** par compétence, dans le temps : niveau actuel, tendance, historique, et un score de confiance qui empêche qu'une seule bonne évaluation soit interprétée comme une maîtrise experte.

## 2. Philosophie appliquée : un état, pas un recalcul

« La progression est un état. Les résultats restent des événements. » Concrètement :
- `evaluation_results` (Sprint 18) n'est **jamais relu en masse** pour reconstruire une progression.
- La progression est **mise à jour de façon incrémentale**, un seul document à la fois (état précédent + un nouveau résultat → nouvel état), et **uniquement** au moment où un nouveau résultat est créé.
- La page « Mes compétences » ne fait que **lire** l'état déjà calculé — jamais un recalcul à l'ouverture.

## 3. ProgressionPolicy — la centralisation demandée

`js/services/progression-policy-service.js` regroupe **tous** les seuils : variation de tendance (> +5 % → En progression, < −5 % → En diminution), bandes de niveau (Découverte/Débutant/Intermédiaire/Avancé/Expert), et la formule du score de confiance. Même architecture que `CorrectionPolicy` (Sprint 18) : état modifiable à l'exécution, jamais une constante figée — prête à varier par organisation/parcours plus tard sans revoir la forme des objets.

### 3.1 Le niveau tient compte du nombre d'évaluations, pas seulement du score

Chaque bande de niveau exige **à la fois** un pourcentage moyen minimal **et** un nombre minimal d'évaluations (ex. Expert : moyenne ≥ 90 % **et** ≥ 10 évaluations). C'est ce second critère qui répond directement à l'exemple donné dans le cadrage : un pharmacien à 100 % sur une seule évaluation ne peut pas atteindre Expert — avec les seuils par défaut, il obtient **Débutant** (1 évaluation ≥ 25 %, mais pas assez pour Intermédiaire qui exige 2 évaluations). À l'inverse, 92 % sur 18 évaluations atteint Expert (≥ 90 % et ≥ 10 évaluations).

### 3.2 Score de confiance (le petit plus demandé)

`computeConfidenceScore()` combine trois sous-scores (0-100 chacun), pondérés :
- **Volume** (poids 0,5) : proportion du nombre d'évaluations par rapport à une cible (10 par défaut).
- **Récence** (poids 0,25) : 100 si la dernière évaluation date de ≤ 30 jours, décroissant linéairement jusqu'à 0 à 180 jours.
- **Régularité** (poids 0,25) : mesure l'espacement des évaluations dans le temps (coefficient de variation des intervalles) — neutre (50) tant qu'il n'y a pas assez de points pour l'évaluer.

Une formule volontairement simple, comme demandé, mais réellement basée sur les trois critères cités (nombre, régularité, récence) — pas une approximation arbitraire.

## 4. Architecture des données

### 4.1 Collection `competency_progress`

Un document par **utilisateur + compétence**, avec un **identifiant déterministe** (`${userId}_${competencyId}`) : garantit nativement « un document par utilisateur et par compétence » sans jamais avoir besoin d'une requête de vérification avant écriture, et permet à la fois une lecture directe (sans requête) et une validation simple des règles Firestore.

Champs conformes à l'indicative du cadrage : `userId`, `competencyId`, `organizationId`, `evaluationCount`, `bestPercent`, `lastPercent`, `averagePercent`, `trend`, `firstEvaluationAt`, `lastEvaluationAt`, `updatedAt`, plus `currentLevel`, `masteryStatus` (réutilise directement l'échelle déjà définie par `CorrectionPolicy`, Sprint 18 — jamais une nouvelle échelle parallèle) et `confidenceScore`.

### 4.2 Historique jamais perdu

`history` est un tableau **append-only** de `{date, percent, resultId}` — chaque nouvelle évaluation y ajoute une entrée, aucune ancienne valeur n'est jamais écrasée ou supprimée. Cet historique alimente directement le graphique d'évolution et la liste chronologique de la page « Mes compétences ».

### 4.3 EvaluationSession → EvaluationResult → CompetencyProgress

Le point d'intégration est unique et clairement identifié : `evaluation-result-service.js` (Sprint 18), juste après avoir enregistré un `EvaluationResult`, appelle `updateProgressionFromResult()`. **Aucun autre endroit du projet ne déclenche cette mise à jour.** En cas d'échec (réseau, etc.), l'échec est journalisé mais **n'annule jamais** le résultat déjà enregistré — la progression reste secondaire par rapport à l'intégrité du résultat lui-même.

## 5. Page « Mes compétences »

- **Vue d'ensemble** : radar SVG simple des compétences principales (les 8 plus évaluées, pour rester lisible), généré **uniquement à partir des niveaux déjà calculés** — jamais un recalcul de résultats.
- **Liste** : une carte par compétence (nom, niveau, meilleure/dernière performance, tendance, nombre d'évaluations).
- **Détail** (au clic) : chiffres clés (y compris le score de confiance, expliqué en une phrase), un graphique d'évolution simple (ligne brisée SVG), et l'historique chronologique complet.
- Aucune recommandation, comparaison ou classement — hors périmètre explicite.

## 6. Intégrations

- **Depuis le résultat d'une évaluation** (Sprint 18) : nouveau lien « 🧠 Voir ma progression », pointant directement vers la compétence concernée (`mes-competences.html?competencyId=...`).
- **Depuis l'espace utilisateur** : nouveau lien « Mes compétences » dans l'en-tête, à côté de « Mes parcours » (Sprint 15).

**Note d'interprétation** (à signaler honnêtement) : le cadrage mentionne également l'ajout de « Mes compétences / Performance » *« depuis le tableau utilisateur »*, une formulation ambiguë pouvant désigner soit l'espace personnel de l'utilisateur, soit la fiche d'un utilisateur dans le module d'administration (Sprint 14). Ce sprint retient la première interprétation (espace personnel), cohérente avec le reste du périmètre (« Ne pas développer : statistiques administrateur »). Une vue de consultation par un administrateur, si elle est réellement souhaitée, pourra être ajoutée dans un sprint dédié sans revoir l'architecture posée ici (la lecture administrateur est déjà autorisée par les règles Firestore).

## 7. Sécurité

- Lecture : un utilisateur ne peut lire que sa propre progression (règle Firestore + revérification applicative). Les administrateurs conservent un accès en lecture.
- Écriture : réservée à l'utilisateur concerné, avec vérification que l'identifiant du document correspond bien à sa paire (utilisateur, compétence) déclarée — empêche d'écrire dans la progression de quelqu'un d'autre ou avec un identifiant incohérent.
- **Limite documentée**, de la même famille que celles déjà notées aux Sprints 17-18 : la progression est calculée et écrite par le client (pas de fonction serveur dans Pharmeval) — les règles protègent le rattachement (qui/quelle compétence) mais ne vérifient pas l'exactitude arithmétique de l'agrégation elle-même.

## 8. Audit

Même solution déjà établie et documentée aux Sprints 17-18 : `audit_logs` (Sprint 8) reste strictement réservé aux actions administratives par ses propres règles. L'événement `competency_progress_updated` est donc enregistré dans un tableau `events` **embarqué dans le document `competency_progress` lui-même**, déjà protégé par les mêmes règles de confidentialité. Aucune nouvelle collection d'audit.

## 9. Fichiers créés

- `js/services/progression-policy-service.js`
- `js/services/competency-progress-metadata-service.js`
- `js/services/competency-progress-catalog-service.js`
- `js/services/competency-progress-service.js`
- `mes-competences.html`, `js/mes-competences.js`
- `RAPPORT_SPRINT19.md`

## 10. Fichiers modifiés

- `js/services/evaluation-result-service.js` (Sprint 18) — appel (best-effort) de `updateProgressionFromResult()` après la création du résultat.
- `evaluation-result.html`, `js/evaluation-result.js` — lien « Voir ma progression ».
- `index.html` — lien « Mes compétences » dans l'en-tête.
- `css/styles.css` — styles additifs (radar, légende), responsive.
- `firestore.rules` — nouvelle collection `competency_progress/`.
- `firestore.indexes.json` — 1 nouvel index composite (`userId` + `lastEvaluationAt`, pour la liste « Mes compétences »).

**Aucune modification** de `evaluation-correction-service.js`, `evaluation-session-service.js` ni des fichiers du moteur de session/correction (Sprints 17-18).

## 11. Compatibilité et régressions

Aucune modification du moteur de session/correction, du moteur d'attribution, du module Utilisateurs, de la Banque des compétences, ni de l'administration des parcours. Une évaluation déjà soumise avant ce sprint ne possède simplement aucune progression tant qu'aucune nouvelle évaluation n'est réalisée sur la même compétence après le déploiement — pas une régression, un état neutre honnête.

## 12. Procédure de déploiement

1. Sauvegarder la version stable actuellement en production.
2. Déployer `firestore.rules` et `firestore.indexes.json` **avant** le code applicatif.
3. Attendre la construction complète du nouvel index composite côté Firebase.
4. Déployer les fichiers statiques (HTML/JS/CSS).
5. Exécuter le scénario de test manuel ci-dessous.
6. Publier en production seulement après validation.

## 13. Tests

**Vérifications effectuées dans cet environnement** : syntaxe de l'ensemble des fichiers JavaScript, validité JSON des index, équilibre des accolades/parenthèses des règles et du CSS, cohérence croisée des identifiants DOM, relecture manuelle complète du moteur de calcul de progression (niveaux, tendance, score de confiance).

**Scénario à exécuter sur un environnement Firebase réel** :
1. Réaliser une première évaluation sur une compétence → vérifier la création du document de progression, niveau « Débutant » ou « Découverte » selon le score, tendance « Stable » (pas de comparaison possible).
2. Réaliser une deuxième évaluation avec un score nettement supérieur (> +5 points) → vérifier la tendance « En progression » et la mise à jour de `bestPercent`/`lastPercent`/`averagePercent`.
3. Réaliser une évaluation avec un score nettement inférieur → vérifier « En diminution ».
4. Réaliser plusieurs évaluations à haut score sur une courte période → vérifier que le niveau ne passe à « Expert » qu'une fois le nombre minimal d'évaluations atteint, pas dès le premier score élevé.
5. Vérifier l'affichage du radar (au moins 3 compétences distinctes évaluées) et du graphique d'évolution (au moins 2 évaluations sur une même compétence).
6. Vérifier le lien « Voir ma progression » depuis un résultat d'évaluation.
7. Se connecter avec un second compte, tenter d'accéder à la progression du premier (URL directe) → vérifier le refus.
8. Vérifier l'affichage sur smartphone (≤ 400px) : radar et graphique d'évolution restent lisibles sans débordement.

## 14. Statut proposé

**À_TESTER** (Charte Développement, section 22). Ne pas publier en production avant exécution du scénario de test manuel sur un environnement Firebase réel.
