# RAPPORT_SPRINT12.md — Parcours (fondations)

**Sprint 12 — Pharmeval v2.2.1 → v2.3.0**

## Objectif du sprint

Poser les **fondations** d'une nouvelle notion : les **Parcours** — une organisation logique de compétences, chacune pouvant être liée à des questions existantes. Ce sprint construit uniquement la **structure de données** et son interface de gestion ; aucune logique pédagogique, aucune progression utilisateur, aucune validation automatique. Le moteur de quiz existant n'est pas touché.

---

## Décision de nommage

Comme suggéré : l'interface n'affiche **jamais** « Parcours de compétences » — uniquement **« Parcours »**, partout (titre d'écran, lien de navigation, boutons, messages). Ce choix est documenté explicitement dans le code (`js/services/parcours-metadata-service.js`) pour qu'aucun développeur futur ne réintroduise par erreur le nom long. Le mot « Parcours » reste volontairement générique : rien dans l'architecture ne présuppose un contenu pédagogique universitaire — un « Parcours d'intégration », un « Parcours AstraZeneca » ou un « Parcours Université de Liège » sont représentés exactement de la même façon.

---

## Architecture

```
admin/parcours.html + admin/parcours.js     (interface deux colonnes, meme style que la Banque de questions)
        |
        v
js/services/parcours-service.js              (orchestration : acces, navigation, creation, statuts, competences, liaison)
        |
        +--> js/services/parcours-catalog-service.js   (lecture/ecriture Firestore de `parcours`)
        +--> js/services/parcours-audit-service.js       (journal dedie `parcours_audit_logs`)
        +--> js/services/parcours-metadata-service.js    (modele de donnees, identifiants stables, validation)
        +--> js/services/authorization-service.js        (MANAGE_PARCOURS / PURGE_PARCOURS, nouvelles permissions)
        +--> js/services/question-catalog-service.js     (REUTILISE tel quel pour rechercher des questions a lier)
```

**Chaque service garde une responsabilité unique**, exactement comme pour la Banque de questions (Sprint 11) : le catalogue ne connaît aucune règle métier, l'orchestrateur ne contient aucune requête Firestore directe, les métadonnées sont un calcul pur.

**Réutilisation maximale, comme demandé** : la recherche de questions à lier ne duplique rien — `searchQuestionsForLinking()` appelle directement `searchQuestionsBounded()` de `question-catalog-service.js` (Sprint 10/11). L'interface reprend **littéralement les mêmes classes CSS** que `admin/bank.html` (`.bank-detail-card`, `.bank-badge`, `.bank-actions-row`, etc.) — un seul petit bloc de CSS additif a été nécessaire, uniquement pour l'affichage propre aux compétences.

---

## Modèle de données

### Parcours
```js
{
  id,                  // identifiant stable, ex. "PARC-a1b2c3d4", genere a la creation
  name, description, targetAudience,
  status,              // draft | review | published | archived | trash (workflow identique aux questions)
  createdAt, updatedAt, author,
  color, icon,         // optionnels
  competencies: [ ... ],
  tags: [],            // reserve, reutilise tag-service.js (Sprint 9)
}
```

### Compétence (imbriquée)
```js
{ id, name, description, order, questionIds: [] }
```

**Choix délibéré : les compétences sont un CHAMP TABLEAU du document Parcours, pas une sous-collection Firestore.** Justification : ce sprint demande explicitement « uniquement une structure de données », sans logique pédagogique — un tableau imbriqué reste largement suffisant pour un nombre de compétences réaliste par parcours (quelques dizaines au grand maximum), simplifie considérablement les règles Firestore (un seul document à protéger, pas de sous-collection avec ses propres règles), et rend chaque opération (ajout, suppression, réordonnancement, liaison de question) atomique par construction. Si un parcours devait un jour accueillir des centaines de compétences avec des besoins de requête indépendants, une migration vers une sous-collection resterait possible sans tout reconstruire.

### Identifiants stables
Générés à la création via `crypto.randomUUID()` (repli sûr si indisponible), jamais régénérés ensuite — même principe que l'identifiant pédagogique des questions (Sprint 9), mais généré directement par l'application plutôt que dérivé d'un import (les parcours n'ont pas de mécanisme d'import dans ce sprint).

---

## Interface

Deux colonnes, exactement comme la Banque de questions :
- **Colonne gauche** : liste des parcours (nom, icône, badge de statut, aperçu de la description, public cible, nombre de compétences), recherche instantanée, filtres (statut, auteur), tri, pagination réelle par curseur Firestore.
- **Colonne droite** : fiche détaillée — description complète, métadonnées, **compétences** (liste avec réordonnancement haut/bas, suppression, ajout), pour chaque compétence les **questions liées** (avec un bouton pour en lier une nouvelle via un panneau de recherche, et un bouton pour retirer une liaison), **actions** (workflow identique aux questions), **historique** (timeline), et un formulaire d'**édition limitée**.
- **Formulaire de création** : un simple repli dans la colonne gauche (pas de popup séparée), avec nom, description, public cible, couleur et icône optionnelles.
- **Panneau de liaison de questions** : une recherche instantanée parmi les questions existantes (réutilise directement le moteur de recherche des questions), un clic pour lier.

Badges de statut identiques à la Banque de questions : Brouillon (jaune), En relecture (bleu), Publié (vert), Archivé (gris foncé), Corbeille (rouge).

---

## Workflow de suppression sécurisée (identique aux questions)

Exactement le même principe que le correctif du Sprint 11, appliqué aux parcours :

```
Parcours (draft/review/published) -> Archive -> Corbeille -> Suppression definitive
```

- Publier / Archiver / Remettre en brouillon : jamais disponibles depuis la corbeille.
- Mise à la corbeille : uniquement depuis « archivé ».
- Restauration : ramène à « archivé », jamais republié automatiquement.
- Suppression définitive : uniquement depuis « corbeille », réservée à une permission dédiée **`PURGE_PARCOURS`** (nouvelle, distincte de `MANAGE_PARCOURS`) — un futur rôle de gestion de contenu pourrait un jour organiser des parcours sans jamais pouvoir les purger définitivement.

**Vérifié explicitement par test** que la règle Firestore de transition générale exclut bien l'ancien statut « corbeille » (le même type de faille détectée et corrigée au Sprint 11 a été anticipé et testé dès l'écriture de cette règle, sans avoir à la corriger après coup cette fois).

