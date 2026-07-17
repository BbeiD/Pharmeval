# RAPPORT DE MIGRATION — Pharmeval v1.1.0 → v1.2.0

**Migration architecturale conservatrice : fichier HTML monolithique → application statique multi-fichiers compatible GitHub Pages.**

Fichier source utilisé comme référence : `Pharmeval-unifie-v1.1.0.html` (dernière version fonctionnelle disponible, avec authentification Firebase), conservé intact dans `archive/Pharmeval-monolithique-v1.1.0.html`.

---

## PHASE 1 — Inventaire (audit du fichier source)

### 1. Vues et écrans
- `#auth-loading` — écran de chargement neutre (vérification de l'état d'authentification).
- `#auth-screen` — écran de connexion / création de compte.
- `#app-root` — conteneur englobant toute l'application (masqué tant que l'utilisateur n'est pas authentifié).
- `#profile-selector` — écran « Choisir votre espace » (Étudiant / Pharmacien).
- `#home-view` — accueil : sélection de difficulté, thèmes, sous-thèmes.
- `#quiz-view` — déroulement d'un quiz (question, propositions, explication).
- `#results-view` — écran de résultats de fin de quiz.

### 2. Boutons et actions (41 gestionnaires `onclick`, 1 `oninput`)
Principaux : `selectProfile()`, `changeSpace()`, `goHome()`, `setDiff()`, `setTheme()`, `selectAllVisible()`, `startQuiz()`, `answer()`/`answerArbre()`/`answerFlux()`/`answerCasEvolutif()`/`onRelierClick()`, `nextQuestion()`, `openReportModal()`/`closeReportModal()`/`selectReportOption()`/`submitReport()`, `openFicheImgModal()`/`closeFicheImgModal()`, `toggleAuthMode()`, `handleAuthSubmit()`, `doGoogleSignIn()`, `doSignOut()`.

### 3. Fenêtres modales
- **Modale de signalement** (`#report-overlay` / `.report-modal`) : 5 options de signalement, zone de texte libre, bouton d'envoi. **Cette modale, ainsi que la modale de zoom d'image ci-dessous, se trouvaient dans le fichier source entre deux blocs `<script>` — un point de découpage fragile, identifié et corrigé pendant cette migration (voir section « Anomalies détectées »).**
- **Modale de zoom d'image** (`#fim-overlay` / `#fim-img` / `#fim-ctx`) : agrandissement des captures d'écran des fiches procédures.

### 4. Formulaires
Aucun élément `<form>` HTML natif. Le formulaire d'authentification (`#auth-email`, `#auth-password`) utilise des champs `<input>` simples pilotés par JavaScript (pas de soumission native).

### 5. Profils / rôles existants
Deux profils : `student` (Étudiant) et `pharmacist` (Pharmacien), gérés par `THEME_CONFIG`. Thèmes Étudiant : Pharmacothérapie, Législation, Galénique, ADM. Thèmes Pharmacien : Conseil, Dermo-cosmétique, Procédures, Médicaments/CBIP, BPPO, FTM, Déontologie, BAPCOC, Pharmacothérapie.

