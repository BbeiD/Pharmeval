# Guide : génération de questions (avec images) à partir d'un PDF de cours

Ce document décrit le processus reproductible utilisé pour transformer un PDF de cours
(diapositives PowerPoint exportées) en questions QCM prêtes à synchroniser dans le
catalogue Pharmeval, avec images en support de justification. Premier lot produit avec
cette méthode : `respi_GPH_1_2026.pdf` (cours "Pathologies respiratoires" de G. Philippe,
Pharmacothérapie Master 2 ULiège) → 3 lots (Rhinite allergique, Asthme, BPCO), 30
questions, 12 images. Sert de référence pour refaire exactement la même chose avec un
autre PDF.

## Contexte : pourquoi deux fichiers de sortie

L'objectif final (feature "images dans les justifications", voir `IMPORT_FORMAT.md` et
`js/services/connectors/excel-catalog-connector.js`) se fait en deux temps :

1. **Ce guide couvre la phase 1** : générer, pour un PDF donné, (a) un Excel au format
   exact attendu par le connecteur de synchronisation, et (b) un dossier d'images dont
   les noms de fichiers sont référencés dans la colonne "Pièces jointes pédagogiques".
2. **La phase 2 n'est PAS construite** : la plateforme n'a aujourd'hui aucun moyen
   d'uploader ce second fichier (dossier d'images) ni de stocker des fichiers binaires
   (pas de Firebase Storage configuré). Le champ `pendingResourceRefs` existe déjà côté
   connecteur/modèle canonique et est correctement rempli par le connecteur Excel, mais
   n'est branché nulle part côté affichage. Ne jamais promettre que les images
   s'affichent déjà dans l'application tant que la phase 2 n'a pas été construite.

## Où travailler

Tout se passe dans `data/catalogue-review/` (dossier hors suivi Git, voir `.gitignore`
— ce dépôt est publié tel quel sur GitHub Pages, un contenu métier comme une banque de
questions ne doit jamais y transiter). Un lot = un sous-dossier, ex. `lot-rhinite/` :

```
data/catalogue-review/
  <fichier_source>.pdf              (déposé par l'utilisateur)
  lot-<theme>/
    Lot_<Theme>.xlsx                (18 colonnes, voir plus bas)
    images/
      <theme>-<sujet>.png           (kebab-case, sans accent/espace)
```

## Étape 1 — Analyser le PDF

Outils : `pymupdf` (import `fitz`) pour tout — texte, comptage de pages, rendu d'image.
Pas de Node.js sur ce poste (voir mémoire `user-two-machine-setup`) ; `python3` et
`python -m pip install <lib>` fonctionnent directement (pip n'est pas sur le PATH en
tant que commande `pip3`, toujours passer par `python -m pip`).

```python
import fitz
doc = fitz.open('mon_cours.pdf')
# Dump du texte, page par page, pour lecture complète du contenu
for i, page in enumerate(doc, start=1):
    print(f'=== PAGE {i} ===')
    print(page.get_text())
```

Repérer la structure (sections/thèmes, cas cliniques éventuels) et estimer le volume de
contenu exploitable. Pour un PDF de plusieurs dizaines de pages couvrant plusieurs
thèmes distincts, découper le travail par thème (un lot Excel + un dossier d'images par
thème, comme les 3 lots rhinite/asthme/bpco) plutôt qu'un unique fichier géant — plus
facile à relire, valider et importer par étapes.

**Toujours calibrer le volume avec l'utilisateur avant de tout générer** : proposer un
scope concret (ex. "je fais d'abord la section X, ~8-10 questions, 3-4 images") et
attendre confirmation, surtout pour un premier essai sur un nouveau PDF.

## Étape 2 — Choisir les images

Piège rencontré : beaucoup des tableaux les plus utiles dans un PDF issu de PowerPoint
sont des **tableaux natifs (vectoriels/texte)**, pas des images — `page.get_images()`
retourne 0 pour ces pages-là. Les extraire "en tant qu'image" donnerait du vide.

