# CHANGELOG — Pharmeval

Toutes les versions notables du projet sont documentées dans ce fichier.

---

## v2.0.0 — Sprint 9 (Architecture pédagogique)

**Changement de modèle de données — évolution majeure d'architecture, d'où le passage en 2.0.**

### Fonctionnalités ajoutées
- **Modèle de données définitif d'une question** : 21 propriétés (`id`, `pedagogicalId`, `space`, `domain`, `theme`, `subtheme`, `tags`, `difficulty`, `questionType`, `source`, `sourceVersion`, `author`, `reviewer`, `reviewDate`, `version`, `status`, `createdAt`, `updatedAt`, `estimatedTime`, `learningObjectives`, `keywords`) — voir `QUESTION_SCHEMA.md`.
- **Statuts éditoriaux** : `draft`/`review`/`published`/`archived`. Toutes les questions existantes deviennent automatiquement `published`.
- **Versionnement** : `version: 1` pour l'existant, prêt pour l'incrémentation future.
- **Nouvel identifiant pédagogique stable** (`pedagogicalId`, ex. `PHARM-BAP-000124`), qui ne change jamais malgré des corrections de contenu — contrairement à l'identifiant technique existant, basé sur un hachage du texte.
- **Service de tags centralisé** (`js/services/tag-service.js`), réutilisable par le futur moteur de recommandations.
- **Validation des métadonnées** : statut, difficulté, domaine, thème, sous-thème — toujours contre des listes fermées et cohérentes.
- **Poursuite de l'internationalisation** : `THEME_LABELS` (theme-utils.js) devient exportée et complétée (`KNOWN_THEMES`, `THEME_CODES`) ; `tag-service.js` applique le même principe de séparation identifiant technique / libellé affiché aux tags.

### Découverte de compatibilité (identifiée et corrigée avant livraison)
Le champ de difficulté existant (`d`) contient 9 écritures différentes à travers les 949 questions (`essentiel`, `Basique`, `débutant`, `approfondi`, `Intermédiaire`, `intermédiaire`, `expert`, `Expert`, `avancé`). Une fonction de normalisation (`normalizeDifficulty()`) les regroupe en exactement 3 niveaux canoniques, sans modifier `data/questions.js` — vérifiée sur l'intégralité des 949 questions.

### Fichiers créés
- `js/services/question-service.js`
- `js/services/question-metadata-service.js`
- `js/services/tag-service.js`
- `QUESTION_SCHEMA.md`

### Fichiers modifiés
- `js/app.js` — deux lignes ajoutées exposant `THEME_CONFIG` et `themeOfQuestion()` (déjà existants, inchangés) via `window`, même principe déjà établi au Sprint 5 pour `QDB`.
- `js/services/theme-utils.js` — `THEME_LABELS` devient exportée, ajout de `KNOWN_THEMES` et `THEME_CODES` (purement additif).

### Compatibilité
**Aucune question de `data/questions.js` n'est modifiée.** Vérifié sur les 949 questions réelles : aucun plantage, aucune mutation de l'objet source, toutes les 21 propriétés toujours présentes avec des valeurs par défaut sûres et jamais inventées (source, auteur, objectifs pédagogiques restent `null`/`[]` tant qu'ils ne sont pas réellement renseignés).

### Ce qui n'est pas encore construit (préparé uniquement)
Éditeur de questions, import Excel/JSON, campagnes, exploitation des tags par le moteur de recommandations, écran de recherche — aucune interface n'appelle encore ces nouveaux services (« ces données ne devront pas encore être affichées au joueur »).

### Limites connues
- `domain` reprend aujourd'hui la même valeur que `theme` (aucune taxonomie de domaine distincte n'existe encore).
- `pedagogicalId` reste stable par position dans la banque, pas par un identifiant permanent stocké — résiste aux corrections de contenu, pas à une insertion/suppression de questions.
- `tags`/`keywords`/`learningObjectives` restent vides pour toutes les questions existantes (aucune analyse de contenu automatique, pour ne jamais inventer une association non vérifiée).

