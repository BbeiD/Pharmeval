// ===================== CatalogSyncEngine (Sprint 21) =====================
// Pilote le workflow COMPLET de synchronisation d'un catalogue editorial
// vers Pharmeval : charger (via un CatalogConnector), valider (services
// existants reutilises tels quels), resoudre l'identite/les referentiels/
// les competences/les tags, comparer a l'existant Firestore, produire un
// rapport d'analyse, puis - apres confirmation explicite - synchroniser
// reellement.
//
// "Le moteur ne doit contenir aucune logique specifique à Excel et ne
// doit dependre que de l'interface CatalogConnector." (cadrage) : ce
// fichier n'importe JAMAIS excel-catalog-connector.js ni aucune
// bibliotheque de lecture de tableur - il ne connait que la forme
// CatalogConnector.load() -> modele canonique (voir catalog-connector.js).
//
// TOUTES LES DEPENDANCES FIRESTORE SONT INJECTEES (voir constructeur) -
// ce fichier lui-meme n'importe ni firebase-config.js ni le SDK Firestore.
// Cela permet : (a) de reutiliser tel quel les services Firestore reels en
// production, (b) de tester integralement l'orchestration avec des
// dependances simulees, sans jamais dupliquer la logique metier entre les
// deux usages (cadrage : "reutilise imperativement les services
// existants").
//
// DEUX ETAPES DISTINCTES, comme demande, MEME PRINCIPE que
// import-service.js (Sprint 10) deja existant :
//   1. analyze()      : ne modifie JAMAIS Firestore. Lectures seules.
//   2. synchronize()  : ecrit reellement (sauf options.dryRun).

import { normalizeForDedup } from "./normalization-utils.js";

const MAX_QUESTIONS_PER_WRITE_CHUNK = 500; // meme limite que question-import-validator.js (MAX_QUESTIONS_PER_IMPORT) - jamais dupliquee en dur ailleurs sans cette meme valeur

const CONTENT_FIELDS = Object.freeze([
  'question', 'answers', 'correctAnswer', 'explanation',
  'difficulty', 'domain', 'theme', 'subtheme',
  'documentSourceId', 'documentSectionId', 'competencyId',
]);

function stableStringify(value) {
  // Comparaison de contenu insensible a l'ordre des cles d'un objet, mais
  // PAS a l'ordre des elements d'un tableau (answers/tags : l'ordre est
  // significatif, notamment `answers` dont `correctAnswer` est un index).
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + stableStringify(value[k]); }).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * Compare deux "questions resolues" (voir buildResolvedQuestion) sur les
 * seuls champs GERES par ce moteur (CONTENT_FIELDS + tags triés). Ignore
 * tout autre champ existant sur le document Firestore (createdAt, author,
 * functionalCode, version...) - ce moteur ne pretend jamais posseder des
 * champs qu'il n'a pas ecrits lui-meme.
 * @returns {boolean} true si un ecart de contenu existe (= mise a jour necessaire)
 */
