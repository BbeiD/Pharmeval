// ===================== ExcelCatalogConnector (Sprint 21) =====================
// Implementation CONCRETE de CatalogConnector pour un Catalogue Editorial
// au format Excel (Catalogue_Pharmeval.xlsx, colonnes A-R - voir
// Rapport_Export_Catalogue_QCM.md). SEUL fichier du projet a savoir lire
// un classeur Excel - toute autre partie du moteur (catalog-sync-engine.js)
// ne manipule que le modele canonique produit par load().
//
// Bibliotheque de lecture : SheetJS (`XLSX`). Cote navigateur, chargee via
// CDN dans admin/catalog-sync.html (voir Charte Developpement : "pas de
// bundler, chemins relatifs uniquement" - un <script> CDN, comme
// tabler-icons dans le reste de l'app, respecte cette contrainte). Cote
// Node (tests, scripts d'administration), le meme code fonctionne avec le
// paquet npm `xlsx` (meme API `XLSX.read`) - injecte au constructeur pour
// ne jamais coder en dur une dependance a l'un ou l'autre environnement.

import { CatalogConnector } from "./catalog-connector.js";
import { deriveTaxonomyFromLegacyId, parseEditorialCatalogId } from "./legacy-id-utils.js";
import { answerLetterToIndex, buildNonEmptyAnswerList, splitTagsCell, buildCanonicalQuestion } from "./canonical-question-factory.js";

/** Colonnes attendues, dans l'ordre exact A-R (voir Rapport_Export_Catalogue_QCM.md). */
export const EXPECTED_HEADERS = [
  'Question ID', 'Statut', 'Question', 'Réponse A', 'Réponse B', 'Réponse C', 'Réponse D',
  'Bonne réponse', 'Justification', 'Source documentaire', 'Niveau 1', 'Niveau 2', 'Niveau 3',
  'Compétence principale', 'Tags', 'Difficulté', 'Pièces jointes pédagogiques', 'Référence documentaire précise',
];

const SHEET_NAME_CANDIDATES = ['Catalogue'];

function cell(row, key) {
  const v = row[key];
  return (v === undefined || v === null) ? '' : v.toString();
}

export class ExcelCatalogConnector extends CatalogConnector {
  /**
   * @param {object} [xlsxLib] - l'objet `XLSX` (SheetJS). Si omis, tente
   *   d'utiliser la variable globale `XLSX` (cas navigateur, script CDN
   *   deja charge par admin/catalog-sync.html).
   */
  constructor(xlsxLib) {
    super();
    this._xlsx = xlsxLib || (typeof globalThis !== 'undefined' ? globalThis.XLSX : null);
  }

  get connectorId() { return 'excel'; }