**La bonne méthode est de rendre la page entière en image** (capture de la diapositive
complète), qui fonctionne quel que soit le contenu (tableau vectoriel, texte, vraie
image/photo) et préserve la mise en forme :

```python
page = doc[numero_page - 1]  # 0-indexed
pix = page.get_pixmap(dpi=150)
pix.save('apercu.png')
```

Avant de choisir définitivement une image, la regarder (outil `Read`, elle s'affiche
comme une image) pour vérifier qu'elle est lisible et pertinente. Repérer les pages
candidates en cherchant les diapositives avec un vrai contenu de synthèse (tableau
comparatif, classification, schéma de mécanisme, fiche produit/RMA) plutôt que du texte
à puces simple (qui n'a pas besoin d'image, le texte suffit dans la justification).

Cible pour un lot d'environ 30 pages sources : **3 à 4 images**, chacune associée à une
question dont la réponse nécessite vraiment de lire l'image (pas une image
"décorative" à côté d'une question qui se répond sans elle).

Nommer chaque image en kebab-case, sans accent ni espace, préfixée par le thème :
`<theme>-<sujet-court>.png` (ex. `rhinite-classification-aria.png`). Copier le rendu
choisi depuis le dossier de travail temporaire vers `lot-<theme>/images/`.

## Étape 3 — Rédiger les questions

Règles de qualité (voir mémoire `pharmeval-question-generation-feedback`, retour
explicite de David) :

