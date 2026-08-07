# QUESTION_SCHEMA.md — Modèle de données définitif d'une question Pharmeval

**Sprint 9 — v2.0.0**

Ce document décrit le modèle de métadonnées pédagogiques géré par `js/services/question-metadata-service.js` et `js/services/question-service.js`. Il complète (sans le remplacer) le format de question déjà utilisé par le moteur de quiz (`data/questions.js`, `js/app.js`).

**Principe fondamental : rien dans ce document n'oblige à modifier `data/questions.js`.** Les métadonnées ci-dessous sont calculées à la demande, à partir de chaque question existante, avec des valeurs par défaut sûres pour tout ce que les 949 questions actuelles ne renseignent pas explicitement. Ces métadonnées ne sont **pas encore affichées au joueur** — elles sont gérées par le modèle, prêtes pour les usages futurs (éditeur de questions, imports, campagnes, recommandations, recherche).

---

## Comment obtenir les métadonnées d'une question

```js
import { getQuestionMetadata } from "./services/question-service.js";

const metadata = getQuestionMetadata(q); // q = un objet question tel qu'utilisé par le moteur de quiz
```

`getQuestionMetadata(q)` ne modifie **jamais** l'objet `q` reçu : elle retourne toujours un **nouvel objet**, construit en complétant par des valeurs par défaut tout ce qui manque.

---

## Les 21 propriétés du modèle

| Propriété | Type | Description | Origine pour une question existante | Exemple |
|---|---|---|---|---|
| `id` | `string` | Identifiant **technique**, dérivé d'un hachage du sous-thème et du texte de la question. **Change si le texte est modifié** (limite connue, documentée depuis le Sprint 4). Réutilise `computeQuestionId()` (`evaluation-service.js`), jamais dupliqué. | Calculé | `"bapcoc_respi-k3f8s2"` |
| `pedagogicalId` | `string` | **Ajout du Sprint 9** (au-delà du modèle demandé initialement) : identifiant **pédagogique stable**, qui ne change jamais, même après plusieurs corrections de contenu. Voir section dédiée ci-dessous. | Calculé | `"PHARM-BAP-000124"` |
| `space` | `'student'\|'pharmacist'\|'both'` | Profil(s) auquel la question est destinée. | Dérivé de `THEME_CONFIG` (`js/app.js`) | `"pharmacist"` |
| `domain` | `string` | Domaine pédagogique de la question. **Aujourd'hui identique à `theme`** (voir note d'évolutivité ci-dessous). | Dérivé de `themeOfQuestion()` (`js/app.js`) | `"bapcoc"` |
| `theme` | `string` | Thème de la question (les 12 thèmes existants de Pharmeval). | Identique à `domain` pour l'instant | `"bapcoc"` |
| `subtheme` | `string` | Sous-thème précis, tel qu'utilisé aujourd'hui par le champ `sub`. | Copié depuis `q.sub` | `"bapcoc_respi"` |
| `tags` | `string[]` | Mots-clés libres associés à la question, distincts de `keywords` (voir note). Centralisés par `tag-service.js`. | `[]` (aucune question existante n'a de tags aujourd'hui) | `["urgence"]` |
| `difficulty` | `'essentiel'\|'approfondi'\|'avance'` | Niveau de difficulté, **normalisé** (voir découverte de compatibilité ci-dessous). | Dérivé et normalisé depuis `q.d` | `"essentiel"` |
| `questionType` | `string` | Type de question (voir `CHARTE_QUALITE_PHARMEVAL.md`, section 8). | Copié depuis `q.type_question`, ou `"qcm"` par défaut | `"arbre_decisionnel"` |
| `source` | `string\|null` | Référence documentaire de la question. | `null` (jamais inventé) | `"CBIP 2026"`, `"BAPCOC 2025"`, `"Code de déontologie"`, `"AR 21 janvier 2009"`, `"FTM"`, `"SSPF"` |
| `sourceVersion` | `string\|null` | Version/édition précise de la source. | `null` | `"2026"` |
| `author` | `string\|null` | Auteur de la question. | `null` | `"Dr. Dupont"` |
| `reviewer` | `string\|null` | Relecteur de la question. | `null` | `"Dr. Martin"` |
| `reviewDate` | `string\|null` | Date de dernière relecture. | `null` | `"2026-09-12"` |
| `version` | `number` | Numéro de version de la question. Incrémenté à chaque modification future (2, 3, 4...). | `1` pour toute question existante | `1` |
| `status` | `'draft'\|'review'\|'published'\|'archived'` | Statut éditorial (cycle de vie). | `"published"` pour toute question existante | `"published"` |
| `createdAt` | `string\|null` | Date de création. | `null` (inconnue pour les questions existantes) | `"2026-01-15"` |
| `updatedAt` | `string\|null` | Date de dernière modification. | `null` | `"2026-09-12"` |
| `estimatedTime` | `number` | Temps de réponse estimé, en secondes. | Estimation par défaut selon le type de question (voir tableau ci-dessous) | `20` |
| `learningObjectives` | `string[]` | Objectifs pédagogiques visés par la question. | `[]` (jamais inventés) | `["Identifier une contre-indication."]` |
| `keywords` | `string[]` | Mots-clés de recherche/classification (distinct de `tags` — voir note). | `[]` | `["grossesse", "diabète"]` |

