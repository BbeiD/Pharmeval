# GUIDE DE MIGRATION — Sprint 13 (Banque des compétences)

## Qui est concerné ?

Tout parcours créé avant ce sprint (v2.3.0/v2.3.1) et contenant au moins une compétence ajoutée en texte libre (formulaire "Nom de la nouvelle compétence" ou ancien panneau "Ajouter plusieurs").

## Faut-il migrer immédiatement ?

**Non, rien ne casse si vous ne migrez pas tout de suite.** Un parcours non migré continue de s'afficher normalement dans `admin/parcours.html` : le nom et la description de chaque compétence restent visibles (repli sur les anciennes valeurs imbriquées), avec un simple avertissement discret ("⚠️ Compétence non reliée à la banque").

En revanche, tant qu'une compétence n'est pas migrée :
- elle n'apparaît **pas** dans la Banque des compétences (`admin/competencies.html`) ;
- une modification de son nom/sa description doit se faire à l'ancienne, parcours par parcours (la fonctionnalité "modification répercutée automatiquement" ne s'applique qu'aux compétences migrées) ;
- elle ne peut pas être réutilisée dans un autre parcours par simple sélection.

## Comment migrer

1. Ouvrir **Administration → 🧩 Banque des compétences**.
2. Cliquer sur **« 🔄 Migrer les anciennes compétences »**.
3. Un aperçu s'affiche : nombre de compétences distinctes à migrer (dédupliquées par nom, insensible à la casse), nombre de liaisons déjà existantes qui seront ignorées. **Aucune écriture n'a encore eu lieu à cette étape.**
4. Cliquer sur **« Lancer la migration »** pour exécuter réellement l'opération.
5. Un résumé s'affiche : nombre de fiches créées, de liaisons ajoutées, de parcours mis à jour, et la liste des éventuelles anomalies rencontrées (par exemple une compétence imbriquée sans nom exploitable).

## Ce que fait la migration, précisément

Pour chaque compétence imbriquée d'un parcours qui n'a pas encore de `competencyId` :
1. Recherche si une fiche de la banque du même nom (insensible à la casse) a déjà été créée **pendant cette même exécution** — si oui, elle est réutilisée (déduplication).
2. Sinon, crée une nouvelle fiche dans la Banque des compétences, avec le nom et la description de la compétence imbriquée, au statut `draft` (jamais publiée automatiquement).
3. Ajoute le champ `competencyId` sur l'entrée imbriquée du parcours, en conservant tout le reste inchangé (identifiant interne, ordre, `questionIds` déjà liés).

## Ce que la migration ne fait PAS

- Elle ne supprime aucune donnée existante.
- Elle ne modifie aucune question.
- Elle ne republie ni n'archive aucun parcours.
- Elle ne fusionne pas deux compétences de noms différents, même proches (ex. "Injection IM" et "Injection intramusculaire" resteront deux fiches distinctes) — aucune décision de fond n'est prise automatiquement à la place d'un administrateur.
- Elle ne retire jamais les anciens champs `name`/`description` de l'entrée imbriquée : ils restent disponibles comme affichage de repli.

## Peut-on relancer la migration plusieurs fois ?

Oui, sans risque : toute compétence déjà migrée (portant déjà un `competencyId`) est simplement ignorée lors d'une nouvelle exécution (comptée dans « liaison(s) déjà existante(s) »).

## Après la migration

Vérifier dans `admin/competencies.html` que les fiches créées ont un nom cohérent, ajouter si besoin une catégorie, des mots-clés, un niveau conseillé ou une couleur (aucun de ces champs n'est rempli automatiquement par la migration, pour ne jamais inventer une catégorisation non demandée), puis publier les fiches jugées prêtes.
