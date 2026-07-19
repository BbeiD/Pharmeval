# RAPPORT SPRINT 17 — Moteur de session d'évaluation

**Pharmeval v2.7.0 → v2.8.0**

## 1. Objectif

Permettre à un utilisateur de réellement passer une évaluation depuis le bouton « Commencer » d'une compétence (Sprint 16) : démarrer, répondre, naviguer, sauvegarder automatiquement, reprendre, terminer. **Aucun score, aucune correction, aucune progression** — ce sprint construit le moteur transactionnel, pas l'intelligence pédagogique (Sprint 18).

## 2. Écart de nommage assumé (à lire en premier)

Le cadrage suggère de nommer le service principal `evaluation-service.js`. **Ce nom est déjà pris** par un service du Sprint 4, entièrement différent : la synchronisation des résultats de l'ancien moteur de quiz (`data/questions.js`) vers `users/{uid}/evaluations`, utilisée par « Mes évaluations ». Réutiliser ce nom aurait créé une confusion durable entre deux systèmes sans rapport. Les nouveaux fichiers de ce sprint sont donc nommés explicitement :
- `parcours-evaluation-service.js` (au lieu de `evaluation-service.js`)
- `evaluation-session-service.js` (nom suggéré, libre — utilisé tel quel)
- `evaluation-session-metadata-service.js`, `evaluation-session-catalog-service.js` (subdivision classique du projet, catalogue Firestore séparé de l'orchestration)
- `question-renderer-service.js` (nom suggéré, libre — utilisé tel quel)

Le service Sprint 4 (`evaluation-service.js`) et la page « Mes évaluations » (Sprint 5) ne sont pas touchés par ce sprint.

## 3. Une évaluation, précisément

Une évaluation = un parcours + une compétence + les questions déjà liées à cette compétence (`parcours.competencies[i].questionIds`, Sprint 12). Aucune nouvelle relation n'a été créée : le moteur réutilise exactement ce qui existait déjà entre parcours, compétences et questions.

### 3.1 Jamais de duplication de contenu, toujours des références

Une session ne stocke **jamais** de copie du parcours ou de la compétence — seulement leurs identifiants (`parcoursId`, `competencyId`). Les questions, en revanche, font l'objet d'un **snapshot minimal et immuable**, comme demandé, pour préserver l'intégrité d'une session déjà en cours si une question venait à être modifiée entre-temps.

**Choix retenu pour le snapshot** (documenté comme demandé) — pour chaque question, `questionSnapshot[pedagogicalId]` contient :
- `pedagogicalId`, `version`, `questionType` (identité et type de rendu)
- `question` (énoncé — nécessaire pour un affichage stable, même si la question source est éditée ou supprimée ensuite)
- `answers` (options, **déjà dans l'ordre de présentation figé** — voir mélange ci-dessous)
- `correctAnswer` (clé de correction, déjà remappée sur cet ordre figé)
- `points` (barème éventuel — `null` tant qu'aucun système de notation pondérée n'existe réellement, jamais une valeur inventée)

**Volontairement exclus** du snapshot, pour rester minimal : l'explication pédagogique, les mots-clés, l'auteur, la source, les objectifs pédagogiques. Aucun de ces champs n'est nécessaire pour afficher ou corriger la question pendant la session ; un futur sprint (18, feedback détaillé) décidera séparément s'il faut les relire depuis la Banque de questions ou étendre le snapshot.

### 3.2 Ordre figé, y compris pour les options

Le moteur de quiz historique (`js/app.js`) mélange déjà l'ordre des questions et de leurs options à chaque lancement. Ce sprint reprend le même esprit, mais **une seule fois, au démarrage de la session** : l'ordre des questions et de leurs options est tiré aléatoirement puis **enregistré tel quel** dans la session (`questionIds` + `questionSnapshot[...].answers` déjà réordonnés, `correctAnswer` déjà remappé). Aucun nouveau tirage n'a lieu au chargement ou à la reprise — la session affiche toujours exactement ce qu'elle a affiché la première fois.

## 4. Collection `evaluation_sessions`

Structure conforme à l'indicative du cadrage (voir `js/services/evaluation-session-metadata-service.js` pour le détail commenté champ par champ) : `userId`, `organizationId` (snapshot de Sprint 14 au moment de la création), `parcoursId`, `competencyId`, `assignmentId` (l'attribution Sprint 15 qui a permis l'accès, quand elle est déterminable), `status` (`in_progress` / `submitted` / `abandoned`), `startedAt`, `updatedAt`, `submittedAt`, `questionIds`, `currentQuestionIndex`, `answers` (map), `questionSnapshot` (map), `createdBy`, `version`, plus un tableau `events` (voir section 6).

**Tentatives** (section 4 du cadrage) : `attemptNumber`, `maxAttempts`, `attemptType` sont stockés dès la création (calcul honnête du numéro de tentative réel) mais **non exploités** — aucune vérification ne les lit pour bloquer ou autoriser quoi que ce soit ce sprint, exactement comme demandé.

## 5. Une seule session active, jamais de session vide

Avant toute création, `findActiveSession()` recherche une session `in_progress` pour ce couple (parcours, compétence). Si elle existe, l'interface propose Reprendre/Recommencer plutôt que d'en créer une seconde. Cette règle est appliquée **au niveau applicatif** (comme la prévention de doublon d'attribution au Sprint 15) — documenté honnêtement plutôt que présenté comme une garantie absolue au niveau des règles Firestore, qui ne peuvent pas exprimer nativement « aucun autre document de ce type n'existe déjà ».

Si aucune question publiée n'est disponible pour la compétence, le message exact demandé s'affiche (*« Aucune question n'est actuellement disponible pour cette évaluation. »*) et **aucune session n'est créée** — vérifié avant toute écriture Firestore.

## 6. Audit : choix d'architecture documenté

Le journal d'audit centralisé existant (`audit_logs`, Sprint 8) est **volontairement et strictement réservé aux actions administratives** — ses propres règles Firestore n'autorisent la création qu'aux administrateurs. Un étudiant qui démarre sa propre évaluation n'est pas un administrateur : réutiliser `audit_logs` ici aurait exigé d'affaiblir ce modèle d'accès déjà validé, pour un événement ne concernant qu'un seul utilisateur.

**Choix retenu** : les 4 événements demandés (`evaluation_started`, `evaluation_resumed`, `evaluation_restarted`, `evaluation_submitted`) sont enregistrés dans un tableau `events` **embarqué directement dans le document de la session**, déjà protégé par les mêmes règles de confidentialité stricte que le reste de la session. Aucune nouvelle collection, aucune nouvelle règle, aucun nouvel index n'a donc été nécessaire pour cette traçabilité. Comme demandé, aucun événement n'est généré par réponse — « les réponses sont déjà enregistrées dans la session ».

## 7. Interface (`evaluation.html`)

États couverts (section 16 du cadrage) : chargement, accès refusé (paramètres manquants, parcours non attribué, compétence introuvable), aucune question disponible, session déjà en cours (dialogue Reprendre/Recommencer), en cours de passage, confirmation de fin, session terminée, session déjà soumise, erreur réseau/de sauvegarde — jamais de page blanche ni d'exception JavaScript non gérée.

- **En-tête** : nom du parcours (lien vers la page du parcours), nom de la compétence, fil d'Ariane.
- **Progression** : « Question X sur Y » + barre de progression **descriptive de l'avancement dans le questionnaire, jamais un score**.
- **Navigation compacte** : un bouton numéroté par question, avec distinction visuelle **et textuelle** (attribut `aria-label`, jamais uniquement la couleur — voir accessibilité) entre question actuelle, répondue, non répondue.
- **Précédent / Suivant / Terminer l'évaluation**, navigation libre même sans réponse, modification possible tant que la session est `in_progress`.
- **Indicateur d'enregistrement** discret (*Enregistrement… / Enregistré / Erreur d'enregistrement*), jamais bloquant.
- **Reprise** : dialogue clair, *Reprendre* rouvre la session et restaure toutes les réponses ; *Recommencer* demande une confirmation explicite avant d'abandonner la session en cours (qui n'est **jamais supprimée**, seulement marquée `abandoned`, ses réponses restant intactes).
- **Fin d'évaluation** : confirmation, mention du nombre de questions sans réponse le cas échéant, aucun blocage de la soumission. Après confirmation : dernières réponses enregistrées, session `submitted`, `submittedAt` renseigné, plus aucune modification possible, redirection vers l'état de confirmation.
- **Confirmation finale** : nom du parcours, compétence, nombre de questions, nombre de réponses fournies, date/heure de soumission, message *« Vos résultats détaillés seront disponibles prochainement. »*, bouton *Retour au parcours*. **Aucun score, aucune bonne/mauvaise réponse, aucune explication, aucune progression, aucun certificat.**

## 8. Moteur de rendu des questions (`question-renderer-service.js`)

Registre `{questionType → {renderOptions, readAnswer}}`, jamais un grand bloc conditionnel. **Seul `qcm` (choix unique) est implémenté ce sprint** — vérification faite dans le code du projet lui-même : `question-import-validator.js` (Sprint 10) n'accepte à l'import que `single-choice` (→ `qcm` en interne). Aucune question à choix multiple ni vrai/faux n'existe réellement dans la Banque de questions à ce jour. Conformément à « ne pas inventer de nouveaux types si la banque n'en contient pas », le renderer de choix multiple / vrai-faux n'a **pas** été écrit — seule une entrée supplémentaire au registre sera nécessaire le jour où de telles questions existeront réellement.

Accessibilité : chaque option est un `<label>` associé à un `<input type="radio">` (association native, clic sur le texte = sélection, navigation clavier native), jamais un `<div onclick>`.

## 9. Sécurité

### 9.1 Contrôle d'accès au parcours (section 14)
`prepareEvaluation()` réutilise intégralement `getAssignedParcoursForUser()` (Sprint 15) : attribution directe, par groupe, ou par profil — jamais une simple vérification du statut publié.

### 9.2 Règles Firestore (`evaluation_sessions`)
- Lecture : uniquement ses propres sessions, ou un administrateur (consultation).
- Création : uniquement en son propre nom, uniquement au statut `in_progress`.
- Modification : trois règles dédiées et strictement scindées (autosave pendant `in_progress` ; transition vers `submitted` ; transition vers `abandoned`) — jamais de modification d'une session déjà `submitted`, **y compris par un administrateur** (aucune règle d'écriture n'accorde de bypass administrateur sur cette collection, choix délibérément plus strict que le reste du projet, pour l'intégrité de l'évaluation).
- Suppression : jamais.

### 9.3 Limite honnêtement documentée : confidentialité de la clé de correction
Pour construire le snapshot d'une session, un utilisateur doit pouvoir lire les questions publiées (`questions/{id}`, désormais ouvert en lecture aux utilisateurs authentifiés pour le contenu publié — même principe que `parcours/`/`competencies/` au Sprint 16). Le champ `correctAnswer` de ces documents (et donc du snapshot copié dans la session) reste un champ Firestore ordinaire : **un utilisateur techniquement capable d'inspecter les requêtes réseau de son propre navigateur peut lire la bonne réponse avant d'y répondre.** Cette limite est **inhérente à toute architecture 100 % cliente sans fonction serveur**, telle que Pharmeval l'utilise depuis son origine (elle existait déjà, de façon latente, pour quiconque savait lire `data/questions.js`). Ce sprint ne l'aggrave pas : il rend seulement techniquement accessible ce que l'architecture ne pouvait de toute façon pas empêcher. Une confidentialité réelle de la clé de correction nécessiterait une fonction serveur (Cloud Function) de correction — explicitement hors périmètre (« Sprint 18 : corriger et calculer les résultats »).

## 10. Fichiers créés

**Services** (`js/services/`) :
- `evaluation-session-metadata-service.js`, `evaluation-session-catalog-service.js`, `evaluation-session-service.js`
- `parcours-evaluation-service.js`
- `question-renderer-service.js`

**Interface** :
- `evaluation.html`, `js/evaluation.js`

**Documentation** :
- `RAPPORT_SPRINT17.md`

## 11. Fichiers modifiés

- `js/parcours-detail.js` — le bouton « Commencer » de chaque compétence ouvre désormais réellement `evaluation.html` (au lieu du message d'attente du Sprint 16) ; suppression d'une fonction devenue inutilisée (`showMessage`, aucun code mort).
- `css/styles.css` — styles additifs de la page d'évaluation, responsive et accessibles (focus visible, tailles de cible tactile ≥ 44px).
- `firestore.rules` — lecture de `questions/` publiées ouverte aux utilisateurs authentifiés (nécessaire au snapshot) ; nouvelle collection `evaluation_sessions/`.
- `firestore.indexes.json` — 3 nouveaux index composites (attributions par parcours+cible pour la recherche des cibles côté admin — en réalité déjà nécessaire depuis le Sprint 15 et ajouté ici en complément ; sessions par utilisateur+parcours+compétence+statut ; sessions par utilisateur+parcours+compétence+date).

## 12. Compatibilité et régressions

Aucune modification du moteur d'attribution (Sprint 15), du module Utilisateurs (Sprint 14), de la Banque des compétences (Sprint 13), de l'administration des parcours (Sprint 12), ni de l'ancien moteur de quiz/historique (Sprints 1-5, `evaluation-service.js` et `history-service.js` non touchés). `parcours-detail.html` reste identique à l'exception du seul changement demandé.

## 13. Procédure de déploiement

1. Sauvegarder la version stable actuellement en production (Charte Développement, section 19).
2. Déployer `firestore.rules` et `firestore.indexes.json` **avant** le code applicatif (les nouvelles lectures/écritures de ce sprint échoueraient sinon).
3. Attendre la construction complète des nouveaux index composites côté Firebase (peut prendre plusieurs minutes selon le volume de données existant) avant de considérer le déploiement des règles terminé.
4. Déployer les fichiers statiques (HTML/JS/CSS).
5. Exécuter le scénario de test manuel ci-dessous sur l'environnement de test.
6. Publier en production seulement après validation.

## 14. Scénario de test manuel

1. Se connecter avec un compte ayant au moins un parcours publié, avec au moins une compétence liée à des questions publiées.
2. Ouvrir « Mes parcours » → ouvrir le parcours → cliquer « Commencer » sur une compétence.
3. Vérifier : la première question s'affiche, « Question 1 sur N », barre de progression cohérente.
4. Répondre à la question 1 (choix unique) → vérifier l'indicateur « Enregistrement… » puis « Enregistré ».
5. Cliquer « Suivant » plusieurs fois sans répondre → vérifier que la navigation fonctionne et que la question reste marquée « non répondue » dans la navigation compacte.
6. Revenir en arrière avec « Précédent » → vérifier que la réponse à la question 1 est toujours affichée (restaurée).
7. Modifier la réponse à la question 1 → vérifier la mise à jour de l'indicateur et de la pastille « répondue ».
8. **Rafraîchir la page** (F5) sur la même URL (`evaluation.html?parcoursId=...&competencyId=...`) → vérifier l'apparition du dialogue « Une évaluation est déjà en cours » avec Reprendre/Recommencer.
9. Cliquer « Reprendre » → vérifier que la question courante et toutes les réponses précédentes sont restaurées à l'identique.
10. Cliquer « Terminer l'évaluation » avec des questions sans réponse → vérifier le message « X questions sont encore sans réponse. » et que la confirmation reste possible.
11. Confirmer → vérifier l'état « Évaluation terminée » (parcours, compétence, nombre de questions, nombre de réponses, date) et l'absence totale de score/bonne réponse/explication affichés.
12. Retenter d'ouvrir la même URL d'évaluation → vérifier qu'aucune session `in_progress` n'est retrouvée (la précédente est `submitted`) et qu'une nouvelle tentative démarre normalement (`attemptNumber` = 2).
13. Se connecter avec un second compte n'ayant pas accès à ce parcours → tenter d'ouvrir la même URL directement → vérifier le message d'accès refusé, jamais les questions ni les réponses du premier utilisateur.
14. Répéter l'ensemble sur un écran de smartphone (largeur ≤ 400px) → vérifier que les boutons restent utilisables, que la navigation compacte reste lisible, et qu'aucun élément ne déborde.

## 15. Points non testés contre un environnement Firebase réel

Comme pour tous les sprints précédents, cet environnement de livraison **n'a pas accès à un projet Firebase réel**. N'ont donc pas pu être vérifiés : création/lecture/écriture réelles dans `evaluation_sessions`, comportement réel des nouvelles règles de sécurité (en particulier les trois règles de mise à jour distinctes et leur étanchéité mutuelle), construction réelle des nouveaux index composites, rendu réel de `evaluation.html` dans un navigateur, comportement réel de la sauvegarde automatique en cas de perte de connexion. **Vérifications effectuées dans cet environnement** : syntaxe de l'ensemble des fichiers JavaScript (`node --check`), validité JSON des index, équilibre des accolades/parenthèses des règles, cohérence croisée des identifiants DOM et des fonctions exposées sur `window`, relecture manuelle complète — y compris une correction apportée en cours de relecture (l'ordre d'enregistrement de la position courante, initialement enregistrée avant plutôt qu'après la navigation).

## 16. Statut proposé

**À_TESTER** (Charte Développement, section 22). Ne pas publier en production avant exécution complète du scénario de test manuel (section 14) sur un environnement Firebase réel.