### Tests
577 vérifications automatisées (56 nouvelles ciblées sur l'architecture pédagogique, dont un balayage complet des 949 questions réelles ; 521 rejouées sans régression). Voir `RAPPORT_SPRINT9.md`.

---

## v1.9.1 — Correctif de sécurité post-déploiement (Sprint 8)

**Correctif ciblé, appliqué après le déploiement du Sprint 8.** Aucune architecture, aucun parcours existant, aucun design modifié.

### Corrections apportées
- **Interdiction complète de l'auto-modification** : un administrateur ne peut désormais modifier **ni son propre rôle, ni son propre statut** (le statut pouvait auparavant être auto-modifié depuis le Sprint 8 — comportement inversé). Message unifié : « Vous ne pouvez pas modifier votre propre rôle ou votre propre statut. »
- **Interface** : dans la fiche du compte connecté, les boutons de changement de statut (Activer/Suspendre/Réactiver) sont désormais masqués, aux côtés des boutons de rôle déjà masqués — remplacés par une mention discrète.
- **Règles Firestore resserrées** : la mise à jour administrative d'un utilisateur est désormais strictement limitée aux champs `role` et `status` via une liste blanche (`diff().affectedKeys().hasOnly(['role','status'])`), remplaçant l'ancienne liste noire de champs protégés. Les valeurs sont explicitement validées (`role in ['user','admin']`, `status in ['pending','active','suspended']`) ; les rôles futurs (Éditeur, Enseignant, Super administrateur) restent dans les constantes applicatives mais sont désormais explicitement rejetés par Firestore tant qu'ils ne sont pas officiellement implémentés.
- **Audit confirmé** : vérifié explicitement qu'aucune entrée d'audit n'est créée pour une action refusée ou échouée (auto-modification, valeur invalide, échec Firestore).

### Fichiers modifiés
- `js/services/admin-service.js` — ajout de la vérification d'auto-modification dans `changeUserStatus()`, message unifié.
- `js/admin.js` — masquage des boutons de statut pour le compte connecté lui-même.
- `firestore.rules` — règle de mise à jour administrative resserrée (liste blanche + validation des valeurs).

### Limite reconfirmée
La protection du dernier administrateur actif reste appliquée **au niveau applicatif uniquement** — aucune règle Firestore ni Cloud Function ne la renforce encore côté serveur. Une Cloud Function déclenchée sur écriture, ou une opération serveur transactionnelle, serait nécessaire pour une garantie réellement robuste. Voir `RAPPORT_CORRECTIF_1.9.1.md` pour le détail complet.

### ⚠️ Publication requise
Si les règles Firestore du Sprint 8 sont déjà déployées, **`firestore.rules` doit être republié manuellement** pour que la restriction des champs et la validation des valeurs soient appliquées côté serveur.

### Tests
25 nouvelles vérifications dédiées (`test_correctif_1_9_1.js`), 2 suites existantes mises à jour pour refléter le changement de comportement intentionnel, 578 vérifications au total rejouées sans régression. Voir `RAPPORT_CORRECTIF_1.9.1.md`.

---

## v1.9.0 — Sprint 8 (Centre d'administration)

### Fonctionnalités ajoutées
- **Tableau des utilisateurs** dans le Centre d'administration : nom, email, profession, organisation, rôle, statut, date d'inscription, dernière connexion.
- **Recherche instantanée** (nom, e-mail, organisation) et **filtres** (rôle : Tous/Utilisateur/Administrateur ; statut : Tous/Actif/En attente/Suspendu), avec pagination (20 par page).
- **Fiche utilisateur détaillée**, avec gestion des rôles (promouvoir/retirer administrateur) et des statuts (activer/suspendre/réactiver), toujours précédée d'une confirmation explicite.
- **Règle absolue implémentée à trois niveaux** (interface, logique métier, règles Firestore proposées) : un administrateur ne peut jamais modifier son propre rôle.
- **Journal d'audit** (`js/services/audit-service.js`, collection Firestore `audit_logs/`) : chaque changement de rôle ou de statut est journalisé (qui, sur qui, quoi, ancienne/nouvelle valeur, date).
- Nouvelles constantes centralisées `STATUSES`/`STATUS_LABELS` (statuts `pending`/`active`/`suspended`), aux côtés de `ROLES`/`ROLE_LABELS` déjà existants — architecture explicitement conçue pour accueillir de futurs rôles (Éditeur, Enseignant, Super administrateur) sans refonte.

### Fichiers modifiés
- `js/services/authorization-service.js` — ajout purement additif de `ROLE_LABELS`, `STATUSES`, `STATUS_LABELS`, `getCurrentStatus()`, `hasStatus()`.
- `js/admin.js` — extension substantielle : tableau, recherche, filtres, fiche détaillée, confirmation, messages. Correctif mineur au passage : masque désormais aussi l'historique en arrière-plan à l'ouverture de l'administration.
- `index.html` — ajout du tableau, des filtres, de la fiche détaillée et de la modale de confirmation.
- `css/styles.css` — styles du Centre d'administration.

### Fichiers créés
- `js/services/user-management-service.js`
- `js/services/admin-service.js`
- `js/services/audit-service.js`
- `firestore.rules` (règles consolidées et mises à jour, proposées, non déployées)

### Sécurité
Trois niveaux de protection contre l'auto-modification de rôle (interface, logique métier, règles Firestore). Nouvelle règle Firestore permettant à un administrateur de modifier le rôle/statut d'un **autre** utilisateur (jamais le sien), fondée sur la relecture du rôle de l'auteur de la requête — jamais sur celui de la cible. Journal d'audit immuable (aucune modification ni suppression possible, y compris par un administrateur).

### Limites connues
- Recherche/filtres/pagination du tableau utilisateurs sont côté client, sur un lot plafonné à 500 comptes.
- Aucune interface de consultation du journal d'audit (la lecture existe, non exposée à l'écran ce sprint).
- Les statuts `pending`/`suspended` ne sont pas encore exploités par la garde d'authentification : un compte suspendu peut toujours se connecter aujourd'hui (préparation uniquement, comme demandé).

