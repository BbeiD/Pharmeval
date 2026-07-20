// ===================== INTERFACE CatalogConnector (Sprint 21) =====================
// Contrat COMMUN a toute source d'entree d'un catalogue editorial. "Le
// concept metier n'est pas 'Importer un Excel', c'est 'Synchroniser un
// catalogue editorial'. Aujourd'hui ce catalogue est un Excel. Demain il
// pourrait etre un Google Sheets, une API, un export Claude, un outil
// interne." (cadrage Sprint 21) - CatalogSyncEngine ne parle JAMAIS
// directement a un fichier Excel : il parle a un CatalogConnector.
//
// RESPONSABILITE STRICTE d'un connecteur : traduire sa source specifique
// vers le MODELE CANONIQUE ci-dessous. Un connecteur :
//   - N'EFFECTUE AUCUN APPEL FIRESTORE (aucune lecture, aucune ecriture) ;
//   - N'ASSIGNE JAMAIS de pedagogicalId (resolu plus tard par le moteur,
//     voir pedagogical-id-service.js - necessite Firestore) ;
//   - Ne fusionne, ne deduplique et ne cree jamais de referentiel
//     (document_sources/sections, competencies, tags) - le connecteur
//     produit du texte brut, le moteur resout les references ;
//   - Reste volontairement "bete" : toute intelligence de synchronisation
//     (diff, idempotence, dedoublonnage) vit dans catalog-sync-engine.js,
//     jamais ici.
//
// MODELE CANONIQUE produit par load() - directement compatible avec
// IMPORT_FORMAT.md schemaVersion "1.1" (extension additive de "1.0",
// aucun champ retire ni renomme - voir CANONICAL_SCHEMA_VERSION) :
//
// {
//   schemaVersion: "1.1",
//   generator: string,
//   generatedAt: string (ISO 8601),
//   questions: Array<{
//     // ---- Champs 1.0 (inchanges) ----
//     pedagogicalId: null,                 // jamais assigne par un connecteur
//     domain: string, theme: string, subtheme: string,
//     difficulty: string, questionType: "single-choice",
//     question: string, answers: Array<string>, correctAnswer: number,
//     explanation: string, source: (string|null), tags: Array<string>,
//     status: "draft",
//     // ---- Champs additifs 1.1 ----
//     externalIds: { editorialCatalog: string },
//     sourceDocument: { name: string, level1: string, level2: string, level3: string, preciseReference: string },
//     primaryCompetency: { label: string } | null,
//     pendingResourceRefs: Array<string>,  // architecture seule (voir Sprint 21, "Ressources pedagogiques") - non traite ce sprint
//   }>
// }

export const CANONICAL_SCHEMA_VERSION = '1.1';

/**
 * @typedef {object} ConnectorRowError
 * @property {string} rowRef - reference lisible de la ligne en erreur (ex. "Ligne 42" ou l'identifiant editorial si connu)
 * @property {string} message
 */

/**
 * @typedef {object} ConnectorLoadResult
 * @property {boolean} success - false si la source elle-meme est illisible (fichier corrompu, colonnes obligatoires absentes...)
 * @property {Array<ConnectorRowError>} fatalErrors - erreurs bloquant l'ENSEMBLE du chargement (aucune question produite)
 * @property {Array<ConnectorRowError>} rowErrors - erreurs LOCALES a une ligne (les autres lignes valides sont quand meme produites)
 * @property {object|null} catalog - le modele canonique (voir ci-dessus), ou null si success=false
 */

/**
 * Classe de base abstraite. Un connecteur concret (ExcelCatalogConnector,
 * et demain GoogleSheetsCatalogConnector, ApiCatalogConnector...) etend
 * cette classe et implemente load(). Volontairement minimale : ce n'est
 * qu'un contrat, aucune logique partagee non triviale ici (voir
 * canonical-question-factory.js pour les helpers reellement partages).
 */
export class CatalogConnector {
  /**
   * @param {*} input - specifique au connecteur (ex. un objet File pour Excel)
   * @returns {Promise<ConnectorLoadResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async load(input) {
    throw new Error('CatalogConnector.load() doit etre implemente par le connecteur concret.');
  }

  /** @returns {string} identifiant technique court du connecteur (ex. "excel"), utilise pour le champ `generator` et les logs. */
  get connectorId() {
    throw new Error('CatalogConnector.connectorId doit etre implemente par le connecteur concret.');
  }
}