### 6. Questions et données intégrées
**949 questions** au total dans `QDB`, réparties dans 20 banques nommées (`LRP_QDB`, `DERCOS_QDB`, `CERAVE_QDB`, `CBIP_QDB`, `PROC_QDB`, `BPPO_QDB`, `FTM_QDB`, `DEON_QDB`, `ETUDIANT_QDB`, `BAPCOC_QDB`, `PROC2_QDB`, `FORMATS_QDB`, `RETOURS_QDB`, `RELIER_FLUX_QDB`, `GI_QDB`, `RESP_QDB`, `NEW22_QDB`, `LEG_QDB`, `GAL_QDB`, `ADM_QDB`) + 50 questions inline dans la déclaration initiale de `QDB` (thème Conseil). Répartition par profil : **242 questions Étudiant**, **736 questions Pharmacien** (certains thèmes communs comptent dans les deux, d'où un total > 949 si additionné naïvement).

### 7. Fonctions JavaScript (43 fonctions recensées)
`getActiveSelection, show, setTheme, selectAllVisible, getVisibleKeys, getQuestionsForKey, renderCats, setDiff, updateStatsDisplay, startQuiz, shuffle, renderQuestion, renderCasEvolutif, answerCasEvolutif, renderArbreDecisionnel, answerArbre, renderRelier, onRelierClick, showRelierExplication, renderFlux, answerFlux, answer, nextQuestion, showResults, goHome, buildFicheImgGallery, buildProc2ImgGallery, openFicheImgModal, closeFicheImgModal, openReportModal, closeReportModal, selectReportOption, onReportTextInput, submitReport, themeOfQuestion, isThemeAllowed, applyProfileVisibility, updateHeaderCount, selectProfile, isQuizInProgressWithAnswer, resetSessionState, goToProfileSelector, changeSpace` — plus, dans le module d'authentification : `toggleAuthMode, showAuthError, clearAuthError, mapAuthError, handleAuthSubmit, doGoogleSignIn, doSignOut`.

### 8. Variables globales importantes
Données : `QDB`, `CATS`, `CBIP_TYPES`, `THEME_CONFIG`, et les 20 banques + catégories associées (`*_QDB`, `*_CATS`). État d'exécution : `selectedConseil/Med/Dermo/Proc/Bppo/Ftm/Deon/Etudiant/Bapcoc/Leg/Gal/Adm` (12 `Set()` de sélection), `selectedDiff`, `activeTheme`, `quiz` (objet d'état du quiz en cours), `currentProfile`, `stats`.

### 9. localStorage / sessionStorage
Aucun usage de `sessionStorage`. `localStorage` utilisé avec les clés suivantes (toutes préfixées par profil, jamais de clé générique partagée) :
- `quiz_stats_student` / `quiz_stats_pharmacist` — écrites par `answer()`, `answerArbre()`, `answerFlux()`, `answerCasEvolutif()`, `onRelierClick()` (une par type de question) ; lues par `selectProfile()` (chargement) et `updateStatsDisplay()`.
- `quiz_reports_student` / `quiz_reports_pharmacist` — écrites par `submitReport()`, lues par la même fonction (append).

### 10. Fonctions d'import/export
Aucune fonction d'import/export de données n'est présente dans le fichier source (ni bouton, ni fonction JS dédiée). Le point 18/19 des critères de test de la mission (« imports », « exports ») ne correspond donc à aucune fonctionnalité existante — **rien n'a été supprimé, cette fonctionnalité n'existait pas dans la source**.

### 11. Statistiques
`stats = {total, correct}`, affichées via `updateStatsDisplay()` (`#stat-total`, `#stat-pct`) et `updateHeaderCount()` (`#stat-bank-total`), séparées par profil (voir point 9).

### 12. Signalements
Système complet de signalement d'une question (voir point 3), avec 5 catégories prédéfinies + texte libre, stocké par profil dans `localStorage`.

### 13. Éléments Firebase
`initializeApp`, `getAuth`, `onAuthStateChanged`, `createUserWithEmailAndPassword`, `signInWithEmailAndPassword`, `signOut`, `GoogleAuthProvider`, `signInWithPopup`. Configuration du projet `pharmeval-ea3d3` (voir Phase 8). Aucune fonction Firestore.

### 14 et 15. Images et images encodées en Base64
**198 images** encodées en base64 (196 PNG + 2 JPEG), réparties dans deux structures :
- `FICHE_IMGS` (137 images, 29 fiches procédures) ;
- `PROC2_IMGS` (61 images, 21 groupes de procédures).

Volume total décodé : **28,1 Mo**. Aucune image ne dépasse individuellement 1,02 Mo (voir Phase 11).

