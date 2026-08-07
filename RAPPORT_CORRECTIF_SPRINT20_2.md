# RAPPORT CORRECTIF SPRINT 20.2 — Catalogue documentaire global, indépendant des organisations

**Pharmeval v2.11.1 → v2.12.0**

**Classification de version** : MINOR plutôt que PATCH, malgré son origine corrective — ce correctif modifie volontairement le contrat de données de `document_sources`/`document_sections` (retrait d'un champ, renommage d'un autre) et le modèle de permissions associé. Ce n'est pas un simple correctif de bug (comme le correctif précédent, v2.11.1, sur les compteurs) : c'est une correction d'architecture, avant toute migration réelle, sans rupture pour les fonctionnalités déjà en production (aucune donnée réelle n'existe encore dans cette couche).

## 1. Objectif

Le Sprint 20 avait, à tort, rattaché les sources et sections documentaires à une organisation (`organizationId`), comme s'il fallait recréer CBIP 2026 séparément pour chaque organisation cliente. Ce correctif transforme la couche documentaire en un catalogue global unique, partagé par toutes les organisations :

```
Catalogue global (indépendant des organisations)
├── Sources documentaires
├── Sections
├── Questions
└── Compétences

Organisations (propres à chaque organisation cliente)
├── Utilisateurs
├── Profils
├── Groupes
├── Parcours
└── Attributions
```

## 2. Analyse du modèle Question (demandée explicitement)

**Résultat : déjà compatible, aucune modification structurelle nécessaire.** Le modèle de question n'a jamais porté de champ `organizationId` obligatoire — vérifié dans le code existant avant toute modification. Une question est donc déjà, et reste, utilisable par plusieurs organisations sans duplication.

**Point identifié et documenté honnêtement** : `question-parser.js` prépare, depuis le Sprint 10, un champ `visibility.organizationIds: []` — un placeholder pour une éventuelle restriction future de visibilité par organisation, vide par défaut et non exploité par aucune interface ni règle Firestore. Il ne contredit donc pas le principe du catalogue global et n'a pas été retiré : c'est un champ préparé et inerte pour une fonctionnalité future explicitement hors périmètre, pas une dépendance organisationnelle active.

## 3. Analyse du modèle Compétence (demandée explicitement)

**Résultat : déjà compatible, aucune modification nécessaire.** Vérification faite dans les trois fichiers du domaine (Sprint 13) : aucune trace d'`organizationId` n'y a jamais existé. Les compétences ont toujours été une banque globale, référencée par les parcours sans jamais en devenir la propriété. Aucune refonte du Sprint 13 n'a donc été nécessaire.

## 4. Sources documentaires : modèle corrigé

`organizationId` retiré de `document_sources`. Le champ `organizationName` du Sprint 20 est renommé **`sourceOrganizationName`** pour lever l'ambiguïté signalée par le cadrage : il désigne l'organisme auteur ou éditeur de la source (CBIP, Familia, ULiège), jamais une organisation cliente de Pharmeval. Le reste du modèle est inchangé.

## 5. Sections documentaires : modèle corrigé

`organizationId` retiré de `document_sections`. Une section reste rattachée uniquement à sa source documentaire (`documentSourceId`) — jamais à une organisation.

## 6. Administration et permissions — un catalogue, deux niveaux d'administration

Nouvelle permission **`MANAGE_GLOBAL_CATALOG`**, volontairement distincte de `MANAGE_QUESTIONS` : gérer le contenu d'une question et gérer sa place dans le catalogue documentaire sont deux capacités séparées.

- **Administrateur du catalogue global** (`MANAGE_GLOBAL_CATALOG`) : crée/modifie/archive une source, crée/déplace des sections, classe les questions, lance une migration ou une réconciliation.
- **Administrateur d'organisation** (`MANAGE_PARCOURS`, `MANAGE_REFERENCE_DATA`, etc., inchangés) : gère utilisateurs, profils, groupes, parcours, attributions — ne possède pas `MANAGE_GLOBAL_CATALOG` par défaut.

