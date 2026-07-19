# RAPPORT SPRINT 18 — Correction automatique et résultats

**Pharmeval v2.8.0 → v2.9.0**

## 1. Objectif

Corriger automatiquement une évaluation soumise (Sprint 17), calculer un score global et un résultat par compétence, et afficher un rapport pédagogique — sans encore rien construire de la progression long terme (historique, tableau de bord, badges, certificats : Sprints suivants).

## 2. Philosophie appliquée : le résultat par compétence prime

Conformément à la demande (« le résultat par compétence est prioritaire »), l'architecture calcule d'abord un `CompetencyResult` par compétence couverte par la session, puis en déduit le score global par agrégation — jamais l'inverse. Le score global n'est donc pas une valeur indépendante : c'est la somme cohérente des résultats par compétence.

## 3. CorrectionPolicy — la seule évolution ajoutée en cours de cadrage

`js/services/correction-policy-service.js` centralise **tous** les seuils et règles de calcul : seuil « Maîtrisée » (≥ 80 % par défaut), seuil « À renforcer » (≥ 50 %), sinon « Non acquise » ; règle de prise en compte des questions sans réponse dans le dénominateur ; mode d'arrondi ; méthode de notation des choix multiples (préparée, non exploitée). **Aucun autre fichier du projet ne code un seuil ou une règle d'arrondi en dur** — `evaluation-correction-service.js` lit systématiquement `getCorrectionPolicy()`.

La politique est exposée comme un état modifiable à l'exécution (`getCorrectionPolicy()` / `setCorrectionPolicy()`), pas une constante figée — même principe déjà utilisé pour la limite de balayage de recherche (Sprint 11). Aujourd'hui une seule politique globale s'applique à toutes les corrections ; l'architecture n'aura pas à être revue pour introduire une politique par organisation, parcours ou certification plus tard : il suffira de faire porter une politique différente au niveau approprié, sans changer la forme des objets ni les appelants.

**Chaque résultat enregistre la politique réellement appliquée** (`policyApplied`) au moment du calcul — garantit qu'un résultat déjà rendu reste historiquement exact même si la politique globale change ensuite (même principe d'intégrité que le snapshot de question, Sprint 17).

## 4. Architecture des objets métier (section 10 du cadrage)

```
EvaluationSession (Sprint 17, jamais modifiée)
  └─▶ EvaluationResult          (score global, evaluation-correction-service.js)
        └─▶ CompetencyResult[]  (un par compétence — toujours 1 aujourd'hui, voir note ci-dessous)
              └─▶ QuestionResult[]  (un par question : correcte/incorrecte/non répondue, réponse utilisateur, bonne réponse, horodatage)
```

**Note d'évolutivité** : une session (Sprint 17) couvre aujourd'hui exactement une compétence. `EvaluationResult.competencyResults` est néanmoins un **tableau**, pas un objet unique : si une future session couvre plusieurs compétences à la fois, ce moteur n'aura qu'à grouper les questions par compétence avant de construire plusieurs `CompetencyResult` — aucune refonte de la forme du résultat.

## 5. Moteur de correction (`evaluation-correction-service.js`)

