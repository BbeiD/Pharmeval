# RAPPORT SPRINT 16 — Consultation d'un parcours

**Pharmeval v2.6.1 → v2.7.0**

## 1. Objectif

Donner un vrai contenu au bouton « Ouvrir » de « Mes parcours » (Sprint 15) : une page de consultation complète d'un parcours — informations générales, compétences, statistiques descriptives, section Évaluations — sans encore rien enregistrer côté utilisateur (aucune progression, aucun score, aucune réponse).

## 2. Nouvelle page : `parcours-detail.html`

Indépendante (comme demandé), accessible uniquement après connexion, à l'URL `parcours-detail.html?id=<identifiant du parcours>`. Structure :

- **Fil d'Ariane** : `Mes parcours › Nom du parcours`.
- **En-tête** : titre, description, catégorie, niveau, durée estimée, nombre de compétences, nombre de questions, date de création, auteur.
- **Compétences** : cartes (nom, description, catégorie, niveau) — aucune progression, aucun score.
- **Statistiques descriptives** : nombre de compétences, nombre de questions, difficulté moyenne, temps estimé.
- **Évaluations** : un bouton « Commencer » par compétence, qui affiche *« Disponible au Sprint 17. »* — aucune ouverture de quiz, aucune écriture.
- **Retour à mes parcours** : bouton explicite, ne renvoie jamais vers l'administration.

## 3. Un service dédié, comme demandé

`js/services/parcours-view-service.js` porte toute la logique. La page (`js/parcours-detail.js`) ne fait qu'appeler `getParcoursDetailForUser(parcoursId, uid)` et afficher le résultat — aucune règle métier dans la page elle-même.

Ce service :
1. **Revérifie l'attribution** du parcours à l'utilisateur (réutilise `getAssignedParcoursForUser()`, Sprint 15) — un utilisateur ne peut jamais consulter en détail un parcours qui ne lui a pas été attribué, même en devinant son identifiant dans l'URL.
2. **Résout les compétences à jour** (réutilise `resolveParcoursCompetenciesDisplay()`, Sprint 13) — jamais une copie figée.
3. **Calcule des indicateurs purement descriptifs** à partir de données réelles déjà existantes :
   - *Catégorie* et *niveau* du parcours : dérivés des compétences réellement liées (catégorie la plus fréquente, niveau moyen arrondi) — jamais un nouveau champ inventé sur le parcours lui-même (« Pas de duplication »).
   - *Nombre de questions* : somme réelle des `questionIds` déjà liés à chaque compétence.
   - *Temps estimé* : **une estimation explicitement labellisée comme telle** (`≈ X min (estimation)`), calculée à partir du nombre réel de questions × une constante documentée (`ESTIMATED_MINUTES_PER_QUESTION`) — jamais présentée comme une mesure réelle, en cohérence avec le principe du projet de ne jamais faire passer une supposition pour un fait.

