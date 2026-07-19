// ===================== SERVICE D'ORCHESTRATION DES SESSIONS D'EVALUATION (Sprint 17) =====================
// Correspond au "EvaluationSessionService" du cadrage (section 15) :
// créer une session, retrouver une session active, sauvegarder une
// réponse, reprendre une session, soumettre une session, empêcher la
// modification après soumission. Point d'entrée UNIQUE pour evaluation.js
// (la page) - aucune logique métier dans la page elle-même.
//
// Coordonne :
//   - js/services/parcours-evaluation-service.js   (determine les questions + verifie l'eligibilite)
//   - js/services/evaluation-session-catalog-service.js (lecture/ecriture Firestore)
//   - js/services/evaluation-session-metadata-service.js (modele de donnees)
//   - js/services/user-management-service.js        (organizationId a snapshoter, Sprint 14)
//
// CHOIX D'ARCHITECTURE — AUDIT (a documenter clairement, comme demande) :
// le journal d'audit centralise existant (js/services/audit-service.js,
// collection `audit_logs`, Sprint 8) est INTENTIONNELLEMENT et
// EXCLUSIVEMENT reserve aux actions ADMINISTRATIVES (ses regles Firestore
// n'autorisent la creation qu'aux administrateurs - voir firestore.rules,
// commentaire d'origine : "le journal peut contenir des informations sur
// n'importe quel utilisateur, jamais accessible a un utilisateur
// standard"). Un etudiant/pharmacien qui demarre SA PROPRE evaluation
// n'est PAS un administrateur : reutiliser `audit_logs` ici aurait exige
// d'affaiblir son modele d'acces deja etabli, pour un evenement qui ne
// concerne qu'un seul utilisateur et sa propre session. "Reutiliser le
// systeme d'audit existant LORSQUE PERTINENT" (SPRINT17, section 18) est
// donc interprete ainsi : les 4 evenements demandes (evaluation_started/
// resumed/restarted/submitted) sont enregistres dans un tableau `events`
// EMBARQUE DIRECTEMENT DANS LE DOCUMENT DE LA SESSION elle-meme (deja
// protegee par les memes regles de securite que le reste de la session -
// lisible uniquement par son proprietaire et les administrateurs). Aucune
// nouvelle collection, aucune nouvelle regle, aucun nouvel index n'a donc
// ete necessaire pour cette tracabilite - et "les reponses sont deja
// enregistrees dans la session" (SPRINT17) s'applique ici a l'identique
// pour ces 4 evenements ponctuels (jamais un evenement par reponse).

import { getCurrentUserContext } from "./app-context.js";
import { getUserByUid } from "./user-management-service.js";
import { prepareEvaluation } from "./parcours-evaluation-service.js";
import {
  SESSION_STATUSES, completeSessionMetadata, completeAnswerEntry, validateSessionMetadata,
} from "./evaluation-session-metadata-service.js";
import {
  createSessionDocument, getSessionById, findActiveSession, countPreviousAttempts, updateSessionFields,
} from "./evaluation-session-catalog-service.js";

function denied(message, reason) { return { status: 'denied', message: message, reason: reason }; }
function success(message, extra) { return Object.assign({ status: 'success', message: message }, extra || {}); }
function errorResult(message) { return { status: 'error', message: message }; }

function nowIso() { return new Date().toISOString(); }

function appendEvent(session, type) {
  const events = Array.isArray(session.events) ? session.events.slice() : [];
  events.push({ type: type, at: nowIso() });
  return events;
}

/**
 * Recherche une session active (in_progress) pour ce couple (parcours,
 * competence) - a appeler AVANT toute creation, pour proposer la boite de
 * dialogue "Reprendre / Recommencer" (SPRINT17, section 10).
 * @param {string} parcoursId
 * @param {string} competencyId
 * @returns {Promise<object|null>}
 */
export async function getActiveSession(parcoursId, competencyId) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return null;
  return findActiveSession(ctx.uid, parcoursId, competencyId);
}

/**
 * Démarre une TOUTE NOUVELLE session (aucune verification de session
 * active existante ici - a l'appelant de l'avoir deja fait via
 * getActiveSession(), voir evaluation.js). Ne cree JAMAIS une session
 * vide : si prepareEvaluation() ne trouve aucune question disponible, rien
 * n'est ecrit dans Firestore (SPRINT17, section 5 : "Ne pas creer de
 * session vide").
 *
 * @param {string} parcoursId
 * @param {string} competencyId
 * @returns {Promise<object>}
 */
export async function startNewSession(parcoursId, competencyId) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour démarrer une évaluation.', 'not_authenticated');

  const prepared = await prepareEvaluation(ctx.uid, parcoursId, competencyId);
  if (!prepared.authorized) {
    return denied(prepared.message, prepared.reason);
  }

  const [user, previousAttempts] = await Promise.all([
    getUserByUid(ctx.uid),
    countPreviousAttempts(ctx.uid, parcoursId, competencyId),
  ]);

  const now = nowIso();
  const session = completeSessionMetadata({
    userId: ctx.uid,
    organizationId: (user && user.organizationId) || null,
    parcoursId: parcoursId,
    competencyId: competencyId,
    assignmentId: prepared.assignmentId,
    status: SESSION_STATUSES.IN_PROGRESS,
    startedAt: now,
    updatedAt: now,
    questionIds: prepared.orderedQuestionIds,
    currentQuestionIndex: 0,
    answers: {},
    questionSnapshot: prepared.questionSnapshots,
    createdBy: ctx.uid,
    attemptNumber: previousAttempts + 1,
  });
  session.events = [{ type: 'evaluation_started', at: now }];

  const validation = validateSessionMetadata(session);
  if (!validation.valid) return errorResult(validation.errors.join(' '));

  const result = await createSessionDocument(session);
  if (!result.success) return errorResult('Le démarrage de l\'évaluation a échoué. Veuillez réessayer.');

  return success('Évaluation démarrée.', { session: session, parcours: prepared.parcours, competency: prepared.competency });
}

