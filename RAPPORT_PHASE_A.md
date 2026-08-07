# Sprint 21.5 — Phase A : suppression de l'écran Étudiant/Pharmacien

## Écrans supprimés
- **`#profile-selector`** (choix manuel Étudiant/Pharmacien) — supprimé de `index.html`.
- **Bouton « Changer d'espace »** (`#btn-change-space`) et son code (`changeSpace()`, `goToProfileSelector()`, `resetSessionState()`, `isQuizInProgressWithAnswer()`) — supprimés de `app.js` (usage exclusif vérifié par recherche globale avant suppression).
- **Filtre « Étudiant / Pharmacien »** de l'écran « Mes évaluations » — supprimé (le reste de l'écran conservé, voir ci-dessous).
- **`#active-profile-badge`** — retiré (n'avait plus de justification, l'utilisateur ne choisit plus explicitement de « profil » visible).

## Écran reconstruit... et une correction de mon analyse initiale
**« Mes évaluations » (`#history-view`) n'a *pas* été supprimé**, contrairement à ma recommandation initiale. En l'inspectant réellement (`js/history.js`) avant d'agir — comme je m'y étais engagé — j'ai constaté qu'il ne s'agit pas d'un écran V1 mort : il est branché sur `history-service.js` (Firestore réel), avec statistiques et recommandations (`statistics.js`, `recommendation.js`). Ce n'est pas un doublon de `mes-competences.html` mais un contenu complémentaire (évaluations individuelles vs maîtrise agrégée). Je te le signale explicitement plutôt que de supprimer silencieusement une fonctionnalité réelle sur la base d'une hypothèse non vérifiée.

## Nouveau parcours utilisateur

```
Connexion
  ↓
Chargement du profil (userData.profile.profession, déjà collecté par l'onboarding)
  ↓
Accueil affiché immédiatement (plus jamais d'écran de choix)
```

`js/auth.js` dérive automatiquement l'espace à partir de `profile.profession` (déjà collecté par l'assistant de première connexion existant — aucune nouvelle collecte de donnée) :
- `student` → espace étudiant
- `pharmacist` → espace pharmacien
- `pharmacy_technician` / `teacher` / `other` / non renseigné → repli documenté sur l'espace pharmacien (voir limite ci-dessous)

## Limite connue et assumée (à ne pas découvrir en Phase B)

`#home-view` reste, pour cette seule phase, structuré autour du choix binaire hérité `THEME_CONFIG['student'|'pharmacist']` — je n'ai pas touché à cette mécanique (hors périmètre de la Phase A, c'est exactement l'objet de la Phase B). Le mappage ci-dessus est donc un **repli pragmatique et temporaire**, pas un modèle de rôles définitif : un assistant pharmaceutico-technique ou un formateur reçoit aujourd'hui l'espace pharmacien par défaut. La Phase B (refonte de `#home-view` en Entraînement libre, piloté par compétences/catalogue) supprimera ce mécanisme binaire entièrement — cette fonction de repli n'existera plus.

## Impacts

- **Firestore** : aucun. Aucune collection, aucun champ modifié ou supprimé. `profile.profession` était déjà collecté et stocké ; il est simplement lu différemment côté interface.
- **Menus** : le header perd 2 boutons (« Changer d'espace », le badge de profil) ; le bouton « Mes évaluations » reste, son filtre interne est simplifié.
- **Formations futures** : aucun impact — hors périmètre de cette phase.
- **Aucune régression sur** : moteur de synchronisation, catalogue éditorial, banques documentaires, compétences, utilisateurs, organisations (aucun de ces fichiers n'a été touché).

## Tests réalisés

`test-phase-a.mjs` — **32/32 réels**, exécutés contre les fichiers effectivement modifiés :
- Absence effective des éléments/fonctions supprimés dans `index.html`/`app.js` (recherche exacte, pas une supposition).
- Présence confirmée des éléments volontairement conservés (`#btn-history`, `#history-view`, `#recommendations-section`, `#statistics-section`).
- **Comportement réel** de `deriveLegacyProfileFromProfession` vérifié en exécutant la fonction extraite du fichier livré (via `vm`), pour les 7 cas de profession possibles.

## Ce qui n'a pas pu être vérifié ici
Aucun test dans un navigateur réel (pas d'environnement disponible) — la vérification porte sur le contenu textuel exact des fichiers et l'exécution isolée de la logique pure, pas sur un rendu DOM complet ni sur une session Firebase réelle. À vérifier visuellement avant mise en production.

## Recommandation pour la suite

Prêt pour la **Phase B** (nouvel écran Entraînement libre, remplacement complet de `#home-view`) dès ton feu vert — c'est cette phase qui supprimera définitivement le mécanisme de repli documenté ci-dessus.