Architecture prévue pour la suite (SPRINT16, « Prévoir une architecture permettant d'ajouter ensuite : progression, historique, recommandations, badges, certificats ») : ce fichier deviendra le point d'ajout naturel de ces futures fonctions (`getProgressForUser()`, `getRecommendationsForUser()`...), sans jamais devoir toucher à `parcours-detail.js`.

## 4. La couche « Module » (suggestion du donneur d'ordre)

Ajoutée à `js/services/parcours-metadata-service.js` : un tableau additif `parcours.modules` (vide par défaut) et un schéma complet (`MODULE_TYPES` : regroupement de compétences, quiz, cas clinique, procédure, vidéo, document, lien ; `completeModule()`).

**Périmètre volontairement limité, comme suggéré** : ce sprint pose uniquement le schéma. `parcours.competencies` reste la seule structure réellement utilisée par l'interface (aucune migration, aucun risque de régression). Cette couche reste donc invisible pour l'utilisateur, exactement comme envisagé — mais elle existe déjà dans le modèle de données, prête à accueillir demain un module vidéo, PDF, procédure ou cas clinique sans refonte du schéma du parcours.

## 5. Fichiers créés

- `js/services/parcours-view-service.js` — service dédié de consultation.
- `parcours-detail.html`, `js/parcours-detail.js` — nouvelle page.
- `RAPPORT_SPRINT16.md`

## 6. Fichiers modifiés

- `js/services/parcours-metadata-service.js` — couche Module (additive), voir section 4.
- `js/mes-parcours.js` — le bouton « Ouvrir » navigue désormais vers `parcours-detail.html?id=...` au lieu d'afficher un message d'attente.
- `css/styles.css` — styles additifs de la nouvelle page, avec deux points de rupture responsives (900px, 600px — mêmes seuils déjà utilisés ailleurs dans le projet), aucune règle existante modifiée.
- `firestore.rules` — lecture des collections `parcours/` et `competencies/` ouverte à tout utilisateur authentifié **pour les documents déjà publiés uniquement** (voir section 7, limite assumée). Aucune autre règle modifiée.

Aucune modification de `firestore.indexes.json` : ce sprint ne fait que des lectures de documents individuels (`getDoc`), jamais de nouvelle requête composée.

## 7. Sécurité : ce qui est garanti, et où se situe la limite assumée

- **Contenu non publié** : strictement invisible pour tout non-administrateur, sans exception, à tous les statuts (brouillon, en relecture, archivé, corbeille).
- **Attribution réelle** : vérifiée par le service applicatif (`parcours-view-service.js`) avant tout affichage — un utilisateur ne voit jamais le contenu détaillé d'un parcours qui ne lui a pas été attribué.
- **Limite assumée et documentée** (dans le code des règles elles-mêmes, pas seulement ici) : la règle Firestore de lecture de `parcours/`/`competencies/` ne peut pas vérifier, au niveau des règles, qu'une attribution existe réellement pour le demandeur — Firestore ne permet pas d'exprimer « un document correspondant existe quelque part dans une autre collection » sans en connaître l'identifiant exact (contrairement à `assignments/{id}`, où l'identifiant recherché est déjà connu). Un utilisateur techniquement capable de contourner l'application et d'interroger Firestore directement pourrait donc lire le contenu (nom, description, compétences) d'un parcours **publié** qui ne lui est pas attribué. Le contenu d'un parcours n'est pas une donnée sensible au sens de la Charte (pas une donnée personnelle, pas un résultat d'évaluation) ; ce risque est jugé acceptable pour ce sprint, mais est noté ici explicitement plutôt que caché — à revoir si Pharmeval doit un jour garantir une confidentialité stricte du contenu pédagogique lui-même (par exemple en donnant aux attributions des identifiants déterministes, ce qui permettrait une vraie vérification par `exists()`).

## 8. Compatibilité et régressions

- Aucune modification du moteur d'attribution (Sprint 15), de la déduplication, du module Utilisateurs (Sprint 14), de la Banque des compétences (Sprint 13) ou de l'administration des parcours (Sprint 12).
- `mes-parcours.html` reste fonctionnellement identique, à l'exception du seul changement demandé (navigation réelle du bouton "Ouvrir").
- Un parcours sans compétence liée s'affiche normalement (sections vides avec message neutre, jamais une erreur).

## 9. Tests

**Vérifications effectuées dans cet environnement** :
- Vérification syntaxique de l'ensemble des fichiers JavaScript du projet (`node --check`, mode module) : tous réussis.
- Vérification JSON de `firestore.indexes.json` (inchangé) : réussie.
- Vérification d'équilibre des accolades/parenthèses de `firestore.rules` après modification : réussie.
- Vérification croisée des identifiants DOM et des fonctions exposées sur `window` pour `parcours-detail.html`/`.js` : aucun identifiant orphelin, aucune fonction manquante.
- Relecture manuelle complète, en particulier de la vérification d'attribution dans `parcours-view-service.js` et des nouvelles règles de lecture Firestore.

**Non vérifié dans cet environnement** (pas d'accès à un projet Firebase réel, comme aux sprints précédents) : rendu réel de la page dans un navigateur, comportement réel des nouvelles règles de lecture, responsive réel sur tablette/smartphone. **À exécuter par le propriétaire du projet avant toute mise en production.**

## 10. Statut proposé

**À_TESTER** (Charte Développement, section 22).

## 11. Vers le Sprint 17

Le bouton « Commencer » de chaque compétence est déjà en place, correctement positionné par compétence, et prêt à être relié à un vrai moteur d'évaluation. `parcours-view-service.js` expose déjà la liste des compétences avec leurs `questionIds` réels : le Sprint 17 pourra s'appuyer directement dessus pour lancer une évaluation ciblée par compétence, sans revoir l'architecture posée ici.