### Migration nécessaire
Aucune. Le fonctionnement d'inscription n'a pas été modifié (tout nouveau compte reste `active` comme avant).

### Addendum (même version v1.9.0) — Garantie du dernier administrateur + matrice de permissions
- **Garantie qu'il existe toujours au moins un administrateur actif** : un administrateur ne peut plus être rétrogradé ni suspendu s'il est le dernier administrateur actif de la plateforme (nouvelle fonction `countActiveAdmins()` dans `user-management-service.js`, vérifiée dans `admin-service.js` avec repli sûr en cas de panne Firestore).
- **Vraie matrice de permissions** (`PERMISSIONS`, `ROLE_PERMISSIONS` dans `authorization-service.js`), remplaçant l'ancien raccourci `hasPermission() = isAdmin()`. Les rôles futurs `EDITOR`, `TEACHER`, `SUPER_ADMIN` sont désormais de vraies constantes avec leurs permissions déjà correctement définies, sans être attribuables via l'interface aujourd'hui. Le contrôle d'accès général au Centre d'administration utilise désormais cette matrice (`hasPermission(PERMISSIONS.MANAGE_USERS)`), sans changement de comportement observable actuel.
- Fichiers concernés : `js/services/authorization-service.js`, `js/services/user-management-service.js`, `js/services/admin-service.js`, `js/admin.js`, `firestore.rules`.
- 38 nouvelles vérifications automatisées (`test_last_admin_protection.js` : 14/14, `test_permissions.js` : 24/24), non-régression complète rejouée.
- Limite documentée : la garantie du dernier administrateur actif est appliquée au niveau applicatif, pas encore par une règle Firestore dédiée (voir `firestore.rules` et `RAPPORT_SPRINT8.md`).

