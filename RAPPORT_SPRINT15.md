# RAPPORT SPRINT 15 — Attribution des parcours

**Pharmeval v2.5.0 → v2.6.0**

## 1. Objectif

Construire le moteur d'attribution des parcours : permettre à un parcours d'être attribué à un utilisateur, un groupe ou un profil, et permettre à un utilisateur de retrouver — dédupliqués — tous les parcours qui lui reviennent, quelle que soit la voie d'attribution. Aucune progression, aucun score, aucun badge : uniquement le lien entre un parcours et une cible.

## 2. Architecture

### 2.1 Une collection dédiée, jamais un champ imbriqué dans `parcours`

Conformément à la demande explicite (« Ne pas modifier directement les documents des parcours »), une nouvelle collection Firestore **`assignments`** stocke chaque attribution comme un document indépendant :

```
{
  id: "ASSIGN-xxxxxxxx",
  parcoursId: "PARC-xxxxxxxx",   // référence, jamais une copie du parcours
  type: "user" | "group" | "profile",
  targetId: "<uid | groupId | profileId>",

  // Préparés pour le futur (SPRINT15, non exploités ce sprint) :
  assignedAt: "2026-07-19T...",
  assignedBy: "admin@exemple.be",
  dueDate: null,
  priority: "normal",
  mandatory: false,
  status: "active",
}
```

**Aucun doublon** : avant toute création, `assignmentExists()` vérifie qu'une attribution strictement identique (même parcours, même type, même cible) n'existe pas déjà — l'interface refuse alors l'action avec un message clair plutôt que de créer un second lien silencieusement redondant.

### 2.2 Trois voies d'attribution, une seule résolution

`getAssignedParcoursForUser(uid)` (`js/services/assignment-service.js`) :
1. Lit le document `users/{uid}` (Sprint 14) pour connaître `profileId` et `groupIds`.
2. Interroge `assignments` trois fois : attributions directes (`type=='user'`), via le profil (`type=='profile'`), via les groupes (`type=='group'`, opérateur `in`).
3. **Déduplique par `parcoursId`** (une `Map`, la première attribution rencontrée fait foi pour l'affichage) — exactement l'exemple donné dans le cadrage : un parcours attribué à la fois au profil *Pharmacien* et au groupe *Nouveaux entrants* n'apparaît qu'une seule fois pour un pharmacien membre de ce groupe.
4. Ne retourne que les parcours au statut `published` — un parcours attribué avant sa publication (ou depuis dépublié) n'apparaît jamais dans l'espace utilisateur, sans jamais toucher à l'attribution elle-même.

### 2.3 Champ `type` : valeurs techniques anglaises, comme le reste de Pharmeval

Le cadrage illustre le champ avec des valeurs françaises (« type = utilisateur »). Le nom de champ `type` est repris tel quel, mais les **valeurs techniques** sont `'user'`/`'group'`/`'profile'` (anglais), exactement comme `STATUSES`, `ROLES`, `COMPETENCY_STATUSES` ailleurs dans le projet — avec un dictionnaire de libellés séparé (`ASSIGNMENT_TARGET_TYPE_LABELS`) pour l'affichage. Choix documenté en tête de `assignment-metadata-service.js` pour éviter toute confusion future.

## 3. Fichiers créés

**Services** (`js/services/`) :
- `assignment-metadata-service.js` — modèle de données, types de cible, priorités, statut (utilitaire pur).
- `assignment-catalog-service.js` — lecture/écriture Firestore de `assignments`.
- `assignment-service.js` — orchestration : création/suppression d'attribution, recherche de cibles, **résolution « Mes parcours »** (cœur du sprint).

**Interface** :
- Section **« Attributions »** ajoutée à la fiche détaillée d'un parcours (`admin/parcours.js`/`.html`) : liste des attributions existantes (type, cible, échéance, obligatoire), panneau « + Attribuer » avec sélection du type, recherche de cible (réutilise les banques Sprint 14 et la liste d'utilisateurs Sprint 8), échéance/priorité/obligatoire, suppression d'une attribution.
- **`mes-parcours.html` + `js/mes-parcours.js`** — nouvelle page « Mes parcours », l'espace utilisateur demandé : cartes avec nom, description, statut (toujours « Publié », seuls ces parcours étant retournés), badge « Obligatoire » le cas échéant, bouton **Ouvrir** (affiche un message honnête indiquant que le contenu détaillé arrive au Sprint 16, plutôt qu'un lien cassé ou une fausse page).

## 4. Fichiers modifiés

- `admin/parcours.js` / `admin/parcours.html` — section Attributions + panneau de sélection.
- `index.html` — lien « Mes parcours » dans l'en-tête, visible pour tout utilisateur connecté (pas seulement les administrateurs).
- `css/styles.css` — un bloc additif pour les cartes de « Mes parcours » (`.mesparcours-*`), aucune règle existante modifiée.
- `firestore.rules` — nouvelle collection `assignments/`.
- `firestore.indexes.json` — 3 nouveaux index composites.

## 5. Décisions d'architecture notables

### 5.1 Permission réutilisée, pas de nouveau système de droits
Gérer les attributions d'un parcours est traité comme une extension de la gestion de ce parcours : la permission déjà existante `MANAGE_PARCOURS` (Sprint 12) est réutilisée telle quelle. Aucune permission dédiée n'a été créée.