`MANAGE_GLOBAL_CATALOG` est accordée aux rôles `admin` et `super_admin` dans la matrice `ROLE_PERMISSIONS`, jamais à `editor` ni `teacher` — même une fois ces rôles réellement attribuables, ils ne posséderont pas automatiquement les droits sur le catalogue global.

Côté règles Firestore, une nouvelle fonction `isRequesterCatalogAdmin()` reproduit cette distinction (`role == 'admin' || role == 'super_admin'`) — les règles ne pouvant pas lire la matrice JS, cette fonction doit rester synchronisée manuellement, documenté explicitement dans `firestore.rules`.

## 7. Interface Sources documentaires

Le sélecteur d'organisation obligatoire, le message « choisissez une organisation », et toutes les requêtes conditionnées par une organisation ont été retirés. À l'ouverture, les sources globales s'affichent directement (filtrables par type et statut). Le formulaire de création ne demande plus d'organisation ; son champ « Organisme auteur ou éditeur » est conservé, correctement libellé. Les sélecteurs de destination (rattachement individuel, migration par lots, import) chargent directement la liste des sources globales actives.

## 8. Import JSON et migration par lots

**Import** : l'étape de destination ne demande plus d'organisation — sélection directe d'une source globale, puis d'une section. Workflow inchangé dans sa structure.

**Migration par lots** : fonctionne sur l'ensemble de la banque globale de questions, sans filtre d'organisation. La logique de deltas exacts et de réconciliation validée au correctif précédent (v2.11.1) est entièrement conservée.

## 9. Jobs de migration documentaire

`organizationId` retiré du modèle `document_migration_jobs` — les jobs sont désormais globaux. L'utilisateur ayant déclenché l'opération (`createdBy`) reste tracé.

## 10. Réconciliation des compteurs

`document-count-service.js` expose désormais `rebuildSourceCounts()`/`rebuildSectionCounts()` (inchangées), un nouvel alias `reconcileSource(sourceId)` combinant les deux, et `reconcileAllDocumentCounts()` sans paramètre d'organisation — une réconciliation complète couvre tout le catalogue global en un seul appel. Philosophie inchangée : les questions classifiées sont la vérité métier, les compteurs sont dérivés et reconstruisibles.

## 11. Interface d'administration — clarification visuelle

Le tableau de bord distingue désormais deux sections, sans refonte graphique : « 📚 Catalogue global » (Import, Banque de questions, Sources documentaires, Banque des compétences) et « 🏢 Organisation » (Parcours, Utilisateurs, Organisations/Profils/Groupes).

## 12. Règles Firestore

- Nouvelle fonction `isRequesterCatalogAdmin()`.
- `document_sources/`, `document_sections/` : toute référence à `organizationId` retirée ; écriture réservée à `isRequesterCatalogAdmin()`.
- `document_migration_jobs/` : `organizationId` retiré ; accès réservé à `isRequesterCatalogAdmin()`.
- `questions/` : la règle de classification documentaire passe de `isRequesterAdmin()` à `isRequesterCatalogAdmin()`.
- Isolation organisationnelle préservée à l'identique pour toutes les autres collections (utilisateurs, profils, groupes, attributions, sessions, résultats, progression).

Fichier complet fourni dans le ZIP.

## 13. Index Firestore

**Supprimés** (4 index, `document_sources`, basés sur `organizationId`) : `(organizationId, display.order)`, `(organizationId, sourceType, display.order)`, `(organizationId, status, display.order)`, `(organizationId, sourceType, status, display.order)`.

**Ajoutés** (3 index, `document_sources`, requêtes globales) : `(sourceType, display.order)`, `(status, display.order)`, `(sourceType, status, display.order)`.

Aucun changement sur `document_sections/` ni `document_migration_jobs/`. Fichier `firestore.indexes.json` complet fourni.