function hasContentDifference(resolved, existingDoc) {
  if (!existingDoc) return true; // securite : ne devrait jamais arriver ici (voir appelant)
  for (const field of CONTENT_FIELDS) {
    if (stableStringify(resolved[field]) !== stableStringify(existingDoc[field])) return true;
  }
  const sortedNew = (resolved.tagIds || []).slice().sort();
  const sortedOld = (existingDoc.tagIds || []).slice().sort();
  if (stableStringify(sortedNew) !== stableStringify(sortedOld)) return true;
  return false;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export class CatalogSyncEngine {
  /**
   * @param {object} deps
   * @param {function(object):{valid:boolean, errors:Array<object>}} deps.validateImportPayload
   *   - REUTILISE TEL QUEL question-import-validator.js (schemaVersion "1.1").
   * @param {function(string):Promise<{found:boolean, pedagogicalId:(string|null), existingDoc:(object|null)}>} deps.resolveQuestionIdentity
   *   - lecture seule (voir identity-resolution.js).
   * @param {function():Promise<Set<string>>} deps.listExistingEditorialCatalogIds
   *   - tous les externalIds.editorialCatalog actuellement dans Firestore
   *     (questions issues d'UNE synchronisation precedente - jamais les
   *     questions historiques codees en dur, hors perimetre - voir point 8).
   * @param {function(string):Promise<string>} deps.allocatePedagogicalId
   *   - alloue un NOUVEL identifiant pedagogique (compteur atomique). Doit
   *     etre appele UNIQUEMENT dans synchronize() (jamais analyze() - un
   *     compteur Firestore incremente est une ECRITURE).
   * @param {function({sourceDocument:object, dryRun:boolean, cache:object}):Promise<object>} deps.resolveDocumentReferential
   * @param {function({label:string, dryRun:boolean, cache:object}):Promise<object>} deps.resolveCompetency
   * @param {function({tags:Array<string>, dryRun:boolean, cache:object}):Promise<object>} deps.resolveTags
   * @param {function(Map<string,object>):Promise<{success:boolean, writtenCount:number}>} deps.writeQuestionsChunk
   * @param {function():string} [deps.now] - injectable pour des tests deterministes
   */
  constructor(deps) {
    this._d = deps;
    this._now = deps.now || function() { return new Date().toISOString(); };
  }

  /**
   * ETAPE 1 : analyse - N'ECRIT JAMAIS DANS FIRESTORE.
   * @param {import("./connectors/catalog-connector.js").CatalogConnector} connector
   * @param {*} connectorInput
   * @returns {Promise<object>} AnalysisReport (voir structure ci-dessous)
   */
  async analyze(connector, connectorInput) {
    const startedAt = Date.now();
    const loadResult = await connector.load(connectorInput);

    if (!loadResult.success) {
      return {
        success: false,
        connectorId: connector.connectorId,
        fatalErrors: loadResult.fatalErrors,
        rowErrors: loadResult.rowErrors,
        analysis: null,
        durationMs: Date.now() - startedAt,
      };
    }

    // Validation par lots de <= 500 (meme limite d'atomicite que
    // question-import-validator.js, MAX_QUESTIONS_PER_IMPORT - reutilisee
    // TELLE QUELLE, jamais redefinie ici). Un catalogue de 760 questions
    // produit donc 2 lots pour la validation ET pour l'ecriture ulterieure
    // - c'est le MEME decoupage, construit une seule fois ci-dessous.
    const questions = loadResult.catalog.questions;
    const chunks = chunkArray(questions, MAX_QUESTIONS_PER_WRITE_CHUNK);

    const validationErrors = [];
    chunks.forEach(function(chunk, chunkIndex) {
      // On valide un "sous-fichier" par lot, avec un pedagogicalId
      // provisoire syntaxiquement valide (le vrai sera alloue a la
      // synchronisation - voir resolveQuestionIdentity plus bas) pour ne
      // pas dupliquer ici les regles deja portees par le validateur
      // (format PHARM-XXX-000000).
      const provisional = {
        schemaVersion: '1.1', generator: loadResult.catalog.generator, generatedAt: loadResult.catalog.generatedAt,
        questions: chunk.map(function(q, rowIndex) {
          return Object.assign({}, q, { pedagogicalId: 'PHARM-TMP-' + String(chunkIndex).padStart(2, '0') + String(rowIndex).padStart(4, '0') });
        }),
      };
      const result = this._d.validateImportPayload(provisional);
      if (!result.valid) {
        result.errors.forEach(function(e) {
          validationErrors.push(Object.assign({}, e, { chunkIndex: chunkIndex }));
        });
      }
    }, this);

    if (validationErrors.length > 0) {
      return {
        success: false,
        connectorId: connector.connectorId,
        fatalErrors: [],
        rowErrors: loadResult.rowErrors,
        validationErrors: validationErrors,
        analysis: null,
        durationMs: Date.now() - startedAt,
      };
    }

    // ---- Resolution d'identite, referentiels, competences, tags (LECTURE SEULE) ----
    const referentialCache = { sources: new Map(), sections: new Map() };
    const competencyCache = new Map();
    const tagCache = new Map();

    const currentExternalIds = new Set();
    const questionActions = [];
    const idCorrespondence = [];

    for (const q of questions) {
      const externalId = q.externalIds.editorialCatalog;
      currentExternalIds.add(externalId);

      const identity = await this._d.resolveQuestionIdentity(externalId);

      const referential = q.sourceDocument && q.sourceDocument.name
        ? await this._d.resolveDocumentReferential({ sourceDocument: q.sourceDocument, dryRun: true, cache: referentialCache })
        : { sourceId: null, sectionId: null, sourceAction: 'none', sectionActions: [] };

      const competency = q.primaryCompetency
        ? await this._d.resolveCompetency({ label: q.primaryCompetency.label, dryRun: true, cache: competencyCache })
        : { competencyId: null, action: 'none', potentialDuplicates: [] };

      const tagsResolution = await this._d.resolveTags({ tags: q.tags, dryRun: true, cache: tagCache });

      const resolved = {
        domain: q.domain, theme: q.theme, subtheme: q.subtheme,
        difficulty: q.difficulty, questionType: q.questionType,
        question: q.question, answers: q.answers, correctAnswer: q.correctAnswer, explanation: q.explanation,
        documentSourceId: referential.sourceId, documentSectionId: referential.sectionId,
        competencyId: competency.competencyId,
        tagIds: tagsResolution.tagIds,
      };

      let action;
      if (!identity.found) {
        action = 'create';
      } else if (hasContentDifference(resolved, identity.existingDoc)) {
        action = 'update';
      } else {
        action = 'unchanged';
      }

      questionActions.push({
        externalId: externalId,
        pedagogicalId: identity.found ? identity.pedagogicalId : null, // alloue seulement a la synchronisation si null
        action: action,
        resolved: resolved,
        primaryCompetencyLabel: q.primaryCompetency ? q.primaryCompetency.label : null,
        tags: q.tags,
        sourceDocument: q.sourceDocument,
        pendingResourceRefs: q.pendingResourceRefs,
        competencyPlan: competency,
        referentialPlan: referential,
        tagsPlan: tagsResolution,
      });

      idCorrespondence.push({
        editorialId: externalId,
        pedagogicalId: identity.found ? identity.pedagogicalId : '(à générer)',
        action: action,
      });
    }

    // ---- Detection des questions Firestore absentes du catalogue (point 8 : signalees, jamais supprimees/archivees ce sprint) ----
    const existingIds = await this._d.listExistingEditorialCatalogIds();
    const archivedCandidates = [];
    existingIds.forEach(function(id) {
      if (!currentExternalIds.has(id)) archivedCandidates.push(id);
    });

    // ---- Agregation des plans referentiel/competence/tag (dedoublonnage deja effectue par le cache pendant la boucle ci-dessus) ----
    const competencyPlanSummary = Array.from(competencyCache.values());
    const tagPlanSummary = Array.from(tagCache.values());
    const sourcePlanSummary = Array.from(referentialCache.sources.values());
    const sectionPlanSummary = Array.from(referentialCache.sections.values());

    const counts = {
      totalQuestions: questions.length,
      toCreate: questionActions.filter(function(a) { return a.action === 'create'; }).length,
      toUpdate: questionActions.filter(function(a) { return a.action === 'update'; }).length,
      unchanged: questionActions.filter(function(a) { return a.action === 'unchanged'; }).length,
      archivedCandidates: archivedCandidates.length,
      competenciesToCreate: competencyPlanSummary.filter(function(c) { return c.action === 'new'; }).length,
      competenciesReused: competencyPlanSummary.filter(function(c) { return c.action === 'existing'; }).length,
      tagsToCreate: tagPlanSummary.filter(function(t) { return t.action === 'new'; }).length,
      tagsReused: tagPlanSummary.filter(function(t) { return t.action === 'existing'; }).length,
      sourcesToCreate: sourcePlanSummary.filter(function(s) { return s.action === 'new'; }).length,
      sourcesReused: sourcePlanSummary.filter(function(s) { return s.action === 'existing'; }).length,
      sectionsToCreate: sectionPlanSummary.filter(function(s) { return s.action === 'new'; }).length,
      sectionsReused: sectionPlanSummary.filter(function(s) { return s.action === 'existing'; }).length,
    };

    return {
      success: true,
      connectorId: connector.connectorId,
      fatalErrors: [],
      rowErrors: loadResult.rowErrors,
      validationErrors: [],
      durationMs: Date.now() - startedAt,
      analysis: {
        counts: counts,
        questionActions: questionActions,
        archivedCandidates: archivedCandidates,
        idCorrespondence: idCorrespondence,
        competencyPlan: competencyPlanSummary,
        tagPlan: tagPlanSummary,
        sourcePlan: sourcePlanSummary,
        sectionPlan: sectionPlanSummary,
        chunkCount: chunks.length,
        generatedAt: this._now(),
      },
    };
  }

  /**
   * ETAPE 2 : synchronisation reelle - N'ECRIT QUE SI options.dryRun !== true.
   * Doit etre appelee avec le resultat DE analyze() (jamais reconstruite a
   * la main) - defense en profondeur similaire a commitImport() qui
   * revalide independamment.
   * @param {object} analysisReport - le resultat de analyze()
   * @param {{dryRun?:boolean}} [options]
   * @returns {Promise<object>} SyncReport
   */
  async synchronize(analysisReport, options) {
    const startedAt = Date.now();
    const dryRun = !!(options && options.dryRun);

    if (!analysisReport || !analysisReport.success || !analysisReport.analysis) {
      return { success: false, message: 'Impossible de synchroniser un rapport d\'analyse invalide ou en erreur.', report: null, durationMs: 0 };
    }

    const referentialCache = { sources: new Map(), sections: new Map() };
    const competencyCache = new Map();
    const tagCache = new Map();
    const createdTags = [];

    const resolvedQuestions = [];
    for (const qa of analysisReport.analysis.questionActions) {
      if (qa.action === 'unchanged') { resolvedQuestions.push(qa); continue; }

      const referential = qa.sourceDocument && qa.sourceDocument.name
        ? await this._d.resolveDocumentReferential({ sourceDocument: qa.sourceDocument, dryRun: dryRun, cache: referentialCache })
        : { sourceId: null, sectionId: null, sourceAction: 'none', sectionActions: [] };

      const competency = qa.primaryCompetencyLabel
        ? await this._d.resolveCompetency({ label: qa.primaryCompetencyLabel, dryRun: dryRun, cache: competencyCache })
        : { competencyId: null, action: 'none' };

      const tagsResolution = await this._d.resolveTags({ tags: qa.tags, dryRun: dryRun, cache: tagCache });
      (tagsResolution.created || []).forEach(function(t) { createdTags.push(t); });

      let pedagogicalId = qa.pedagogicalId;
      if (!pedagogicalId) {
        pedagogicalId = dryRun ? '(simulé)' : await this._d.allocatePedagogicalId(qa.resolved.theme);
      }

      resolvedQuestions.push(Object.assign({}, qa, {
        pedagogicalId: pedagogicalId,
        resolved: Object.assign({}, qa.resolved, {
          documentSourceId: referential.sourceId,
          documentSectionId: referential.sectionId,
          competencyId: competency.competencyId,
          tagIds: tagsResolution.tagIds,
        }),
      }));
    }

    // Comptage des CREATIONS DE REFERENTIELS : derive DES CACHES (une
    // entree par cle normalisee UNIQUE), jamais accumule question par
    // question - plusieurs questions partageant la meme competence/source
    // ne doivent JAMAIS faire compter plusieurs creations pour UNE seule
    // entite reellement creee (c'est precisement le dedoublonnage demande).
    const createdCompetencies = Array.from(competencyCache.values()).filter(function(c) { return c.action === 'new'; });
    const createdSources = Array.from(referentialCache.sources.values()).filter(function(s) { return s.action === 'new'; });
    const createdSections = Array.from(referentialCache.sections.values()).filter(function(s) { return s.action === 'new'; });

    const toWrite = resolvedQuestions.filter(function(qa) { return qa.action === 'create' || qa.action === 'update'; });
    const chunks = chunkArray(toWrite, MAX_QUESTIONS_PER_WRITE_CHUNK);

    let createdCount = 0, updatedCount = 0, chunkResults = [];
    if (!dryRun) {
      for (const chunk of chunks) {
        const docsByPedagogicalId = new Map();
        chunk.forEach((qa) => {
          docsByPedagogicalId.set(qa.pedagogicalId, {
            pedagogicalId: qa.pedagogicalId,
            domain: qa.resolved.domain, theme: qa.resolved.theme, subtheme: qa.resolved.subtheme,
            difficulty: qa.resolved.difficulty, questionType: qa.resolved.questionType,
            question: qa.resolved.question, answers: qa.resolved.answers,
            correctAnswer: qa.resolved.correctAnswer, explanation: qa.resolved.explanation,
            status: 'draft', // JAMAIS publie automatiquement, meme en mise a jour (meme regle non negociable qu'import-service.js)
            documentSourceId: qa.resolved.documentSourceId, documentSectionId: qa.resolved.documentSectionId,
            competencyId: qa.resolved.competencyId,
            tagIds: qa.resolved.tagIds,
            externalIds: { editorialCatalog: qa.externalId },
            fromEditorialCatalog: true,
            pendingResourceRefs: qa.pendingResourceRefs,
            updatedAt: this._now(),
          });
        });
        const writeResult = await this._d.writeQuestionsChunk(docsByPedagogicalId);
        chunkResults.push({ size: chunk.length, success: writeResult.success });
        if (writeResult.success) {
          chunk.forEach(function(qa) { if (qa.action === 'create') createdCount++; else updatedCount++; });
        }
      }
    }

    const archived = analysisReport.analysis.archivedCandidates.slice(); // JAMAIS traite ce sprint (point 8) - uniquement reporte

    return {
      success: true,
      dryRun: dryRun,
      durationMs: Date.now() - startedAt,
      report: {
        questionsCreated: dryRun ? analysisReport.analysis.counts.toCreate : createdCount,
        questionsUpdated: dryRun ? analysisReport.analysis.counts.toUpdate : updatedCount,
        questionsUnchanged: analysisReport.analysis.counts.unchanged,
        questionsArchivedCandidates: archived.length,
        questionsArchivedOrDeleted: 0, // toujours 0 ce sprint - voir point 8
        competenciesCreated: createdCompetencies.length,
        tagsCreated: createdTags.length,
        sourcesCreated: createdSources.length,
        sectionsCreated: createdSections.length,
        chunkResults: chunkResults,
        idCorrespondence: resolvedQuestions.map(function(qa) {
          return { editorialId: qa.externalId, pedagogicalId: qa.pedagogicalId, action: qa.action };
        }),
        archivedCandidates: archived,
        generatedAt: this._now(),
      },
    };
  }
}
