# RAPPORT_SPRINT7.md — Moteur de recommandations intelligentes

**Sprint 7 — Pharmeval v1.7.0 (base) → v1.8.0**

## Objectif du sprint

Créer un premier moteur de recommandations personnelles : simple, entièrement basé sur des règles explicites (aucune IA, aucun apprentissage automatique), qui propose sans jamais décider à la place de l'utilisateur, et qui explique chacune de ses suggestions de façon transparente.

---

## Architecture retenue

Chaîne de responsabilité respectée telle que demandée :

```
Firestore (users/{uid}/evaluations)
        ↓
js/services/history-service.js       (lecture seule, une seule requête partagée)
        ↓
js/services/statistics-service.js    (calcul statistique pur)
        ↓
js/services/recommendation-service.js (moteur de règles pur, consomme les statistiques)
        ↓
js/recommendation.js                  (rendu uniquement)
        ↓
Interface ("Vos recommandations", au-dessus de l'analyse de progression)
```

### Refactor important : une lecture Firestore partagée entre statistiques et recommandations

Le Sprint 6 effectuait une lecture Firestore dédiée pour l'Analyse de progression (`getEvaluationsForStatistics()`, plafonnée à 100 évaluations). Ce sprint introduit un second consommateur de la même donnée (le moteur de recommandations), qui a besoin d'exactement la même liste d'évaluations. Plutôt que d'effectuer une **deuxième lecture Firestore redondante**, `js/history.js` a été modifié pour :

1. Effectuer **une seule fois** `getEvaluationsForStatistics()` à l'ouverture du Centre de progression.
2. Transmettre le résultat à **deux fonctions de rendu pures** : `renderStatisticsFromData()` (statistics.js, nouvellement exportée) et `renderRecommendationsFromData()` (recommendation.js).

`js/statistics.js` a donc été **modifié** (pas seulement `js/history.js`) : sa fonction `render()` interne a été exposée sous le nom `renderStatisticsFromData(evaluations, truncated)`, et `loadAndRenderStatistics()` (fetch + rendu, conservée telle quelle pour compatibilité et testée isolément) l'appelle désormais en interne. **Aucun comportement visible n'a changé** pour l'Analyse de progression elle-même — vérifié par la suite de tests du Sprint 6 rejouée intégralement sans modification (23/23 réussis).

Ce choix respecte le principe déjà énoncé au Sprint 6 (« ne jamais relire plusieurs fois les mêmes évaluations ») et evite d'ajouter une troisième lecture Firestore indépendante, ce qui aurait été contraire à l'esprit de la consigne malgré l'architecture linéaire suggérée par le schéma.

---

## Fichiers modifiés

