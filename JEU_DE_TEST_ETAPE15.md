# JEU DE TEST — Étape 15 (passe de test manuelle complète)

Checklist pour clore l'Étape 15 : jamais faite formellement jusqu'ici,
seulement des vérifications ponctuelles au fil des migrations. À cocher
au fur et à mesure, idéalement après le chargement complet des nouveaux
lots de questions.

Convention : ✅ chemin normal (golden path) — ⚠️ cas limite/erreur
attendue (doit échouer proprement, jamais planter ni corrompre des
données).

---

## 1. Compte utilisateur (pharmacien)

- ✅ Connexion, déconnexion, reconnexion.
- ✅ Accueil : compteurs (parcours en cours, évaluations réalisées, score
  moyen), progression globale, activité récente, défi du jour — cohérents
  avec l'activité réelle du compte.
- ⚠️ Accès à une page sans être connecté → redirection propre, aucune
  fuite de données avant redirection (vérifier dans l'onglet Réseau du
  navigateur qu'aucune requête Firestore/API ne part avant l'auth).

## 2. Entraînement libre

- ✅ Composer une séance : filtrer par source documentaire, section,
  difficulté, tag — au moins une combinaison de chaque filtre.
- ✅ Répondre à une série complète, voir le résultat détaillé.
- ⚠️ Filtre ne renvoyant aucune question (ex. section vide) → message
  clair, pas d'écran blanc/erreur JS.
- ⚠️ Source masquée de l'entraînement libre (`hiddenFromFreeTraining`)
  → n'apparaît plus dans le sélecteur, même si elle reste active ailleurs.

## 3. Parcours

- ✅ Ouvrir "Mes parcours", démarrer un parcours attribué, le terminer.
- ✅ "Mes compétences" : progression par compétence cohérente après une
  évaluation.
- ⚠️ Aucun parcours attribué → message clair (déjà vu après le reset :
  "Aucun parcours ne vous a été attribué").

## 4. Défi du jour

- ✅ Répondre au défi du jour, vérifier qu'il ne se represente pas une
  2e fois le même jour.
- ⚠️ Aucune question disponible pour le défi (catalogue vide/en cours de
  rechargement) → message clair, pas de blocage de la page d'accueil.

## 5. Mes évaluations / historique

- ✅ Historique des évaluations passées affiché correctement, score par
  évaluation cohérent avec le détail (`evaluation-result.html`).

## 6. Administration — Sources documentaires

- ✅ Créer/activer une source en brouillon, la renommer (bouton
  "Renommer", tout juste ajouté), l'archiver, la masquer/révéler de
  l'entraînement libre, changer son icône.
- ✅ Arborescence des sections affichée correctement pour une source
  volumineuse (celle avec le plus de questions rattachées).
- ⚠️ Supprimer un référentiel contenant des questions → confirmation
  explicite, questions archivées en cascade (jamais supprimées), compteur
  cohérent après.
- ⚠️ Renommer avec un nom vide ou 1 caractère → refusé avec message clair
  (`MIN_NAME_LENGTH`).

## 7. Administration — Banque de questions

- ✅ Parcourir, filtrer par statut (brouillon/publié/archivé), ouvrir le
  détail d'une question importée récemment.
- ⚠️ Filtre combiné improbable (ex. domaine + tag sans aucune question
  correspondante) → liste vide propre, pas d'erreur d'index Firestore
  visible côté utilisateur.

## 8. Administration — Synchronisation du catalogue (import Excel)

- ✅ Importer un lot Excel valide de bout en bout : upload, validation
  ligne par ligne, questions créées en brouillon, activation.
- ⚠️ Fichier avec une banque inconnue (`BANK_TO_THEME`) → erreur de
  validation explicite, aucune question partiellement créée.
- ⚠️ Fichier avec une difficulté non reconnue → même chose (cas déjà
  rencontré et corrigé : "fondamental" → Essentiel).
- ⚠️ Fichier avec une ligne où la bonne réponse ne correspond à aucune
  réponse non vide, ou moins de 2 réponses non vides, ou justification
  vide → ligne ignorée avec message, le reste du fichier importé quand
  même.
- ⚠️ Réimporter le même fichier deux fois → pas de doublons silencieux
  (vérifier le comportement réel : nouvelle version, ou rejet, ou
  doublon signalé).

## 9. Administration — Compétences / Parcours

- ✅ Créer/modifier une compétence et un parcours, les publier, les
  attribuer à un utilisateur ou un groupe.
- ⚠️ Attribuer un parcours à un utilisateur déjà assigné → pas de
  doublon d'assignation.

## 10. Administration — Utilisateurs

- ✅ Changer le rôle d'un utilisateur (user → admin → user), changer son
  statut (actif/désactivé), vérifier qu'une seule entrée d'audit est
  créée par action (bug de doublon déjà corrigé en Phase D, à
  revérifier une dernière fois en conditions réelles).
- ⚠️ Tenter de retirer les droits admin du DERNIER admin actif → refusé
  (protection transactionnelle "dernier admin actif", Phase C.1).
- ⚠️ Désactiver son propre compte en étant connecté → comportement
  vérifié (déconnexion immédiate ? blocage à la prochaine action ?).

## 11. Journal d'audit

- ✅ Chaque action sensible (rôle, statut, référentiel, question,
  parcours, compétence) produit une entrée lisible dans le journal.
- ⚠️ Filtrer le journal par utilisateur cible (`targetUid`) → résultat
  cohérent, jamais toute la collection chargée d'un coup.

## 12. Multi-appareils

- ✅ Se connecter simultanément sur deux navigateurs/ordinateurs
  différents avec le même compte admin → les deux voient les mêmes
  données en quasi temps réel (catalogue partagé via Firestore, pas de
  synchronisation manuelle nécessaire — point déjà expliqué à David).

## 13. Réseau / robustesse

- ⚠️ Couper le réseau en cours d'action (ex. pendant un import) → message
  d'erreur clair, pas de données à moitié écrites.
- ⚠️ Recharger la page en plein milieu d'une évaluation → pas de perte
  totale de progression déjà validée (vérifier ce qui est réellement
  garanti aujourd'hui).

---

Une fois toutes les cases cochées (et les ⚠️ vérifiées comme échouant
*proprement*), l'Étape 15 est close et le "tout est ok" (condition posée
par David avant d'entamer le PWA) peut être considéré comme atteint.
