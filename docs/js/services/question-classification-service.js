// ===================== SERVICE DE CLASSIFICATION DOCUMENTAIRE DES QUESTIONS (Sprint 20) =====================
// Responsabilite : rattacher UNE question EXISTANTE (jamais recreee) a
// une source + une section documentaire, et resoudre la destination d'une
// question au moment de l'import (priorite JSON > interface > non
// classee). "La question ne doit pas porter elle-meme toute la
// classification documentaire... elle doit principalement referencer une
// source et une section." (cadrage) - ce service ne fait qu'ecrire ces
// deux references sur la question, jamais recopier les informations de
// la source/section elles-memes.
//
// AUCUNE MODIFICATION DU CONTENU DE LA QUESTION : enonce, propositions,
// bonne(s) reponse(s), justification restent strictement intouches par ce
// service (voir classifyQuestion() ci-dessous : liste explicite des SEULS
// champs modifies).

import { PERMISSIONS, hasPermission } from "./authorization-service.js";
import { getCurrentUserContext } from "./app-context.js";
import { logAction } from "./audit-service.js";
import { getExistingQuestionByPedagogicalId } from "./question-catalog-service.js";
import { getDocumentSourceById } from "./document-source-catalog-service.js";
import { getDocumentSectionById } from "./document-section-catalog-service.js";
import { generateFunctionalCode } from "./question-code-service.js";
import { applyClassificationDelta } from "./document-count-service.js";

function denied(message) { return { status: 'denied', message: message }; }
function success(message, extra) { return Object.assign({ status: 'success', message: message }, extra || {}); }
function errorResult(message) { return { status: 'error', message: message }; }

function checkAccess() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour classer des questions.');
  // "un utilisateur ne peut pas reclasser une question" (cadrage Sprint
  // 20, "Sécurité Firestore") - CORRECTIF (Sprint 20.2) : la
  // classification documentaire rattache une question au catalogue
  // GLOBAL (sources/sections), une action distincte de l'édition du
  // contenu de la question elle-même (MANAGE_QUESTIONS) - voir
  // "Administration et permissions" du cadrage 20.2.
  if (!hasPermission(PERMISSIONS.MANAGE_GLOBAL_CATALOG)) return denied('La classification documentaire est réservée aux administrateurs du catalogue global.');
  return { status: 'authorized' };
}

/**
 * Vérifie qu'une section appartient bien à la source déclarée (défense en
 * profondeur, en plus des règles Firestore).
 * @param {string} documentSourceId
 * @param {string|null} documentSectionId
 * @returns {Promise<{valid:boolean, message?:string, source?:object, section?:object}>}
 */
async function validateDestination(documentSourceId, documentSectionId) {
  const source = await getDocumentSourceById(documentSourceId);
  if (!source) return { valid: false, message: 'Source documentaire introuvable.' };
  if (source.status === 'archived') return { valid: false, message: 'Impossible de classer une question dans une source archivée.' };

  let section = null;
  if (documentSectionId) {
    section = await getDocumentSectionById(documentSectionId);
    if (!section) return { valid: false, message: 'Section documentaire introuvable.' };
    if (section.documentSourceId !== documentSourceId) {
      return { valid: false, message: 'Cette section n\'appartient pas à la source documentaire choisie.' };
    }
    if (section.status === 'archived') return { valid: false, message: 'Impossible de classer une question dans une section archivée.' };
  }
  return { valid: true, source: source, section: section };
}

/**
 * Rattache UNE question existante à une source (+ section optionnelle).
 * Ne modifie JAMAIS l'énoncé, les propositions, la bonne réponse ni la
 * justification - uniquement les champs de classification.
 *
 * @param {object} question - le document question existant (déjà lu)
 * @param {{documentSourceId:string, documentSectionId?:(string|null), generateCode?:boolean}} destination
 * @returns {Promise<object>}
 */
