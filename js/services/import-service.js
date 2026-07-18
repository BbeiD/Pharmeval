// ===================== SERVICE D'IMPORT DE QUESTIONS (ORCHESTRATION) =====================
// Point d'entree UNIQUE pour tout le flux d'import de questions, appele
// exclusivement par admin/import.js. Coordonne :
//   - js/services/question-parser.js            (parsing JSON, construction des documents)
//   - js/services/question-import-validator.js  (validation complete avant toute ecriture)
//   - js/services/question-catalog-service.js   (lecture/ecriture Firestore de `questions`)
//   - js/services/import-log-service.js         (journal des imports)
//   - js/services/authorization-service.js      (controle d'acces : reserve aux administrateurs)
//
// PHILOSOPHIE (rappel) : "Ne jamais faire confiance au fichier importe."
// Ce fichier ne contourne JAMAIS la validation - meme commitImport()
// revalide independamment avant d'ecrire quoi que ce soit, par defense en
// profondeur, au cas ou l'appelant se serait trompe dans l'enchainement
// des etapes.
//
// Deux etapes distinctes, comme demande :
//   1. analyzeImportFile()  : parse + valide + construit un apercu, N'ECRIT JAMAIS.
//   2. commitImport()       : ecrit reellement (sauf en mode simulation).

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { formatThemeLabel } from "./theme-utils.js";
import { parseImportFile, buildQuestionDocument, classifyQuestions } from "./question-parser.js";
import { validateImportPayload } from "./question-import-validator.js";
import { getExistingQuestionsByPedagogicalIds, writeQuestionsBatch } from "./question-catalog-service.js";
import { logImport } from "./import-log-service.js";

function denied(message) {
  return { authorized: false, message: message };
}

/**
 * Verifie que l'utilisateur courant a le droit d'utiliser le moteur
 * d'import (reserve aux administrateurs - voir authorization-service.js,
 * PERMISSIONS.MANAGE_QUESTIONS). Utilisee a la fois par analyzeImportFile
 * et commitImport, independamment de tout controle deja effectue par
 * l'interface (admin/import.js) - defense en profondeur.
 *
 * @returns {{authorized:boolean, message?:string}}
 */
function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    return denied('Vous devez être connecté pour importer des questions.');
  }
  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) {
    return denied('L\'import de questions est réservé aux administrateurs.');
  }
  return { authorized: true };
}

/**
 * Construit l'apercu (compte de questions, repartition par theme et par
 * difficulte, nouvelles questions vs mises a jour) a partir d'un fichier
 * DEJA VALIDE et de la correspondance des questions deja existantes.
 *
 * @param {Array<object>} rawQuestions
 * @param {Map<string,object>} existingByIdMap
 * @returns {object}
 */
function buildPreview(rawQuestions, existingByIdMap) {
  const byTheme = {};
  const byDifficulty = {};
  rawQuestions.forEach(function(q) {
    const themeLabel = formatThemeLabel(q.theme || q.domain);
    byTheme[themeLabel] = (byTheme[themeLabel] || 0) + 1;
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
  });

  const classified = classifyQuestions(rawQuestions, existingByIdMap);

  return {
    totalQuestions: rawQuestions.length,
    byTheme: byTheme,
    byDifficulty: byDifficulty,
    newCount: classified.creations.length,
    updateCount: classified.updates.length,
    newIds: classified.creations.map(function(q) { return q.pedagogicalId; }),
    updateIds: classified.updates.map(function(q) { return q.pedagogicalId; }),
  };
}

/**
 * ETAPE 1 : analyse un fichier d'import - parse, valide integralement,
 * construit un apercu detaille. N'ECRIT JAMAIS RIEN DANS FIRESTORE (une
 * seule lecture, pour distinguer creations/mises a jour dans l'apercu).
 *
 * @param {string} rawText - contenu brut du fichier selectionne
 * @param {{fileName:string}} fileMetadata
 * @returns {Promise<{
 *   authorized: boolean, message?: string,
 *   parseError: (string|null),
 *   valid: boolean,
 *   errors: Array<object>,
 *   preview: (object|null),
 *   payload: (object|null),
 * }>}
 */
export async function analyzeImportFile(rawText, fileMetadata) {
  const access = checkAccess();
  if (!access.authorized) {
    return { authorized: false, message: access.message, parseError: null, valid: false, errors: [], preview: null, payload: null };
  }

  const parsed = parseImportFile(rawText);
  if (!parsed.success) {
    return { authorized: true, parseError: parsed.error, valid: false, errors: [], preview: null, payload: null };
  }

  const validation = validateImportPayload(parsed.data);
  if (!validation.valid) {
    return { authorized: true, parseError: null, valid: false, errors: validation.errors, preview: null, payload: parsed.data };
  }

  const ids = parsed.data.questions.map(function(q) { return q.pedagogicalId; });
  const existing = await getExistingQuestionsByPedagogicalIds(ids);
  if (existing.error) {
    return {
      authorized: true, parseError: null, valid: false,
      errors: [{ scope: 'file', message: 'Impossible de vérifier les questions déjà existantes dans Firestore pour le moment. Réessayez plus tard.' }],
      preview: null, payload: parsed.data,
    };
  }

  const preview = buildPreview(parsed.data.questions, existing.map);

  return {
    authorized: true,
    parseError: null,
    valid: true,
    errors: [],
    preview: preview,
    payload: parsed.data,
  };
}

