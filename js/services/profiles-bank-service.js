// ===================== BANQUE DES PROFILS (Sprint 14) =====================
// SPRINT14 (évolution demandée par le donneur d'ordre en cours de cadrage) :
// "les profils ne devraient pas être saisis librement... créer un véritable
// module Profils, comme il l'a fait pour les compétences. Ainsi, un
// utilisateur ne choisira pas un texte 'Pharmacien', mais une référence
// vers un profil."
//
// IMPORTANT - NE PAS CONFONDRE avec deux notions existantes distinctes :
// 1. `role` (js/services/authorization-service.js, ROLES : user/admin/
//    editor/teacher/super_admin) - un concept TECHNIQUE de PERMISSIONS
//    (ce que l'utilisateur a le droit de faire dans l'administration de
//    Pharmeval). Ce sprint ne le modifie PAS ("Ne pas créer de système de
//    droits").
// 2. `profile.profession` (js/services/user-service.js, PROFESSION_OPTIONS)
//    - un texte libre/enum FIGE capture a la premiere connexion (Sprint 2),
//    non reutilisable, non extensible depuis l'interface.
//
// Le "Profil" de ce sprint est une TROISIEME notion, metier et
// PEDAGOGIQUE/ORGANISATIONNELLE (Étudiant, Pharmacien, Assistant
// pharmaceutico-technique, Responsable qualité, Responsable formation,
// Administrateur...) : une fiche independante et reutilisable, prevue pour
// determiner plus tard l'acces aux parcours, aux tableaux de bord, etc.
// (voir VISION_PHARMEVAL.md, section 6 "Les rôles" - ce module Profils est
// un pas concret vers ce futur modele, sans l'implementer entierement
// aujourd'hui).
//
// Reutilise le service generique (reference-bank-service.js, Sprint 14).

import { createReferenceBankService } from "./reference-bank-service.js";
import { PERMISSIONS } from "./authorization-service.js";

export const profilesBank = createReferenceBankService({
  bankType: 'profile',
  collectionName: 'profiles',
  idPrefix: 'PROFILE',
  managePermission: PERMISSIONS.MANAGE_REFERENCE_DATA,
  purgePermission: PERMISSIONS.PURGE_REFERENCE_DATA,
  labelSingular: 'profil',
});

/**
 * Suggestions de noms de profils (SPRINT14, "Exemples"). PURE COMMODITE
 * D'INTERFACE (pré-remplissage du formulaire de création, voir
 * admin/reference-banks.js) : aucune fiche n'est créée automatiquement,
 * aucune donnée n'est inventée dans Firestore - l'administrateur reste
 * seul décisionnaire de ce qui est réellement créé.
 */
export const SUGGESTED_PROFILE_NAMES = Object.freeze([
  'Étudiant',
  'Pharmacien',
  'Assistant pharmaceutico-technique',
  'Responsable qualité',
  'Responsable formation',
  'Administrateur',
]);