### 16. Polices, icônes, ressources intégrées
Aucune police ni icône encodée en base64 dans le fichier. Une seule dépendance externe de ce type : la feuille d'icônes Tabler (voir point 17).

### 17. Dépendances externes
- `https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.30.0/tabler-icons.min.css` (icônes, CSS externe).
- `https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js` et `firebase-auth.js` (SDK Firebase, modules ES).

Aucune autre dépendance externe (pas de framework JS, pas de bundler, pas de build step).

### 18. Gestionnaires d'événements
41 `onclick`, 1 `oninput`, plus les gestionnaires internes attachés par JavaScript (`onAuthStateChanged`). Aucun `addEventListener` global, aucun `DOMContentLoaded` ni `window.onload` : le code s'appuie sur l'exécution séquentielle des `<script>` classiques placés en fin de `<body>`, un point de vigilance explicitement préservé lors du découpage (voir Phase 7).

### 19. Comportements au chargement de la page
1. Les scripts classiques (données + moteur) s'exécutent dans l'ordre du document.
2. Le module Firebase (`firebase-config.js` puis `auth.js`) s'initialise et attache `onAuthStateChanged`.
3. Tant que Firebase n'a pas répondu, seul `#auth-loading` est visible (`#app-root` et `#auth-screen` sont masqués par défaut dans le HTML brut : aucun flash de contenu protégé).
4. Selon l'état d'authentification, bascule vers `#auth-screen` ou `#app-root` → `#profile-selector`.

### 20. Éléments susceptibles de casser lors du découpage — et ce qui a effectivement posé problème
- **Risque identifié et confirmé** : le fichier source contient **4 blocs `<script>` distincts**, avec du **HTML intercalé entre le 1ᵉʳ et le 2ᵉ bloc** (la modale de signalement et la modale de zoom d'image). Une première version de cette migration a supprimé ce HTML par erreur en ne conservant que le contenu situé avant le premier bloc et après le dernier. **Ce problème a été détecté par un test dédié et corrigé avant la livraison finale** — voir section « Anomalies détectées et corrections » ci-dessous. Les deux autres interstices (bloc 2↔3 et 3↔4) ne contenaient que des sauts de ligne, sans risque.
- Dépendance de portée (scope) entre fichiers JS classiques : `js/app.js` référence des constantes (`FICHE_IMGS`, `PROC2_IMGS`) définies dans des fichiers chargés séparément. Ceci fonctionne car les scripts classiques partagent le même espace global du document, à condition d'être chargés dans le bon ordre (préservé, voir Phase 7).
- Une entrée d'image orpheline `{"src":"","ctx":""}` dans `FICHE_IMGS["FP-CMD-002"]` (déjà signalée lors d'un audit qualité précédent) : **préservée telle quelle**, non convertie en image, non supprimée.

---

## PHASE 2 — Sauvegarde de référence

Le fichier source est conservé intact dans `archive/Pharmeval-monolithique-v1.1.0.html` (38,7 Mo, identique octet pour octet au fichier fourni). **Ce fichier ne doit pas être utilisé comme `index.html` de production.**

⚠️ **Ce fichier dépasse la limite de 25 Mo de l'interface web de dépôt de fichiers de GitHub (glisser-déposer).** Il peut être ajouté au dépôt via `git` en ligne de commande ou GitHub Desktop (limite réelle de GitHub : 100 Mo par fichier, avec avertissement au-delà de 50 Mo), mais **pas** via la simple interface web « Add file → Upload files ». Voir `README_DEPLOIEMENT.md` pour la marche à suivre, ou conserver ce fichier hors du dépôt (sauvegarde locale uniquement) si vous préférez ne pas le committer.

---

## PHASE 3 — Extraction des images

