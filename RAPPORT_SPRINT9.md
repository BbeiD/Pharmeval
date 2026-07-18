# RAPPORT_SPRINT9.md — Architecture pédagogique

**Sprint 9 — Pharmeval v1.9.1 → v2.0.0**

## Pourquoi v2.0.0

Ce sprint change le **modèle de données** des questions — pas une fonctionnalité isolée, mais le socle sur lequel reposeront l'éditeur de questions, les imports Excel/JSON, les campagnes, un moteur de recommandations enrichi et la recherche. Conformément à la demande, ce changement d'architecture est traité comme une évolution majeure : **v2.0.0**.

**Aucune régression fonctionnelle pour autant** : les 949 questions existantes continuent de fonctionner à l'identique, `data/questions.js` n'est pas modifié, et rien de nouveau n'est encore affiché au joueur.

---

## Architecture

```
js/services/question-service.js           (facade principale : identifiants technique + pedagogique, metadonnees completes)
        │
        ├──▶ js/services/question-metadata-service.js   (modele de donnees, defauts, validation, normalisation)
        │           │
        │           └──▶ js/services/tag-service.js       (registre centralise des tags/mots-cles)
        │           └──▶ js/services/theme-utils.js       (libelles humains, liste des themes connus - etendu ce sprint)
        │
        └──▶ js/services/evaluation-service.js  (reutilise computeQuestionId(), jamais duplique)
```

**Aucune logique métier dans l'interface** : aucun de ces services n'est aujourd'hui appelé par une interface (conformément à « ces données ne devront pas encore être affichées au joueur ») — ils sont posés, testés, documentés, prêts à être consommés par un futur écran.

---

## Fichiers créés

| Fichier | Rôle |
|---|---|
| `js/services/question-service.js` | Façade principale : identifiant technique (réutilise `computeQuestionId`), **nouvel** identifiant pédagogique stable, métadonnées complètes d'une question. |
| `js/services/question-metadata-service.js` | Le modèle de données lui-même : énumérations (`QUESTION_STATUSES`, `DIFFICULTY_LEVELS`, `QUESTION_TYPES`, `QUESTION_SPACES`), dérivation des valeurs par défaut, normalisation de la difficulté, validation. |
| `js/services/tag-service.js` | Registre centralisé des tags (normalisation, libellés, enregistrement), réutilisable par le futur moteur de recommandations. |

## Fichiers modifiés

| Fichier | Nature de la modification |
|---|---|
| `js/app.js` | Ajout de **deux lignes** exposant `THEME_CONFIG` et `themeOfQuestion()` (déjà existants, inchangés) via `window`, exactement selon le pattern déjà établi au Sprint 5 pour `QDB`. Permet à `question-metadata-service.js` de dériver `domain`/`theme`/`space` sans dupliquer cette logique de classification (y compris le cas particulier `"cbip"` déjà géré). Aucune autre ligne touchée. |
| `js/services/theme-utils.js` | `THEME_LABELS` (déjà existante) devient **exportée** (`export const`, était interne) et complétée par `KNOWN_THEMES` (liste dérivée, pour la validation) et `THEME_CODES` (codes à 3 lettres, pour l'identifiant pédagogique). Purement additif — `formatThemeLabel()` inchangée. |

**Confirmé strictement inchangés** : `data/questions.js` (les 949 questions, aucune modifiée), tous les autres services (`user-service.js`, `app-context.js`, `authorization-service.js`, `admin-service.js`, `user-management-service.js`, `audit-service.js`, `evaluation-service.js`, `history-service.js`, `statistics-service.js`, `recommendation-service.js`, `date-utils.js`, `score-utils.js`), toutes les interfaces (`index.html`, `css/styles.css`, `js/history.js`, `js/statistics.js`, `js/recommendation.js`, `js/admin.js`, `js/auth.js`, `js/onboarding.js`), `firestore.rules`.

---

## Le nouveau modèle de données

Voir **`QUESTION_SCHEMA.md`** pour la documentation complète (21 propriétés, description, exemples). Résumé des points clés :

### Les 4 niveaux de classification (`space > domain > theme > subtheme`)
Pharmeval ne connaît aujourd'hui que 2 niveaux réels (thème, sous-thème). `domain` reprend aujourd'hui la même valeur que `theme` — **aucune taxonomie de domaine n'a été inventée**, le champ est réservé pour une évolution future sans casser le schéma.

### Les statuts
`draft`/`review`/`published`/`archived`. Toutes les 949 questions existantes deviennent `published` (calculé, jamais stocké). Une métadonnée saisie manuellement sans statut explicite part en `draft` par prudence — jamais publiée par défaut.

### Le versionnement
`version: 1` pour l'existant. Le mécanisme d'incrémentation (2, 3, 4...) n'est pas encore implémenté (aucun éditeur de questions n'existe encore) — le champ est prêt à le recevoir.