| Fichier | Nature de la modification |
|---|---|
| `js/services/statistics-service.js` | **Ajout de 2 fonctions, purement additif** : `getThemeRecency(evaluations)` (jours écoulés depuis la dernière pratique de chaque thème) et `calculateActivityMetrics(evaluations)` (jours depuis la dernière évaluation, nombre d'évaluations des 7 derniers jours). Aucune fonction existante du Sprint 6 n'a été touchée — vérifié par diff et par la suite de tests `test_statistics_service.js` du Sprint 6 rejouée sans modification (45/45 réussis). |
| `js/statistics.js` | Extraction de `render()` en une fonction exportée `renderStatisticsFromData(evaluations, truncated)`, réutilisée à la fois par `loadAndRenderStatistics()` (conservée, fetch + rendu) et par le nouveau flux partagé de `js/history.js`. `renderError()` et `renderLoading()` également exportées pour le même usage partagé. Aucun changement de comportement visible. |
| `js/history.js` | Remplacement de l'appel à `loadAndRenderStatistics()` par une nouvelle fonction interne `loadStatisticsAndRecommendations()` : une seule lecture (`getEvaluationsForStatistics()`), puis appel de `renderStatisticsFromData()` et `renderRecommendationsFromData()` avec la **même** liste. Aucune autre logique (pagination, filtres, recherche, détail, coloration des scores) n'a été touchée — vérifié par la suite de tests du Sprint 6 rejouée intégralement (44/44) plus 6 nouvelles vérifications sur le partage de lecture. |
| `index.html` | Ajout de la section `<div id="recommendations-section">`, placée au-dessus de `#statistics-section`, comme demandé. |
| `css/styles.css` | Ajout des styles des cartes de recommandation. Aucune règle existante modifiée. |
| `js/admin.js` | 1 seule ligne : `APP_VERSION` → `'Pharmeval v1.8.0'`. |

## Fichiers créés

| Fichier | Rôle |
|---|---|
| `js/services/recommendation-service.js` | Moteur de règles complet (voir détail ci-dessous). |
| `js/recommendation.js` | Rendu de la section « Vos recommandations ». |

**Confirmé strictement inchangés** (comparaison octet pour octet) : `js/app.js`, `js/auth.js`, `js/onboarding.js`, `js/firebase-config.js`, `js/services/user-service.js`, `js/services/app-context.js`, `js/services/authorization-service.js`, `js/services/evaluation-service.js`, `js/services/date-utils.js`, `js/services/score-utils.js`, `js/services/history-service.js`, `data/questions.js`, `data/fiche-images.js`, `data/proc2-images.js`. **Authentification, onboarding, rôles, administration, évaluations, scores, sauvegarde locale, synchronisation, historique et analyse de progression n'ont subi aucune régression.**

---

## Toutes les règles utilisées (« SI... ALORS... »)

Chaque règle est une fonction indépendante dans `js/services/recommendation-service.js`, testable isolément.

### 1. Faiblesse identifiée (`weakness`)
**SI** un thème dispose d'au moins 2 évaluations (seuil de fiabilité déjà défini par `statistics-service.js`) **ET** sa moyenne est strictement inférieure à `weakTheme` (65 %) **ALORS** proposer une évaluation ciblée sur le thème le plus faible parmi ceux éligibles.

### 2. Thème oublié (`forgotten_theme`)
**SI** un thème déjà pratiqué n'a plus été travaillé depuis au moins `themeForgottenDays` (21 jours) **ALORS** le signaler (le plus ancien parmi les éligibles, en jours).

### 3. Progression (`progression`)
**SI** la tendance récente (calculée par `calculateProgressTrend()`, Sprint 6 : moyenne des 5 évaluations les plus récentes vs moyenne des 5 précédentes) est `"up"` **ET** l'écart dépasse `progressionMargin` (+5 points) **ALORS** féliciter et encourager à continuer.

### 4. Régression (`regression`)
**SI** la tendance récente est `"down"` **ET** l'écart est inférieur ou égal à `regressionMargin` (-5 points) **ALORS** conseiller de revoir les fondamentaux.

### 5. Régularité — bon rythme (`regularity_good`)
**SI** au moins `weeklyGoodRhythmCount` (5) évaluations ont été réalisées au cours des 7 derniers jours **ALORS** féliciter le rythme.

### 5bis. Régularité — inactivité (`regularity_inactive`)
**SI** aucune évaluation n'a été réalisée depuis au moins `inactivityDays` (14 jours) **ALORS** encourager une reprise.

### 6. Réussite exceptionnelle (`exceptional`)
**SI** les `exceptionalStreakCount` (3) évaluations les plus récentes (par date) ont **toutes** un score ≥ `exceptionalScoreThreshold` (90 %) **ALORS** féliciter et suggérer d'essayer un niveau plus difficile.

### Cas particulier : données insuffisantes
**SI** l'utilisateur a moins de `minEvaluationsForRecommendations` (5) évaluations **ALORS** aucune règle n'est évaluée : le moteur renvoie `insufficientData: true` et l'interface affiche « Continuez vos évaluations. Nous construirons bientôt votre profil d'apprentissage. » — jamais de recommandation inventée.

---

## Seuils centralisés (`RECOMMENDATION_THRESHOLDS`)

```js
{
  weakTheme: 65,
  strongTheme: 85,                  // reserve a un usage futur (voir "Evolutions futures")
  inactivityDays: 14,
  themeForgottenDays: 21,            // ajoute par rapport a l'exemple fourni (voir note ci-dessous)
  progressionMargin: 5,
  regressionMargin: -5,
  exceptionalScoreThreshold: 90,     // ajoute (voir note ci-dessous)
  exceptionalStreakCount: 3,         // ajoute
  weeklyGoodRhythmCount: 5,          // ajoute
  minEvaluationsForRecommendations: 5,
  maxRecommendations: 3,             // ajoute
}
```

**Note sur les seuils ajoutés au-delà de l'exemple fourni dans la demande** : la demande donnait `RECOMMENDATION_THRESHOLDS` « par exemple », avec 5 clés. Le moteur en compte 11, car plusieurs règles nécessitaient un seuil numérique propre qui n'aurait sinon été qu'une « valeur magique » cachée dans le code (interdit explicitement par la demande) :
- `themeForgottenDays` (21 jours) : distinct de `inactivityDays` (14 jours, qui concerne l'inactivité **globale**, tous thèmes confondus) — un thème spécifique mérite un délai plus long avant d'être signalé comme « oublié », pour ne pas multiplier les alertes sur des thèmes simplement moins pratiqués récemment.
- `exceptionalScoreThreshold` (90 %) : l'exemple de la demande mentionne littéralement « au-dessus de 90 % » pour la réussite exceptionnelle, distinct de `strongTheme` (85 %, qui sert à qualifier un thème comme fort dans l'Analyse de progression, Sprint 6).
- `exceptionalStreakCount` (3), `weeklyGoodRhythmCount` (5, repris de l'exemple « 5 évaluations cette semaine »), `minEvaluationsForRecommendations` (5, repris de l'exemple « moins de 5 évaluations »), `maxRecommendations` (3, repris de « le moteur doit choisir les 3 plus pertinentes »).

---

## Logique de priorité

Chaque règle calcule sa propre priorité (0-100) selon une formule simple et documentée dans le code :

| Règle | Formule (simplifiée) | Plage |
|---|---|---|
| Régression | `70 + (écart en valeur absolue − 5)` | 70 à 100 |
| Faiblesse identifiée | `50 + (seuil − moyenne du thème)` | 50 à 90 |
| Thème oublié | `55 + (jours au-delà du seuil) / 2` | 55 à 80 |
| Inactivité | `50 + (jours au-delà du seuil) / 2` | 50 à 75 |
| Progression | `30 + (écart − marge)` | 30 à 55 |
| Bon rythme | fixe | 25 |
| Réussite exceptionnelle | fixe | 20 |

Ces plages correspondent directement aux exemples donnés dans la demande (« 90 → Régression importante », « 70 → Thème oublié », « 20 → Bravo »). **Toutes les règles qui se déclenchent sont triées par priorité décroissante, et seules les 3 premières sont conservées** (`maxRecommendations`). Vérifié par test avec un utilisateur cumulant 4 règles déclenchées simultanément : exactement 3 recommandations retenues, dans le bon ordre, la régression en tête.

## Logique de confiance

Le champ `confidence` (0-100) ne prétend jamais à une certitude non justifiée par les données :
- **Régression/Progression** : confiance fixe à 90 % (le calcul de tendance sous-jacent exige déjà au moins 10 évaluations, donc une base de données raisonnable).
- **Faiblesse identifiée** : `40 + (nombre d'évaluations du thème × 15)`, plafonné à 95 % — un thème tout juste éligible (2 évaluations, le minimum) obtient une confiance nettement plus basse (70 %) qu'un thème avec davantage de données (95 % dès 4 évaluations). Vérifié explicitement par test.
- **Thème oublié / Inactivité / Bon rythme / Réussite exceptionnelle** : confiance élevée (90-95 %), ces règles reposant sur des faits directement observables (dates, comptages) plutôt que sur une tendance statistique.

---

## 🌟 Transparence : « Pourquoi cette recommandation ? »

Chaque recommandation porte un champ **`reason`**, une phrase concrète référençant les chiffres réels ayant déclenché la règle — jamais un texte générique. Exemples produits réellement par le moteur (issus des tests) :

> « Parce que votre moyenne sur « antibiotherapie » (43 %, sur 2 évaluations) est inférieure au seuil de 65 %. »

> « Parce que vous n'avez pas travaillé « preparations-magistrales » depuis 42 jours (seuil : 21 jours). »

> « Parce que la moyenne de vos 5 dernières évaluations est inférieure de 30 points à celle des 5 précédentes. »

Dans l'interface, ce texte est affiché derrière un élément `<details>` discret (« Pourquoi cette recommandation ? »), non intrusif mais toujours accessible en un clic — jamais de boîte noire.

---

## Modèle de données

Chaque recommandation respecte strictement le contrat demandé :

```js
{
  id,            // identifiant stable (ex. "weak-theme-antibiotherapie")
  type,          // 'weakness' | 'forgotten_theme' | 'progression' | 'regression' | 'regularity_good' | 'regularity_inactive' | 'exceptional'
  priority,      // 0-100
  title,
  description,
  action: { label, actionId, enabled },
  confidence,    // 0-100
  reason,        // "Pourquoi cette recommandation ?"
}
```

## Boutons d'action

Seule l'action **« Commencer une évaluation »** (`start-evaluation`) est implémentée ce sprint : elle ferme le Centre de progression et affiche l'accueil — **l'utilisateur choisit lui-même son thème et son quiz**, le moteur ne lance jamais une évaluation à sa place (philosophie : « il propose, il explique, il laisse toujours le choix »).

Les actions **« Voir mes erreurs »** (`view-errors`, associée à la régression) et **« Essayer un niveau plus difficile »** (`increase-difficulty`, associée à la réussite exceptionnelle) sont **prévues proprement mais rendues désactivées** (`enabled: false`), avec une info-bulle « Bientôt disponible » — conformément à la consigne. Le bouton **« Ignorer »** est fonctionnel dès ce sprint : il retire la carte de l'affichage pour la session en cours (aucune persistance, voir Limites).

## Accessibilité du langage

Toutes les formulations ont été rédigées ou vérifiées pour éviter toute tournure culpabilisante (« Vous pourriez renforcer... » plutôt que « Vous êtes mauvais... ») — vérifié explicitement par test (absence de toute variante de « vous êtes mauvais/nul/faible » dans le texte rendu).

---

## Tests réalisés

### Suite 1 — `test_recommendation_service.js` (54 vérifications, 54/54 réussies)
Couvre explicitement chaque profil demandé :
- **Utilisateur débutant** (0, 1 et 4 évaluations) : `insufficientData` toujours vrai, aucune recommandation inventée.
- **Utilisateur régulier stable** : aucune fausse régression/progression avec moins de 10 évaluations.
- **Utilisateur inactif** : règle d'inactivité déclenchée avec le bon nombre de jours.
- **Progression** et **régression** : déclenchement correct, delta exact référencé dans la raison, jamais de formulation culpabilisante.
- **Thèmes faibles** : identification correcte du thème le plus faible, seuil de fiabilité (2 évaluations minimum) strictement respecté — un thème à 1 seule évaluation, même à 10 %, n'est jamais signalé.
- **Thème oublié** : identification correcte, nombre de jours exact (42, reprenant l'exemple de la demande).
- **Réussite exceptionnelle** : déclenchement sur 3 évaluations consécutives ≥ 90 %, contre-exemple vérifié (si une des 3 est sous le seuil, aucune recommandation).
- **Bon rythme** : déclenchement correct à 5 évaluations sur 7 jours.
- **Priorité et tri** : jamais plus de 3 recommandations, triées par priorité décroissante, la régression en tête dans un scénario à 4 règles déclenchées.
- **Modèle de données** : chaque champ requis (`id`, `type`, `priority`, `title`, `description`, `action`, `confidence`, `reason`) présent et correctement typé.
- **Confiance** : un thème faible avec seulement 2 évaluations obtient une confiance strictement inférieure à un cas mieux documenté.

### Suite 2 — `test_recommendation_ui.js` (22 vérifications, 22/22 réussies)
Rendu réel avec le vrai moteur (pas de mock de calcul) : message adapté pour données insuffisantes, cartes complètes (icône, titre, description, confiance, bloc « Pourquoi »), bouton « Ignorer » fonctionnel (retire la bonne carte), action `start-evaluation` ferme bien l'historique et affiche l'accueil, action non implémentée journalisée proprement sans jamais planter, bouton désactivé correctement rendu, message d'erreur convivial sans terme technique, absence de toute formulation culpabilisante.

### Suite 3 — Non-régression du Sprint 6 (rejouée sans modification)
- `test_statistics_service.js` : 45/45 (les 2 nouvelles fonctions ajoutées n'ont affecté aucune fonction existante).
- `test_statistics_ui.js` : 23/23 (`loadAndRenderStatistics()` se comporte exactement comme avant après le refactor).
- `test_score_utils.js` : 20/20. `test_date_utils.js` : 18/18.

### Suite 4 — `test_history_ui.js` mis à jour (50 vérifications, 50/50 réussies)
Les 44 vérifications du Sprint 6 (dont la coloration des scores) rejouées sans régression, plus 6 nouvelles vérifications sur le refactor de lecture partagée : une seule lecture Firestore alimente à la fois les statistiques et les recommandations avec la **même** liste d'évaluations (vérifié par identité de référence, pas seulement égalité de valeur), et une panne de cette lecture partagée déclenche bien les deux messages d'erreur sans affecter la liste.

### Suite 5 — Non-régression complète du reste du projet (rejouée après ce sprint)
49 tests fonctionnels du moteur de quiz (×3) + 16 modales + 25 (contexte/autorisation) + 16 (administration) + 9 (intégration auth/admin) + 29 (synchronisation) + 12 (intégration `showResults()`) : **tous réussis**.

**Total : 54 + 22 + 45 + 23 + 20 + 18 + 50 + 107 = 339 vérifications automatisées dans cette session, toutes réussies.**

### Non testé dans cet environnement
Rendu visuel réel dans un navigateur ; comportement réel contre le projet Firestore `pharmeval-ea3d3` (déjà signalé aux sprints précédents, aucun accès réseau disponible ici).

---

## Limites connues

1. **Une recommandation par type de règle**, jamais plusieurs pour le même type (ex. un seul thème faible signalé même si plusieurs sont éligibles) — choix délibéré pour rester simple et ne pas saturer l'utilisateur, conformément à « les recommandations doivent rester simples ».
2. **« Ignorer » n'est pas persistant** : une recommandation ignorée réapparaît à la prochaine ouverture du Centre de progression si les conditions qui l'ont déclenchée sont toujours réunies (aucune mémorisation en base ce sprint).
3. **Boutons d'action partiellement implémentés** : « Voir mes erreurs » et « Essayer un niveau plus difficile » sont prévus proprement (contrat d'action complet, désactivation propre) mais ne font rien de plus qu'afficher une info-bulle ce sprint.
4. **Le calcul de tendance est réutilisé tel quel** (5 évaluations récentes vs 5 précédentes, Sprint 6) : la règle de régression/progression hérite donc de la même exigence de 10 évaluations minimum, même si un utilisateur avec 6-9 évaluations montre déjà une tendance visuellement nette.
5. **Une seule lecture Firestore plafonnée à 100 évaluations** (héritée du Sprint 6) alimente aussi le moteur de recommandations : un utilisateur avec un historique plus long verra ses recommandations calculées uniquement sur ses 100 évaluations les plus récentes.

## Évolutions futures (préparées, non développées ce sprint)

- **Répétition espacée** : `getThemeRecency()` (déjà créé ce sprint) fournit la brique de base nécessaire.
- **Recommandations basées sur les erreurs fréquentes** : nécessiterait d'exploiter le détail `questions[]` de chaque évaluation (déjà disponible, non exploité par le moteur actuel qui ne regarde que les agrégats).
- **Campagnes imposées / rappels automatiques / notifications** : le champ `action.enabled = false` prépare déjà l'activation progressive de nouvelles actions sans changer le contrat de données.
- **`strongTheme` (85 %)** : seuil déjà défini mais pas encore exploité par une règle (ex. suggérer un niveau supérieur sur un thème maîtrisé) — piste naturelle pour un sprint futur.
- **Persistance des recommandations ignorées** : stocker un statut « ignoré jusqu'à… » par recommandation, par exemple dans le document utilisateur ou une sous-collection dédiée.
