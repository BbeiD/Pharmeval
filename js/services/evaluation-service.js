// ===================== SERVICE DE SYNCHRONISATION DES EVALUATIONS =====================
// Centralise toute la logique Firestore liee aux evaluations terminees.
// Aucun appel Firestore lie aux evaluations ne doit exister ailleurs (voir
// js/app.js, ou seul un point d'accroche minimal dans showResults() appelle
// ce service via window.PharmevalEvaluationSync - voir plus bas).
//
// Principe (voir RAPPORT_SPRINT4.md pour le detail) :
//   evaluation terminee -> stockage local existant (inchange) -> objet
//   normalise -> enregistrement local (nouveau, additif) -> tentative
//   Firestore -> statut "synced" ou "pending" -> jamais de blocage utilisateur.

import { db } from "../firebase-config.js";
import { getCurrentUserContext } from "./app-context.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const APP_VERSION = '1.5.0';
const SCHEMA_VERSION = 1;

// Clef de stockage local des evaluations, par profil - suit la meme
// convention que les clefs deja existantes quiz_stats_<profil> et
// quiz_reports_<profil> (voir RAPPORT_SPRINT2.md). Ce sprint AJOUTE cette
// nouvelle clef ; il ne touche a aucune des deux clefs existantes.
const LOCAL_KEY_PREFIX = 'quiz_evaluations_';
const KNOWN_PROFILES = ['student', 'pharmacist'];

// ---------------------------------------------------------------------------
// Identifiant stable d'evaluation
// ---------------------------------------------------------------------------

/**
 * Genere un identifiant unique et stable pour une evaluation, cree une seule
 * fois a la fin du quiz et conserve tel quel en local et dans Firestore.
 * Utilise crypto.randomUUID() quand disponible (tous navigateurs recents),
 * avec un mecanisme de secours sinon.
 */
export function generateEvaluationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Secours : suffisamment unique pour un usage local (horodatage + alea),
  // sans dependance externe. Ne vise pas les garanties cryptographiques
  // d'un UUID v4, uniquement l'absence de collision pratique.
  return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Identifiant "au mieux" d'une question, tant qu'aucun champ `id` stable
 * n'existe dans data/questions.js (voir RAPPORT_SPRINT4.md, section dediee -
 * aucune question de la banque actuelle ne possede de champ `id` explicite).
 *
 * Cet identifiant est derive du sous-theme et d'un hachage simple du texte
 * de la question (ou, selon le type, de `question`/`situation`, les formats
 * autres que QCM classique n'utilisant pas tous le meme nom de champ). Il
 * reste stable tant que le texte de la question n'est pas modifie, mais
 * changera si la question est corrigee - limite assumee et documentee,
 * preferable a une duplication du texte complet dans Firestore.
 *
 * @param {object} q - objet question tel qu'utilise par le moteur de quiz
 * @returns {string}
 */
export function computeQuestionId(q) {
  const text = q.q || q.question || q.situation || '';
  const sub = q.sub || 'unknown';
  return sub + '-' + simpleHash(sub + '|' + text);
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Construction de l'objet d'evaluation normalise
// ---------------------------------------------------------------------------

/**
 * Construit l'objet d'evaluation normalise a partir des donnees brutes
 * fournies par js/app.js (voir showResults()). Adapte du modele propose
 * dans la demande du sprint : le champ "selection" est simplifie a un seul
 * theme + une difficulte (Pharmeval ne propose pas aujourd'hui de composer
 * un quiz sur plusieurs themes/pathologies a la fois), et "pathologies"
 * n'est pas repris car il ne correspond a aucune notion presente dans le
 * modele de donnees actuel des questions.
 *
 * @param {{questions:Array, score:number, totalQuestions:number, profile:string, theme:string, difficulty:string}} raw
 * @param {string} evaluationId
 */
export function buildEvaluationObject(raw, evaluationId) {
  const ctx = getCurrentUserContext();
  const nowIso = new Date().toISOString();
  const totalQuestions = raw.totalQuestions || (raw.questions ? raw.questions.length : 0);
  const percentage = totalQuestions > 0 ? Math.round((raw.score / totalQuestions) * 100) : 0;

  return {
    id: evaluationId,
    userId: (ctx && ctx.uid) || null,

    createdAt: nowIso,   // horodatage local ; remplace par serverTimestamp() lors de l'ecriture Firestore reelle
    completedAt: nowIso,
    syncedAt: null,      // renseigne uniquement apres synchronisation reussie

    space: raw.profile || '',
    mode: 'evaluation',

    score: {
      correctAnswers: raw.score || 0,
      totalQuestions: totalQuestions,
      percentage: percentage,
    },

    selection: {
      difficulty: raw.difficulty || 'all',
      theme: raw.theme || '',
    },

    questions: (raw.questions || []).map(function(q) {
      return {
        questionId: computeQuestionId(q),
        answerGiven: (q._evalAnswerGiven !== undefined) ? q._evalAnswerGiven : null,
        correct: (q._evalCorrect !== undefined) ? q._evalCorrect : null,
      };
    }),

    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    source: 'pharmeval-web',

    // Champ purement local (jamais ecrit tel quel dans Firestore, voir
    // trySyncEvaluation) : reflete l'etat de synchronisation de CETTE copie.
    syncStatus: 'pending',
  };
}

// ---------------------------------------------------------------------------
// Stockage local (nouveau, additif - ne remplace ni ne modifie quiz_stats_*
// ni quiz_reports_*, deja existants et inchanges par ce sprint)
// ---------------------------------------------------------------------------

function loadLocalEvaluations(profile) {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY_PREFIX + profile) || '[]');
  } catch (e) {
    return [];
  }
}