### Sources, objectifs pédagogiques, mots-clés, temps estimé
Tous **`null`/`[]` par défaut** pour les questions existantes — jamais inventés. `estimatedTime` reçoit une estimation par défaut selon le type de question (15 s à 90 s, voir `QUESTION_SCHEMA.md`), explicitement documentée comme une estimation, jamais une mesure réelle.

---

## Découverte de compatibilité : la difficulté n'était pas propre

En construisant `getMetadata()`, un balayage complet des 949 questions a révélé que le champ `d` contient **9 écritures différentes** (`essentiel`, `approfondi`, `expert`, `Basique`, `Intermédiaire`, `Expert`, `intermédiaire`, `avancé`, `débutant`) — jamais uniformisées jusqu'ici, puisque seul le filtre de difficulté du quiz les comparait entre elles sans jamais les valider contre une liste fermée.

**Solution retenue, sans toucher à `data/questions.js`** : `normalizeDifficulty()` (`question-metadata-service.js`) regroupe ces 9 écritures en exactement 3 niveaux canoniques :

| Niveau | Regroupe | Total |
|---|---|---|
| `essentiel` | essentiel, Basique, débutant | 409 |
| `approfondi` | approfondi, Intermédiaire, intermédiaire | 475 |
| `avance` | expert, Expert, avancé | 65 |

**Vérifié par test sur l'intégralité des 949 questions** : chacune normalise correctement, la somme reconstitue exactement 949. Sans cette normalisation, `validateMetadata()` aurait rejeté la majorité des questions existantes pour « difficulté invalide » — un vrai risque de casse silencieuse, détecté et corrigé avant livraison plutôt qu'après.

---

## Compatibilité ascendante

**Aucune question de `data/questions.js` n'est modifiée.** `getQuestionMetadata(q)` ne mute jamais l'objet `q` reçu — elle retourne toujours un nouvel objet.

**Vérifié explicitement sur les 949 questions réelles** (pas un échantillon) :
- Aucun plantage.
- Les 21 propriétés du modèle sont présentes sur chacune.
- Toutes défaut à `status: "published"`, `version: 1`.
- Aucune mutation de l'objet source (snapshot avant/après identique).

**Point d'extension pour le futur** (éditeur de questions, imports) : une question peut porter une clé réservée `q._pharmevalMetadata` avec des valeurs réelles déjà renseignées (statut, version, auteur, source, objectifs pédagogiques...) — ces valeurs sont respectées telles quelles ; seuls les champs non fournis reçoivent un défaut. Vérifié par test avec une question fictive « déjà enrichie ».

---

## L'identifiant pédagogique stable (demande complémentaire)

Voir `QUESTION_SCHEMA.md`, section dédiée, pour le détail complet. Résumé :