/**
 * ETAPE 2 : importe reellement les questions (ou simule si
 * options.simulate est vrai). REVALIDE independamment avant d'ecrire quoi
 * que ce soit (defense en profondeur - voir en-tete de fichier). Toutes
 * les questions importees recoivent le statut "draft", sans exception
 * (voir question-parser.js, buildQuestionDocument() pour le detail de
 * cette regle non negociable).
 *
 * @param {object} payload - le JSON valide (tel que retourne par analyzeImportFile)
 * @param {{fileName:string}} fileMetadata
 * @param {{simulate?:boolean}} [options]
 * @returns {Promise<{
 *   authorized: boolean, message?: string,
 *   success: boolean,
 *   simulated: boolean,
 *   createdCount: number, updatedCount: number, errorCount: number,
 *   durationMs: number,
 *   createdIds: Array<string>, updatedIds: Array<string>,
 * }>}
 */
export async function commitImport(payload, fileMetadata, options) {
  const startedAt = Date.now();
  const simulate = !!(options && options.simulate);

  const access = checkAccess();
  if (!access.authorized) {
    return { authorized: false, message: access.message, success: false, simulated: simulate, createdCount: 0, updatedCount: 0, errorCount: 0, durationMs: 0, createdIds: [], updatedIds: [] };
  }

  // Defense en profondeur : revalide independamment de tout appel
  // precedent a analyzeImportFile(). "Aucune ecriture si une erreur est
  // detectee" s'applique meme si l'appelant a, par erreur, transmis un
  // payload jamais valide.
  const validation = validateImportPayload(payload);
  if (!validation.valid) {
    return {
      authorized: true, success: false, simulated: simulate,
      createdCount: 0, updatedCount: 0, errorCount: validation.errors.length,
      durationMs: Date.now() - startedAt, createdIds: [], updatedIds: [],
      errors: validation.errors,
    };
  }

  const ctx = getCurrentUserContext();
  const ids = payload.questions.map(function(q) { return q.pedagogicalId; });
  const existing = await getExistingQuestionsByPedagogicalIds(ids);
  if (existing.error) {
    return {
      authorized: true, success: false, simulated: simulate,
      createdCount: 0, updatedCount: 0, errorCount: 1,
      durationMs: Date.now() - startedAt, createdIds: [], updatedIds: [],
      errors: [{ scope: 'file', message: 'Impossible de vérifier les questions déjà existantes dans Firestore pour le moment. Import annulé.' }],
    };
  }

  const importContext = {
    schemaVersion: payload.schemaVersion,
    generator: payload.generator,
    sourceFile: (fileMetadata && fileMetadata.fileName) || null,
    importedByUid: ctx && ctx.uid,
    importedByEmail: ctx && ctx.email,
  };

  const documentsByPedagogicalId = new Map();
  const createdIds = [];
  const updatedIds = [];
  payload.questions.forEach(function(q) {
    const existingDoc = existing.map.get(q.pedagogicalId) || null;
    const builtDoc = buildQuestionDocument(q, importContext, existingDoc);
    documentsByPedagogicalId.set(q.pedagogicalId, builtDoc);
    if (existingDoc) updatedIds.push(q.pedagogicalId); else createdIds.push(q.pedagogicalId);
  });

  let writeResult = { success: true, writtenCount: documentsByPedagogicalId.size, error: false };
  if (!simulate) {
    writeResult = await writeQuestionsBatch(documentsByPedagogicalId);
  }

  const durationMs = Date.now() - startedAt;

  // Journal de l'import (best effort, jamais bloquant - meme en cas
  // d'echec d'ecriture, on tente de journaliser la tentative).
  logImport({
    adminUid: importContext.importedByUid,
    adminEmail: importContext.importedByEmail,
    fileName: importContext.sourceFile,
    createdCount: writeResult.success ? createdIds.length : 0,
    updatedCount: writeResult.success ? updatedIds.length : 0,
    errorCount: writeResult.success ? 0 : 1,
    durationMs: durationMs,
    simulated: simulate,
    schemaVersion: payload.schemaVersion,
  }).catch(function() { /* deja journalise en console par import-log-service.js */ });

  return {
    authorized: true,
    success: writeResult.success,
    simulated: simulate,
    createdCount: writeResult.success ? createdIds.length : 0,
    updatedCount: writeResult.success ? updatedIds.length : 0,
    errorCount: writeResult.success ? 0 : 1,
    durationMs: durationMs,
    createdIds: writeResult.success ? createdIds : [],
    updatedIds: writeResult.success ? updatedIds : [],
  };
}