/**
 * Reprend une session EXISTANTE (bouton "Reprendre", SPRINT17 section 10).
 * Revalide que la session appartient bien à l'utilisateur courant et
 * qu'elle est toujours `in_progress` (défense en profondeur, en plus des
 * règles Firestore).
 * @param {string} sessionId
 * @returns {Promise<object>}
 */
export async function resumeSession(sessionId) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour reprendre une évaluation.', 'not_authenticated');

  const session = await getSessionById(sessionId);
  if (!session) return denied('Cette session est introuvable.', 'session_not_found');
  if (session.userId !== ctx.uid) return denied('Cette session ne vous appartient pas.', 'forbidden');
  if (session.status !== SESSION_STATUSES.IN_PROGRESS) return denied('Cette évaluation a déjà été soumise.', 'already_submitted');

  const events = appendEvent(session, 'evaluation_resumed');
  updateSessionFields(sessionId, { events: events, updatedAt: nowIso() }).catch(function() {});

  return success('Session reprise.', { session: session });
}

/**
 * Abandonne la session EXISTANTE puis en démarre une nouvelle (bouton
 * "Recommencer", SPRINT17 section 10 - la CONFIRMATION elle-même est de
 * la responsabilité de l'interface, avant tout appel à cette fonction :
 * "Ne jamais supprimer silencieusement les réponses existantes" - ici, la
 * session précédente n'est d'ailleurs jamais supprimée, seulement marquée
 * `abandoned`, ses réponses restant intactes et consultables si un futur
 * sprint en a besoin).
 * @param {string} oldSessionId
 * @param {string} parcoursId
 * @param {string} competencyId
 * @returns {Promise<object>}
 */
export async function restartSession(oldSessionId, parcoursId, competencyId) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour recommencer une évaluation.', 'not_authenticated');

  const oldSession = await getSessionById(oldSessionId);
  if (oldSession && oldSession.userId === ctx.uid && oldSession.status === SESSION_STATUSES.IN_PROGRESS) {
    const events = appendEvent(oldSession, 'evaluation_restarted');
    await updateSessionFields(oldSessionId, { status: SESSION_STATUSES.ABANDONED, updatedAt: nowIso(), events: events });
  }

  return startNewSession(parcoursId, competencyId);
}

/**
 * Sauvegarde UNE réponse (autosave, SPRINT17 section 9). N'écrit QUE le
 * champ de cette question précise (notation pointée Firestore
 * `answers.<pedagogicalId>`) - jamais l'ensemble de la map `answers`,
 * pour éviter d'écraser une réponse enregistrée depuis un autre onglet.
 * @param {object} session
 * @param {string} pedagogicalId
 * @param {*} value
 * @returns {Promise<object>}
 */
export async function saveAnswer(session, pedagogicalId, value) {
  if (!session || session.status !== SESSION_STATUSES.IN_PROGRESS) {
    return errorResult('Cette évaluation n\'accepte plus de modifications.');
  }
  const entry = completeAnswerEntry(value);
  const payload = {};
  payload['answers.' + pedagogicalId] = entry;
  payload.updatedAt = nowIso();

  const result = await updateSessionFields(session.id, payload);
  if (!result.success) return errorResult('Erreur d\'enregistrement.');
  return success('Enregistré.', { entry: entry });
}

/**
 * Enregistre la question actuellement affichée (navigation, SPRINT17
 * section 9 : "lors du changement de question").
 * @param {object} session
 * @param {number} index
 * @returns {Promise<object>}
 */
export async function saveCurrentQuestionIndex(session, index) {
  if (!session || session.status !== SESSION_STATUSES.IN_PROGRESS) return errorResult('Session non modifiable.');
  const result = await updateSessionFields(session.id, { currentQuestionIndex: index, updatedAt: nowIso() });
  if (!result.success) return errorResult('Erreur d\'enregistrement.');
  return success('Position enregistrée.');
}

/**
 * Termine définitivement une évaluation (SPRINT17, section 11) : passe la
 * session en `submitted`, renseigne `submittedAt`, empêche toute
 * modification ultérieure (garanti par firestore.rules, voir ce fichier -
 * cette fonction elle-même refuse aussi de resoumettre une session déjà
 * soumise, défense en profondeur).
 * @param {object} session
 * @returns {Promise<object>}
 */
export async function submitSession(session) {
  if (!session) return errorResult('Session introuvable.');
  if (session.status !== SESSION_STATUSES.IN_PROGRESS) {
    return denied('Cette évaluation a déjà été soumise.', 'already_submitted');
  }
  const now = nowIso();
  const events = appendEvent(session, 'evaluation_submitted');
  const result = await updateSessionFields(session.id, {
    status: SESSION_STATUSES.SUBMITTED, submittedAt: now, updatedAt: now, events: events,
  });
  if (!result.success) return errorResult('La soumission a échoué. Veuillez réessayer.');
  return success('Évaluation soumise avec succès.', { submittedAt: now });
}
