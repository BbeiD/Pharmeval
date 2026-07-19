# CHANGELOG — Pharmeval

Toutes les versions notables du projet sont documentées dans ce fichier.

---

## v2.10.0 — Sprint 19 (Progression des compétences)

### Fonctionnalités ajoutées
- **Progression des compétences dans le temps** : nouvelle collection `competency_progress` (un document par utilisateur + compétence, identifiant déterministe), mise à jour incrémentale déclenchée uniquement à la création d'un nouveau résultat d'évaluation (Sprint 18) — jamais un recalcul global.
- **ProgressionPolicy** (`progression-policy-service.js`) : seuils de tendance, bandes de niveau (Découverte à Expert, exigeant à la fois un score moyen et un nombre minimal d'évaluations), formule de score de confiance — centralisés, jamais codés en dur.
- **Score de confiance** (le petit plus demandé) : combine volume, récence et régularité des évaluations, pour éviter qu'une seule bonne évaluation soit interprétée comme une maîtrise experte.
- **Nouvelle page « Mes compétences »** (`mes-competences.html`) : radar simple des compétences principales, liste avec niveau/tendance/performances, détail par compétence avec graphique d'évolution et historique complet (jamais perdu).
- **Intégrations** : lien « Voir ma progression » depuis le résultat d'une évaluation, lien « Mes compétences » dans l'en-tête de l'application.

### Fichiers créés
- `js/services/progression-policy-service.js`, `competency-progress-metadata-service.js`, `competency-progress-catalog-service.js`, `competency-progress-service.js`
- `mes-competences.html`, `js/mes-competences.js`
- `RAPPORT_SPRINT19.md`

### Fichiers modifiés
- `js/services/evaluation-result-service.js` (Sprint 18) — déclenchement (best-effort) de la mise à jour de progression après la création d'un résultat.
- `evaluation-result.html`, `js/evaluation-result.js` — lien « Voir ma progression ».
- `index.html` — lien « Mes compétences ».
- `css/styles.css` — styles additifs, responsive.
- `firestore.rules` — nouvelle collection `competency_progress/`.
- `firestore.indexes.json` — 1 nouvel index composite.

### Compatibilité
Aucune modification du moteur de session/correction (Sprints 17-18), du moteur d'attribution, du module Utilisateurs, ni de la Banque des compétences.

### Sécurité — limite documentée
Même famille de limite que les Sprints 17-18 : la progression est calculée et écrite par le client ; les règles protègent le rattachement utilisateur/compétence mais ne vérifient pas l'exactitude arithmétique de l'agrégation — voir `RAPPORT_SPRINT19.md`, section 7.

### Tests
Vérification syntaxique complète, validité JSON des index, équilibre des règles/CSS, cohérence croisée des identifiants DOM, relecture manuelle du moteur de calcul. **Aucun test fonctionnel réel sur un projet Firebase** — voir `RAPPORT_SPRINT19.md`, section 13.

---

## v2.9.0 — Sprint 18 (Correction automatique et résultats)

### Fonctionnalités ajoutées
- **Correction automatique** d'une évaluation soumise (Sprint 17) : moteur pur (`evaluation-correction-service.js`), registre extensible par type de question (seul « qcm » implémenté, seul type réel).
- **CorrectionPolicy** (`correction-policy-service.js`) : seuils de maîtrise, règle des questions sans réponse, mode d'arrondi, méthode de notation multi-choix (préparée) — centralisés, jamais codés en dur ; chaque résultat enregistre la politique réellement appliquée pour rester historiquement exact.
- **Architecture EvaluationSession → EvaluationResult → CompetencyResult → QuestionResult**, conçue pour accueillir demain plusieurs compétences par session sans refonte.
- **Nouvelle collection `evaluation_results`**, séparée de `evaluation_sessions`, écriture unique (jamais recalculée, jamais modifiée).
- **Nouvelle page « Résultat de l'évaluation »** (`evaluation-result.html`) : score global avec graphique simple (donut SVG), résultats par compétence (statut Maîtrisée/À renforcer/Non acquise), détail des questions avec explication si disponible, navigation vers le parcours ou « Mes parcours » (jamais l'administration).

### Fichiers créés
- `js/services/correction-policy-service.js`, `evaluation-correction-service.js`, `evaluation-result-catalog-service.js`, `evaluation-result-service.js`
- `evaluation-result.html`, `js/evaluation-result.js`
- `RAPPORT_SPRINT18.md`

### Fichiers modifiés
- `js/evaluation.js` (Sprint 17) — soumission redirige désormais vers la correction puis le résultat, retrait propre de l'état local devenu inutile.
- `evaluation.html` — retrait du bloc de confirmation minimal du Sprint 17.
- `css/styles.css` — styles additifs, responsive.
- `firestore.rules` — nouvelle collection `evaluation_results/` (écriture unique, rattachement vérifié à une session soumise et possédée par le demandeur).