### `tags` vs `keywords`

Les deux champs existent car ils serviront potentiellement à des usages différents plus tard (`tags` : classification libre orientée recommandation/filtrage ; `keywords` : indexation orientée recherche plein texte). Aujourd'hui, les deux sont gérés de façon strictement identique (normalisation via `tag-service.js`, tableaux de chaînes en minuscules, dédupliqués). Rien n'empêche de les faire diverger plus tard sans changement de schéma.

### Note d'évolutivité : `domain` vs `theme`

Pharmeval ne connaît aujourd'hui que **deux niveaux** de classification (thème large, ex. `"bapcoc"` ; sous-thème, ex. `"bapcoc_respi"`). Le schéma demandé en prévoit **quatre** (`space > domain > theme > subtheme`), en anticipation d'un regroupement pédagogique plus fin (ex. un domaine « Réglementaire » regroupant les thèmes `legislation`, `deontologie`, `bapcoc`). **Aucun regroupement de ce type n'a été inventé par ce sprint** — `domain` reprend aujourd'hui exactement la même valeur que `theme`. Le jour où une vraie taxonomie de domaines sera définie, seule la fonction `deriveDomain()`/le champ `existing.domain` (`question-metadata-service.js`) aura besoin d'évoluer, sans casser le schéma ni les appelants.

---

## Les statuts (`status`)

| Statut | Signification |
|---|---|
| `draft` | Brouillon, en cours de rédaction. |
| `review` | Soumis à relecture. |
| `published` | Publié, utilisable dans le moteur de quiz. |
| `archived` | Retiré de la circulation, conservé pour historique. |

**Aujourd'hui** : les 949 questions existantes deviennent automatiquement `published` (calculé, jamais stocké dans `data/questions.js`). Une métadonnée saisie manuellement sans statut explicite (via `completeMetadata()`, en vue d'un futur éditeur) part prudemment en `draft`, **jamais** `published` par défaut — une question ne doit jamais devenir accessible aux joueurs sans décision explicite.

## Le versionnement (`version`)

Toute question existante est `version: 1`. Une future modification (via un éditeur de questions) devra incrémenter ce nombre (`2`, `3`, `4`...) — ce mécanisme d'incrémentation n'est pas encore implémenté ce sprint (aucun éditeur n'existe encore), mais le champ est prêt à le recevoir.

## Les types de question (`questionType`)

Reprend exactement les types déjà gérés par le moteur de quiz (voir `CHARTE_QUALITE_PHARMEVAL.md`, section 8) : `qcm`, `vrai_faux`, `relier`, `arbre_decisionnel`, `detection_risque`, `trouver_erreur`, `cas_evolutif`, `flux`, `question_suivante`.

## Le temps estimé (`estimatedTime`)

**Ce n'est jamais une mesure réelle** pour les questions existantes (aucune donnée de temps de réponse n'a jamais été collectée) — c'est une **estimation par défaut**, selon le type de question :

| `questionType` | Temps par défaut |
|---|---|
| `vrai_faux` | 15 s |
| `qcm` | 20 s |
| `detection_risque`, `trouver_erreur`, `question_suivante` | 30 s |
| `relier`, `flux` | 45 s |
| `arbre_decisionnel` | 60 s |
| `cas_evolutif` | 90 s |
| (type inconnu) | 30 s (repli générique) |

