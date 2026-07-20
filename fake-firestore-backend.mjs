// Backend Firestore SIMULE (en memoire), utilise UNIQUEMENT pour tester
// catalog-sync-engine.js sans connexion Firebase reelle. Implemente
// EXACTEMENT le meme contrat de fonctions que la vraie integration
// production (voir NOTES_INTEGRATION_PRODUCTION.md) - reutilise donc les
// memes conventions (find-or-create par cle normalisee, path/pathLabels
// pour les sections, statut "draft" pour toute creation).
import { normalizeForDedup } from '../js/services/normalization-utils.js';
import { THEME_CODES } from '../js/services/theme-utils.js';

export class FakeFirestoreBackend {
  constructor() {
    this.questions = new Map();           // pedagogicalId -> doc
    this.externalIdIndex = new Map();      // externalId -> pedagogicalId
    this.sources = new Map();              // sourceId -> {id, name, key}
    this.sourcesByKey = new Map();         // normalizedName -> sourceId
    this.sections = new Map();             // sectionId -> {id, documentSourceId, parentSectionId, name, key}
    this.sectionsByKey = new Map();        // sourceId|parentSectionId|normalizedName -> sectionId
    this.competencies = new Map();         // competencyId -> {id, name, key}
    this.competenciesByKey = new Map();    // normalizedName -> competencyId
    this.tags = new Map();                 // tagId -> {id, label}
    this._pedCounters = new Map();         // themeCode -> n
    this._idSeq = 0;
  }

  _nextId(prefix) { this._idSeq++; return prefix + '-' + this._idSeq; }

  // ---- resolveQuestionIdentity ----
  resolveQuestionIdentity = async (externalId) => {
    const pedagogicalId = this.externalIdIndex.get(externalId) || null;
    if (!pedagogicalId) return { found: false, pedagogicalId: null, existingDoc: null };
    return { found: true, pedagogicalId: pedagogicalId, existingDoc: this.questions.get(pedagogicalId) };
  };

  // ---- listExistingEditorialCatalogIds ----
  listExistingEditorialCatalogIds = async () => {
    return new Set(Array.from(this.externalIdIndex.keys()));
  };

  // ---- allocatePedagogicalId ---- (mime le compteur atomique de pedagogical-id-service.js)
  allocatePedagogicalId = async (themeKey) => {
    const code = THEME_CODES[themeKey] || 'GEN';
    const n = (this._pedCounters.get(code) || 0) + 1;
    this._pedCounters.set(code, n);
    return 'PHARM-' + code + '-' + String(n).padStart(6, '0');
  };

  // ---- resolveDocumentReferential ----
  resolveDocumentReferential = async ({ sourceDocument, dryRun, cache }) => {
    const sourceKey = normalizeForDedup(sourceDocument.name);
    let sourceId = cache.sources.get(sourceKey) && cache.sources.get(sourceKey).sourceId;
    let sourceAction = 'existing';
    if (!sourceId) {
      const existing = this.sourcesByKey.get(sourceKey);
      if (existing) {
        sourceId = existing;
      } else {
        sourceAction = 'new';
        sourceId = dryRun ? '(pending:' + sourceKey + ')' : this._nextId('DOCSRC');
        if (!dryRun) { this.sources.set(sourceId, { id: sourceId, name: sourceDocument.name }); this.sourcesByKey.set(sourceKey, sourceId); }
      }
      cache.sources.set(sourceKey, { sourceId: sourceId, action: sourceAction, name: sourceDocument.name });
    }

    const levels = [sourceDocument.level1, sourceDocument.level2, sourceDocument.level3].filter(function(l) { return l && l.trim(); });
    let parentSectionId = null;
    let sectionId = null;
    const sectionActions = [];
    for (const levelName of levels) {
      const sectionCacheKey = sourceKey + '>' + (parentSectionId || 'root') + '>' + normalizeForDedup(levelName);
      let entry = cache.sections.get(sectionCacheKey);
      if (!entry) {
        const storeKey = sourceId + '|' + (parentSectionId || 'root') + '|' + normalizeForDedup(levelName);
        const existingSectionId = this.sectionsByKey.get(storeKey);
        let action = 'existing';
        let newSectionId = existingSectionId;
        if (!existingSectionId) {
          action = 'new';
          newSectionId = dryRun ? '(pending-section:' + storeKey + ')' : this._nextId('DOCSEC');
          if (!dryRun) { this.sections.set(newSectionId, { id: newSectionId, documentSourceId: sourceId, parentSectionId: parentSectionId, name: levelName }); this.sectionsByKey.set(storeKey, newSectionId); }
        }
        entry = { sectionId: newSectionId, action: action, name: levelName };
        cache.sections.set(sectionCacheKey, entry);
      }
      sectionActions.push(entry);
      parentSectionId = entry.sectionId;
      sectionId = entry.sectionId;
    }

    return { sourceId: sourceId, sectionId: sectionId, sourceAction: sourceAction, sectionActions: sectionActions };
  };

  // ---- resolveCompetency ----
  resolveCompetency = async ({ label, dryRun, cache }) => {
    const key = normalizeForDedup(label);
    if (cache.has(key)) return cache.get(key);

    let competencyId = this.competenciesByKey.get(key);
    let action = 'existing';
    if (!competencyId) {
      action = 'new';
      competencyId = dryRun ? '(pending-skill:' + key + ')' : this._nextId('SKILL');
      if (!dryRun) { this.competencies.set(competencyId, { id: competencyId, name: label }); this.competenciesByKey.set(key, competencyId); }
    }
    const result = { competencyId: competencyId, action: action, label: label, key: key };
    cache.set(key, result);
    return result;
  };

  // ---- resolveTags ----
  resolveTags = async ({ tags, dryRun, cache }) => {
    const tagIds = [];
    const created = [];
    for (const rawTag of tags) {
      const key = normalizeForDedup(rawTag);
      let entry = cache.get(key);
      if (!entry) {
        let existed = this.tags.has(key);
        if (!existed && !dryRun) { this.tags.set(key, { id: key, label: rawTag }); }
        entry = { tagId: key, action: existed ? 'existing' : 'new', label: rawTag, key: key };
        cache.set(key, entry);
        if (entry.action === 'new') created.push(entry);
      }
      tagIds.push(entry.tagId);
    }
    return { tagIds: tagIds, created: created };
  };

  // ---- writeQuestionsChunk ----
  writeQuestionsChunk = async (docsByPedagogicalId) => {
    docsByPedagogicalId.forEach((doc, pedagogicalId) => {
      this.questions.set(pedagogicalId, doc);
      this.externalIdIndex.set(doc.externalIds.editorialCatalog, pedagogicalId);
    });
    return { success: true, writtenCount: docsByPedagogicalId.size };
  };
}
