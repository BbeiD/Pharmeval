# IMPORT_FORMAT.md — Format officiel d'import de questions Pharmeval

**Sprint 10 — v2.1.0**

Ce document décrit le format JSON officiel accepté par le moteur d'import de questions de Pharmeval (`js/services/import-service.js`). Ce format devient la référence officielle pour tout fichier généré par Claude (ou tout autre outil) en vue d'un import dans Pharmeval.

Ce document complète `QUESTION_SCHEMA.md` (Sprint 9, le modèle de métadonnées interne de Pharmeval) sans le remplacer : le moteur d'import **traduit** ce format JSON public vers ce modèle interne (voir `js/services/question-parser.js`).

---

## Structure générale du fichier

```json
{
  "schemaVersion": "1.0",
  "generator": "Claude",
  "generatedAt": "2026-07-18T10:00:00Z",
  "questions": [
    { "...": "voir ci-dessous" }
  ]
}
```

| Champ | Obligatoire | Type | Description |
|---|---|---|---|
| `schemaVersion` | Oui | `string` | Version du format. **Seule `"1.0"` est acceptée aujourd'hui.** Permet de faire évoluer le format sans casser les imports existants (voir « Compatibilité » ci-dessous). |
| `generator` | Non | `string` | Nom de l'outil ayant généré le fichier (ex. `"Claude"`). Informatif — utilisé comme attribution d'auteur par défaut si une question ne précise pas la sienne (voir plus bas). |
| `generatedAt` | Non | `string` | Date de génération du fichier. Informatif, non exploité par la validation. |
| `questions` | Oui | `array` | Tableau non vide des questions à importer. |

**Aucun autre champ n'est accepté au premier niveau** — tout champ inconnu fait échouer la validation (voir « Philosophie »).

---

## Structure d'une question

```json
{
  "pedagogicalId": "PHARM-BAP-000124",
  "domain": "bapcoc",
  "theme": "bapcoc",
  "subtheme": "bapcoc_respi",
  "difficulty": "essentiel",
  "questionType": "single-choice",
  "question": "Quel antibiotique est recommandé en première intention pour une angine streptococcique ?",
  "answers": ["Amoxicilline", "Azithromycine", "Ciprofloxacine", "Vancomycine"],
  "correctAnswer": 0,
  "explanation": "L'amoxicilline reste le traitement de première intention selon les recommandations BAPCOC.",
  "source": "BAPCOC 2025",
  "status": "draft"
}
```

### Champs obligatoires

