// ===================== SERVICE DE MIGRATION VERS LA BANQUE DES COMPETENCES (Sprint 13) =====================
// Objectif UNIQUE (SPRINT13, "Contraintes" : "Prévoir une migration
// automatique des anciennes compétences texte vers le nouveau modèle") :
// convertir les competences EN TEXTE LIBRE deja imbriquees dans des
// documents `parcours` (Sprint 12, `completeCompetency()` sans
// `competencyId`) en de VERAIES fiches independantes de la collection
// `competencies` (Sprint 13), puis relier chaque parcours a ces nouvelles
// fiches par reference (`competencyId`) - sans jamais perdre l'historique
// de liaison de questions (`questionIds`) deja present sur l'ancienne
// competence imbriquee.
//
// GARDE-FOU CENTRAL (Charte Développement, section 15 : "aucune question
// n'est modifiée, supprimée ou déplacée par une opération purement
// technique... sans que ce soit l'objet explicite de la demande") :
// - Ne touche JAMAIS aux questions elles-memes.
// - Ne supprime JAMAIS une competence imbriquee existante : elle est
//   COMPLETEE d'un `competencyId`, jamais remplacee ni effacee - un parcours
//   deja affiche continue de fonctionner meme si la migration echoue a mi
//   chemin (compatibilite ascendante, meme principe que
//   resolveParcoursColorHex()).
// - Ne s'execute JAMAIS silencieusement en arriere-plan : doit etre
//   declenchee explicitement depuis admin/competencies.js, jamais au
//   chargement d'une page.
// - Deduplique par nom (insensible a la casse) : deux parcours ayant deja
//   une competence "Injection intramusculaire" produisent UNE SEULE fiche
//   de banque partagee, jamais un doublon par parcours.

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { completeCompetencyMetadata, COMPETENCY_STATUSES } from "./competency-metadata-service.js";
import { createCompetencyDocument } from "./competency-catalog-service.js";
import { logCompetencyAction } from "./competency-audit-service.js";
import { searchParcoursBounded, updateParcoursFields } from "./parcours-catalog-service.js";

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return { status: 'denied', message: 'Vous devez être connecté pour lancer la migration.' };
  }
  if (!hasPermission(PERMISSIONS.MANAGE_COMPETENCIES) || !hasPermission(PERMISSIONS.MANAGE_PARCOURS)) {
    return { status: 'denied', message: 'La migration des compétences est réservée aux administrateurs.' };
  }
  return { status: 'authorized' };
}

/**
 * Examine l'ensemble des parcours (balayage borne, comme partout ailleurs
 * dans le projet) et prepare un APERCU de ce que la migration ferait, SANS
 * ecrire quoi que ce soit - a afficher a l'administrateur avant
 * confirmation (meme principe que previewBulkCompetencyNames()).
 *
 * @returns {Promise<{authorized:boolean, message?:string, error?:boolean, alreadyMigratedCount:number, toMigrateNames:Array<string>, truncatedScan:boolean}>}
 */
export async function previewCompetencyMigration() {
  const access = checkAccess();
  if (access.status !== 'authorized') return { authorized: false, message: access.message };

  const bounded = await searchParcoursBounded({});
  if (bounded.error) {
    return { authorized: true, error: true, message: 'Impossible de lire les parcours pour préparer la migration. Réessayez plus tard.' };
  }

  let alreadyMigratedCount = 0;
  const namesSeen = new Set();
  bounded.items.forEach(function(p) {
    (Array.isArray(p.competencies) ? p.competencies : []).forEach(function(c) {
      if (c.competencyId) {
        alreadyMigratedCount++;
      } else if (c.name) {
        namesSeen.add(c.name.trim().toLowerCase());
      }
    });
  });

  return {
    authorized: true, error: false,
    alreadyMigratedCount: alreadyMigratedCount,
    toMigrateNames: Array.from(namesSeen),
    truncatedScan: bounded.truncated,
  };
}