### Tests effectués
418 + 38 = 456 vérifications automatisées (règles métier du service d'administration, garantie du dernier administrateur, matrice de permissions, lecture/écriture Firestore simulées, interface complète, non-régression complète de tout le reste du projet) — voir `RAPPORT_SPRINT8.md` pour le détail complet.

---

## v1.8.0 — Sprint 7 (Moteur de recommandations intelligentes)

### Fonctionnalités ajoutées
- Nouvelle section **« Vos recommandations »**, affichée au-dessus de l'Analyse de progression dans le Centre de progression.
- Moteur de recommandations entièrement basé sur des règles explicites (aucune IA, aucun apprentissage automatique), couvrant 6 types : faiblesse identifiée sur un thème, thème oublié, progression, régression, régularité (bon rythme / inactivité), réussite exceptionnelle.
- Chaque recommandation porte un **champ de transparence « Pourquoi cette recommandation ? »**, expliquant concrètement les chiffres à l'origine de la suggestion.
- Priorisation automatique : seules les 3 recommandations les plus pertinentes sont affichées, triées par priorité décroissante.
- Indicateur de confiance (0-100 %) sur chaque recommandation, qui ne prétend jamais à une certitude non justifiée par le volume de données disponible.
- Cas des données insuffisantes (moins de 5 évaluations) : aucune recommandation inventée, message adapté à la place.
- Boutons d'action prévus proprement pour l'évolutivité future (« Voir mes erreurs », « Essayer un niveau plus difficile », actuellement désactivés).

### Fichiers modifiés
- `js/services/statistics-service.js` — ajout de 2 fonctions purement additives (`getThemeRecency`, `calculateActivityMetrics`), aucune fonction existante modifiée.
- `js/statistics.js` — refactor pour exposer `renderStatisticsFromData()`, permettant de partager une seule lecture Firestore entre l'analyse de progression et les recommandations (aucun changement de comportement visible).
- `js/history.js` — une seule lecture Firestore alimente désormais à la fois l'analyse de progression et les recommandations (au lieu d'une lecture dédiée par section).
- `index.html` — section « Vos recommandations » ajoutée.
- `css/styles.css` — styles des cartes de recommandation.
- `js/admin.js` — version affichée mise à jour vers v1.8.0.

### Fichiers créés
- `js/services/recommendation-service.js`
- `js/recommendation.js`

### Règles et seuils
Voir `RAPPORT_SPRINT7.md` pour le détail complet des 6 règles, des 11 seuils centralisés (`RECOMMENDATION_THRESHOLDS`), des formules de priorité et de confiance.

### Limites connues
- Une seule recommandation par type de règle (jamais plusieurs thèmes faibles simultanément).
- Le bouton « Ignorer » n'est pas persistant (réapparaît à la prochaine ouverture si la condition est toujours vraie).
- Actions « Voir mes erreurs » et « Essayer un niveau plus difficile » prévues mais non implémentées (désactivées proprement).
- Analyse plafonnée aux 100 évaluations les plus récentes (héritée du Sprint 6).

### Migration nécessaire
Aucune. Le moteur calcule tout à la demande côté client à partir des évaluations déjà existantes ; aucune nouvelle collection Firestore, aucune donnée de recommandation persistée.

### Tests effectués
339 vérifications automatisées (moteur de règles, interface, non-régression complète de l'historique, de l'analyse de progression et de tout le reste du projet) — voir `RAPPORT_SPRINT7.md` pour le détail complet.

---

## v1.7.0 — Sprint 6 (Analyse de progression personnelle)

### Fonctionnalités ajoutées
- Nouvelle section **« Analyse de progression »**, affichée au-dessus de la liste dans le Centre de progression : nombre d'évaluations, score moyen, meilleur score, dernier score, tendance récente, performance par espace (Étudiant/Pharmacien), thèmes forts et thèmes à retravailler.
- Couleurs des scores dans l'historique : vert (80-100 %), orange (60-79 %), rouge (moins de 60 %) — appliquées uniquement au pourcentage affiché, jamais à toute la carte, avec un libellé textuel disponible en complément de la couleur.
- Nouveaux services purs et réutilisables : `js/services/statistics-service.js` (tout le calcul), `js/services/date-utils.js` et `js/services/score-utils.js` (utilitaires partagés, éliminant une duplication de code entre l'historique et l'analyse).