- **Les 3 mauvaises réponses doivent être des quasi-erreurs plausibles, jamais des
  évidences.** Construire chaque distracteur comme : une confusion réelle et fréquente
  (bon mécanisme/mauvaise indication ou l'inverse), une affirmation vraie dans un autre
  contexte mais fausse ici, ou une confusion entre deux notions adjacentes d'un même
  cours. Jamais une réponse absurde, trop longue, ou hors sujet — ça se repère sans
  connaître le contenu.
- **La justification explique aussi pourquoi chaque distracteur est tentant**, pas
  seulement pourquoi la bonne réponse est bonne (reprendre le texte source du PDF entre
  guillemets quand c'est pertinent).
- **Ne jamais fabriquer un fait non présent dans le PDF.** Toute affirmation vient du
  texte source, jamais d'une connaissance médicale générale non vérifiée dans le
  document.
- **Répartir les bonnes réponses sur A/B/C/D, sans biais de position.** Piège vécu lors
  du premier lot : une première passe avait mis 9/9 bonnes réponses en position B. Le
  script de génération construit chaque question avec un `target` (A/B/C/D) explicite
  et répartit consciemment (ex. sur 9-11 questions : 2-3 par lettre), puis les
  distracteurs sont placés dans les lettres restantes avec leur explication propre —
  jamais coder "la bonne réponse est toujours en premier puis on mélange au hasard"
  sans vérifier la distribution finale (`collections.Counter` sur les `target`).
- Utiliser le vocabulaire de compétences déjà construit (voir
  `js/services/parcours-metadata-service.js` et le travail de reclassification du
  catalogue, mémoire `pharmeval-current-work-2026-07-23`) plutôt que d'inventer une
  nouvelle étiquette de compétence par lot.
- Varier la difficulté (`Basique`/`Approfondi`, valeurs déjà utilisées dans le
  catalogue existant) selon que la réponse demande un fait isolé ou un croisement de
  plusieurs informations (ex. lire un tableau à deux axes).
- **L'image n'apparaît qu'à la correction (justification), jamais pendant que
  l'utilisateur répond à la question.** Piège rencontré sur le premier lot : plusieurs
  énoncés étaient rédigés "D'après le tableau ci-dessous, ..." comme si l'image était
  visible en même temps que la question — incohérent avec l'endroit réel où elle
  s'affiche. Ne jamais écrire "ci-dessous"/"illustré ci-dessous"/"reproduit ci-dessous"
  dans le texte de la **question** ; l'énoncé doit se suffire à lui-même comme une
  question de connaissance/raisonnement normale. C'est dans la **justification**
  (qui accompagne réellement l'image) qu'on peut décrire le contenu du tableau/schéma
  sans réserve.

## Étape 4 — Format de l'identifiant "Question ID" (point CRITIQUE)

**C'est le piège le plus important de tout ce processus — à ne plus jamais rater.** Le
connecteur (`js/services/connectors/legacy-id-utils.js`, fonction
`deriveTaxonomyFromLegacyId`) exige que la colonne "Question ID" respecte EXACTEMENT :

```
LEGACY-{BANQUE}-{sous_theme}-{position}
```

avec `{BANQUE}` appartenant à une liste fermée (`BANK_TO_THEME` dans
`legacy-id-utils.js` : `QDB`, `GI_QDB`, `RESP_QDB`, `LRP_QDB`, `DERCOS_QDB`,
`CERAVE_QDB`, `CBIP_QDB`, `PROC_QDB`, `PROC2_QDB`, `RETOURS_QDB`, `BPPO_QDB`,
`FTM_QDB`, `DEON_QDB`, `BAPCOC_QDB`, `ETUDIANT_QDB`, `LEG_QDB`, `GAL_QDB`, `ADM_QDB`).
Un ID qui ne respecte pas ce format exact (ex. `PHARMACO-RESPI-RHINITE-001`, utilisé par
erreur dans la toute première version de ce lot) fait **rejeter silencieusement la
ligne** ("ligne ignorée") lors du chargement par le connecteur — la question
n'apparaît jamais dans le résultat, sans erreur bloquante visible ailleurs que dans
`rowErrors`.

**Comment choisir un ID pour un nouveau lot généré à partir d'un PDF déjà représenté
dans le catalogue** (même source documentaire qu'un module `BANK_TO_THEME` existant) :
réutiliser la banque correspondante, et choisir un **sous-thème distinct** de ceux déjà
utilisés pour ce même PDF/cours, afin de ne jamais entrer en collision avec un ID déjà
présent dans Firestore (une collision d'ID = **écrasement/mise à jour silencieuse
d'une question existante**, pas une simple erreur — voir `catalog-sync-engine.js`,
`resolveQuestionIdentity`/action `update`). Exemple utilisé ici : le cours ETUDIANT_QDB
avait déjà des sous-thèmes `respi_rhinite`/`respi_asthme`/`respi_bpco` (contenu
existant, sans image) — le nouveau lot illustré utilise
`respi_rhinite_illustre`/`respi_asthme_illustre`/`respi_bpco_illustre`, une numérotation
fraîche à partir de 1, garantissant zéro collision.

Si le PDF correspond à un contenu totalement nouveau ne correspondant à aucune banque
existante, il faudrait AJOUTER une entrée à `BANK_TO_THEME` (mappée vers un des 12
thèmes connus de `theme-utils.js`) — un changement de code, à ne pas faire sans en
discuter d'abord (impact sur la taxonomie applicative de tout le catalogue).

## Étape 5 — Construire l'Excel

18 colonnes, dans cet ordre exact (voir `EXPECTED_HEADERS` dans
`excel-catalog-connector.js`) :

```
Question ID | Statut | Question | Réponse A | Réponse B | Réponse C | Réponse D |
Bonne réponse | Justification | Source documentaire | Niveau 1 | Niveau 2 | Niveau 3 |
Compétence principale | Tags | Difficulté | Pièces jointes pédagogiques |
Référence documentaire précise
```

Points d'attention :
- `Statut` = `Brouillon` systématiquement (jamais publié directement).
- `Source documentaire` doit correspondre **caractère pour caractère** (accents,
  tirets cadratin) à la source existante si le PDF en représente une déjà connue —
  sinon une source en double sera créée. Vérifier par comparaison de chaînes Python
  (`==`), pas par relecture visuelle (les accents s'affichent mal dans un terminal).
- `Compétence principale` : réutiliser une valeur déjà en place plutôt qu'en inventer
  une nouvelle par lot.
- `Pièces jointes pédagogiques` : nom de fichier exact de l'image (sans chemin), vide
  si la question n'en a pas. Plusieurs fichiers possibles, séparés par `;`.
- `Tags` / `Niveau 2` / `Niveau 3` : laissés vides sauf besoin identifié (c'est aussi
  la convention du catalogue existant).

Générer le fichier avec `openpyxl` (`pip install openpyxl` si absent). Écrire un script
Python dédié par lot (voir les scripts produits pour rhinite/asthme/bpco comme modèle)
plutôt qu'éditer l'Excel à la main : ça permet de factoriser la construction de la
justification (intro + explication de chaque distracteur, assemblées automatiquement
selon la lettre finale du distracteur) et de vérifier la distribution des bonnes
réponses par le code plutôt qu'à l'œil.

## Étape 6 — Vérifications d'intégrité obligatoires avant de livrer

1. En-têtes strictement identiques à `EXPECTED_HEADERS` (comparaison de liste Python).
2. Chaque fichier référencé dans "Pièces jointes pédagogiques" existe réellement dans
   `images/` (vérifier avec `os.path.exists`, pas en relisant la liste).
3. Distribution des bonnes réponses par lettre (`Counter`) sans déséquilibre flagrant.
4. **Validation avec le vrai connecteur** (voir Étape 7) — c'est la vérification qui a
   permis de détecter l'erreur de format d'ID sur le premier lot ; ne pas s'en passer.

## Étape 7 — Valider avec le vrai connecteur (sans toucher à la production)

Le chargement d'un fichier (`ExcelCatalogConnector.load()`) est une opération **purement
client, sans aucune écriture Firestore** — elle peut donc être testée en toute sécurité
dans un navigateur non authentifié, sans risque pour la production. Méthode utilisée :

1. Ouvrir `admin/catalog-sync.html` dans le navigateur (charge SheetJS/`window.XLSX`
   via le script CDN déjà présent dans la page — pas besoin d'être connecté).
2. Depuis la console JS de cette page, importer dynamiquement le connecteur et lui
   faire lire directement le fichier Excel du lot (fetch en local suffit, la page et le
   fichier sont sous la même arborescence `file://`) :

```js
const mod = await import('../js/services/connectors/excel-catalog-connector.js');
const connector = new mod.ExcelCatalogConnector();
const res = await fetch('../data/catalogue-review/lot-<theme>/Lot_<Theme>.xlsx');
const arrayBuffer = await res.arrayBuffer();
const result = await connector.load({ arrayBuffer });
// result.success doit être true, result.fatalErrors et result.rowErrors vides,
// result.catalog.questions.length doit correspondre au nombre de lignes attendu.
```

3. Vérifier que chaque question avec image a bien un `pendingResourceRefs` non vide
   correspondant au bon nom de fichier.

Ce test valide le **format** (parsing + résolution taxonomie/ID), pas la résolution
complète contre Firestore (correspondance de source/compétence existante, décision
create/update) — cette dernière étape nécessite une vraie session admin connectée et
reste à faire par l'utilisateur au moment de l'import réel via l'interface
`admin/catalog-sync.html`.

## Récapitulatif — lot de référence (respi_GPH_1_2026.pdf)

| Lot | Questions | Images | Sous-thème (Question ID) |
|---|---|---|---|
| Rhinite allergique | 9 | 4 | `respi_rhinite_illustre` |
| Asthme | 11 | 4 | `respi_asthme_illustre` |
| BPCO | 10 | 4 | `respi_bpco_illustre` |

Les 3 fichiers passent la validation du connecteur réel avec 0 erreur (voir Étape 7).