- **Format** : `PHARM-{CODE_DOMAINE}-{NUMERO sur 6 chiffres}`, ex. `PHARM-BAP-000124`.
- **Stabilité** : basée sur la **position** de la question dans son domaine, au sein de la banque chargée — une correction de texte ne déplace jamais une question, donc ne change jamais son `pedagogicalId` (contrairement à l'`id` technique, basé sur un hachage du texte).
- **Limite honnête, documentée** : cette stabilité ne résiste pas à une insertion/suppression de question au milieu d'un domaine (décalerait les positions suivantes). Une vraie stabilité permanente nécessiterait un champ `id` stocké dans `data/questions.js` — hors périmètre de ce sprint, mais le modèle est prêt à l'accueillir le jour venu (il suffirait de lire `pedagogicalId` depuis ce futur champ plutôt que de le calculer par position).
- **Unicité vérifiée** sur les 949 questions réelles (aucun doublon).
- **Une question absente de la banque chargée** (brouillon non encore intégré) reçoit `pedagogicalId: null` — un identifiant n'est attribué qu'à l'intégration réelle, jamais à un brouillon qui pourrait être abandonné.

---

## Préparation de l'internationalisation (demande complémentaire)

`theme-utils.js` (Sprint 7) sépare déjà les identifiants techniques de theme (`"bapcoc"`) de leurs libellés affichés (`"BAPCOC"`). Ce sprint **étend ce principe** :
- `THEME_LABELS` devient exportée (source unique, réutilisée pour la validation du modèle de questions — jamais redéfinie).
- `tag-service.js` applique le même principe aux tags/mots-clés (`getTagLabel()` sépare l'identifiant technique normalisé de son libellé affiché).
- Toute comparaison de statut/difficulté/type dans le nouveau modèle se fait sur des identifiants techniques stables, jamais sur un libellé affiché en dur — prêt pour une table de traduction par langue le jour venu, sans qu'aucune logique de validation n'ait à changer.

---

## Ce que ce sprint prépare (sans le construire)

Conformément au périmètre demandé, **rien de ce qui suit n'a été construit ce sprint** — seule l'architecture qui le rendra possible sans refonte :
- **Éditeur de questions** : `completeMetadata()` + `validateMetadata()` sont prêts à recevoir une saisie partielle et à la valider avant sauvegarde.
- **Import Excel/JSON** : le point d'extension `q._pharmevalMetadata` permet à un futur import de fournir des métadonnées réelles sans changer le format de base d'une question.
- **Campagnes** : `status`/`version` sont prêts à distinguer les questions publiées des brouillons/révisions dans une future campagne éditoriale.
- **Recommandations** : `tag-service.js` centralise déjà les tags que le moteur de recommandations (`recommendation-service.js`, Sprint 7, non modifié ce sprint) pourra exploiter plus tard — voir la demande explicite « le moteur de recommandations pourra les exploiter plus tard ».
- **Recherche** : `keywords`, `learningObjectives`, `pedagogicalId` sont autant de points d'ancrage pour une future recherche, déjà normalisés et validables.

---

## Tests réalisés

### Suite dédiée — `test_question_architecture.js` (56 vérifications, 56/56 réussies)

Exécutée contre la **banque réelle de 949 questions** (pas des données fictives), couvre :
- **Compatibilité ascendante totale** : aucun plantage sur les 949 questions, les 21 propriétés toujours présentes, statut/version par défaut corrects, aucune mutation de l'objet source, aucune propriété parasite ajoutée.
- **Dérivation correcte** sur des exemples réels : domaine/thème/sous-thème, espace (`pharmacist` pour BAPCOC, `both` pour le thème partagé `etudiant`), identifiant pédagogique au bon format, type de question (respect d'un `type_question` explicite comme `arbre_decisionnel`, repli sur `qcm` sinon), temps estimé cohérent avec le type, champs jamais inventés (`source`, `author`, etc. restent `null`).
- **Identifiant pédagogique** : unicité sur les 949 questions, stabilité entre appels répétés, stabilité face à une modification de texte (contrairement à l'identifiant technique, qui change), `null` pour une question hors banque.
- **Découverte de compatibilité de la difficulté** : les 9 écritures brutes observées, la normalisation vers exactement 3 niveaux sur l'ensemble des 949 questions, la reconstitution exacte des comptages, l'absence de rejet de validation dû à la difficulté.
- **Validation** : chaque défaut de validation testé isolément (statut, difficulté, domaine, thème, sous-thème) et en combinaison (plusieurs erreurs rapportées simultanément).
- **`completeMetadata()`** : une saisie partielle sans statut explicite part en `draft`, jamais `published`.
- **Service de tags** : normalisation, enregistrement, libellés, dédoublonnage.
- **Énumérations** : présence complète et correcte de tous les statuts/espaces/types documentés.
- **Point d'extension futur** : une question « déjà enrichie » (`_pharmevalMetadata`) voit ses valeurs réelles respectées, jamais écrasées par les défauts.

### Non-régression complète (rejouée après ce sprint)
49 tests fonctionnels du moteur de quiz (exercés avec les nouvelles expositions `window.PharmevalThemeConfig`/`window.PharmevalThemeOfQuestion` actives, sans effet de bord) + 16 modales + 25 (contexte/autorisation) + 9 (intégration auth→admin) + 29 (synchronisation des évaluations) + 12 (intégration `showResults()`) + 20 (score-utils) + 18 (date-utils) + 45 (statistics-service) + 54 (recommendation-service) + 22 (recommendation.js) + 25 + 4 (correctifs Sprint 7) + 23 (statistics.js) + 50 (history.js) + 32 (admin-service) + 22 (user-management + audit) + 14 (dernier administrateur actif) + 24 (matrice de permissions) + 40 (admin.js) + 25 (correctif v1.9.1) : **tous réussis, aucune régression**.

**Total : 56 + 521 (non-régression) = 577 vérifications automatisées dans cette session, toutes réussies.**

### Non testé dans cet environnement
Aucun écran n'existe encore pour ce modèle (conformément au périmètre) : rien à tester visuellement. Aucun accès réseau à Firebase — sans objet pour ce sprint, qui ne touche à aucune donnée Firestore.

---

## Limites connues

1. **`domain` ≡ `theme` aujourd'hui** : aucune taxonomie de domaine distincte n'existe. Le champ est prêt, mais vide de contenu propre tant qu'une vraie hiérarchie pédagogique n'est pas définie.
2. **`pedagogicalId` stable par position, pas par stockage permanent** : voir limite détaillée ci-dessus et dans `QUESTION_SCHEMA.md` — résiste aux corrections de contenu en place, pas à une insertion/suppression de questions.
3. **`tags`/`keywords`/`learningObjectives` vides pour toutes les questions existantes** : aucune analyse de contenu n'a été effectuée pour les déduire automatiquement (risque d'invention non vérifiée) — un futur éditeur devra les renseigner question par question.
4. **`estimatedTime` par défaut est une estimation, jamais une mesure réelle** : aucune donnée de temps de réponse n'a jamais été collectée par Pharmeval à ce jour.
5. **Découverte de compatibilité de la difficulté** : les 9 écritures brutes restent telles quelles dans `data/questions.js` (non modifié) — seule la couche de métadonnées les normalise à la lecture. Une reprise éventuelle du fichier source pour uniformiser ce champ resterait une amélioration possible, mais hors périmètre de ce sprint.

## Recommandations pour le Sprint 10

- Construire un premier écran d'éditeur de questions, s'appuyant directement sur `completeMetadata()` + `validateMetadata()`.
- Envisager un vrai champ `id` permanent dans `data/questions.js` pour lever la limite de stabilité du `pedagogicalId` par position.
- Exploiter `tag-service.js` dans le moteur de recommandations existant (`recommendation-service.js`) pour une 8ᵉ règle basée sur les tags, une fois que de vraies questions en posséderont.
- Envisager une vraie table de traduction pour `THEME_LABELS`/`TAG_LABELS` le jour où une deuxième langue sera requise (l'architecture actuelle le permet sans refonte).