---

## Découverte de compatibilité : normalisation de la difficulté

Un balayage complet des 949 questions existantes a révélé que le champ `d` (difficulté) contient en réalité **9 écritures différentes**, jamais uniformisées jusqu'ici :

| Écriture brute observée | Nombre de questions |
|---|---|
| `essentiel` | 334 |
| `approfondi` | 332 |
| `Intermédiaire` | 111 |
| `Basique` | 67 |
| `Expert` | 35 |
| `intermédiaire` | 32 |
| `expert` | 19 |
| `avancé` | 11 |
| `débutant` | 8 |

Plutôt que d'exiger une reprise de `data/questions.js` (hors périmètre — « aucune banque de données modifiée »), `normalizeDifficulty()` (`question-metadata-service.js`) normalise cette valeur avant de la présenter comme métadonnée, vers exactement 3 niveaux canoniques :

| Niveau canonique | Écritures brutes regroupées | Total |
|---|---|---|
| `essentiel` | `essentiel`, `Basique`, `débutant` | 409 |
| `approfondi` | `approfondi`, `Intermédiaire`, `intermédiaire` | 475 |
| `avance` | `expert`, `Expert`, `avancé` | 65 |

**Vérifié par test sur l'intégralité des 949 questions** : chacune normalise vers exactement l'un de ces 3 niveaux, sans exception, et la somme reconstitue bien les 949 questions (aucune perdue, aucune dupliquée).

---

## L'identifiant pédagogique stable (`pedagogicalId`)

**Ajout demandé en complément du modèle initial.**

### Pourquoi un deuxième identifiant ?

L'identifiant technique existant (`id`, `computeQuestionId()`) est un hachage du texte de la question : **il change si le texte est corrigé**, même pour une simple faute de frappe. Cela rend impossible de dire de façon durable *« la question X a été revue le 12/09/2026 »* — après correction, ce ne serait techniquement plus « la question X ».

### Format

```
PHARM-{CODE_DOMAINE}-{NUMERO}
```

- `PHARM` : préfixe fixe.
- `CODE_DOMAINE` : code à 3 lettres du thème (ex. `BAP` pour `bapcoc`, `MED` pour `medicaments` — voir `THEME_CODES` dans `theme-utils.js`).
- `NUMERO` : numéro séquentiel sur 6 chiffres, **au sein de ce domaine**, selon la position de la question dans la banque chargée.

**Exemple réel** : `PHARM-BAP-000124` (124ᵉ question du domaine BAPCOC rencontrée dans la banque).

### Pourquoi c'est stable

Une correction de texte (typographie, distracteur revu, explication clarifiée) **ne déplace jamais** une question dans le tableau `data/questions.js` — donc son `pedagogicalId` ne change jamais, contrairement à son `id` technique. Vérifié explicitement par test : éditer le texte d'une question change son `id`, mais son `pedagogicalId` reste rigoureusement identique.

### Limite honnête (documentée, pas cachée)

Cette stabilité repose sur la **position** de la question dans le tableau, pas sur un identifiant réellement permanent stocké dans les données. Concrètement :
- **Stable** pour toute correction de contenu en place (ce que fait déjà le Protocole Opérationnel Qualité existant).
- **Non stable** si des questions sont un jour **insérées ou supprimées** au milieu d'un domaine — cela décalerait la position, donc le `pedagogicalId`, de toutes les questions suivantes de ce domaine.

Cette limite disparaîtrait le jour où un vrai champ `id` permanent serait ajouté à chaque question dans `data/questions.js` — un chantier explicitement hors périmètre de ce sprint (« aucune banque de données modifiée »), mais que ce modèle de données rend déjà possible d'accueillir sans casser quoi que ce soit : il suffirait alors de faire lire `pedagogicalId` depuis ce futur champ réel plutôt que de le calculer par position.

Une question qui n'appartient pas encore à la banque chargée (ex. un brouillon en cours de rédaction dans un futur éditeur) reçoit `pedagogicalId: null` — un identifiant pédagogique n'est attribué qu'au moment où la question est réellement intégrée à la banque, jamais à un brouillon qui pourrait encore être abandonné.