## 14. Gestion des erreurs d'index manquant

`document-source-catalog-service.js` détecte désormais une erreur Firestore « précondition échouée, index requis » et retourne un message dédié plutôt qu'un message générique — propagé jusqu'à l'interface. L'erreur d'origine complète reste, dans tous les cas, journalisée en console. Appliqué à la requête la plus directement affectée par ce correctif (`queryDocumentSources()`) ; le même schéma peut être répliqué ailleurs si nécessaire.

## 15. Migration des données existantes

Nouveau service `document-catalog-migration-service.js`, exposé via « 🧹 Analyser les anciennes données » :
- **Détection des résidus** : sources portant encore un champ `organizationId` physique — nettoyage en un clic, un par un ou en lot, sans toucher identifiant/métadonnées/sections/questions.
- **Rapport de doublons potentiels** : regroupe les sources par `(sourceType, shortCode, version)` identiques, signale les groupes de plus d'une source, sans jamais fusionner automatiquement — décision manuelle du propriétaire du projet.

## 16. Compatibilité

Aucune modification de contenu des questions, réponses, justifications, identifiants techniques/pédagogiques, parcours, évaluations, résultats, progression, présentation générale. Aucune réimportation nécessaire.

## 17. Procédure de déploiement (deux temps)

### Déploiement immédiat
```
firebase deploy --only firestore:rules
```
Fonctionne indépendamment des index.

### Déploiement ultérieur des index
```
firebase deploy --only firestore:indexes
```
**Fonctionnalités temporairement limitées avant la création des index** : la liste des sources filtrée par type et/ou statut échouera avec le message explicite décrit en section 14 tant que les 3 nouveaux index ne sont pas construits — le reste de l'application (parcours, évaluations, résultats, progression, banque de questions classique) n'est pas affecté. L'utilisateur n'est pas tenu de déployer les index immédiatement pour vérifier le reste de l'interface.

## 18. Procédure de retour arrière

Revenir à v2.11.1 reste possible : le schéma `organizationId` n'est plus lu ni écrit par le nouveau code, mais des documents existants peuvent avoir perdu ce champ suite à un nettoyage volontaire (section 15). Recommandation : ne déclencher ce nettoyage qu'une fois ce correctif validé en production.

## 19. Tests réalisés

**Vérifications effectuées ici** : syntaxe complète, validité JSON des index, équilibre des règles et du CSS, cohérence croisée des identifiants DOM et fonctions exposées, balayage exhaustif du projet pour toute trace résiduelle d'`organizationId` dans la couche documentaire (confirmé : aucune hors du service de nettoyage et des commentaires), vérification que les collections isolées par organisation n'ont subi aucune modification.

**Non exécuté ici** (aucun accès Firebase réel) — les 13 tests demandés : création de source globale sans organisation ; affichage global immédiat ; sections globales sans organisation ; classification d'une question ; utilisation de la même question/compétence dans deux parcours de deux organisations différentes sans duplication ; refus de modification par un administrateur d'organisation sans permission catalogue ; création/modification/archivage par un administrateur du catalogue ; migration par lots ; réconciliation ; import JSON sans organisation ; compatibilité parcours/évaluations/résultats/progression ; migration sans perte d'une ancienne source ; message d'erreur explicite en cas d'index manquant.

## 20. Limites connues

1. `isRequesterCatalogAdmin()` doit être maintenue manuellement en cohérence avec la matrice JS.
2. La détection d'erreur d'index manquant est appliquée à la requête la plus concernée par ce correctif, pas encore généralisée.
3. La détection de doublons se limite à l'égalité stricte de `(sourceType, shortCode, version)`.
4. Aucun test fonctionnel réel sur un projet Firebase.

## 21. Statut proposé

**À_TESTER.** Ne pas procéder à la migration réelle des ~900 questions avant exécution complète des 13 scénarios de test sur un environnement Firebase réel, en particulier les tests de permissions et de non-duplication inter-organisations.
