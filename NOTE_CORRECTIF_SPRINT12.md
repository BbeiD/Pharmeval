# NOTE DE CORRECTION — Correctif Sprint 12 (Parcours)

**Pharmeval v2.3.0 → v2.3.1**

## 1. Sélection de couleur

Remplacé la saisie libre par une palette fermée de 6 couleurs (vert, bleu, orange, violet, rouge, gris), affichées sous forme de pastilles cliquables. La valeur technique (ex. `"vert"`) est enregistrée ; le code hexadécimal réel n'est utilisé que pour l'affichage (`PARCOURS_COLOR_HEX`).

**Compatibilité conservée** : un parcours déjà créé avec un ancien code hexadécimal libre (ex. `"#2E7D32"`) continue de s'afficher exactement comme avant (`resolveParcoursColorHex()`) — aucune migration, aucune perte. La validation de la palette fermée ne s'applique qu'aux nouvelles créations et aux nouvelles modifications.

## 2. Ajout multiple de compétences

Nouvelle fonction « Ajouter plusieurs » : un panneau dédié permet de coller une liste (une compétence par ligne). Avant tout enregistrement, un récapitulatif affiche ce qui sera ajouté, les doublons ignorés (contre l'existant et entre les lignes collées) et les lignes vides ignorées. Une seule écriture Firestore pour tout le lot. L'ajout unitaire existant reste inchangé.

## 3. Historique

**Cause racine identifiée** : il manquait l'index composite Firestore (`parcoursId` + `date`) requis dès qu'une requête combine un `where` et un `orderBy` sur des champs différents — sans cet index, Firestore refuse la requête, provoquant le message d'erreur. Ajouté dans `firestore.indexes.json`.

En complément, la fonction de récupération de l'historique a été rendue plus robuste : l'événement de création (dérivé directement du parcours lui-même) s'affiche désormais **toujours**, même si le journal détaillé est indisponible. Le message « Aucun historique disponible » n'apparaît que s'il n'existe réellement aucun événement ; une panne du journal affiche une mention discrète plutôt qu'un blocage complet.

**Constat additionnel, corrigé par précaution** : le même index manquant existait pour le journal d'audit des questions (`question_audit_logs`), avec le même risque. Ajouté également, sans modifier aucun comportement de la Banque de questions.

## Fichiers modifiés

`js/services/parcours-metadata-service.js`, `js/services/parcours-service.js`, `admin/parcours.js`, `admin/parcours.html`, `css/styles.css`, `firestore.indexes.json`.

## Tests

63 nouvelles vérifications ciblées sur ce correctif (couleurs et compatibilité ascendante, ajout en bloc de 5 compétences avec doublons/lignes vides/ordre, historique après création/modification/publication, présence des index corrigés), toutes réussies. 1132 vérifications héritées rejouées sans aucune régression.