---

## Permissions

Deux nouvelles permissions, mirroir exact du modèle des questions :
- `MANAGE_PARCOURS` : accordée à `admin` et `super_admin` uniquement — **pas** à `editor` (dont le périmètre reste explicitement limité aux questions ; un parcours reste un type de contenu distinct).
- `PURGE_PARCOURS` : accordée à `admin` et `super_admin` uniquement, jamais à un futur rôle de gestion de contenu.

---

## Sécurité (Firestore)

Collection globale `parcours/{parcoursId}` (jamais sous `users/{uid}`), et `parcours_audit_logs/{logId}` (journal immuable, même principe que `question_audit_logs/`). Quatre règles de mise à jour distinctes, reprenant fidèlement la structure de `questions/` :
1. Création : identifiant du document = champ `id`, statut toujours `draft`.
2. Édition complète (nom, description, compétences...) : statut et identifiant doivent rester inchangés.
3. Transition de statut générale (hors corbeille) : `hasOnly(['status','updatedAt'])`, **exclut explicitement l'ancien statut `trash`**.
4. Transition dédiée Archivé <-> Corbeille : seule voie pour atteindre ou quitter la corbeille.

Suppression définitive contrainte au statut `trash` uniquement — défense en profondeur, indépendante de l'application cliente.

`firestore.indexes.json` complété avec 4 index composites proposés (statut+date de création, statut+date de modification, statut+nom, auteur+date de création).

---

## Hors périmètre (respecté à la lettre)

Rien de ce qui suit n'a été développé, comme explicitement demandé : progression utilisateur, validation automatique, badges de réussite, certificats, campagnes, analytics, recommandations, IA. Le moteur de quiz, les statistiques, l'authentification, l'import et la Banque de questions n'ont **strictement rien changé** — vérifié par 978 vérifications de non-régression, toutes réussies.

---

## Tests réalisés

### Suite 1 — `test_parcours_metadata.js` (27 vérifications, 27/27 réussies)
Les 5 statuts (mirroir exact des questions) ; génération d'identifiants stables (parcours et compétences) ; `completeCompetency()`/`completeParcoursMetadata()` (défauts sûrs, jamais de texte inventé, préservation d'un identifiant déjà fourni) ; `validateParcoursMetadata()` (statut, longueur minimale du nom, structure des compétences).

### Suite 2 — `test_parcours_catalog_and_audit.js` (27 vérifications, 27/27 réussies)
Création, lecture, pagination réelle par curseur, filtre serveur, recherche bornée avec limite configurable et surcharge par appel, changement de statut, édition de champs (**un champ non autorisé comme `status` silencieusement ignoré**), suppression, journal d'audit dédié.