---

## Préparation de l'internationalisation

Conformément à la demande complémentaire du Sprint 9, ce modèle poursuit la séparation déjà entamée par `theme-utils.js` (Sprint 7) entre **identifiants techniques** et **libellés affichés** :

- `domain`/`theme` restent des identifiants techniques stables (`"bapcoc"`), jamais affichés bruts — leur libellé humain s'obtient via `formatThemeLabel()` (`theme-utils.js`), déjà prêt pour devenir une table par langue.
- `tags`/`keywords` sont normalisés en identifiants techniques (minuscules, sans accents de casse) via `tag-service.js`, dont `getTagLabel()` fournit déjà le libellé affiché séparément — même principe, même future extension vers une table par langue.
- `status`, `difficulty`, `questionType` restent des identifiants techniques en anglais/normalisés (`"published"`, `"essentiel"`, `"qcm"`) — leur traduction/affichage humain est un sujet pour un futur écran d'éditeur de questions, pas encore construit ce sprint (« ces données ne devront pas encore être affichées au joueur »).

Aucun libellé affiché n'est aujourd'hui codé en dur dans la logique de validation ou de calcul de ce modèle : tout est comparé à des identifiants techniques stables.

---

## Validation

`validateMetadata(metadata)` (`question-metadata-service.js`) vérifie :

| Vérification | Contre quoi |
|---|---|
| Statut valide | `QUESTION_STATUSES` (`draft`/`review`/`published`/`archived`) |
| Difficulté valide | `DIFFICULTY_LEVELS` (`essentiel`/`approfondi`/`avance` — après normalisation) |
| Domaine existant | `KNOWN_THEMES` (`theme-utils.js`, les 12 thèmes connus) |
| Thème existant | `KNOWN_THEMES` |
| Sous-thème valide | Les sous-thèmes réellement présents dans la banque de questions chargée |

Retourne toujours `{valid: boolean, errors: string[]}` — jamais d'exception, exploitable directement par un futur écran d'édition pour afficher les erreurs de saisie.

---

## Exemple complet

```js
// Question existante (data/questions.js, format inchangé) :
const q = {
  t: "Conseil officinal",
  sub: "bapcoc_respi",
  d: "Intermédiaire",
  type_question: "arbre_decisionnel",
  situation: "Patient adulte : « J'ai mal à la gorge depuis hier soir... »",
  question: "Quelle est la question clé à poser avant toute décision ?",
  arbre: { /* ... */ },
};

getQuestionMetadata(q);
// {
//   id: "bapcoc_respi-k3f8s2",
//   pedagogicalId: "PHARM-BAP-000124",
//   space: "pharmacist",
//   domain: "bapcoc",
//   theme: "bapcoc",
//   subtheme: "bapcoc_respi",
//   tags: [],
//   difficulty: "approfondi",        // normalise depuis "Intermédiaire"
//   questionType: "arbre_decisionnel",
//   source: null,
//   sourceVersion: null,
//   author: null,
//   reviewer: null,
//   reviewDate: null,
//   version: 1,
//   status: "published",
//   createdAt: null,
//   updatedAt: null,
//   estimatedTime: 60,
//   learningObjectives: [],
//   keywords: [],
// }
```

Une future question, entièrement enrichie par un éditeur (via la clé réservée `q._pharmevalMetadata`) :

```js
const futureQ = {
  sub: "bapcoc_respi", d: "essentiel", q: "...", a: [...], r: 0, e: "...",
  _pharmevalMetadata: {
    status: "review",
    version: 3,
    author: "Dr. Dupont",
    reviewer: "Dr. Martin",
    reviewDate: "2026-09-12",
    source: "BAPCOC 2025",
    sourceVersion: "2025",
    learningObjectives: ["Appliquer le BAPCOC."],
    tags: ["urgence"],
    keywords: ["antibiotique"],
  },
};

getQuestionMetadata(futureQ);
// Toutes les valeurs reelles ci-dessus sont respectees telles quelles ;
// seuls les champs non fournis (ex. estimatedTime, createdAt, updatedAt,
// pedagogicalId si la question n'est pas encore integree a la banque)
// recoivent un defaut.
```
