# RAPPORT SPRINT 20 — Classification documentaire et structuration de la banque de questions

**Pharmeval v2.10.0 → v2.11.0**

## 1. Objectif

Construire une couche de classification **documentaire** au-dessus de la banque de questions existante (≈900 questions), sans jamais les recréer ni les réimporter : d'où vient chaque question (référentiel, procédure interne, cours), dans quelle édition, dans quel chapitre. La présentation actuelle (Familia, Référentiels, Étudiant, Médicaments…) reste entièrement fonctionnelle et inchangée.

Conformément à l'instruction finale du cadrage, ce sprint **ne** construit **pas** un système de gestion documentaire complet : il pose une couche stable et extensible, puis permet un rattachement progressif.

## 2. Architecture

```
DocumentSource (document_sources)
      ↓
DocumentSection (document_sections, hiérarchique, profondeur libre)
      ↓
Question (questions — référence seulement, jamais copiée/dupliquée)
```

### 2.1 La question référence, elle ne porte pas

Conformément à la philosophie demandée, `questions/{pedagogicalId}` gagne quatre champs **additifs** :
- `documentSourceId`, `documentSectionId` — références, jamais une copie du nom/organisme/version de la source.
- `functionalCode` — l'identifiant fonctionnel lisible (voir section 4), **distinct** de `pedagogicalId`.
- `classificationVersion` — compteur simple, incrémenté à chaque (re)classification.
- `legacyClassification` — photographie des anciennes valeurs (thème/sous-thème/difficulté) prise une seule fois, pour ne jamais perdre l'ancienne classification pendant la transition.

**Aucun champ existant supprimé** : `theme`, `subtheme`, `difficulty`, etc. continuent de fonctionner à l'identique, y compris pour l'ancienne présentation visuelle (Familia, Référentiels…), qui les consulte encore directement.

### 2.2 DocumentSource (`document_sources`)

Une source ou une édition identifiable (CBIP 2026, Procédure Familia — Retours v3, Pharmacologie ULiège Master 1…). Structure conforme à l'indicative du cadrage (`sourceType`, `name`, `shortCode`, `organizationName`, `version`, `academicYear`, `status`, `metadata{}`, `display{}`), plus deux compteurs **maintenus** (`sectionCount`, `questionCount` — jamais recalculés par balayage, voir section 8).

Validation centralisée (`document-source-metadata-service.js`) : type obligatoire, nom, code court au format `[A-Z0-9_-]+`. Des avertissements non bloquants signalent une version absente pour un référentiel/une procédure, ou une année académique absente pour un enseignement — jamais une erreur bloquante, ces champs restant volontairement facultatifs.

### 2.3 DocumentSection (`document_sections`)

Une section appartient obligatoirement à une source, peut avoir une section parente. **Aucune limite artificielle de profondeur** : `path`/`pathLabels` sont des tableaux de longueur variable portant la chaîne complète des ancêtres, jamais deux champs fixes "niveau 1"/"niveau 2". Deux compteurs maintenus par section : `directQuestionCount` (rattachées directement) et `totalQuestionCount` (incluant les sous-sections).

**Déplacer une section** recalcule `path`/`pathLabels`/`level` de la section ET de tous ses descendants (une seule lecture bornée de l'arborescence complète de la source, jamais un balayage de toute la banque de questions) — protégé contre la création de boucles.

## 3. Identifiants fonctionnels (`question-code-service.js`)

Service **centralisé unique** : aucun autre fichier ne construit une chaîne du type `REF-CBIP-HTA-000001`. Compteur séquentiel par périmètre (type + code court de la source + code court de la section optionnelle), alloué de façon atomique (`increment()` Firestore).

**Jamais automatique et jamais rétroactif** : une question existante (ex. `Pharm-med-000001`) **conserve son `pedagogicalId`** — le nouvel identifiant fonctionnel n'est qu'un champ additif, généré uniquement à la demande explicite de l'administrateur (case à cocher, rattachement individuel ou import), jamais imposé pendant la migration.

## 4. Réutilisation de l'import JSON existant

**La page d'import n'a pas été remplacée.** Le workflow existant (Sélectionner → Analyser → Importer) devient Sélectionner → Analyser → **Choisir la destination documentaire** → Prévisualiser → Importer comme brouillon, en insérant deux nouvelles étapes entre l'aperçu déjà existant et l'import final. Toutes les questions importées restent au statut `draft` — aucune publication automatique, comportement du Sprint 10 non modifié.

**Règle de priorité implémentée exactement comme demandée** (`question-classification-service.js`, `resolveImportDestination()`) :
1. destination définie explicitement dans le fichier JSON **et valide** (source existante, non archivée, section cohérente) ;
2. destination choisie dans l'interface ;
3. aucune destination — la question reste « Non classée », toujours importable comme brouillon.

Une destination invalide dans le fichier ne bloque jamais l'import : elle retombe sur la destination d'interface (ou « Non classée ») et génère un avertissement explicite, affiché à l'administrateur.

## 5. Migration des ~900 questions existantes

**Aucune question n'est recréée ni réimportée.** `question-migration-service.js` fournit un rattachement par lots :
1. **Filtrage** sur l'ancienne classification (thème, sous-thème, difficulté, « non classées uniquement ») — balayage borné (jusqu'à 1000 questions, couvre largement le volume actuel).
2. **Prévisualisation** du nombre exact de questions concernées, sans rien écrire.
3. **Choix de la destination** (source + section).
4. **Application par lots** de taille bornée (25 questions par lot, en parallèle limité) — jamais des centaines d'écritures simultanées.