### Suite 3 — `test_parcours_service.js` (40 vérifications, 40/40 réussies)
Contrôle d'accès ; création (nom minimal, statut toujours `draft`, identifiant stable, auteur enregistré) ; navigation (mode normal et recherche) ; **workflow de suppression sécurisée complet** (chaque transition autorisée et refusée, y compris la vérification qu'un rôle sans `MANAGE_PARCOURS` est bloqué dès l'accès général) ; édition limitée ; gestion complète des compétences (ajout, suppression avec réindexation, réordonnancement, refus aux extrémités) ; liaison/déliaison de questions (avec refus d'un doublon) ; **réutilisation confirmée** de `question-catalog-service.js` pour la recherche de questions à lier ; historique combiné et trié chronologiquement.

### Suite 4 — `test_parcours_ui.js` (32 vérifications, 32/32 réussies)
Contrôle d'accès réel ; rendu de la liste (icône, badge, nombre de compétences) ; formulaire de création ; fiche détaillée complète (description, public cible, compétences avec questions liées, historique) ; boutons d'action conditionnels au statut (workflow sécurisé complet, y compris la mention d'irréversibilité de la suppression définitive) ; édition ; gestion des compétences depuis l'interface ; panneau de liaison de questions (recherche, sélection, retrait) ; états vide et erreur.

### Suite 5 — `test_firestore_rules_parcours.js` (28 vérifications, 28/28 réussies)
Simulation fidèle des 4 règles de mise à jour et de la suppression contrainte, **avec la vérification explicite que l'ancien statut ne peut jamais être « corbeille » pour la règle générale** (le type de faille détectée au Sprint 11 a été anticipé dès l'écriture, testé avant toute livraison) ; journal d'audit dédié ; régression confirmée sur `isRequesterAdmin()` lui-même.

### Non-régression complète (rejouée après ce sprint)
978 vérifications héritées de tous les sprints précédents, toutes réussies sans exception — couvrant explicitement, comme demandé : moteur de quiz (49x3 + 16 modales), statistiques, authentification, import et sa simulation, Banque de questions (badges, workflow de suppression sécurisée, complétude, recherche), administration existante (utilisateurs, dernier administrateur actif, correctif v1.9.1).

**Total : 154 (nouvelles vérifications Sprint 12) + 978 (non-régression) = 1132 vérifications automatisées dans cette session, toutes réussies.**

### Non testé dans cet environnement
Aucun accès réseau à Firebase/Firestore réel — comme pour tous les sprints précédents, un test manuel après publication reste recommandé (créer/publier/archiver/mettre à la corbeille/supprimer un parcours de test via l'interface, confirmer le refus serveur pour un utilisateur non-administrateur).

---

## Limites connues

1. **Compétences en champ imbriqué, pas en sous-collection** — voir « Modèle de données » ci-dessus pour la justification ; une migration reste possible si le besoin apparaît (grand nombre de compétences, requêtes indépendantes sur les compétences).
2. **Réordonnancement simple (haut/bas), pas de glisser-déposer** — suffisant pour ce sprint, une bibliothèque de glisser-déposer serait un ajout futur si le besoin s'en fait sentir.
3. **Aucune limite de taille sur le tableau de compétences ou de questions liées** — un document Firestore reste plafonné à 1 Mo ; un parcours avec un nombre extrême de compétences/liaisons pourrait un jour approcher cette limite (peu réaliste au vu de l'usage prévu, mais non testé).
4. **Recherche de parcours bornée** (même principe et même limite configurable que la Banque de questions) — pas un moteur de recherche exhaustif à grande échelle.
5. **Aucun lien avec le moteur de quiz** — un parcours et ses compétences ne sont, pour l'instant, qu'une structure organisationnelle consultée depuis l'administration ; aucune interface étudiante ou pharmacien ne les exploite encore (explicitement hors périmètre de ce sprint).

## Recommandations pour le Sprint 13

- Écran de consultation du journal `parcours_audit_logs/` (la lecture existe déjà, non exposée à l'écran ce sprint).
- Réfléchir à la présentation d'un Parcours côté utilisateur final (étudiant/pharmacien), une fois la structure de données éprouvée.
- Si le nombre de compétences par parcours croît significativement, envisager une sous-collection Firestore dédiée.
- Déployer `firestore.rules` et `firestore.indexes.json` après relecture humaine.