### Fichiers modifiés
- `js/history.js` — délègue désormais le format de date à `date-utils.js`, colore le pourcentage des cartes/détail via `score-utils.js`, déclenche le chargement de l'analyse à l'ouverture du Centre de progression (lecture Firestore indépendante de la liste).
- `js/services/history-service.js` — ajout d'une fonction dédiée, `getEvaluationsForStatistics()` (lecture unique, plafonnée à 100 évaluations, alimentant tous les indicateurs).
- `index.html` — section « Analyse de progression » ajoutée dans le Centre de progression.
- `css/styles.css` — styles de l'analyse et classes de couleur de score.
- `js/admin.js` — version affichée mise à jour vers v1.7.0.

### Fichiers créés
- `js/services/statistics-service.js`
- `js/services/date-utils.js`
- `js/services/score-utils.js`
- `js/statistics.js`

### Méthodes de calcul
- **Score moyen** : moyenne arithmétique de `score.percentage` déjà enregistré (jamais recalculé question par question).
- **Tendance** : nécessite au moins 10 évaluations ; compare la moyenne des 5 plus récentes à la moyenne des 5 précédentes, avec une marge de stabilité de ±2 points. En-deçà de 10 évaluations, messages adaptés (« pas encore assez de données », ou message dédié pour une seule évaluation).
- **Thèmes forts/à retravailler** : minimum 2 évaluations par thème pour être classé, maximum 3 thèmes par catégorie, tri par moyenne. Thème absent → « Thème non renseigné », jamais inventé.

### Seuils de couleurs
80-100 % vert (« Très bon ») · 60-79 % orange (« À consolider ») · 0-59 % rouge (« À retravailler ») · valeur manquante : neutre. Centralisés dans `js/services/score-utils.js`.

### Limites statistiques
- Analyse plafonnée à 100 évaluations les plus récentes (Option B, documentée à l'écran par un message explicite si l'historique est plus long).
- Deux lectures Firestore indépendantes à l'ouverture (liste paginée à 20, lot dédié aux statistiques à 100) plutôt qu'une lecture partagée, par prudence vis-à-vis de la pagination déjà stable du Sprint 5.
- Aucun filtre temporel (7/30/90 jours) dans ce sprint — architecture prête à les accueillir sans modification des fonctions de calcul.

### Migration nécessaire
Aucune. Aucune nouvelle collection Firestore, aucune statistique écrite en base — tout est calculé à la demande côté client à partir des évaluations déjà existantes.

### Tests effectués
257 vérifications automatisées (calcul statistique, seuils de couleur, utilitaire de dates, rendu de l'interface, non-régression complète de l'historique et de tout le reste du projet) — voir `RAPPORT_SPRINT6.md` pour le détail complet, y compris ce qui n'a pas pu être testé dans cet environnement (lecture réelle contre Firebase, rendu visuel réel).

---

## v1.6.0 — Sprint 5 (Centre de progression & historique des évaluations)

### Fonctionnalités ajoutées
- Nouvel espace **« Mes évaluations »**, accessible depuis l'en-tête pour tout utilisateur connecté.
- Historique paginé (20 évaluations par page, `loadMoreHistory()` pour la suite), lu exclusivement depuis Firestore (`users/{uid}/evaluations`) — le localStorage n'est plus utilisé pour cette vue.
- Cartes d'évaluation (date, espace, score %, fraction bonnes réponses/total), triées de la plus récente à la plus ancienne.
- Détail complet d'une évaluation : paramètres de sélection, et pour chaque question, l'énoncé, la réponse donnée, la bonne réponse et le résultat (correct/incorrect) — l'énoncé et la bonne réponse sont retrouvés localement dans la banque de questions déjà chargée, jamais dupliqués dans Firestore.
- Recherche libre et filtres (Tous/Pharmacien/Étudiant), avec une architecture prévue pour ajouter facilement période/difficulté/thème.
- État vide avec bouton « Commencer une évaluation ».
- Nouveau service `js/services/history-service.js`, centralisant toute lecture Firestore de l'historique — aucun appel Firestore ailleurs dans l'interface.
- Décision d'architecture appliquée : aucun calcul (moyenne, progression...) n'est fait dans cette vue ; elle affiche uniquement les données déjà enregistrées, préparant un futur `statistics-service.js` (Sprint 6) sans qu'il faille modifier l'historique.