function saveLocalEvaluations(profile, list) {
  localStorage.setItem(LOCAL_KEY_PREFIX + profile, JSON.stringify(list));
}

/** Insere ou met a jour (par id) une evaluation dans le stockage local. */
function upsertLocalEvaluation(profile, evalObj) {
  const list = loadLocalEvaluations(profile);
  const idx = list.findIndex(function(e) { return e.id === evalObj.id; });
  if (idx >= 0) list[idx] = evalObj; else list.push(evalObj);
  saveLocalEvaluations(profile, list);
}

// ---------------------------------------------------------------------------
// Synchronisation Firestore
// ---------------------------------------------------------------------------

/**
 * Traduit une erreur Firestore en trace console exploitable, sans jamais
 * exposer de detail technique a l'utilisateur (voir RAPPORT_SPRINT4.md,
 * section "Gestion des erreurs").
 */
function logSyncError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[evaluation-service] ' + context + ' : ' + code, err);
}

/**
 * Tente d'ecrire une evaluation dans Firestore (ecriture idempotente : le
 * document est adresse par l'identifiant stable de l'evaluation, donc une
 * meme evaluation synchronisee plusieurs fois ne cree jamais de doublon).
 * Met a jour la copie locale avec le statut resultant ("synced" ou "pending").
 *
 * @returns {Promise<'synced'|'pending'>}
 */
async function trySyncEvaluation(profile, evalObj) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) {
    // Aucun utilisateur valide : on reste en attente, sans erreur bloquante
    // (voir "Compatibilite avec les utilisateurs non connectes").
    evalObj.syncStatus = 'pending';
    upsertLocalEvaluation(profile, evalObj);
    return 'pending';
  }
  try {
    const ref = doc(db, 'users', ctx.uid, 'evaluations', evalObj.id);
    const isFirstSync = !evalObj.syncedAt;
    const payload = Object.assign({}, evalObj, {
      userId: ctx.uid,
      syncedAt: serverTimestamp(),
    });
    if (isFirstSync) {
      // createdAt n'est ecrit qu'une seule fois, a la toute premiere
      // synchronisation reussie. Les tentatives suivantes (resync) ne le
      // renvoient plus du tout : combine a l'ecriture en `merge:true`, cela
      // laisse le champ deja stocke strictement intact, exactement ce que
      // les regles Firestore proposees (voir firestore.rules) exigent.
      payload.createdAt = serverTimestamp();
    } else {
      delete payload.createdAt;
    }
    delete payload.syncStatus; // champ purement local, jamais ecrit dans Firestore
    await setDoc(ref, payload, { merge: true });

    evalObj.syncStatus = 'synced';
    evalObj.syncedAt = new Date().toISOString();
    upsertLocalEvaluation(profile, evalObj);
    return 'synced';
  } catch (err) {
    logSyncError('echec de synchronisation d\'une evaluation (conservee localement, nouvelle tentative plus tard)', err);
    evalObj.syncStatus = 'pending';
    upsertLocalEvaluation(profile, evalObj);
    return 'pending';
  }
}

