// ===================== CABLAGE DU MOTEUR (Sprint 21, phase 3) =====================
// Point d'assemblage UNIQUE de CatalogSyncEngine avec ses dependances.
// "L'interface ne doit pas contenir la logique metier du moteur" (cadrage) -
// ce fichier NON PLUS : il ne fait qu'injecter des dependances deja
// existantes dans le moteur, sans ajouter de regle metier ici.
//
// CORRECTIF (suite au signalement "boucle infinie de controle d'acces") :
// ce fichier importait auparavant depuis ../tests/fake-firestore-
// backend.mjs - une dependance de PRODUCTION vers un fichier de TEST,
// potentiellement absent d'un hebergement reel (voir js/services/catalog-
// sync-demo-backend.js pour le detail). Corrige : le backend de
// demonstration vit desormais dans js/services/, aux cotes du reste du
// code reellement deploye.
//
// ETAT ACTUEL (phase 3, a corriger au Sprint 22 - voir
// NOTES_INTEGRATION_PRODUCTION.md) : les dependances Firestore reelles
// n'ont pas encore ete cablees sur de vrais services Firestore - seul
// writeQuestionsBatch (deja existant, question-catalog-service.js) serait
// directement reutilisable sans travail supplementaire. Ce fichier
// utilise donc, EXPLICITEMENT et visiblement (voir bandeau #cs-demo-
// banner dans catalog-sync.html), le MEME backend simule que les tests -
// jamais un Firestore reel tant que le Sprint 22 n'a pas fait ce cablage.

import { CatalogSyncEngine } from "../js/services/catalog-sync-engine.js";
import { validateImportPayload } from "../js/services/question-import-validator.js";
import { FakeFirestoreBackend } from "../js/services/catalog-sync-demo-backend.js";

/**
 * @param {object} [backend] - injectable pour les tests ; par defaut, une
 *   instance de demonstration PERSISTANTE POUR LA DUREE DE LA SESSION DE
 *   PAGE (perdue au rechargement - comportement normal d'un mode
 *   demonstration, jamais presente comme une persistance reelle).
 */
export function createCatalogSyncEngine(backend) {
  const b = backend || new FakeFirestoreBackend();
  return {
    engine: new CatalogSyncEngine({
      validateImportPayload: validateImportPayload,
      resolveQuestionIdentity: b.resolveQuestionIdentity,
      listExistingEditorialCatalogIds: b.listExistingEditorialCatalogIds,
      allocatePedagogicalId: b.allocatePedagogicalId,
      resolveDocumentReferential: b.resolveDocumentReferential,
      resolveCompetency: b.resolveCompetency,
      resolveTags: b.resolveTags,
      writeQuestionsChunk: b.writeQuestionsChunk,
    }),
    backend: b,
    isDemoBackend: !backend, // true si aucun backend explicite n'a ete fourni (donc: pas encore branche sur Firestore reel)
  };
}