### Fichiers modifiés
- `js/app.js` — un seul ajout isolé (`window.PharmevalQDB = QDB;`) pour permettre la résolution locale des questions dans le détail d'une évaluation.
- `index.html` — bouton « Mes évaluations » et vue `#history-view` complète.
- `css/styles.css` — styles du centre de progression, réutilisant strictement la palette et les composants existants.

### Fichiers créés
- `js/services/history-service.js`
- `js/history.js`

### Migration nécessaire
Aucune. Cette vue lit les évaluations déjà synchronisées par le Sprint 4 ; aucune donnée existante n'est modifiée.

### Actions Firebase nécessaires
Aucune action immédiate obligatoire. À surveiller si l'usage augmente significativement : des index Firestore composites (ex. `space` + `completedAt`) pourraient devenir nécessaires pour un filtrage réellement côté serveur (non créés dans ce sprint, voir `RAPPORT_SPRINT5.md`).

### Règles Firestore à publier
Aucune nouvelle règle proposée dans ce sprint (lecture seule, déjà couverte par les règles proposées au Sprint 4 pour `users/{userId}/evaluations/{evaluationId}`).

### Tests à effectuer
Voir `RAPPORT_SPRINT5.md`, section « Non testé dans cet environnement » : validation manuelle contre le vrai projet Firebase (pagination réelle, rendu visuel dans un navigateur).

### Limites connues
- Recherche et filtres ne portent que sur les évaluations déjà chargées (pas sur toute la collection Firestore).
- Le détail d'une évaluation ne peut afficher l'énoncé/la bonne réponse que si la question existe encore sous la même forme dans `data/questions.js`.
- `answerGiven` reste simplifié pour les formats Relier/Arbre décisionnel/Flux/Cas évolutif (limite déjà documentée au Sprint 4).

---

## v1.5.0 — Sprint 4 (Synchronisation des résultats et historique Firestore)

### Fonctionnalités ajoutées
- Enregistrement local (nouveau, additif) de chaque évaluation terminée : `quiz_evaluations_student` / `quiz_evaluations_pharmacist` (tableau détaillé, distinct des compteurs agrégés `quiz_stats_*` déjà existants).
- Synchronisation automatique des évaluations vers Firestore (`users/{uid}/evaluations/{evaluationId}`), avec identifiant stable généré une seule fois (`crypto.randomUUID()`), sans jamais bloquer l'affichage du score en cas d'échec réseau.
- Mécanisme anti-doublon par écriture idempotente (même identifiant = même document, jamais de doublon).
- File d'attente locale : toute évaluation non synchronisée reste marquée `pending` et une nouvelle tentative est effectuée automatiquement à la connexion suivante (`syncPendingEvaluations()`), sans boucle de tentatives répétées.
- Indicateur discret après chaque évaluation : « ✓ Résultat sauvegardé » ou « ✓ Résultat sauvegardé localement — synchronisation en attente » (jamais de message technique Firebase).
- Nouveau service `js/services/evaluation-service.js`, centralisant toute la logique Firestore liée aux évaluations, avec une première fonction de lecture de l'historique (`getUserEvaluations()`) préparée pour le Sprint 5.

### Fichiers modifiés
- `js/app.js` — 6 ajouts minimaux isolés (traçage de la réponse donnée dans les 5 gestionnaires de réponse, appel de synchronisation dans `showResults()`). Aucune logique de score existante modifiée.
- `js/auth.js` — tentative de synchronisation des évaluations en attente à chaque connexion (appel non bloquant).
- `js/admin.js` — version affichée mise à jour vers v1.5.0.
- `index.html` — ajout de l'indicateur discret de synchronisation dans l'écran de résultats.
- `css/styles.css` — style de l'indicateur discret.

### Fichiers créés
- `js/services/evaluation-service.js`
- `firestore.rules` (règles proposées, non déployées)

