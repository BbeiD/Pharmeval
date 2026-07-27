# AUDIT "MAUVAIS UTILISATEUR" — Résultats (27/07/2026)

Audit statique du code, mené selon la grille de [PERSONA_MAUVAIS_UTILISATEUR.md](PERSONA_MAUVAIS_UTILISATEUR.md).
Méthode : lecture intégrale de `functions/index.js` (~100 routes),
`firestore.rules`, les services de rendu/échappement, le connecteur
d'import Excel. Posture : utilisateur authentifié standard, jamais admin
au départ, appels API directs (DevTools/curl) plutôt que via l'UI.

## Priorité 1 — Critique (exploitable par tout compte utilisateur normal)

1. **`POST /api/evaluation-results` (functions/index.js:2283-2312)** — le
   score et les corrections envoyés par le client sont écrits tels que
   reçus, jamais recalculés côté serveur à partir des réponses réelles de
   la session. Un utilisateur peut s'auto-attribuer n'importe quel score
   par appel API direct.
2. **`POST /api/question-progress/apply` (index.js:2155-2211)** — les
   `entries` (question réussie/ratée) ne sont jamais croisées avec le
   contenu réel du résultat d'évaluation référencé.
3. **`POST /api/competency-progress` (index.js:274-287)** — seule
   l'identité du document (`userId`/`id`) est vérifiée, le contenu
   métier (niveau de maîtrise, score) est accepté sans contrôle.

Ces 3 routes alimentent l'historique, les statistiques et potentiellement
un usage RH/formation continue — falsifiables aujourd'hui sans avoir
besoin d'un compte admin.

## Priorité 2 — Moyen

4. **`firestore.rules:207-212`** — un admin peut toujours modifier
   `role`/`status` d'un tiers en écriture Firestore directe (DevTools),
   en contournant la protection transactionnelle "toujours garder un
   admin actif" ajoutée côté Cloud Function (`index.js:1976-1988`).
   Nécessite déjà un compte admin, mais casse une garantie que la
   migration Étape 13 prétend apporter.
5. **`POST /api/images` (index.js:46-52)** — `mimetype` non vérifié
   (déclaré par le client), aucun plafond de nombre d'uploads par
   utilisateur, URL signée valide jusqu'en 2030 → hébergement de contenu
   arbitraire derrière un domaine Google de confiance + coût de
   stockage.
6. **Bornes non plafonnées** sur `/api/questions/search-bounded`,
   `/api/competencies/search-bounded`, `/api/parcours/search-bounded`,
   `/api/questions` (`maxScan`/`pageSize` vérifiés `>0`, jamais de
   maximum) → un compte normal peut saturer les 10 instances Cloud
   Function (`maxInstances:10`, seule protection existante) et dégrader
   le service pour tous.
7. **`question_reports`** — écriture Firestore directe (contourne
   entièrement les Cloud Functions et `maxInstances`), aucune limite de
   fréquence ni de taille sur le champ `comment`.
8. **`POST /api/questions/batch` (index.js:758-788)** — ne réapplique pas
   les règles de `question-import-validator.js` (longueurs, bornes,
   thèmes) ; nécessite déjà un compte admin catalogue.

## Priorité 3 — Mineur / hygiène

9. `PUT /api/daily-challenge/:uid` — même famille que 1-3, impact limité
   à la gamification.
10. Incohérence `isRequesterAdmin` vs `isRequesterCatalogAdmin` sur des
    routes de lecture similaires (`index.js:611,633` vs `660`) — bug
    fonctionnel, pas une escalade de privilège.
11. `escapeHtml()` utilisé dans des attributs `onclick` inline (pattern
    fragile en théorie) — non exploitable aujourd'hui, les valeurs
    concernées sont toutes des identifiants système.

## Vérifié sans problème trouvé

- Fuite de données d'un autre utilisateur par identifiant deviné/modifié
  dans l'URL (`evaluation_results`, `question_progress`,
  `competency_progress`, `daily_challenge_progress`, `audit-logs`).
- Échappement XSS sur tout le contenu réellement affiché à l'écran.
- Exécution de code via l'import Excel (SheetJS lit le texte affiché,
  jamais une formule).
- Permissions manquantes sur une route (`requireAuth` partout sauf
  `/health`, intentionnel).

---

**Décision en attente** : par quoi commencer. Recommandation : les 3
critiques (Priorité 1) d'abord, car exploitables sans compte admin.