Pure fonction : aucun appel Firestore, aucun effet de bord. Registre `{questionType → correcteur}`, exactement le même principe que le moteur de rendu (Sprint 17) — jamais un bloc conditionnel géant. **Seul « qcm » (choix unique) est implémenté**, pour la même raison déjà établie au Sprint 17 : c'est l'unique type réellement présent dans la Banque de questions (l'import ne permet que « single-choice »). Choix multiple et vrai/faux ne sont donc pas codés, uniquement réservés dans `CorrectionPolicy` (`MULTI_CHOICE_SCORING_METHODS`) — une entrée supplémentaire au registre suffira le jour où ces types existeront réellement.

## 6. Stockage : `evaluation_results`, séparée de `evaluation_sessions`

Nouvelle collection contenant **uniquement** les résultats calculés — `evaluation_sessions` (les réponses de l'utilisateur) n'est ni lue en écriture ni modifiée par ce sprint. « Une session représente ce que l'utilisateur a répondu. Un résultat représente ce que le système a calculé. »

**Choix d'implémentation notable** : l'identifiant du document `evaluation_results/{id}` est **toujours identique** à l'identifiant de la session corrigée. Conséquences : un résultat par session est nativement garanti (jamais deux), et le retrouver ne nécessite jamais de requête — une simple lecture par identifiant, comme pour tous les autres accès de la page de résultat.

**Écriture unique** : « le calcul doit être réalisé une seule fois, au moment de la soumission » est appliqué au niveau des règles Firestore elles-mêmes (`allow update: if false`), pas seulement au niveau applicatif.

## 7. Intégration avec la soumission (Sprint 17)

Nouveau service d'orchestration `evaluation-result-service.js`, avec une fonction unique `finalizeEvaluation(session)` qui **réutilise `submitSession()` du Sprint 17 telle quelle, sans la modifier**, puis enchaîne correction et enregistrement. `evaluation.js` (page de passage, Sprint 17) appelle désormais `finalizeEvaluation()` au lieu de `submitSession()` directement, et redirige vers la nouvelle page de résultat plutôt que d'afficher l'état minimal local du Sprint 17 (« Évaluation terminée » sans score) — logiquement remplacé, retiré proprement (aucun code mort laissé derrière).

**Gestion honnête d'un cas d'échec partiel** : si la soumission réussit mais que la correction ou son enregistrement échoue (panne réseau, etc.), l'utilisateur voit un message explicite indiquant que son évaluation est bien soumise (définitif, jamais remis en cause) mais que le rapport n'a pas pu être généré — jamais une redirection silencieuse vers une page cassée.

## 8. Page de résultat (`evaluation-result.html`)

- **Score global** : pourcentage, bonnes/mauvaises réponses, sans réponse, avec un **graphique simple** (donut SVG minimal, sans bibliothèque externe, purement descriptif).
- **Résultats par compétence** : cartes avec statut (Maîtrisée / À renforcer / Non acquise, badge coloré) et détail des comptages.
- **Détail des questions** : énoncé, réponse de l'utilisateur, bonne réponse (affichée uniquement si la réponse n'était pas déjà correcte), statut, et **explication si elle existe encore** dans la Banque de questions — relue en direct au moment de l'affichage (jamais stockée dans le résultat ni dans le snapshot de session, conformément au choix déjà documenté au Sprint 17 de garder ce snapshot minimal).
- **Aucun** historique, progression, comparaison ou classement — hors périmètre explicite.
- **Navigation** : Retour au parcours (`parcours-detail.html?id=...`), Retour à mes parcours — jamais vers l'administration.
- Ne recalcule jamais rien : relit exclusivement le document déjà enregistré.

## 9. Sécurité

- **Lecture** : un utilisateur ne peut lire que ses propres résultats (règle Firestore + revérification applicative dans `getResultForCurrentUser()`). Les administrateurs conservent un accès en lecture (consultation), comme pour les sessions.
- **Écriture** : la règle de création vérifie, via `get()`, que le résultat est rattaché à une session **réellement soumise et appartenant au demandeur** — empêche de fabriquer un résultat pour une session inexistante, d'autrui, ou encore en cours.
- **Limite honnêtement documentée** (même famille que celle déjà notée au Sprint 17 pour `correctAnswer`) : le résultat est calculé **et écrit par le client**, faute de fonction serveur dans l'architecture actuelle de Pharmeval. Les règles empêchent de fabriquer un résultat hors contexte, mais ne vérifient pas l'exactitude arithmétique du score lui-même (reproduire toute la logique de correction en langage de règles Firestore serait fragile et hors de portée raisonnable pour ce sprint). Une garantie complète nécessiterait une fonction serveur de correction — non demandée, hors périmètre.

## 10. Audit

Mêmes principes et même solution que le Sprint 17 (documentée une nouvelle fois ici pour ne pas être manquée) : le journal d'audit centralisé (`audit_logs`, Sprint 8) est strictement réservé aux actions administratives par ses propres règles — un étudiant qui termine sa propre évaluation n'en fait pas partie. Les deux événements demandés (`evaluation_corrected`, `evaluation_result_created` — le second étant implicite dès que le document est créé) sont enregistrés dans un tableau `events` **embarqué dans le document `evaluation_results` lui-même**, déjà protégé par les mêmes règles de confidentialité stricte. Aucune nouvelle collection d'audit, aucune nouvelle règle dédiée.

## 11. Fichiers créés

- `js/services/correction-policy-service.js`
- `js/services/evaluation-correction-service.js`
- `js/services/evaluation-result-catalog-service.js`
- `js/services/evaluation-result-service.js`
- `evaluation-result.html`, `js/evaluation-result.js`
- `RAPPORT_SPRINT18.md`

## 12. Fichiers modifiés

- `js/evaluation.js` (Sprint 17) — `confirmSubmit()` appelle désormais `finalizeEvaluation()` au lieu de `submitSession()` directement, et redirige vers `evaluation-result.html` ; suppression de l'état local `ev-finished`, devenu inutile (aucun code mort laissé).
- `evaluation.html` — retrait du bloc `#ev-finished`, remplacé par la nouvelle page.
- `css/styles.css` — styles additifs de la page de résultat, responsive.
- `firestore.rules` — nouvelle collection `evaluation_results/` (écriture unique, vérifiée par rattachement à une session réellement soumise et possédée par le demandeur).

**Aucune modification** de `js/services/evaluation-session-service.js`, `evaluation-session-catalog-service.js`, `evaluation-session-metadata-service.js`, `parcours-evaluation-service.js` ni `question-renderer-service.js` (Sprint 17) — la correction s'appuie dessus sans y toucher.

**Aucune modification de `firestore.indexes.json`** : ce sprint ne fait que des lectures/écritures de documents individuels par identifiant, jamais de nouvelle requête composée.

## 13. Compatibilité et régressions

Aucune modification du moteur d'attribution, du module Utilisateurs, de la Banque des compétences, de l'administration des parcours, ni de l'ancien moteur de quiz/historique (Sprints 1-5). Le moteur de session d'évaluation (Sprint 17) reste fonctionnellement identique jusqu'à l'instant de la soumission finale.

## 14. Procédure de déploiement

1. Sauvegarder la version stable actuellement en production.
2. Déployer `firestore.rules` **avant** le code applicatif (aucun changement d'index requis ce sprint).
3. Déployer les fichiers statiques (HTML/JS/CSS).
4. Exécuter le scénario de test manuel ci-dessous sur l'environnement de test.
5. Publier en production seulement après validation.

## 15. Tests réalisés / scénario de test manuel

**Vérifications effectuées dans cet environnement** : syntaxe de l'ensemble des fichiers JavaScript (`node --check`), équilibre des accolades/parenthèses des règles et du CSS, cohérence croisée des identifiants DOM, relecture manuelle complète du moteur de correction (calculs de pourcentage, seuils, agrégation) et des règles de sécurité.

**Scénario à exécuter sur un environnement Firebase réel** (non disponible ici) :
1. Terminer une évaluation avec 100 % de bonnes réponses → vérifier « Maîtrisée », 100 %, aucune mauvaise réponse affichée en détail.
2. Terminer une évaluation avec 100 % de mauvaises réponses → vérifier « Non acquise », 0 %, bonne réponse affichée pour chaque question.
3. Terminer une évaluation avec des questions non répondues → vérifier qu'elles comptent dans le dénominateur (politique par défaut) et s'affichent comme « Sans réponse », sans bonne/mauvaise réponse erronément indiquée.
4. Terminer une évaluation avec un mélange bonnes/mauvaises → vérifier l'exactitude du pourcentage et du statut selon les seuils par défaut (80 % / 50 %).
5. Vérifier l'affichage de l'explication pour une question dont la Banque de questions contient une explication, et son absence totale (aucun bloc vide) pour une question qui n'en a pas.
6. Se déconnecter puis se reconnecter, rouvrir l'URL du résultat → vérifier que le résultat s'affiche à l'identique (aucun recalcul, même score).
7. Tenter de modifier le résultat (ex. rejouer la soumission) → vérifier l'impossibilité (règle `allow update: if false`).
8. Se connecter avec un second compte, tenter d'ouvrir l'URL du résultat du premier utilisateur → vérifier le refus d'accès, jamais l'affichage des réponses d'autrui.
9. Vérifier l'affichage sur un écran de smartphone (≤ 400px) : graphique, cartes de compétence et détail des questions restent lisibles sans débordement.

## 16. Limite connue non liée à la sécurité

Course critique mineure, préexistante à ce sprint (architecture Sprint 17, non introduite ici) : si un utilisateur modifie une réponse et clique immédiatement sur « Terminer l'évaluation » avant que la sauvegarde automatique de cette dernière réponse n'ait fini de s'exécuter, il existe une fenêtre théorique très brève où cette dernière modification pourrait ne pas être prise en compte par la correction. Non corrigé dans ce sprint (hors périmètre : concerne le moteur de session, pas la correction elle-même), noté ici pour transparence plutôt que passé sous silence.

## 17. Statut proposé

**À_TESTER** (Charte Développement, section 22). Ne pas publier en production avant exécution du scénario de test manuel (section 15) sur un environnement Firebase réel.