### Migration nécessaire
Aucune migration de données existantes : les compteurs agrégés (`quiz_stats_*`) restent inchangés et continuent de fonctionner normalement. Le nouvel historique détaillé démarre uniquement à partir des évaluations terminées après le déploiement de cette version — voir `RAPPORT_SPRINT4.md` pour le détail des raisons pour lesquelles les données historiques existantes ne peuvent pas être rétroactivement décomposées en évaluations individuelles.

### Actions Firebase nécessaires
- **Aucune action immédiate obligatoire** : le service fonctionne dès le déploiement du code, en écrivant dans une nouvelle sous-collection Firestore (`users/{uid}/evaluations`), sans configuration préalable requise côté console au-delà de ce qui existe déjà (Firestore déjà activé depuis le Sprint 2).
- **Recommandé avant une mise en production réelle** : publier les règles Firestore proposées dans `firestore.rules`, après relecture humaine.

### Règles Firestore à publier (proposées, non appliquées)
Voir le fichier séparé `firestore.rules` et la section dédiée de `RAPPORT_SPRINT4.md`. Résumé : lecture/écriture strictement limitées à son propre UID, mise à jour restreinte aux seuls champs de synchronisation (le résultat d'une évaluation ne peut pas être modifié après coup), suppression désactivée côté client.

### Tests à effectuer
Voir `RAPPORT_SPRINT4.md`, section « Non testé dans cet environnement » : validation manuelle contre le vrai projet Firebase (écriture/lecture réelles, comportement des règles une fois déployées, rendu visuel de l'indicateur).

### Limites connues
- Identifiant de question synthétique (`computeQuestionId`), en l'absence d'un champ `id` stable dans `data/questions.js` — voir `RAPPORT_SPRINT4.md`.
- Détail de la réponse donnée (`answerGiven`) simplifié pour les formats Relier/Arbre décisionnel/Flux/Cas évolutif (seule l'exactitude `correct` est garantie pour ces formats).
- Aucune donnée historique antérieure à cette version n'est récupérable.

---

## v1.4.0 — Sprint 3 (Gestion des rôles et contrôle d'accès)

- Contexte utilisateur centralisé (`js/services/app-context.js`).
- Service d'autorisation (`js/services/authorization-service.js`) : rôles `user`/`admin`, extensible.
- Première zone d'administration minimale (`js/admin.js`), à double contrôle d'accès (interface + logique métier).
- Règles Firestore proposées pour `users/{userId}` (protection de `role`, `status`, `uid`, `createdAt`).

Voir `RAPPORT_SPRINT3.md` pour le détail complet.

---

## v1.3.0 — Sprint 2 (Moteur de gestion des utilisateurs)

- Création automatique du document utilisateur Firestore à la première connexion.
- Mise à jour automatique (`lastLogin`, `provider`, `displayName`, `photoURL`) à chaque connexion suivante.
- Assistant de première connexion (onboarding) en 4 étapes.

Voir `RAPPORT_SPRINT2.md` pour le détail complet.

---

## v1.2.0 — Migration multi-fichiers

- Transformation de l'application monolithique (~37 Mo, images en base64) en application statique multi-fichiers compatible GitHub Pages.
- 198 images extraites vers `assets/images/`.
- Séparation CSS/JS/données en fichiers dédiés.

Voir `RAPPORT_MIGRATION.md` et `VERSION.md` pour le détail complet.

---

## v1.1.0 — Sprint 1 (Authentification Firebase)

- Authentification Firebase (e-mail/mot de passe, Google), garde d'accès à l'application, déconnexion, persistance de session.

Voir `RAPPORT_TECHNIQUE_PHARMEVAL_v1.1.0.md` pour le détail complet.

---

## v1.0.x — Fusion Étudiant / Pharmacien et corrections qualité

- Fusion des deux applications historiques (Étudiant / Pharmacien) en une version unique à rôles.
- Audit et correction du lot pilote de questions Législation (biais de longueur/style des distracteurs).

Voir les rapports associés (`reinjection-legislation-lot01-rapport.md`, `audit-biais-qcm-synthese.md`, etc.) pour le détail complet.
