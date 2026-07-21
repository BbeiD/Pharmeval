// ===================== CABLAGE DU MOTEUR (Sprint 21 phase 3 -> Sprint 22) =====================
// Point d'assemblage UNIQUE de CatalogSyncEngine avec ses dependances.
// "L'interface ne doit pas contenir la logique metier du moteur" (cadrage) -
// ce fichier NON PLUS : il ne fait qu'injecter des dependances deja
// existantes dans le moteur, sans ajouter de regle metier ici.
//
// SPRINT 22 : le backend REEL (js/services/catalog-sync-firestore-
// backend.js) remplace desormais FakeFirestoreBackend PAR DEFAUT. Le
// backend de demonstration reste disponible mais doit desormais etre
// fourni EXPLICITEMENT (utilise par les tests, voir tests/test-catalog-
// sync-*.mjs) - jamais plus le comportement implicite en production.
//
// GARDE-FOU CONSERVE (correctif "boucle infinie de controle d'acces") :
// ce fichier n'importe toujours aucune dependance de PRODUCTION vers un
// fichier de TEST.

import { CatalogSyncEngine } from "../js/services/catalog-sync-engine.js";
import { validateImportPayload } from "../js/services/question-import-validator.js";
import * as FirestoreBackend from "../js/services/catalog-sync-firestore-backend.js";

/**
 * @param {object} [backend] - injectable pour les tests (ex.
 *   `new FakeFirestoreBackend()`). Par defaut (aucun argument, usage
 *   normal en production) : le VRAI backend Firestore (Sprint 22) - plus
 *   aucune ecriture simulee par defaut.
 */
export function createCatalogSyncEngine(backend) {
  const isRealBackend = !backend;
  const b = backend || FirestoreBackend;

  // Reinitialise les caches de LECTURE du backend reel avant CHAQUE
  // synchronisation (analyze() + synchronize() sont deux appels
  // separes de ce meme backend partage au niveau du module) - sans quoi
  // une source/competence creee par la synchronisation precedente ne
  // serait relue qu'a la prochaine ouverture de page. Sans effet sur un
  // backend de test qui n'expose pas cette fonction (ex. FakeFirestoreBackend).
  if (isRealBackend && typeof b.resetAllReadCaches === 'function') {
    b.resetAllReadCaches();
  }

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
      onChunkWritten: b.onChunkWritten, // absente sur un backend de test -> aucun effet (voir catalog-sync-engine.js)
    }),
    backend: b,
    isDemoBackend: !isRealBackend, // true UNIQUEMENT si un backend explicite (ex. demo) a ete fourni
  };
}