| Champ | Type | Règles de validation |
|---|---|---|
| `pedagogicalId` | `string` | Doit suivre le format `PHARM-XXX-000000` (voir `QUESTION_SCHEMA.md`, section identifiant pédagogique). Doit être **unique au sein du fichier**. |
| `domain` | `string` | Doit être l'un des 12 thèmes connus de Pharmeval (voir `theme-utils.js`, `KNOWN_THEMES`). |
| `theme` | `string` | Même règle que `domain` (aujourd'hui identique — voir `QUESTION_SCHEMA.md`). |
| `subtheme` | `string` | Format : minuscules, chiffres, underscores (ex. `bapcoc_respi`). **Un nouveau sous-thème, pas encore présent dans la banque existante, est accepté** — un import est précisément l'un des moyens d'en introduire un. |
| `difficulty` | `string` | Une valeur reconnue (voir la liste des variantes acceptées ci-dessous — insensible à la casse). |
| `questionType` | `string` | **Seule `"single-choice"` est prise en charge ce sprint** (voir « Non-objectifs »). |
| `question` | `string` | Minimum 10 caractères. |
| `answers` | `array` de `string` | Entre 2 et 8 propositions, chacune non vide, sans doublon. |
| `correctAnswer` | `number` (entier) | Index (base 0) dans `answers`, donc entre `0` et `answers.length - 1`. |
| `explanation` | `string` | Minimum 10 caractères. |

### Champs optionnels

| Champ | Type | Description |
|---|---|---|
| `source` | `string` | Référence documentaire (ex. `"CBIP 2026"`, `"BAPCOC 2025"`, `"Code de déontologie"`, `"AR 21 janvier 2009"`, `"FTM"`, `"SSPF"`). |
| `sourceVersion` | `string` | Version/édition précise de la source. |
| `author` | `string` | Auteur de la question. **Si absent, reprend `generator`** (ex. `"Claude"`) — une attribution honnête, jamais une invention, puisque le fichier a réellement été généré par cet outil. |
| `reviewer` | `string` | Relecteur. |
| `reviewDate` | `string` | Date de relecture. |
| `tags` | `array` de `string` | Voir `js/services/tag-service.js`. |
| `keywords` | `array` de `string` | Mots-clés de recherche. |
| `learningObjectives` | `array` de `string` | Objectifs pédagogiques (ex. `"Identifier une contre-indication."`). |
| `space` | `string` | `"student"`, `"pharmacist"` ou `"both"`. |
| `estimatedTime` | `number` | Temps estimé en secondes. |
| `version` | `number` | **Ignoré à l'écriture** — le versionnement est géré par Pharmeval lui-même (voir « Versionnement »), jamais par le fichier importé. |
| `status` | `string` | **Ignoré à l'écriture, toujours forcé à `"draft"`** (voir « Règle de sécurité non négociable »). |

### Valeurs de difficulté reconnues

Le validateur accepte toutes les variantes déjà rencontrées dans la banque de questions existante (voir `QUESTION_SCHEMA.md`, « Découverte de compatibilité ») : `essentiel`, `Basique`, `débutant`, `approfondi`, `Intermédiaire`, `intermédiaire`, `expert`, `Expert`, `avancé`. Toutes sont normalisées vers exactement 3 niveaux canoniques (`essentiel`/`approfondi`/`avance`) avant stockage.

---

## Règle de sécurité non négociable

**Toute question importée reçoit le statut `"draft"`, sans exception** — même si le fichier prétend `"status": "published"`, même s'il s'agit d'une **mise à jour** d'une question déjà publiée. « Ne jamais publier automatiquement » s'applique intégralement, y compris aux mises à jour : republier une question corrigée reste une décision humaine séparée, effectuée en dehors de ce moteur d'import (voir RAPPORT_SPRINT10.md, « Limites connues »).

---

## Détection des doublons et versionnement

- **Même `pedagogicalId`** qu'une question déjà présente dans Firestore → **mise à jour** : la version existante est incrémentée de 1, `createdAt` est préservé, `updatedAt` est rafraîchi.
- **`pedagogicalId` absent de Firestore** → **création** : version `1`, `createdAt` = maintenant.

Le champ `version` du fichier importé lui-même n'est **jamais** utilisé directement — le versionnement est une propriété du cycle de vie Pharmeval, pas du fichier source.

---

## Philosophie de validation : « Ne jamais faire confiance au fichier importé »

Avant toute écriture Firestore, le fichier est intégralement validé (voir `js/services/question-import-validator.js`) :
- schéma JSON et version (`schemaVersion`) ;
- présence des champs obligatoires ;
- types de chaque champ ;
- format des tableaux (`answers`, `tags`, `keywords`, `learningObjectives`) ;
- longueur minimale (question, explication, chaque réponse) ;
- unicité des identifiants pédagogiques **au sein du fichier** ;
- validité de l'index de bonne réponse ;
- **champs inconnus** (au premier niveau ET par question) — rejetés explicitement, jamais ignorés silencieusement.

**Une seule erreur, où qu'elle soit dans le fichier (même sur une seule question parmi des centaines), invalide l'ensemble du fichier. Aucune écriture Firestore n'a lieu tant que la validation n'est pas intégralement réussie.**

---

## Compatibilité et évolution du format

Le champ `schemaVersion` permet d'introduire une version future (`"1.1"`, `"2.0"`...) sans casser les fichiers déjà conformes à `"1.0"` : `SUPPORTED_SCHEMA_VERSIONS` (`question-import-validator.js`) est une simple liste, à laquelle il suffira d'ajouter la nouvelle version prise en charge, en conservant le support de `"1.0"` en parallèle tant que nécessaire.

**Ce qui n'est PAS encore pris en charge** (voir « Non-objectifs » du Sprint 10) :
- Les types de question autres que `"single-choice"` (relier, arbre décisionnel, cas évolutif, etc.) — une future version du format devra définir leur représentation JSON propre.
- Un éditeur manuel, un import Excel, une IA de génération intégrée, un workflow de publication ou un historique complet des versions.

---

## Exemple de fichier complet

```json
{
  "schemaVersion": "1.0",
  "generator": "Claude",
  "generatedAt": "2026-07-18T10:00:00Z",
  "questions": [
    {
      "pedagogicalId": "PHARM-BAP-000124",
      "domain": "bapcoc",
      "theme": "bapcoc",
      "subtheme": "bapcoc_respi",
      "difficulty": "essentiel",
      "questionType": "single-choice",
      "question": "Quel antibiotique est recommandé en première intention pour une angine streptococcique ?",
      "answers": ["Amoxicilline", "Azithromycine", "Ciprofloxacine", "Vancomycine"],
      "correctAnswer": 0,
      "explanation": "L'amoxicilline reste le traitement de première intention selon les recommandations BAPCOC.",
      "source": "BAPCOC 2025",
      "tags": ["antibiotique", "urgence"],
      "learningObjectives": ["Appliquer le BAPCOC."]
    },
    {
      "pedagogicalId": "PHARM-MED-000042",
      "domain": "medicaments",
      "theme": "medicaments",
      "subtheme": "gastro",
      "difficulty": "approfondi",
      "questionType": "single-choice",
      "question": "Quelle interaction majeure faut-il surveiller avec les IPP au long cours ?",
      "answers": ["Diminution de l'absorption de la vitamine B12", "Augmentation du risque hémorragique", "Hyperkaliémie", "Photosensibilisation"],
      "correctAnswer": 0,
      "explanation": "L'usage prolongé d'IPP réduit l'acidité gastrique nécessaire à l'absorption de la vitamine B12.",
      "source": "CBIP 2026"
    }
  ]
}
```