  /**
   * @param {{arrayBuffer?:ArrayBuffer, buffer?:Uint8Array, fileName?:string}} input
   *   - `arrayBuffer` : cas navigateur (`await file.arrayBuffer()`).
   *   - `buffer` : cas Node (`fs.readFileSync(path)`).
   * @returns {Promise<import("./catalog-connector.js").ConnectorLoadResult>}
   */
  async load(input) {
    const fatalErrors = [];
    const rowErrors = [];

    if (!this._xlsx) {
      return { success: false, fatalErrors: [{ rowRef: 'fichier', message: 'Bibliothèque XLSX (SheetJS) indisponible — impossible de lire le classeur.' }], rowErrors: [], catalog: null };
    }
    if (!input || (!input.arrayBuffer && !input.buffer)) {
      return { success: false, fatalErrors: [{ rowRef: 'fichier', message: 'Aucun contenu de fichier fourni au connecteur Excel.' }], rowErrors: [], catalog: null };
    }

    let workbook;
    try {
      const data = input.arrayBuffer ? new Uint8Array(input.arrayBuffer) : input.buffer;
      workbook = this._xlsx.read(data, { type: 'array' });
    } catch (err) {
      return { success: false, fatalErrors: [{ rowRef: 'fichier', message: 'Fichier illisible ou format non Excel valide (' + (err && err.message) + ').' }], rowErrors: [], catalog: null };
    }

    const sheetName = SHEET_NAME_CANDIDATES.find(function(n) { return workbook.SheetNames.includes(n); }) || workbook.SheetNames[0];
    if (!sheetName) {
      return { success: false, fatalErrors: [{ rowRef: 'fichier', message: 'Le classeur ne contient aucune feuille.' }], rowErrors: [], catalog: null };
    }
    const sheet = workbook.Sheets[sheetName];
    const rows = this._xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });

    if (rows.length === 0) {
      return { success: false, fatalErrors: [{ rowRef: 'fichier', message: 'Le classeur ne contient aucune ligne de données.' }], rowErrors: [], catalog: null };
    }

    // Verification des colonnes obligatoires - AUCUNE donnee n'est
    // exploitee tant que les 18 en-tetes attendus ne sont pas tous
    // presents (cadrage Sprint 21, "en cas d'erreur, aucune donnee n'est
    // modifiee").
    const actualHeaders = Object.keys(rows[0]);
    const missingHeaders = EXPECTED_HEADERS.filter(function(h) { return !actualHeaders.includes(h); });
    if (missingHeaders.length > 0) {
      return {
        success: false,
        fatalErrors: [{ rowRef: 'fichier', message: 'Colonne(s) obligatoire(s) absente(s) : ' + missingHeaders.join(', ') + '.' }],
        rowErrors: [],
        catalog: null,
      };
    }

    const questions = [];
    const seenIds = new Set();

    rows.forEach(function(row, idx) {
      const excelRowNumber = idx + 2; // +1 pour l'entete, +1 pour un index 1-based
      const editorialId = cell(row, 'Question ID').trim();
      const rowRef = editorialId || ('Ligne ' + excelRowNumber);

      if (!editorialId) {
        rowErrors.push({ rowRef: rowRef, message: 'Question ID vide — ligne ignorée.' });
        return;
      }
      if (seenIds.has(editorialId)) {
        rowErrors.push({ rowRef: rowRef, message: 'Question ID "' + editorialId + '" dupliqué dans le fichier — ligne ignorée.' });
        return;
      }
      seenIds.add(editorialId);

      const taxonomy = deriveTaxonomyFromLegacyId(editorialId);
      if (!taxonomy.valid) {
        rowErrors.push({ rowRef: rowRef, message: taxonomy.message + ' — ligne ignorée.' });
        return;
      }

      const questionText = cell(row, 'Question').trim();
      if (!questionText) {
        rowErrors.push({ rowRef: rowRef, message: 'Question vide — ligne ignorée.' });
        return;
      }

      const rawAnswers = [cell(row, 'Réponse A'), cell(row, 'Réponse B'), cell(row, 'Réponse C'), cell(row, 'Réponse D')];
      const answers = buildNonEmptyAnswerList(rawAnswers);
      if (answers.length < 2) {
        rowErrors.push({ rowRef: rowRef, message: 'Moins de 2 réponses non vides — ligne ignorée.' });
        return;
      }

      const correctLetter = cell(row, 'Bonne réponse').trim();
      const correctIndexInFullList = answerLetterToIndex(correctLetter);
      if (correctIndexInFullList === null || !rawAnswers[correctIndexInFullList] || !rawAnswers[correctIndexInFullList].toString().trim()) {
        rowErrors.push({ rowRef: rowRef, message: 'Bonne réponse "' + correctLetter + '" ne correspond à aucune réponse non vide — ligne ignorée.' });
        return;
      }
      // L'index dans `answers` (liste compactee, sans les cellules vides)
      // peut differer de l'index dans rawAnswers si une reponse
      // intermediaire est vide - on retrouve la BONNE position par la
      // VALEUR, jamais par un recalcul d'index suppose.
      const correctAnswerText = rawAnswers[correctIndexInFullList].toString().trim();
      const correctAnswer = answers.indexOf(correctAnswerText);

      const explanation = cell(row, 'Justification').trim();
      if (!explanation) {
        rowErrors.push({ rowRef: rowRef, message: 'Justification vide — ligne ignorée.' });
        return;
      }

      const difficulty = cell(row, 'Difficulté').trim();
      if (!difficulty) {
        rowErrors.push({ rowRef: rowRef, message: 'Difficulté vide — ligne ignorée.' });
        return;
      }

      const sourceDocument = {
        name: cell(row, 'Source documentaire').trim(),
        level1: cell(row, 'Niveau 1').trim(),
        level2: cell(row, 'Niveau 2').trim(),
        level3: cell(row, 'Niveau 3').trim(),
        preciseReference: cell(row, 'Référence documentaire précise').trim(),
      };

      const primaryCompetencyLabel = cell(row, 'Compétence principale').trim() || null;
      const tags = splitTagsCell(cell(row, 'Tags'));
      const pendingResourceRefs = cell(row, 'Pièces jointes pédagogiques').trim()
        ? cell(row, 'Pièces jointes pédagogiques').split(';').map(function(s) { return s.trim(); }).filter(Boolean)
        : [];

      questions.push(buildCanonicalQuestion({
        domain: taxonomy.domain, theme: taxonomy.theme, subtheme: taxonomy.subtheme,
        difficulty: difficulty,
        question: questionText, answers: answers, correctAnswer: correctAnswer, explanation: explanation,
        sourceDocument: sourceDocument,
        primaryCompetencyLabel: primaryCompetencyLabel,
        tags: tags,
        editorialCatalogId: editorialId,
        pendingResourceRefs: pendingResourceRefs,
      }));
    });

    if (questions.length === 0) {
      return {
        success: false,
        fatalErrors: [{ rowRef: 'fichier', message: 'Aucune question exploitable après validation ligne par ligne (' + rowErrors.length + ' ligne(s) en erreur).' }],
        rowErrors: rowErrors,
        catalog: null,
      };
    }

    return {
      success: true,
      fatalErrors: fatalErrors,
      rowErrors: rowErrors,
      catalog: {
        schemaVersion: '1.1',
        generator: 'CatalogSyncEngine/ExcelCatalogConnector',
        generatedAt: new Date().toISOString(),
        questions: questions,
      },
    };
  }
}
