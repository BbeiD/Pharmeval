// ===================== BANQUE DES GROUPES (Sprint 14) =====================
// Un utilisateur peut appartenir a PLUSIEURS groupes (voir
// user-profile-metadata-service.js, champ `groupIds`, tableau). Reutilise
// le service generique (reference-bank-service.js, Sprint 14).

import { createReferenceBankService } from "./reference-bank-service.js";
import { PERMISSIONS } from "./authorization-service.js";

export const groupsBank = createReferenceBankService({
  bankType: 'group',
  collectionName: 'groups',
  idPrefix: 'GROUP',
  managePermission: PERMISSIONS.MANAGE_REFERENCE_DATA,
  purgePermission: PERMISSIONS.PURGE_REFERENCE_DATA,
  labelSingular: 'groupe',
});

/** Suggestions de noms de groupes (SPRINT14, "Exemples") - meme principe
 * que SUGGESTED_PROFILE_NAMES (profiles-bank-service.js) : pré-remplissage
 * uniquement, aucune création automatique. */
export const SUGGESTED_GROUP_NAMES = Object.freeze([
  'Nouveaux entrants',
  'Pharmaciens titulaires',
  'Étudiants ULiège',
  'Formation continue',
]);