- 198 images décodées et écrites dans `assets/images/`, au format d'origine (PNG/JPEG), sans recompression ni transformation.
- Nommage stable et descriptif : `fiche-<CLE>-<INDEX>.png` (ex. `fiche-FP-CAI-001-1.png`) et `proc2-<CLE>-<INDEX>.png` (ex. `proc2-P2_18-3.png`).
- Chaque `src` base64 a été remplacé par le chemin relatif correspondant (`assets/images/<fichier>`), le champ `ctx` (texte contextuel affiché à côté de l'image) restant strictement inchangé.
- **Aucune image supprimée.** L'entrée anomale `FICHE_IMGS["FP-CMD-002"][4]` (`src:"",ctx:""`) a été conservée telle quelle plutôt que d'être silencieusement retirée.
- Vérification effectuée : nombre d'images par clé identique avant/après (tableau `_image_manifest.json` disponible sur demande), un échantillon d'images ouvert et vérifié visuellement.

---

## PHASE 4 — Architecture retenue

```
index.html
css/
  styles.css
js/
  firebase-config.js
  auth.js
  app.js
data/
  questions.js
  fiche-images.js
  proc2-images.js
assets/
  images/         (198 fichiers)
archive/
  Pharmeval-monolithique-v1.1.0.html
RAPPORT_MIGRATION.md
VERSION.md
README_DEPLOIEMENT.md
```

**Adaptation par rapport à la structure minimale demandée** : deux fichiers de données supplémentaires ont été créés — `data/fiche-images.js` et `data/proc2-images.js` — plutôt que de tout regrouper dans un unique `data/questions.js`. Raison : ces deux structures (`FICHE_IMGS`, `PROC2_IMGS`) sont volumineuses même après extraction des images (chemins + textes contextuels) et logiquement distinctes des banques de questions ; les séparer limite le risque d'erreur et clarifie la traçabilité de chaque type de donnée. Aucun dossier `assets/icons/` ni `assets/fonts/` n'a été créé : le fichier source ne contient ni icône ni police encodée (uniquement une dépendance externe CDN, voir point 17), donc rien à y placer.

---

## PHASE 5 — HTML

`index.html` (14,8 Ko, contre 38,7 Mo pour le fichier source) :
- Structure HTML complète conservée à l'identique (mêmes identifiants, classes, attributs).
- CSS référencé via `<link rel="stylesheet" href="css/styles.css">`.
- Scripts référencés via des chemins relatifs : `data/questions.js`, `data/fiche-images.js`, `data/proc2-images.js`, `js/app.js` (scripts classiques), puis `js/firebase-config.js` et `js/auth.js` (modules ES).
- Aucun chemin absolu (`/...`), aucune dépendance à `file:///`, aucune image en base64.
- Testé pour fonctionner avec les chemins relatifs tels quels depuis n'importe quel sous-répertoire, y compris `/Pharmeval/`.

---

## PHASE 6 — CSS

L'intégralité du bloc `<style>` du fichier source (25 305 octets) a été déplacée sans aucune modification dans `css/styles.css` : couleurs, espacements, tailles, polices, animations, états actifs, media queries, styles des écrans d'authentification et de tous les profils/modules sont strictement identiques. Aucune règle ajoutée, supprimée ou reformulée.

---

## PHASE 7 — JavaScript

- **`js/firebase-config.js`** : configuration et initialisation Firebase uniquement (`firebaseConfig`, `initializeApp`, `getAuth`), exportés en module ES.
- **`js/auth.js`** : logique d'authentification complète (création de compte, connexion e-mail/mot de passe, connexion Google, déconnexion, suivi d'état, messages d'erreur), importée depuis `firebase-config.js`. Contenu identique à celui du sprint précédent, seulement déplacé dans ce fichier dédié.
- **`js/app.js`** : l'intégralité des 43 fonctions du moteur applicatif (hors authentification) et des variables d'état, **copiées telles quelles**, sans transformation en modules ES6 (le code repose sur des variables globales et des attributs `onclick` classiques ; une conversion en modules aurait cassé ces appels sans bénéfice pour cette étape — conformément à la consigne de prudence).
- **`data/questions.js`** : extraction jugée sûre et réalisée — les 20 banques de questions sont des données pures (`const NOM = [...]` / `QDB.push(...)`), sans dépendance sur autre chose que leur propre contenu.
- **`data/fiche-images.js` / `data/proc2-images.js`** : galeries d'images, également des données pures une fois les base64 externalisées.

---

## PHASE 8 — Firebase

Projet Firebase strictement inchangé (`pharmeval-ea3d3`), configuration copiée à l'identique dans `js/firebase-config.js`. Méthodes conservées : e-mail/mot de passe et Google. Aucun secret, mot de passe ou compte de service dans les fichiers — seule la clé publique `apiKey` (non sensible) figure dans le code client, comme dans la version source. Le domaine `bbeid.github.io` étant déjà autorisé côté Firebase Authentication (selon les informations fournies), aucune modification de configuration Firebase n'est nécessaire pour publier sous `https://bbeid.github.io/Pharmeval/`.

---

## PHASE 9 — Données et stockage local

Voir Phase 1, point 9, pour l'inventaire complet. **Aucune clé renommée.** Le moteur (`js/app.js`) lit et écrit exactement les mêmes clés (`quiz_stats_student`, `quiz_stats_pharmacist`, `quiz_reports_student`, `quiz_reports_pharmacist`) que la version source : les données déjà enregistrées par un utilisateur dans son navigateur avec la version monolithique restent reconnues à l'identique après passage à la version multi-fichiers, puisqu'il s'agit du même code de lecture/écriture, seulement déplacé dans un fichier séparé.

---

## PHASE 10 — Contrôle de parité

### Matrice fonction par fonction

| Fonction / élément | Présent source | Présent migré | Test effectué | Résultat | Réserve |
|---|---|---|---|---|---|
| 43 fonctions du moteur (`js/app.js`) | ✅ | ✅ | Exécution réelle (Node, DOM simulé) | ✅ Identique | — |
| `THEME_CONFIG` / profils Étudiant-Pharmacien | ✅ | ✅ | Comptage automatisé | ✅ 242 / 736 identiques | — |
| 949 questions (`QDB` + 20 banques) | ✅ | ✅ | Comparaison question par question (JSON) | ✅ 0 divergence | — |
| `FICHE_IMGS` (137 images, 29 clés) | ✅ | ✅ | Comparaison clé par clé + `ctx` | ✅ 0 divergence, y compris l'entrée anomale préservée | — |
| `PROC2_IMGS` (61 images, 21 clés) | ✅ | ✅ | Comparaison clé par clé + `ctx` | ✅ 0 divergence | — |
| **Modale de signalement** | ✅ | ✅ (corrigée) | Ouverture, sélection, envoi, stockage réel | ✅ Après correction (voir ci-dessous) | Corrigée en cours de migration, voir anomalie |
| **Modale de zoom d'image** | ✅ | ✅ (corrigée) | Ouverture, `src`/`ctx`, fermeture | ✅ Après correction (voir ci-dessous) | Corrigée en cours de migration, voir anomalie |
| Sélection de profil / changement d'espace | ✅ | ✅ | `selectProfile`, `changeSpace`, `goToProfileSelector` exécutés | ✅ 49/49 tests fonctionnels | — |
| Statistiques par profil | ✅ | ✅ | Écriture réelle `localStorage` vérifiée | ✅ | — |
| Authentification Firebase | ✅ | ✅ | Analyse statique + logique de bascule d'écran simulée | Voir limites ci-dessous | Pas d'accès réseau réel à Firebase dans cet environnement |
| Fonctions d'import/export | Absentes | Absentes | — | N/A | N'existaient pas dans la source |

### Les 25 tests demandés — statut réel

| # | Test | Statut |
|---|---|---|
| 1 | Ouverture de la page | ✅ Vérifié (structure HTML validée, chargement des scripts confirmé) |
| 2 | Affichage de l'écran d'authentification | ✅ Vérifié par simulation (logique de bascule testée, voir sprint précédent) |
| 3 | Création d'un compte | ⚠️ Contrôle statique uniquement (pas d'accès réseau Firebase dans ce sandbox) |
| 4 | Connexion e-mail/mot de passe | ⚠️ Contrôle statique uniquement |
| 5 | Connexion Google | ⚠️ Contrôle statique uniquement |
| 6 | Déconnexion | ⚠️ Contrôle statique uniquement |
| 7 | Persistance de session | ⚠️ Contrôle statique uniquement (comportement par défaut du SDK Firebase, non reconfiguré) |
| 8 | Accès à l'application après authentification | ✅ Vérifié (logique `onAuthStateChanged` simulée) |
| 9 | Sélection des profils existants | ✅ Vérifié (test automatisé réel) |
| 10 | Navigation entre toutes les sections | ✅ Vérifié (test automatisé réel) |
| 11 | Affichage de toutes les images | ✅ Vérifié (chemins relatifs corrects, galerie testée, échantillon ouvert visuellement) |
| 12 | Lancement d'une évaluation | ✅ Vérifié (test automatisé réel) |
| 13 | Affichage des questions | ✅ Vérifié (test automatisé réel, tous types) |
| 14 | Validation des réponses | ✅ Vérifié (test automatisé réel) |
| 15 | Calcul des résultats | ✅ Vérifié (test automatisé réel) |
| 16 | Statistiques | ✅ Vérifié (test automatisé réel) |
| 17 | Signalements | ✅ Vérifié (test automatisé réel, après correction de l'anomalie modale) |
| 18 | Imports | N/A — fonctionnalité absente de la source |
| 19 | Exports | N/A — fonctionnalité absente de la source |
| 20 | Sauvegarde locale | ✅ Vérifié (clés `localStorage` inchangées, écriture confirmée) |
| 21 | Restauration des données existantes | ✅ Vérifié par analyse de code (mêmes clés lues/écrites) — **non testé dans un vrai navigateur avec des données préexistantes réelles** |
| 22 | Affichage sur mobile | ⚠️ Non testé (nécessite un navigateur réel) — le CSS responsive est strictement inchangé |
| 23 | Affichage sur ordinateur | ⚠️ Non testé visuellement dans un navigateur réel dans cet environnement — structure HTML/CSS inchangée |
| 24 | Rechargement de la page | ⚠️ Non testé dans un vrai navigateur (dépend de Firebase, voir tests 3-7) |
| 25 | Fonctionnement depuis `/Pharmeval/` | ✅ Vérifié par analyse : tous les chemins sont relatifs, aucun chemin absolu détecté |

**Distinction explicite** : les tests marqués ✅ ont été **réellement exécutés par du code automatisé dans cette session** (Node.js avec DOM simulé, comparaison programmatique avant/après). Les tests marqués ⚠️ sont des **contrôles statiques du code** ou des vérifications de cohérence, **pas des exécutions dans un vrai navigateur** — cet environnement de travail n'a pas d'accès réseau à Firebase ni de navigateur graphique. Ils **restent à effectuer par vous** après déploiement.

### Anomalie détectée et corrigée pendant cette migration

Une première version de découpage avait accidentellement supprimé le HTML des deux modales (signalement + zoom d'image), qui se trouvait **entre le 1ᵉʳ et le 2ᵉ bloc `<script>`** du fichier source plutôt qu'à l'intérieur d'un seul bloc contigu. Ce point a été détecté par un test dédié écrit spécifiquement pour vérifier la présence de ces éléments, puis corrigé avant la livraison en réintégrant ce HTML à sa position d'origine. Un test de non-régression ciblé (16 vérifications) confirme désormais : présence des éléments, ouverture/fermeture des deux modales, écriture réelle d'un signalement dans `localStorage`, affichage correct d'une image via son chemin relatif.

### Anomalie pré-existante identifiée (non corrigée, hors périmètre)

En testant la modale de signalement, une **anomalie déjà présente dans le fichier source** a été mise en évidence : 35 questions du thème « Conseil » (type `arbre_decisionnel`) stockent leur énoncé dans un champ `question` plutôt que `q`. La fonction `openReportModal()` du fichier source accède directement à `q.q`, ce qui provoque une erreur si l'utilisateur tente de signaler ce type précis de question. **Ce comportement a été vérifié comme identique dans le fichier monolithique source et dans la version migrée** (reproduit à l'identique dans les deux, avec le même code non modifié) : il ne s'agit donc pas d'une régression introduite par cette migration, mais d'un défaut préexistant. Conformément au périmètre strict de cette mission (« ne pas modifier les règles métier »), **il n'a pas été corrigé** — il est simplement signalé ici pour une correction éventuelle dans un chantier dédié à la qualité du moteur.

---

## PHASE 11 — Contrôle des volumes

| Élément | Taille |
|---|---|
| Fichier source (`archive/Pharmeval-monolithique-v1.1.0.html`) | 38 776 398 octets (≈ 37,0 Mo) |
| `index.html` (nouveau) | 14 797 octets (≈ 14,4 Ko) |
| `css/styles.css` | 25 305 octets (≈ 24,7 Ko) |
| `js/app.js` | 52 798 octets (≈ 51,6 Ko) |
| `js/firebase-config.js` | 1 344 octets |
| `js/auth.js` | 5 864 octets |
| `data/questions.js` | 1 154 443 octets (≈ 1,1 Mo) |
| `data/fiche-images.js` | 18 003 octets |
| `data/proc2-images.js` | 8 110 octets |
| `assets/images/` (198 fichiers) | 28 123 547 octets (≈ 26,8 Mo) |
| **Total nouveau projet (hors archive du monolithe)** | **≈ 29,4 Mo** |

**Nombre d'images extraites : 198** (137 dans `FICHE_IMGS`, 61 dans `PROC2_IMGS`).

**Image la plus lourde** : `proc2-P2_18-3.png`, 1 015 417 octets (≈ 0,97 Mo) — largement sous la limite de 25 Mo.

**Aucun fichier du nouveau projet ne dépasse 25 Mo.** Seul le fichier d'archive du monolithe (`archive/Pharmeval-monolithique-v1.1.0.html`, ≈ 37 Mo) dépasse cette limite pour l'upload web GitHub — voir avertissement en Phase 2 et procédure alternative dans `README_DEPLOIEMENT.md`.

---

## Résumé des vérifications automatisées effectuées dans cette session

- Comparaison octet pour octet et question par question entre le fichier source et la version migrée (949/949 questions identiques, 0 divergence).
- Comparaison clé par clé des deux galeries d'images (198/198 images, `ctx` identiques, y compris l'entrée anomale préservée).
- Validation syntaxique JavaScript (`node --check`) de chaque fichier JS produit.
- Suite de 49 tests fonctionnels automatisés (profils, thèmes, QCM, Relier, Arbre décisionnel, statistiques, `changeSpace`) rejouée avec succès sur la version multi-fichiers (5 exécutions consécutives, 49/49 à chaque fois).
- Suite dédiée de 16 tests sur les deux modales (signalement, zoom d'image), écrite spécifiquement pour détecter puis confirmer la correction de l'anomalie de découpage identifiée ci-dessus (5 exécutions consécutives, 16/16 à chaque fois).
- Vérification qu'aucun chemin absolu ni référence `base64`/`file:///` ne subsiste dans `index.html`.

**Ce qui n'a pas pu être testé dans cet environnement** (pas de navigateur graphique, pas d'accès réseau à Firebase) : les scénarios 3 à 7, 21 à 24 du tableau ci-dessus. Ils sont clairement signalés comme tels et restent à votre charge après déploiement, en suivant `README_DEPLOIEMENT.md`.