/**
 * Point d'entree principal, appele depuis js/app.js (showResults()) une fois
 * une evaluation terminee. Enregistre toujours localement en premier (jamais
 * bloque par le reseau), puis tente la synchronisation Firestore.
 *
 * @param {{questions:Array, score:number, totalQuestions:number, profile:string, theme:string, difficulty:string}} rawData
 * @returns {Promise<'synced'|'pending'>}
 */
export async function recordCompletedEvaluation(rawData) {
  const profile = rawData.profile || 'unknown';
  const evaluationId = generateEvaluationId();
  const evalObj = buildEvaluationObject(rawData, evaluationId);

  // 1. Enregistrement local immediat - garanti, jamais retarde par le reseau.
  upsertLocalEvaluation(profile, evalObj);

  // 2. Tentative de synchronisation (n'affecte jamais ce qui precede).
  return trySyncEvaluation(profile, evalObj);
}

/**
 * Verifie si une evaluation donnee existe deja dans Firestore (utilise en
 * complement de l'ecriture idempotente de trySyncEvaluation - celle-ci
 * suffit deja a eviter les doublons, cette fonction reste utile pour des
 * verifications explicites, ex. avant un futur affichage d'historique).
 *
 * @param {string} evaluationId
 * @returns {Promise<boolean>}
 */
export async function evaluationExists(evaluationId) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return false;
  try {
    const ref = doc(db, 'users', ctx.uid, 'evaluations', evaluationId);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch (err) {
    logSyncError('verification d\'existence d\'une evaluation', err);
    return false;
  }
}

/**
 * Tente de synchroniser toutes les evaluations locales encore "pending",
 * pour tous les profils connus. A appeler a l'ouverture de l'application ou
 * juste apres une connexion reussie (voir js/auth.js). Un seul passage par
 * appel : aucune boucle de nouvelles tentatives automatique n'est declenchee
 * en interne (pas de risque de boucle infinie).
 *
 * @returns {Promise<{attempted:number, synced:number}>}
 */
export async function syncPendingEvaluations() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return { attempted: 0, synced: 0 };

  let attempted = 0;
  let synced = 0;
  for (const profile of KNOWN_PROFILES) {
    const list = loadLocalEvaluations(profile);
    const pending = list.filter(function(e) { return e.syncStatus === 'pending'; });
    for (const evalObj of pending) {
      attempted++;
      const status = await trySyncEvaluation(profile, evalObj);
      if (status === 'synced') synced++;
    }
  }
  if (attempted > 0) {
    console.info('[evaluation-service] synchronisation des evaluations en attente : ' + synced + '/' + attempted + ' reussies.');
  }
  return { attempted, synced };
}

/**
 * Lit les dernieres evaluations de l'utilisateur connecte depuis Firestore,
 * triees par date de fin. Prevue pour etre utilisee par le Sprint 5 (aucune
 * interface d'historique n'est construite dans ce sprint).
 *
 * @param {{limit?:number, order?:'asc'|'desc'}} options
 * @returns {Promise<Array<object>>}
 */
export async function getUserEvaluations(options) {
  const opts = options || {};
  const maxResults = opts.limit || 20;
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return [];
  try {
    const colRef = collection(db, 'users', ctx.uid, 'evaluations');
    const q = query(colRef, orderBy('completedAt', opts.order === 'asc' ? 'asc' : 'desc'), limit(maxResults));
    const snap = await getDocs(q);
    const out = [];
    snap.forEach(function(docSnap) { out.push(docSnap.data()); });
    return out;
  } catch (err) {
    logSyncError('lecture de l\'historique des evaluations', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pont vers js/app.js (script classique, sans import ES) : app.js ne fait
// qu'appeler window.PharmevalEvaluationSync.recordCompletedEvaluation(...)
// de facon defensive dans showResults() - voir RAPPORT_SPRINT4.md.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.PharmevalEvaluationSync = {
    recordCompletedEvaluation: recordCompletedEvaluation,
  };
}