### 5.2 Pas de workflow de contenu pour une attribution
Contrairement aux banques de contenu (Sprint 12-14 : brouillon → publié/archivé → corbeille → suppression), une attribution est un simple lien. « Supprimer une attribution » (demande explicite) est donc une suppression Firestore réelle et immédiate — pas de statut intermédiaire, pas de corbeille. Le champ `status` de l'attribution existe (préparé pour le futur, ex. « expirée » à l'échéance) mais n'est pas exploité comme workflow ce sprint.

### 5.3 Sécurité de « Mes parcours » : au niveau des règles Firestore, pas seulement de l'interface
La page `mes-parcours.html` n'a **aucune protection d'interface** particulière (elle est volontairement accessible à tout utilisateur connecté) : la garantie réelle qu'un utilisateur ne voie que SES attributions repose sur `firestore.rules` — la règle de lecture de `assignments/{id}` relit le document `users/{uid}` du demandeur (via `get()`, même principe que `isRequesterAdmin()`) pour vérifier que la cible de l'attribution correspond bien à son propre `uid`, son propre `profileId`, ou l'un de ses propres `groupIds`. Un utilisateur techniquement capable de contourner l'interface ne peut pas lire les attributions d'un autre.

## 6. Compatibilité et régressions

- Aucun champ de `parcours/{id}` modifié, ajouté ou supprimé — conformément à la contrainte explicite.
- Aucune modification du moteur de quiz, de l'authentification, des statistiques, de la Banque de questions, de la Banque des compétences ou du module Utilisateurs (Sprint 14).
- Les fiches de parcours existantes continuent de s'afficher normalement ; la section « Attributions » démarre simplement vide (« Ce parcours n'est attribué à personne pour l'instant »).

## 7. Limites connues (documentées, non cachées)

1. **Aucune interface de gestion des attributions depuis la fiche d'un utilisateur, d'un groupe ou d'un profil** — uniquement depuis la fiche du parcours (« Dans la fiche d'un parcours, ajouter une nouvelle section : Attributions », demande explicite). Une vue inverse (« quels parcours sont attribués à cet utilisateur ») pourrait être ajoutée dans un sprint futur sans refonte (même collection, requête différente).
2. **Recherche de cible « utilisateur »** repose sur `fetchAllUsersBounded()` (Sprint 8, lot borné à 500) filtré côté client — même limite déjà documentée et acceptée pour le module Utilisateurs.
3. **`listAssignmentsByTargetIn()` limité à 30 groupes** par utilisateur (limite native de l'opérateur Firestore `in`) — largement suffisant pour un usage réaliste, documenté plutôt que masqué.
4. **Champs « préparés pour le futur » non exploités** : `dueDate`, `priority`, `mandatory`, `status` sont stockés et affichés tels quels (échéance, badge « Obligatoire ») mais aucune logique (rappel, tri par priorité, expiration automatique) n'est encore appliquée — conforme à la demande (« Ces champs ne sont pas encore exploités »).
5. **Pas de journal d'audit dédié aux attributions** : `assignedBy`/`assignedAt` tracent la création, mais aucune trace n'est conservée après une suppression (contrairement aux banques de contenu qui ont un journal dédié). Choix délibéré de sobriété pour ce sprint (une attribution est un lien léger, pas un contenu éditorial) — à revoir si un historique des attributions devient nécessaire.
6. **Règle Firestore de lecture de `assignments/` par un utilisateur standard repose sur `in` dans une règle de sécurité** (`resource.data.targetId in get(...).data.groupIds`) — syntaxe supposée valide dans le moteur de règles Firestore actuel, non vérifiée sur un projet réel dans cet environnement (voir section 8).

## 8. Tests

**Vérifications effectuées dans cet environnement** :
- Vérification syntaxique de l'ensemble des fichiers JavaScript du projet (`node --check`, mode module) : tous réussis.
- Vérification JSON de `firestore.indexes.json` : réussie.
- Vérification d'équilibre des accolades/parenthèses de `firestore.rules` après insertion : réussie.
- Vérification croisée des identifiants DOM et des fonctions exposées sur `window` pour `admin/parcours.html`/`.js` (section Attributions) et `mes-parcours.html`/`js/mes-parcours.js` : aucun identifiant orphelin, aucune fonction manquante.
- Relecture manuelle complète de chaque fichier créé ou modifié, en particulier de la règle Firestore de lecture de `assignments/` (vérification qu'un utilisateur standard ne peut lire que les attributions le concernant réellement).

**Non vérifié dans cet environnement** (pas d'accès à un projet Firebase réel, comme aux Sprints 13 et 14) : création/suppression réelle d'une attribution, résolution réelle de « Mes parcours » avec des données réelles, comportement réel de la règle `in` dans `get(...).data.groupIds`, déploiement effectif des règles/index. **À exécuter par le propriétaire du projet avant toute mise en production.**

## 9. Statut proposé

**À_TESTER** (Charte Développement, section 22).

## 10. Vers le Sprint 16

Le moteur d'attribution étant posé, le Sprint 16 (« Entrer dans un parcours ») pourra s'appuyer directement sur `getAssignedParcoursForUser()` pour savoir *quels* parcours ouvrir, et sur les compétences déjà liées à chaque parcours (Sprint 13) pour construire l'expérience détaillée (compétences, évaluation, progression) — sans avoir à revenir sur l'architecture posée ici.
