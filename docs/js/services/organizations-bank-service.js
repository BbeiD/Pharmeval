// ===================== BANQUE DES ORGANISATIONS (Sprint 14) =====================
// SPRINT14 : "L'utilisateur est rattaché à une organisation existante. Ne
// pas recréer les organisations. Utiliser la banque créée lors du Sprint
// précédent."
//
// NOTE DE TRANSPARENCE IMPORTANTE : contrairement à ce que cette consigne
// suppose, AUCUNE banque d'organisations n'existait réellement dans le code
// livré à l'issue du Sprint 13 (RAPPORT_SPRINT13.md ne mentionne aucune
// collection `organizations` ; seule l'assistant de première connexion,
// js/services/user-service.js, capture un nom d'organisation en TEXTE LIBRE
// dans `profile.organizationName`, non structuré et non réutilisable). La
// mention "Gestion des organisations" dans le texte de cadrage du Sprint 13
// décrivait une intention de produit, pas un module réellement livré.
//
// Ce fichier crée donc cette banque MAINTENANT, en préalable indispensable
// au module Utilisateurs de ce sprint - signalé ici plutôt que corrigé
// silencieusement (voir RAPPORT_SPRINT14.md, section "Écart constaté").
//
// Reutilise le nouveau service generique (Sprint 14,
// reference-bank-service.js) plutot que de dupliquer le pattern
// competency-*-service.js une quatrieme fois.

import { createReferenceBankService } from "./reference-bank-service.js";
import { PERMISSIONS } from "./authorization-service.js";

// REUTILISE la liste de types d'organisation deja definie pour l'assistant
// de premiere connexion (Sprint 2, user-service.js) - jamais une nouvelle
// liste parallele.
export { ORGANIZATION_TYPE_OPTIONS } from "./user-service.js";

export const organizationsBank = createReferenceBankService({
  bankType: 'organization',
  collectionName: 'organizations',
  idPrefix: 'ORG',
  managePermission: PERMISSIONS.MANAGE_REFERENCE_DATA,
  purgePermission: PERMISSIONS.PURGE_REFERENCE_DATA,
  labelSingular: 'organisation',
  extraFields: ['organizationType'], // valeur de ORGANIZATION_TYPE_OPTIONS, texte libre non validé ici (validation faite côté interface via la liste fermée déjà existante)
});