export async function classifyQuestion(question, destination) {
  const access = checkAccess();
  if (access.status !== 'authorized') return denied(access.message);
  if (!question || !question.pedagogicalId) return errorResult('Question cible introuvable.');

  const newDest = { sourceId: destination.documentSourceId, sectionId: destination.documentSectionId || null };
  const validation = await validateDestination(newDest.sourceId, newDest.sectionId);
  if (!validation.valid) return errorResult(validation.message);

  const isReclassification = !!question.documentSourceId;
  const previousSourceId = question.documentSourceId || null;

  // CORRECTIF (fiabilisation des compteurs) : plus aucun incrément manuel
  // ici - applyClassificationDelta() (document-count-service.js) calcule
  // le delta EXACT (source + section + TOUS les ancêtres) et l'applique
  // dans UNE SEULE transaction avec la question elle-même, avec
  // protection contre un compteur négatif. "Cas 5 — Destination
  // identique" (idempotence) y est également géré : aucune écriture,
  // aucun audit si rien ne change réellement.
  let functionalCode = question.functionalCode || null;
  if (destination.generateCode && !functionalCode) {
    const codeResult = await generateFunctionalCode({
      sourceType: validation.source.sourceType, sourceShortCode: validation.source.shortCode,
      sectionShortCode: validation.section ? validation.section.shortCode : null,
    });
    if (codeResult.success) functionalCode = codeResult.code;
  }

  const applyResult = await applyClassificationDelta(question.pedagogicalId, newDest, functionalCode !== question.functionalCode ? { functionalCode: functionalCode } : null);
  if (applyResult.status !== 'success') return errorResult(applyResult.message);

  const ctx = getCurrentUserContext();
  if (applyResult.message.indexOf('identique') === -1) {
    logAction({
      adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
      targetUid: null, targetEmail: null,
      actionType: isReclassification ? 'questions_reclassified' : 'questions_classified',
      oldValue: previousSourceId || '(non classée)', newValue: newDest.sourceId,
    }).catch(function() {});

    if (functionalCode && functionalCode !== question.functionalCode) {
      logAction({
        adminUid: ctx && ctx.uid, adminEmail: ctx && ctx.email,
        targetUid: null, targetEmail: null,
        actionType: 'question_functional_code_assigned', oldValue: question.functionalCode || null, newValue: functionalCode,
      }).catch(function() {});
    }
  }

  // CORRECTIF (bibliotheque d'icones, remplace les emojis) : reste du texte
  // brut (plus d'emoji) - ce message est affiche via showMessage()/.textContent
  // par les appelants (voir admin/bank.js), jamais interprete comme du HTML.
  const warningSuffix = applyResult.inconsistencies.length > 0 ? ' ' + applyResult.inconsistencies.length + ' incohérence(s) de compteur détectée(s) et corrigée(s) — une réconciliation est recommandée.' : '';
  return success('Question rattachée avec succès.' + warningSuffix, { functionalCode: functionalCode, inconsistencies: applyResult.inconsistencies });
}

/**
 * Relit une question par son identifiant pedagogique (relai direct,
 * evite a l'interface d'importer question-catalog-service.js pour ce
 * seul besoin).
 * @param {string} pedagogicalId
 * @returns {Promise<object|null>}
 */
export async function getQuestionForClassification(pedagogicalId) {
  return getExistingQuestionByPedagogicalId(pedagogicalId);
}

// ---------------------------------------------------------------------------
// Résolution de destination au moment de l'import (Sprint 20, "Règle de
// priorité proposée")
// ---------------------------------------------------------------------------

/**
 * Résout la destination documentaire d'UNE question au moment de
 * l'import, selon la priorité demandée : (1) destination définie
 * explicitement dans le fichier ET valide, (2) destination choisie dans
 * l'interface, (3) aucune destination (autorisée comme brouillon non
 * classé). Utilise un cache mémoire partagé entre appels successifs sur
 * un même lot, pour ne jamais relire deux fois la même source/section.
 *
 * @param {object} rawQuestion
 * @param {{documentSourceId:string, documentSectionId:(string|null)}|null} uiDefaultDestination
 * @param {Map<string,object>} cache - initialiser à `new Map()` avant le premier appel d'un lot
 * @returns {Promise<{destination:(object|null), warning:(string|null)}>}
 */
export async function resolveImportDestination(rawQuestion, uiDefaultDestination, cache) {
  async function cachedGet(id, getter) {
    if (cache.has(id)) return cache.get(id);
    const value = await getter(id);
    cache.set(id, value);
    return value;
  }

  if (rawQuestion.documentSourceId) {
    const source = await cachedGet(rawQuestion.documentSourceId, getDocumentSourceById);
    if (source && source.status !== 'archived') {
      let section = null;
      if (rawQuestion.documentSectionId) {
        section = await cachedGet(rawQuestion.documentSectionId, getDocumentSectionById);
      }
      const sectionValid = !rawQuestion.documentSectionId || (section && section.documentSourceId === rawQuestion.documentSourceId && section.status !== 'archived');
      if (sectionValid) {
        return { destination: { documentSourceId: rawQuestion.documentSourceId, documentSectionId: rawQuestion.documentSectionId || null, functionalCode: rawQuestion.functionalCode || null }, warning: null };
      }
      return { destination: uiDefaultDestination || null, warning: 'Destination invalide dans le fichier pour "' + rawQuestion.pedagogicalId + '" (section incohérente) — destination de repli appliquée.' };
    }
    return { destination: uiDefaultDestination || null, warning: 'Destination invalide dans le fichier pour "' + rawQuestion.pedagogicalId + '" (source introuvable ou archivée) — destination de repli appliquée.' };
  }

  if (uiDefaultDestination && uiDefaultDestination.documentSourceId) {
    return { destination: uiDefaultDestination, warning: null };
  }

  return { destination: null, warning: null };
}