### Compatibilité
Aucune modification du moteur de session d'évaluation (Sprint 17, `evaluation-session-service.js` et fichiers associés non touchés), du moteur d'attribution, du module Utilisateurs, de la Banque des compétences, ni de l'administration des parcours. Aucun index Firestore modifié.

### Sécurité — limite documentée
Le résultat est calculé et écrit par le client (pas de fonction serveur dans l'architecture actuelle) ; les règles empêchent de fabriquer un résultat hors contexte mais ne vérifient pas l'exactitude arithmétique du score — voir `RAPPORT_SPRINT18.md`, section 9.

### Tests
Vérification syntaxique complète, équilibre des règles/CSS, cohérence croisée des identifiants DOM, relecture manuelle du moteur de calcul. **Aucun test fonctionnel réel sur un projet Firebase** — voir `RAPPORT_SPRINT18.md`, section 15.

---

## v2.8.0 — Sprint 17 (Moteur de session d'évaluation)

### Fonctionnalités ajoutées
- **Passage réel d'une évaluation** depuis « Commencer » (Sprint 16) : nouvelle page `evaluation.html`, démarrage, réponse, navigation libre entre questions, modification des réponses, sauvegarde automatique (indicateur discret), reprise d'une session en cours, terminaison volontaire avec confirmation.
- **Nouvelle collection Firestore `evaluation_sessions`** : une session = un parcours + une compétence + les questions déjà liées, toujours par référence (jamais de duplication de contenu). Snapshot minimal et immuable des questions (énoncé, options déjà mélangées et figées, clé de correction, barème éventuel) pour préserver l'intégrité d'une session même si une question est modifiée plus tard — choix d'architecture documenté en détail dans `RAPPORT_SPRINT17.md`.
- **Une seule session active** par utilisateur/parcours/compétence, dialogue Reprendre/Recommencer, `attemptNumber`/`maxAttempts`/`attemptType` préparés (non exploités).
- **Moteur de rendu de questions extensible** (`question-renderer-service.js`) : registre par type, seul « qcm » (choix unique) implémenté — c'est le seul type réellement présent dans la Banque de questions à ce jour.
- **Confirmation de fin d'évaluation** : nom du parcours, compétence, nombre de questions, réponses fournies, date/heure — explicitement aucun score, aucune bonne/mauvaise réponse, aucune progression.
- Accessibilité et responsive : labels associés, navigation clavier, focus visible, distinction non basée uniquement sur la couleur, utilisable sur smartphone.

### Fichiers créés
- `js/services/evaluation-session-metadata-service.js`, `evaluation-session-catalog-service.js`, `evaluation-session-service.js`
- `js/services/parcours-evaluation-service.js` (écart de nommage assumé et documenté — voir `RAPPORT_SPRINT17.md`, section 2)
- `js/services/question-renderer-service.js`
- `evaluation.html`, `js/evaluation.js`
- `RAPPORT_SPRINT17.md`

### Fichiers modifiés
- `js/parcours-detail.js` — « Commencer » ouvre réellement l'évaluation.
- `css/styles.css` — styles additifs, responsive et accessibles.
- `firestore.rules` — lecture des questions publiées ouverte aux utilisateurs authentifiés (nécessaire au snapshot) ; nouvelle collection `evaluation_sessions/` avec règles strictes (aucun bypass administrateur en écriture, pour l'intégrité de l'évaluation).
- `firestore.indexes.json` — 3 nouveaux index composites.

### Sécurité — limite documentée
La confidentialité de la clé de correction (`correctAnswer`) reste limitée par l'architecture 100 % cliente du projet (sans fonction serveur) — limite préexistante, non aggravée par ce sprint, documentée en détail dans `RAPPORT_SPRINT17.md`, section 9.3.

### Compatibilité
Aucune modification du moteur d'attribution, du module Utilisateurs, de la Banque des compétences, de l'administration des parcours, ni de l'ancien moteur de quiz/historique (Sprints 1-5).

### Tests
Vérification syntaxique complète, vérification JSON/équilibre des règles, vérification croisée des identifiants DOM et fonctions exposées, relecture manuelle complète (avec correction d'un bug d'ordre d'enregistrement de la position courante détecté en relecture). **Aucun test fonctionnel réel sur un projet Firebase** — voir `RAPPORT_SPRINT17.md`, section 15, et le scénario de test manuel, section 14.

---

## v2.7.0 — Sprint 16 (Consultation d'un parcours)

### Fonctionnalités ajoutées
- **Nouvelle page « Parcours »** (`parcours-detail.html`) : point d'entrée de l'expérience pédagogique, accessible depuis « Ouvrir » (Mes parcours, Sprint 15). Fil d'Ariane, en-tête (titre, description, catégorie, niveau, durée estimée, nombre de compétences/questions, date de création, auteur), cartes de compétences, statistiques descriptives (aucun résultat utilisateur), section Évaluations avec bouton « Commencer » par compétence (« Disponible au Sprint 17 »), bouton « Retour à mes parcours ».
- **Service dédié** `js/services/parcours-view-service.js` : revérifie l'attribution réelle du parcours avant tout affichage, calcule des indicateurs descriptifs (catégorie/niveau dérivés des compétences liées, temps estimé explicitement labellisé comme une estimation) — architecture prête pour progression/historique/recommandations/badges/certificats sans refonte.
- **Couche « Module »** (schéma additif, non exploité) dans `parcours-metadata-service.js` : prépare l'intégration future de contenus autres que des compétences/questions (vidéo, PDF, procédure, cas clinique, lien) sans migration ni refonte des parcours existants.

### Fichiers créés
- `js/services/parcours-view-service.js`
- `parcours-detail.html`, `js/parcours-detail.js`
- `RAPPORT_SPRINT16.md`

### Fichiers modifiés
- `js/services/parcours-metadata-service.js` — couche Module additive.
- `js/mes-parcours.js` — « Ouvrir » navigue réellement vers la nouvelle page.
- `css/styles.css` — styles additifs, responsive (tablette/smartphone).
- `firestore.rules` — lecture de `parcours/` et `competencies/` ouverte à tout utilisateur authentifié pour le contenu déjà **publié** uniquement (limite documentée : la vérification d'attribution réelle reste applicative, voir `RAPPORT_SPRINT16.md` section 7).

### Compatibilité
Aucune modification du moteur d'attribution, de la déduplication, du module Utilisateurs, de la Banque des compétences ou de l'administration des parcours. Aucun index Firestore modifié.

### Tests
Vérification syntaxique complète, vérification JSON/équilibre des règles, vérification croisée des identifiants DOM et fonctions exposées, relecture manuelle — en particulier de la revérification d'attribution. **Aucun test fonctionnel réel sur un projet Firebase** — voir `RAPPORT_SPRINT16.md`, section 9.

---

## v2.6.1 — Correctif Sprint 15 (Attribution des parcours)

### Corrections apportées
- **Suppression d'une attribution** : bouton clair « Retirer l'attribution » (remplace un lien « ✕ » trop discret), confirmation explicite précisant que le parcours n'est pas supprimé, actualisation immédiate de la liste, et journalisation dans l'historique du parcours (réutilise `parcours_audit_logs`, Sprint 12 — aucune nouvelle collection). Fonctionne pour les attributions utilisateur, groupe et profil.
- **Navigation « Retour à l'administration »** : les six écrans d'administration secondaires renvoient désormais réellement vers le tableau de bord d'administration (`../index.html?admin=1`, ouverture directe via `openAdminZone()`, Sprint 3/8) au lieu de l'écran de sélection Étudiant/Pharmacien.

### Fichiers modifiés
`js/services/assignment-service.js`, `js/services/parcours-service.js`, `admin/parcours.js`, `js/auth.js`, `admin/bank.html`, `admin/import.html`, `admin/parcours.html`, `admin/competencies.html`, `admin/users.html`, `admin/reference-banks.html`.

### Compatibilité
Aucune modification de l'architecture du moteur d'attribution, de la déduplication « Mes parcours », des règles Firestore, des index, ni d'aucune autre fonctionnalité validée.

### Tests
Vérification syntaxique complète, vérification croisée des identifiants DOM et fonctions exposées, relecture manuelle. Voir `NOTE_CORRECTIF_SPRINT15.md`.

---

## v2.6.0 — Sprint 15 (Attribution des parcours)

### Fonctionnalités ajoutées
- **Moteur d'attribution des parcours** : un parcours peut être attribué directement à un utilisateur, à un groupe, ou à un profil — nouvelle collection Firestore dédiée `assignments` (jamais un champ imbriqué dans `parcours`).
- **Résolution dédupliquée** (`getAssignedParcoursForUser()`) : retrouve tous les parcours attribués à un utilisateur (direct + groupe + profil) sans jamais afficher un même parcours deux fois.
- **Section « Attributions »** dans la fiche détaillée d'un parcours (`admin/parcours.html`) : liste des attributions, recherche de cible, ajout (utilisateur/groupe/profil + échéance/priorité/obligatoire), suppression.
- **Nouvelle page « Mes parcours »** (`mes-parcours.html`), espace utilisateur accessible après connexion : cartes des parcours attribués (nom, description, statut), bouton « Ouvrir » (contenu détaillé prévu au Sprint 16).
- **Architecture préparée pour le futur** : chaque attribution porte déjà date, auteur, échéance (nullable), priorité, caractère obligatoire et statut — non exploités ce sprint.

### Fichiers créés
- `js/services/assignment-metadata-service.js`, `assignment-catalog-service.js`, `assignment-service.js`
- `mes-parcours.html`, `js/mes-parcours.js`
- `RAPPORT_SPRINT15.md`

### Fichiers modifiés
- `admin/parcours.js`, `admin/parcours.html` — section Attributions.
- `index.html` — lien « Mes parcours ».
- `css/styles.css` — styles additifs des cartes « Mes parcours ».
- `firestore.rules` — nouvelle collection `assignments/` (lecture utilisateur strictement limitée à ses propres attributions, vérifiée côté serveur).
- `firestore.indexes.json` — 3 nouveaux index composites.

### Compatibilité
Aucun champ de `parcours/{id}` modifié. Aucune modification du moteur de quiz, de l'authentification, de la Banque de questions, de la Banque des compétences ou du module Utilisateurs.

### Limites connues
Voir `RAPPORT_SPRINT15.md`, section 7 (notamment : pas d'interface de gestion des attributions depuis la fiche utilisateur/groupe/profil, seulement depuis la fiche du parcours, comme demandé ; aucun journal d'audit dédié aux attributions).

### Tests
Vérification syntaxique de l'ensemble des fichiers JavaScript, vérification JSON des index, vérification d'équilibre de `firestore.rules`, vérification croisée des identifiants DOM et fonctions exposées, relecture manuelle complète — en particulier de la règle de sécurité limitant la lecture des attributions. **Aucun test fonctionnel réel sur un projet Firebase** (non disponible dans cet environnement) — à exécuter avant publication, voir `RAPPORT_SPRINT15.md`, section 8.

---

## v2.5.0 — Sprint 14 (Module Utilisateurs)

### Fonctionnalités ajoutées
- **Module Utilisateurs** (`admin/users.html` + `admin/users.js`) : recherche, filtres (statut, organisation, profil, groupe), pagination, fiche détaillée, édition (prénom/nom/organisation/profil/groupes), désactivation/réactivation, historique.
- **Banque des organisations** (nouvelle, voir `RAPPORT_SPRINT14.md` section 1 pour l'écart constaté avec le cadrage), **Banque des profils** (référence, remplace toute saisie libre de "Pharmacien"/"Étudiant"...) et **Banque des groupes** — trois collections indépendantes, gérées par un écran unique à onglets (`admin/reference-banks.html` + `reference-banks.js`), au-dessus d'une fondation générique commune (`js/services/reference-bank-service.js`).
- **Pré-provisionnement d'utilisateurs par e-mail** (`pending_user_invites`, `user-invite-service.js`) : permet une « création » de fiche métier sans créer de nouveau système d'authentification — la fiche est automatiquement complétée à la première connexion réelle via Firebase Authentication.
- **Architecture préparée pour le futur** (schéma posé, aucune interface) : parcours attribués, compétences validées, progression, badges, certificats, historique de formations, résultats d'évaluations.

### Fichiers créés
- `js/services/reference-bank-service.js`, `organizations-bank-service.js`, `profiles-bank-service.js`, `groups-bank-service.js`
- `js/services/user-profile-metadata-service.js`, `user-invite-service.js`, `user-directory-service.js`
- `admin/reference-banks.html`, `admin/reference-banks.js`
- `admin/users.html`, `admin/users.js`
- `RAPPORT_SPRINT14.md`

### Fichiers modifiés
- `js/services/authorization-service.js` — permissions `MANAGE_REFERENCE_DATA`/`PURGE_REFERENCE_DATA` ; `MANAGE_USERS` (Sprint 8) réutilisée pour le module Utilisateurs, aucun nouveau système de droits.
- `js/services/user-service.js` — champs métier additifs par défaut, consommation d'une pré-provision à la première connexion.
- `js/services/user-management-service.js` — `updateUserBusinessFields()`.
- `js/services/admin-service.js` — `updateUserBusinessProfile()`.
- `js/services/audit-service.js` — filtre optionnel `targetUid` (rétrocompatible).
- `index.html` — navigation.
- `firestore.rules` — nouvelle règle d'édition métier sur `users/{userId}` ; nouvelles collections `organizations/`, `profiles/`, `groups/`, `reference_bank_audit_logs/`, `pending_user_invites/`.
- `firestore.indexes.json` — 9 nouveaux index composites.

### Compatibilité
Aucun champ existant supprimé ou renommé sur `users/{uid}`. Le tableau utilisateurs existant (Sprint 8, `js/admin.js`) reste inchangé et pleinement fonctionnel. Aucune modification du moteur de quiz, de l'import, de la Banque de questions, des Parcours ou de la Banque des compétences.

### Limites connues
Voir `RAPPORT_SPRINT14.md`, section 8 (notamment : la Banque des organisations est neuve — n'existait pas réellement à l'issue du Sprint 13, contrairement à ce que supposait le cadrage ; « création » d'un utilisateur = pré-provisionnement par e-mail, pas un compte de connexion).

### Tests
Vérification syntaxique de l'ensemble des fichiers JavaScript, vérification JSON des index, vérification d'équilibre de `firestore.rules`, vérification croisée des identifiants DOM et fonctions exposées, relecture manuelle complète. **Aucun test fonctionnel réel sur un projet Firebase** (non disponible dans cet environnement) — à exécuter avant publication, voir `RAPPORT_SPRINT14.md`, section 9.

---

## v2.4.0 — Sprint 13 (Banque des compétences)

### Fonctionnalités ajoutées
- **Nouvelle « Banque des compétences »** : chaque compétence est désormais un objet Firestore indépendant et réutilisable (collection `competencies`), avec nom, description, couleur (palette fermée à 6 couleurs : rouge/orange/jaune/vert/bleu/violet), catégorie, mots-clés, niveau conseillé, statut, auteur, dates.
- **Nouvel écran d'administration** (`admin/competencies.html` + `admin/competencies.js`) : recherche, filtres (statut, catégorie), tri, pagination, création, fiche détaillée, édition, workflow de suppression sécurisée (Archivée → Corbeille → Suppression définitive), historique.
- **Les Parcours sélectionnent désormais une compétence existante dans la banque** au lieu d'en créer une en texte libre : nouveau panneau de sélection (recherche + sélection multiple) dans `admin/parcours.html`, remplaçant l'ancien formulaire de création libre et l'ancien panneau « Ajouter plusieurs » (Sprint 12 correctif).
- **Réutilisation avec propagation automatique** : un parcours ne stocke qu'une référence (`competencyId`) vers la banque ; toute modification d'une compétence est immédiatement visible dans tous les parcours qui la référencent, sans écriture supplémentaire.
- **Migration automatique** des anciennes compétences texte des parcours vers la nouvelle banque (`js/services/competency-migration-service.js`), avec aperçu avant exécution, déduplication par nom, idempotence — voir `GUIDE_MIGRATION_SPRINT13.md`.
- **Architecture préparée pour le futur** (schéma posé, aucune interface complexe) : questions associées, ressources pédagogiques/vidéos/procédures/documents, niveaux, badges, recommandations.

### Fichiers créés
- `js/services/competency-metadata-service.js`, `competency-catalog-service.js`, `competency-audit-service.js`, `competency-service.js`, `competency-migration-service.js`
- `admin/competencies.html`, `admin/competencies.js`
- `RAPPORT_SPRINT13.md`, `GUIDE_MIGRATION_SPRINT13.md`

### Fichiers modifiés
- `js/services/authorization-service.js` — permissions `MANAGE_COMPETENCIES`/`PURGE_COMPETENCIES`.
- `js/services/parcours-metadata-service.js` — champ additif `competencyId` sur une compétence de parcours.
- `js/services/parcours-service.js` — `addCompetencyFromBank()`, `resolveParcoursCompetenciesDisplay()` (nouveaux) ; `addCompetency()`/`addCompetenciesBulk()`/`previewBulkCompetencyNames()` conservées pour compatibilité et migration, non exposées côté interface.
- `admin/parcours.js`, `admin/parcours.html` — sélection depuis la banque, affichage à jour des compétences liées.
- `index.html` — navigation.
- `css/styles.css` — un changement additif (`flex-wrap` sur l'en-tête de carte de compétence).
- `firestore.rules` — nouvelles collections `competencies/`, `competency_audit_logs/` (aucune règle existante modifiée).
- `firestore.indexes.json` — 6 nouveaux index composites.

### Compatibilité
Aucun champ existant supprimé ou renommé. Un parcours créé avant ce sprint continue de s'afficher normalement (repli sur l'ancien texte imbriqué tant qu'il n'est pas migré). Aucune question, statistique, compte utilisateur ni import de questions concerné.

### Limites connues
Voir `RAPPORT_SPRINT13.md`, section 6 (notamment : sélection d'une compétence dans un parcours exige aujourd'hui `MANAGE_COMPETENCIES` en plus de `MANAGE_PARCOURS` — sans conséquence tant que seul le rôle admin existe réellement).

### Tests
Vérification syntaxique de l'ensemble des fichiers JavaScript du projet, vérification JSON des index, vérification d'équilibre de `firestore.rules`, vérification croisée des identifiants DOM et des fonctions exposées, relecture manuelle complète. **Aucun test fonctionnel réel sur un projet Firebase** (non disponible dans cet environnement de livraison) — à exécuter par le propriétaire du projet avant publication, voir `RAPPORT_SPRINT13.md`, section 8.

---

## v2.3.1 — Correctif Sprint 12 (Parcours)

### Corrections apportées
- **Sélection de couleur** : remplacement de la saisie libre par une palette fermée de 6 couleurs (vert, bleu, orange, violet, rouge, gris), pastilles cliquables. Compatibilité ascendante conservée avec les parcours déjà créés (ancien code hexadécimal libre).
- **Ajout multiple de compétences** : nouveau panneau « Ajouter plusieurs » (coller une liste, une compétence par ligne), avec récapitulatif avant enregistrement (doublons et lignes vides ignorés, ordre conservé). Ajout unitaire conservé.
- **Historique** : cause racine identifiée et corrigée — index Firestore composite manquant (`parcoursId` + `date`) sur `parcours_audit_logs`. L'événement de création s'affiche désormais toujours, même si le journal détaillé est indisponible ; message neutre si aucun historique n'existe réellement. Le même index manquant a été corrigé par précaution pour `question_audit_logs` (Banque de questions), sans modifier son comportement.

### Fichiers modifiés
`js/services/parcours-metadata-service.js`, `js/services/parcours-service.js`, `admin/parcours.js`, `admin/parcours.html`, `css/styles.css`, `firestore.indexes.json`.

### Tests
63 nouvelles vérifications ciblées sur ce correctif, toutes réussies. 1132 vérifications héritées rejouées sans régression. Voir `NOTE_CORRECTIF_SPRINT12.md`.

---

## v2.3.0 — Sprint 12 (Parcours — fondations)

### Fonctionnalités ajoutées
- **Nouvelle notion « Parcours »** (jamais « Parcours de compétences » dans l'interface — nom volontairement générique) : une organisation logique de compétences, chacune pouvant être liée à des questions existantes.
- **Nouvel écran d'administration « Parcours »** (`admin/parcours.html` + `admin/parcours.js`), même style deux colonnes que la Banque de questions, réutilisant ses classes CSS.
- **CRUD complet des parcours** : création, édition limitée (nom, description, public cible, couleur, icône), recherche, filtres (statut, auteur), tri, pagination réelle par curseur Firestore.
- **Workflow de suppression sécurisée identique aux questions** : Parcours → Archivé → Corbeille → Suppression définitive, avec une permission dédiée `PURGE_PARCOURS` distincte de `MANAGE_PARCOURS`.
- **Gestion complète des compétences** : ajout, suppression, réordonnancement (haut/bas), chacune avec un identifiant stable.
- **Liaison de questions existantes** à une compétence (sélection manuelle via un panneau de recherche réutilisant le moteur de recherche des questions), sans jamais modifier les questions elles-mêmes.
- **Historique visuel (timeline)** par parcours, même principe que celui des questions (Sprint 11).
- **Journal d'audit dédié** (`parcours_audit_logs`), même principe que `question_audit_logs`.

### Fichiers créés
- `admin/parcours.html`, `admin/parcours.js`
- `js/services/parcours-service.js`
- `js/services/parcours-catalog-service.js`
- `js/services/parcours-metadata-service.js`
- `js/services/parcours-audit-service.js`

### Fichiers modifiés
- `js/services/authorization-service.js` — nouvelles permissions `MANAGE_PARCOURS`/`PURGE_PARCOURS` (admin/super_admin uniquement, jamais editor).
- `index.html`, `css/styles.css` — navigation et styles additifs (uniquement pour l'affichage des compétences ; le reste réutilise les classes existantes de la Banque de questions).
- `firestore.rules` — nouvelles collections `parcours/` et `parcours_audit_logs/`, reprenant fidèlement le workflow de suppression sécurisée des questions.
- `firestore.indexes.json` — 4 index composites proposés pour les parcours.

### Compatibilité
**Aucun changement** au moteur de quiz, aux statistiques, à l'authentification, à l'import, à la Banque de questions ou à l'administration existante — vérifié explicitement par 978 vérifications de non-régression, toutes réussies.

### Limites connues
- Compétences en champ imbriqué du document Parcours, pas en sous-collection Firestore (choix délibéré pour ce sprint « fondations »).
- Réordonnancement simple (haut/bas), pas de glisser-déposer.
- Aucun lien avec le moteur de quiz — structure organisationnelle côté administration uniquement.

### Tests
1132 vérifications automatisées (154 nouvelles ciblées sur les Parcours, 978 rejouées sans régression). Voir `RAPPORT_SPRINT12.md`.

---

## v2.2.1 — Correctifs avant validation (Sprint 11)

### Corrections apportées
- **Suppression sécurisée** : plus aucune suppression Firestore directe. Nouveau workflow *Question → Archivée → Corbeille → Suppression définitive*, avec un nouveau statut `trash` (additif) et une nouvelle permission dédiée `PURGE_QUESTIONS` (distincte de `MANAGE_QUESTIONS`, réservée à `admin`/`super_admin`, jamais à un futur `editor`).
- **Bug critique détecté et corrigé avant publication** : la règle Firestore générale de transition de statut ne vérifiait que le nouveau statut demandé, jamais l'ancien — une question déjà à la corbeille aurait pu être renvoyée directement vers `published`, contournant le workflow. Corrigé en excluant explicitement l'ancien statut `trash` de cette règle, vérifié par un test dédié.
- **Historique visuel** : nouvelle section « Historique » dans la fiche détaillée, combinant l'événement de création/import et le journal d'audit existant en une timeline lisible — consultable sans quitter l'écran.
- **Recherche** : la limite de balayage (500) n'est plus une constante figée (`getDefaultSearchScanLimit()`/`setDefaultSearchScanLimit()`), et une nouvelle abstraction (`question-search-provider.js`) prépare une future intégration d'un moteur externe (Algolia, Meilisearch) sans devoir modifier les appelants. Aucune intégration réelle développée — un point de préparation uniquement, comme demandé.

### Fichiers créés
- `js/services/question-search-provider.js`

### Fichiers modifiés
- `js/services/question-metadata-service.js` (statut `TRASH`, additif)
- `js/services/authorization-service.js` (permission `PURGE_QUESTIONS`)
- `js/services/question-catalog-service.js` (limite de recherche configurable)
- `js/services/question-bank-service.js` (workflow de suppression sécurisée, timeline, fournisseur de recherche)
- `admin/bank.js`, `admin/bank.html`, `css/styles.css` (interface du nouveau workflow et de la timeline)
- `firestore.rules` (règle générale resserrée, nouvelle règle dédiée archived↔trash, suppression contrainte au statut trash)

### Compatibilité
Aucun comportement des sprints précédents modifié (import, simulation, historique, statistiques, catalogue, administration) — vérifié par 873 vérifications de non-régression rejouées, toutes réussies.

### Tests
123 nouvelles vérifications ciblées sur ce correctif, toutes réussies. Voir `RAPPORT_SPRINT11.md`, section « Correctifs avant validation ».

---

## v2.2.0 — Sprint 11 (Banque de questions)

### Fonctionnalités ajoutées
- **Nouvel écran d'administration « Banque de questions »** (`admin/bank.html` + `admin/bank.js`), deux colonnes : liste à gauche, fiche détaillée à droite — sans popup, sans navigation compliquée.
- **Recherche instantanée** sur identifiant pédagogique, énoncé, thème, sous-thème, tags, source.
- **Filtres** : statut, thème, difficulté, type de question, auteur — combinables, appliqués côté serveur.
- **Tri** : date de création, date de modification, identifiant, thème, difficulté (croissant/décroissant).
- **Vraie pagination Firestore par curseur**, jamais un chargement complet de la collection — compatible avec plusieurs milliers de questions.
- **Fiche détaillée complète** façon « fiche produit » : énoncé, réponses, bonne réponse surlignée, explication, tags, source, objectifs pédagogiques, métadonnées, dates, version, auteur.
- **Badges visuels sobres par statut** : 🟡 Brouillon · 🔵 En relecture · 🟢 Publiée · ⚫ Archivée.
- **Indicateur de complétude des métadonnées** (barre + pourcentage + détail par critère) — vérifie la présence de 6 métadonnées (objectifs pédagogiques, tags, source, explication, auteur, temps estimé), jamais la qualité scientifique du contenu.
- **Actions limitées, avec confirmation systématique** : Publier, Archiver, Remettre en brouillon, Supprimer.
- **Édition limitée** : explication, tags, source uniquement — aucun éditeur complet.
- **Journal dédié des actions sur les questions** (`question_audit_logs`), même principe que `audit_logs`/`importLogs`.
- **Index Firestore composites proposés** (`firestore.indexes.json`) pour les combinaisons filtre + tri les plus probables.

### Fichiers créés
- `admin/bank.html`, `admin/bank.js`
- `js/services/question-bank-service.js`
- `js/services/question-completeness-service.js`
- `js/services/question-audit-service.js`
- `firestore.indexes.json`

### Fichiers modifiés
- `js/services/question-catalog-service.js` — extension additive (pagination, recherche bornée, statut, édition, suppression). Aucune fonction existante modifiée.
- `index.html`, `css/styles.css` — navigation et styles (additifs).
- `firestore.rules` — `questions/` accepte désormais une transition de statut et une édition limitée, la suppression est assouplie pour les administrateurs ; nouvelle collection `question_audit_logs/`.

### Sécurité
Accès réservé aux administrateurs à trois niveaux (interface, service, règles Firestore). Chaque nouvelle règle de mise à jour de `questions/` est strictement bornée (`hasOnly`) : une transition de statut ne peut jamais modifier le contenu, une édition de champ ne peut jamais changer le statut.

### Limites connues
- Recherche textuelle bornée à 500 questions par filtres actifs (limite Firestore native, documentée).
- Édition limitée à explication/tags/source ; pas d'éditeur complet.
- Index Firestore proposés, non déployés automatiquement.
- Suppression définitive, sans corbeille.

### Tests
966 vérifications automatisées (150 nouvelles ciblées sur la Banque de questions, 816 rejouées sans régression). Voir `RAPPORT_SPRINT11.md`.

---

## v2.1.1 — Correctif : sécurité et atomicité des imports (Sprint 10)

### Corrections apportées
- **Limite stricte de 500 questions par fichier d'import** (`MAX_QUESTIONS_PER_IMPORT`, `question-import-validator.js`) : au-delà, le fichier est refusé avant toute écriture, avec un message clair invitant à diviser le fichier. Élimine le risque d'import partiellement appliqué (l'atomicité Firestore n'étant garantie que par bloc de 500 opérations).
- **Suppression du comportement multi-bloc** : `writeQuestionsBatch()` n'utilise plus qu'un seul `writeBatch()` ; `MAX_BATCH_SIZE` et `multiBatchWarning` supprimés (plus utiles).
- **`isRequesterAdmin()` (firestore.rules) vérifie désormais aussi le statut actif** : un administrateur suspendu perd immédiatement tous ses droits administratifs sur toutes les collections protégées (`users/`, `audit_logs/`, `questions/`, `importLogs/`), une seule modification cascadant partout où la fonction est utilisée.

### Fichiers modifiés
- `js/services/question-import-validator.js`, `js/services/question-catalog-service.js`, `js/services/import-service.js`, `admin/import.js`, `firestore.rules`.

### Tests
179 nouvelles vérifications ciblées sur ce correctif, toutes réussies. Suite de régression complète rejouée sans exception. Voir `RAPPORT_CORRECTIF_SPRINT10.md`.

---

## v2.1.0 — Sprint 10 (Moteur d'import de contenu pédagogique JSON)

### Fonctionnalités ajoutées
- **Moteur d'import de questions au format JSON officiel** (voir `IMPORT_FORMAT.md`), workflow complet : sélection du fichier → validation → aperçu → import comme brouillons → rapport final.
- **Nouvel écran d'administration séparé** (`admin/import.html` + `admin/import.js`), premier écran de Pharmeval à vivre en dehors d'`index.html`.
- **Collection Firestore globale `questions`** (jamais sous `users/`), utilisant directement l'identifiant pédagogique (ex. `PHARM-BAP-000124`) comme identifiant de document — mises à jour, synchronisation et imports incrémentaux naturels.
- **Validation robuste avant toute écriture** : schéma, version, champs obligatoires/inconnus, types, longueurs minimales, unicité des identifiants, index de bonne réponse. Une seule erreur invalide l'intégralité du fichier.
- **Mode simulation** (« Simuler l'import ») : exécute toute la validation et produit le rapport complet, sans jamais écrire dans Firestore.
- **Journal des imports** (`importLogs`), tracé à chaque import (y compris une simulation) : date, administrateur, fichier, comptages, durée.
- Toute question importée reçoit le statut `draft` — jamais publiée automatiquement, y compris pour une mise à jour d'une question déjà publiée.
- Préparation du futur catalogue : champ `visibility` (`isCatalogVisible`, `audiences`, `organizationIds`) présent dès l'import, non encore exploité par une interface.

### Fichiers créés
- `js/services/question-import-validator.js`
- `js/services/question-parser.js`
- `js/services/question-catalog-service.js`
- `js/services/import-log-service.js`
- `js/services/import-service.js`
- `admin/import.html`, `admin/import.js`
- `IMPORT_FORMAT.md`

### Fichiers modifiés
- `js/services/authorization-service.js` — `admin` reçoit désormais aussi `MANAGE_QUESTIONS` (une permission peut être accordée à plusieurs rôles).
- `js/services/question-metadata-service.js` — correctif de cohérence : `completeMetadata()` applique désormais aussi `normalizeDifficulty()`, comme `getMetadata()`.
- `index.html`, `css/styles.css` — lien de navigation et styles de l'écran d'import.
- `firestore.rules` — règles pour les nouvelles collections `questions/` et `importLogs/`.

### Bug détecté et corrigé avant livraison
La lecture groupée des questions existantes masquait silencieusement une panne Firestore comme si toutes les questions étaient nouvelles. Corrigé : toute erreur individuelle fait désormais échouer l'ensemble de la lecture, jamais un résultat partiel présenté comme fiable.

### Sécurité
Accès à l'écran, lancement d'un import et écriture dans `questions` réservés aux administrateurs, à trois niveaux (interface, service, règles Firestore). Chaque écriture Firestore est doublement contrainte : identifiant de document = `pedagogicalId` du contenu, statut toujours `draft`.

### Limites connues
- Statut toujours forcé à `draft`, y compris pour une mise à jour d'une question déjà publiée (simplification délibérée).
- Lecture des questions existantes par appel individuel, pas par requête groupée (suffisant aux volumes réalistes actuels).
- Atomicité Firestore garantie par bloc de 500 questions, pas au-delà.
- Seul le type de question `single-choice` est pris en charge par l'import ce sprint.
- Aucune interface ne consomme encore la collection `questions` (choix délibéré, pas un oubli).

### Tests
767 vérifications automatisées (162 nouvelles ciblées sur le moteur d'import, 605 rejouées sans régression — dont une mise à jour intentionnelle d'un test reflétant l'octroi de `MANAGE_QUESTIONS` à `admin`). Voir `RAPPORT_SPRINT10.md`.

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