**Garanties non négociables, vérifiées dans le code** : seuls `documentSourceId`/`documentSectionId`/`classificationVersion`/`updatedAt` sont modifiés (même règle Firestore que le rattachement individuel, voir section 7) — jamais l'énoncé, les propositions, la bonne réponse, la justification, ni republication. Les anciens champs (`theme`, `subtheme`...) ne sont jamais supprimés.

**Reprise en cas d'échec partiel** : chaque question traitée individuellement dans son lot ; un échec n'interrompt jamais le reste du traitement. Le rapport final liste précisément les identifiants en échec, permettant de relancer une migration ciblée uniquement sur ceux-ci (opération idempotente).

**Traçabilité par lot, pas par question** : une seule entrée d'audit par migration, avec nombre de questions, filtres d'origine, destination, identifiant de lot, administrateur, date.

## 6. Interface d'administration

**Nouvelle page** `admin/document-sources.html` (accessible depuis le tableau de bord d'administration et depuis la Banque de questions), à trois onglets :
- **Sources & sections** : liste filtrable par organisation/type/statut, fiche détaillée avec compteurs, arborescence de sections en liste indentée (pas d'éditeur graphique de type organigramme), création de section racine/sous-section, archivage.
- **Migration par lots** : le flux décrit en section 5, plus un outil de **rattachement individuel** (recherche par identifiant, sélection de destination, génération optionnelle d'un identifiant fonctionnel).
- **Non classées** : compteur des questions sans source documentaire, avec accès rapide à la migration.

**Banque de questions existante** (`admin/bank.js`) : ajout d'une section « Classification documentaire » en **lecture seule** dans la fiche de chaque question (source/section résolues, identifiant fonctionnel le cas échéant), avec un lien vers la nouvelle page — aucune logique de classification dupliquée entre les deux écrans.

## 7. Sécurité

- Lecture de `document_sources`/`document_sections` : administrateurs (tout statut) ou utilisateur authentifié pour le contenu **actif** uniquement — même principe déjà établi pour `parcours`/`competencies`/`questions` (Sprints 16-17).
- Écriture : strictement réservée aux administrateurs (`MANAGE_QUESTIONS`, réutilisée — aucune nouvelle permission créée).
- Classification d'une question : nouvelle règle de mise à jour dédiée sur `questions/{id}`, limitée exactement aux 4 champs de classification + `updatedAt`, statut inchangé — un utilisateur standard ne peut jamais reclasser une question.
- Compteurs de codes fonctionnels (`document_code_counters`) : lecture/écriture strictement administrateur.

**Limite honnêtement documentée** : « l'organisation doit rester isolée » est vérifié pour la **cohérence des données** (une section doit appartenir à la même source et à la même organisation, vérifié par les services applicatifs avant toute écriture), mais pas pour l'accès administrateur lui-même — Pharmeval ne possède pas encore de rôle « administrateur par organisation » (seul un rôle global `admin`/`super_admin` existe réellement, comme documenté depuis le Sprint 14). Un administrateur global peut donc aujourd'hui gérer les sources de n'importe quelle organisation, exactement comme il peut déjà gérer les utilisateurs de n'importe quelle organisation.

## 8. Performance

- **Compteurs maintenus** via `increment()` atomique, à chaque création/déplacement/(re)classification — jamais un recalcul par balayage à l'affichage.
- **Migration par lots bornés** (25 questions/lot) plutôt qu'une seule opération massive.
- **Filtrage par sous-thème/« non classées »** effectué sur un balayage borné (1000 questions) plutôt que d'ajouter un nouvel index composite pour un usage ponctuel d'administration. **Limite assumée pour l'avenir** : au-delà de quelques milliers de questions, cette approche devra évoluer.

## 9. Audit

Réutilise le journal centralisé existant (`audit_logs`, Sprint 8) **directement**, sans le contournement nécessaire aux Sprints 17-19 : l'acteur de toute action de ce sprint est toujours un administrateur. Événements ajoutés : `document_source_created/updated/archived`, `document_section_created/updated/moved/archived`, `questions_classified`, `questions_reclassified` (individuel et par lot), `question_functional_code_assigned`, `question_imported_to_document_section`.

## 10. Fichiers créés

**Services** (`js/services/`) : `document-source-metadata-service.js`, `document-source-catalog-service.js`, `document-source-service.js`, `document-section-metadata-service.js`, `document-section-catalog-service.js`, `document-section-service.js`, `question-code-service.js`, `question-classification-service.js`, `question-migration-service.js`.

**Interface** : `admin/document-sources.html`, `admin/document-sources.js`.

**Documentation** : `RAPPORT_SPRINT20.md`.

## 11. Fichiers modifiés

- `js/services/question-metadata-service.js` — champs additifs de classification.
- `js/services/question-parser.js` — `buildQuestionDocument()` accepte une destination résolue.
- `js/services/import-service.js` — résolution de la destination par question, trace de lot.
- `admin/import.html`, `admin/import.js` — étape de destination documentaire.
- `admin/bank.js` — section « Classification documentaire » en lecture seule.
- `index.html` — lien « Sources documentaires ».
- `firestore.rules` — nouvelle règle de mise à jour n°4 (classification) sur `questions/` ; nouvelles collections `document_sources/`, `document_sections/`, `document_code_counters/`.
- `firestore.indexes.json` — 6 nouveaux index composites.

**Aucune modification** de `data/questions.js`, de `js/app.js`, ni d'aucune fonctionnalité des Sprints 1-19.

## 12. Procédure de déploiement

1. Sauvegarder la version stable en production.
2. Déployer `firestore.rules` et `firestore.indexes.json` avant le code applicatif.
3. Attendre la construction complète des nouveaux index.
4. Déployer les fichiers statiques.
5. Exécuter le scénario de test (section 15).
6. Publier en production seulement après validation.

## 13. Procédure de migration (pour le propriétaire du projet)

1. Créer les sources documentaires principales depuis `admin/document-sources.html`.
2. Créer les premières sections.
3. Utiliser l'onglet « Migration par lots » : filtrer, prévisualiser, choisir la destination, confirmer.
4. Répéter progressivement — aucune obligation de tout migrer en une seule fois.
5. Suivre l'onglet « Non classées » pour mesurer la progression.

## 14. Procédure de retour arrière

Ce sprint n'a rien retiré : revenir à la version précédente du code suffit — les questions conservent tous leurs anciens champs et continuent de fonctionner exactement comme avant, y compris si des questions ont déjà été classées (les nouveaux champs sont simplement ignorés par l'ancien code). Aucune donnée n'est perdue : les documents créés restent en base, prêts à être réutilisés lors d'un nouveau déploiement.

## 15. Tests réalisés / scénario de test manuel

**Vérifications effectuées dans cet environnement** : syntaxe de l'ensemble des fichiers JavaScript, validité JSON des index, équilibre des règles, cohérence croisée des identifiants DOM et fonctions exposées, relecture manuelle complète.

**Scénario à exécuter sur un environnement Firebase réel** :
1. Créer une source REF (CBIP 2026), une source PROC (Familia — Retours v3), une source ETU (ULiège — Pharmacologie 2026-2027).
2. Créer plusieurs niveaux de sections (Cardiologie > Hypertension > IEC).
3. Renommer une section, la déplacer, vérifier que ses sous-sections suivent.
4. Archiver une source contenant des questions → vérifier qu'elle reste consultée normalement, mais n'apparaît plus comme destination possible.
5. Vérifier l'impossibilité de supprimer une source.
6. Rattacher une question individuellement, vérifier le résultat dans la Banque de questions.
7. Rattacher un lot filtré par ancien thème/sous-thème, vérifier les compteurs, vérifier qu'aucun contenu n'a changé.
8. Reclassifier une question déjà classée → vérifier l'ajustement des compteurs.
9. Importer avec destination choisie dans l'interface.
10. Importer sans destination → « Non classée », import non bloqué.
11. Importer avec destination invalide dans le fichier → avertissement, repli.
12. Vérifier la conservation du `pedagogicalId` d'origine.
13. Générer un identifiant fonctionnel, vérifier le format.
14. Vérifier l'isolation par organisation dans les sélecteurs.
15. Vérifier la compatibilité complète (affichage, édition, parcours, évaluation, progression).
16. Vérifier le responsive smartphone.

## 16. Limites connues

1. Isolation d'accès administrateur entre organisations non réellement enforcée (section 7).
2. Filtrage de migration par sous-thème sur balayage borné, pas un index dédié.
3. Aucune vérification d'unicité réelle en base pour un identifiant fonctionnel saisi manuellement.
4. Vue « Non classées » basée sur un balayage borné (1000 questions).
5. Aucun éditeur graphique d'arborescence — délibérément non construit.
6. Aucun test fonctionnel réel sur un projet Firebase.

## 17. Choix volontairement reportés

- Reconnexion réelle entre les cartes visibles (Familia, Référentiels…) et les sources documentaires — architecture prête, rien de câblé dans l'affichage existant.
- Renommage ou association rétroactive automatique des identifiants existants — reste une action explicite de l'administrateur.
- Toute fonctionnalité listée comme hors périmètre (IA, OCR, upload PDF, comparaison d'éditions, workflow multi-validateurs, statistiques de difficulté, moteur de recherche avancé…) — aucun développement, même partiel.

## 18. Statut proposé

**À_TESTER** (Charte Développement, section 22). Ne pas publier en production avant exécution du scénario de test manuel, en particulier les scénarios de sécurité et de compatibilité.