/**
 * Execute REELLEMENT la migration : pour chaque competence imbriquee sans
 * `competencyId`, cree (ou reutilise, par nom deduplique) une fiche de la
 * Banque des compétences, puis met a jour le parcours pour y ajouter la
 * reference. Le champ `questionIds` deja present sur la competence
 * imbriquee reste sur le parcours (liaison question<->competence dans un
 * parcours precis, non modifiee par ce sprint) ; la nouvelle fiche de la
 * banque demarre avec un `questionIds` vide (architecture future, non
 * retro-remplie automatiquement pour eviter toute association inventee).
 *
 * @returns {Promise<{authorized:boolean, message?:string, error?:boolean, createdCount:number, linkedCount:number, skippedCount:number, parcoursUpdated:number, errors:Array<string>}>}
 */
export async function runCompetencyMigration() {
  const access = checkAccess();
  if (access.status !== 'authorized') return { authorized: false, message: access.message };

  const bounded = await searchParcoursBounded({});
  if (bounded.error) {
    return { authorized: true, error: true, message: 'Impossible de lire les parcours. Migration annulée, aucune écriture effectuée.' };
  }

  const ctx = getCurrentUserContext();
  const now = new Date().toISOString();
  const nameToCompetencyId = new Map(); // dedup par nom normalise, pour toute la migration
  let createdCount = 0;
  let linkedCount = 0;
  let skippedCount = 0;
  let parcoursUpdated = 0;
  const errors = [];

  for (const parcours of bounded.items) {
    const existing = Array.isArray(parcours.competencies) ? parcours.competencies : [];
    let changed = false;

    const updatedCompetencies = [];
    for (const c of existing) {
      if (c.competencyId) {
        // Deja migree (idempotence : une seconde execution ne recree rien).
        updatedCompetencies.push(c);
        skippedCount++;
        continue;
      }
      if (!c.name) {
        // Rien a migrer sans nom exploitable - laissee telle quelle,
        // signalee plutot que corrigee silencieusement.
        updatedCompetencies.push(c);
        errors.push('Parcours ' + parcours.id + ' : compétence sans nom ignorée (id imbriqué ' + c.id + ').');
        continue;
      }

      const normalizedName = c.name.trim().toLowerCase();
      let bankId = nameToCompetencyId.get(normalizedName);

      if (!bankId) {
        const metadata = completeCompetencyMetadata({
          name: c.name,
          description: c.description || '',
          status: COMPETENCY_STATUSES.DRAFT, // jamais publiee automatiquement, meme principe que toute creation
          createdAt: now, updatedAt: now,
          author: (ctx && ctx.email) || null,
        });
        const createResult = await createCompetencyDocument(metadata);
        if (!createResult.success) {
          errors.push('Parcours ' + parcours.id + ' : échec de création de la fiche pour "' + c.name + '".');
          updatedCompetencies.push(c);
          continue;
        }
        bankId = metadata.id;
        nameToCompetencyId.set(normalizedName, bankId);
        createdCount++;

        logCompetencyAction({
          adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
          competencyId: bankId, actionType: 'migration_import',
          oldValue: null, newValue: 'Depuis parcours ' + parcours.id,
        }).catch(function() {});
      }

      updatedCompetencies.push(Object.assign({}, c, { competencyId: bankId }));
      linkedCount++;
      changed = true;
    }

    if (changed) {
      const updateResult = await updateParcoursFields(parcours.id, { competencies: updatedCompetencies });
      if (!updateResult.success) {
        errors.push('Parcours ' + parcours.id + ' : échec de l\'enregistrement des références après migration.');
      } else {
        parcoursUpdated++;
      }
    }
  }

  return {
    authorized: true, error: false,
    createdCount: createdCount, linkedCount: linkedCount, skippedCount: skippedCount,
    parcoursUpdated: parcoursUpdated, errors: errors,
    truncatedScan: bounded.truncated,
  };
}
