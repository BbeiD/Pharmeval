# PERSONA — "Le mauvais utilisateur"

Persona adversarial utilisé pour forcer un audit du code et de l'UI,
au-delà du chemin heureux couvert par [JEU_DE_TEST_ETAPE15.md](JEU_DE_TEST_ETAPE15.md).
Il ne cherche jamais à "utiliser normalement" l'application — il cherche
ce qui casse, ce qui fuit, ce qu'on peut contourner.

## Qui c'est

Un utilisateur authentifié (compte pharmacien standard, jamais admin au
départ) qui :
- ne suit jamais le chemin prévu par l'interface,
- appelle l'API directement (console navigateur, curl) plutôt que de
  cliquer,
- modifie ce qu'il peut modifier côté client avant d'envoyer (état
  JavaScript, `localStorage`, requêtes réseau interceptées),
- teste les limites (chaînes vides, énormes, caractères spéciaux,
  Unicode, code HTML/JS injecté),
- essaie plusieurs fois vite, en parallèle, ou dans le désordre,
- devine des identifiants plutôt que de les obtenir légitimement.

Il n'a **jamais** de mauvaises intentions graves (pas de vol de
données réel) — dans ce contexte, "casser" veut dire : provoquer une
erreur non gérée, contourner une permission, corrompre une donnée,
voir ce qu'il ne devrait pas voir.

## Ce qu'il essaie (checklist)

### Permissions et contournement d'admin
- [ ] Appeler une route `/api/admin/...` avec un compte non-admin →
  doit recevoir 403, jamais 200 ni fuite d'info dans le message d'erreur.
- [ ] Appeler une route protégée sans jeton, avec un jeton expiré, ou un
  jeton d'un autre utilisateur copié depuis `localStorage`.
- [ ] Modifier son propre document `users/{uid}` en écriture directe
  Firestore (console navigateur, SDK client) pour se donner `role:
  "admin"` → doit être bloqué par firestore.rules (collection
  verrouillée côté client depuis la Phase C.3/D).
- [ ] Lire/écrire directement une des 21 collections verrouillées
  (`allow read, write: if false;`) via le SDK client → doit échouer.

### Falsification de données via l'API
- [ ] Soumettre un résultat d'évaluation avec un score irréaliste
  (négatif, > 100%, non numérique) directement en appelant l'API.
- [ ] Soumettre une réponse à une question qui n'existe pas / qui est
  archivée.
- [ ] Rejouer (replay) deux fois la même requête de soumission
  d'évaluation → vérifie l'absence de double comptage.

### Injection / contenu malveillant
- [ ] Créer une question (ou un profil, un commentaire, un nom de
  référentiel) contenant `<script>alert(1)</script>` ou une balise
  `<img onerror=...>` → doit s'afficher comme texte brut partout où
  c'est ensuite RENDU à un autre utilisateur, jamais exécuté.
- [ ] Colonnes Excel avec une formule (`=CMD(...)`, injection de
  formule classique dans les outils tableur) dans un champ texte.
- [ ] Nom de fichier ou champ texte avec des caractères de contrôle,
  emoji, RTL (right-to-left override), chaînes très longues (10 000+
  caractères).

### Accès à des données d'autrui
- [ ] Deviner/incrémenter un ID (`uid`, `sourceId`, `resultId`) dans une
  URL ou un appel API pour lire les évaluations d'un autre utilisateur.
- [ ] Demander le journal d'audit filtré sur un `targetUid` qui n'est
  pas le sien, sans être admin.

### Abus / robustesse
- [ ] Rafale de requêtes sur une route coûteuse (import Excel, reset
  admin s'il en reste, recherche) → comportement sous charge (la
  fonction est plafonnée à `maxInstances: 10` — que se passe-t-il au
  -delà ?).
- [ ] Upload d'un fichier "image" qui n'est pas une image (renommé),
  ou dépassant la limite de taille (`multer`, 5 Mo).
- [ ] Ouvrir l'app dans 2 onglets, faire une action destructrice dans
  l'un (ex. supprimer un référentiel) pendant que l'autre affiche
  encore l'ancien état → cohérence au retour.

### UI
- [ ] Naviguer avec le bouton retour du navigateur en plein milieu d'un
  flux (import, évaluation) → état cohérent, pas de soumission
  fantôme.
- [ ] Zoom navigateur extrême / fenêtre très étroite (mobile) sur les
  écrans d'administration denses (tableaux, arborescences).

## Comment s'en servir

1. **Audit statique** (fait par Claude Code, voir rapport associé) :
   relire le code sous cet angle — validation d'entrée, échappement à
   l'affichage, vérifications de permission systématiques côté serveur
   (jamais seulement côté client).
2. **Audit manuel en conditions réelles** : David reproduit lui-même
   quelques cas de cette liste (les plus simples à tester à la main —
   permissions, injection de contenu) sur l'environnement de
   production, avec un compte de test dédié (jamais sur un vrai compte
   utilisateur).
