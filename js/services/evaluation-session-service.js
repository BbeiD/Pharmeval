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
import { prepareEvaluation, prepareParcoursMixedEvaluation, buildOrderedQuestionSnapshots } from "./parcours-evaluation-service.js";
import {
  SESSION_STATUSES, completeSessionMetadata, completeAnswerEntry, validateSessionMetadata,
} from "./evaluation-session-metadata-service.js";
import {
  createSessionDocument, getSessionById, findActiveSession, countPreviousAttempts, updateSessionFields,
  findActiveFreeTrainingSession, countPreviousFreeTrainingAttempts, findActiveDailyChallengeSession,
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
 * SPRINT 21.5, PHASE B1 : équivalent de getActiveSession() ci-dessus,
 * pour l'entraînement libre. Fonction SIBLING, pas un paramètre optionnel
 * ajouté à getActiveSession() - un appelant "parcours" existant n'a donc
 * RIEN à changer, aucun risque de régression sur son comportement.
 * @returns {Promise<object|null>}
 */
export async function getActiveFreeTrainingSession() {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return null;
  return findActiveFreeTrainingSession(ctx.uid);
}

/**
 * AJOUT (Défi du jour) : équivalent de getActiveFreeTrainingSession()
 * ci-dessus, scope à LA DATE precise du defi (voir findActiveDailyChallengeSession()) -
 * jamais confondue avec une session d'entrainement libre ordinaire, ni
 * avec le defi d'un jour different.
 * @param {string} dateStr - 'AAAA-MM-JJ'
 * @returns {Promise<object|null>}
 */
export async function getActiveDailyChallengeSession(dateStr) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return null;
  return findActiveDailyChallengeSession(ctx.uid, dateStr);
}

/**
 * SPRINT 21.5, PHASE B1 : démarre une session d'ENTRAÎNEMENT LIBRE - à
 * partir d'une liste de `pedagogicalId` DÉJÀ résolue et bornée par
 * free-training-service.js (filtres source/section/tags/difficulté/
 * jamais-vue/jamais-réussie, voir ce fichier - jamais recalculée ici).
 * Aucune vérification d'attribution de parcours (il n'y en a pas) - seule
 * l'authentification est requise. Réutilise buildOrderedQuestionSnapshots()
 * (partie générique déjà utilisée par prepareEvaluation(), voir
 * parcours-evaluation-service.js) pour la construction des snapshots -
 * AUCUNE logique de sélection/mélange de questions dupliquée ici.
 *
 * @param {Array<string>} pedagogicalIds
 * @returns {Promise<object>}
 */
export async function startNewFreeTrainingSession(pedagogicalIds) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour démarrer un entraînement.', 'not_authenticated');

  const snapshots = await buildOrderedQuestionSnapshots(pedagogicalIds);
  if (snapshots.error) return errorResult('Impossible de charger les questions pour le moment. Réessayez plus tard.');
  if (snapshots.orderedQuestionIds.length === 0) return denied('Aucune question disponible pour cette sélection.', 'no_questions');

  const [user, previousAttempts] = await Promise.all([
    getUserByUid(ctx.uid),
    countPreviousFreeTrainingAttempts(ctx.uid),
  ]);

  const now = nowIso();
  const session = completeSessionMetadata({
    userId: ctx.uid,
    organizationId: (user && user.organizationId) || null,
    sessionType: 'free_training',
    parcoursId: null,
    competencyId: null,
    assignmentId: null,
    status: SESSION_STATUSES.IN_PROGRESS,
    startedAt: now,
    updatedAt: now,
    questionIds: snapshots.orderedQuestionIds,
    currentQuestionIndex: 0,
    answers: {},
    questionSnapshot: snapshots.questionSnapshots,
    createdBy: ctx.uid,
    attemptNumber: previousAttempts + 1,
  });
  session.events = [{ type: 'evaluation_started', at: now }];

  const validation = validateSessionMetadata(session);
  if (!validation.valid) return errorResult(validation.errors.join(' '));

  const result = await createSessionDocument(session);
  if (!result.success) return errorResult('Le démarrage de l\'entraînement a échoué. Veuillez réessayer.');

  return success('Entraînement démarré.', { session: session });
}

/**
 * AJOUT (Défi du jour) : meme moteur que startNewFreeTrainingSession()
 * ci-dessus (session 'free_training', questionIds DEJA determines par
 * l'appelant - daily-challenge-service.js#startTodaysChallenge(), qui a
 * deja applique le filtre "non masque de l'entrainement libre" ET la
 * selection deterministe du jour AVANT d'arriver ici) - seule difference :
 * `dailyChallengeDate` est renseigne, ce qui permettra a
 * finalizeEvaluation() (evaluation-result-service.js) de mettre a jour la
 * serie au bon moment. AUCUNE verification "deja releve aujourd'hui" ici -
 * deja faite par l'ecran appelant (js/defi.js), qui ne propose meme pas le
 * bouton "Commencer" si c'est le cas.
 * @param {Array<string>} pedagogicalIds - deja selectionnes pour aujourd'hui
 * @param {string} dailyChallengeDate - 'AAAA-MM-JJ'
 * @returns {Promise<object>}
 */
export async function startDailyChallengeSession(pedagogicalIds, dailyChallengeDate) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour relever le défi du jour.', 'not_authenticated');

  const snapshots = await buildOrderedQuestionSnapshots(pedagogicalIds);
  if (snapshots.error) return errorResult('Impossible de charger les questions pour le moment. Réessayez plus tard.');
  if (snapshots.orderedQuestionIds.length === 0) return denied('Aucune question disponible pour le défi du jour.', 'no_questions');

  const [user, previousAttempts] = await Promise.all([
    getUserByUid(ctx.uid),
    countPreviousFreeTrainingAttempts(ctx.uid),
  ]);

  const now = nowIso();
  const session = completeSessionMetadata({
    userId: ctx.uid,
    organizationId: (user && user.organizationId) || null,
    sessionType: 'free_training',
    parcoursId: null,
    competencyId: null,
    assignmentId: null,
    dailyChallengeDate: dailyChallengeDate,
    status: SESSION_STATUSES.IN_PROGRESS,
    startedAt: now,
    updatedAt: now,
    questionIds: snapshots.orderedQuestionIds,
    currentQuestionIndex: 0,
    answers: {},
    questionSnapshot: snapshots.questionSnapshots,
    createdBy: ctx.uid,
    attemptNumber: previousAttempts + 1,
  });
  session.events = [{ type: 'evaluation_started', at: now }];

  const validation = validateSessionMetadata(session);
  if (!validation.valid) return errorResult(validation.errors.join(' '));

  const result = await createSessionDocument(session);
  if (!result.success) return errorResult('Le démarrage du défi du jour a échoué. Veuillez réessayer.');

  return success('Défi du jour démarré.', { session: session });
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
 * AJOUT : demarre une evaluation couvrant TOUT le contenu d'un parcours
 * (competences + sources + questions directement liees, voir
 * prepareParcoursMixedEvaluation() ci-dessus) - UN SEUL bouton "Commencer"
 * par parcours, plus un par competence. Reutilise `sessionType:
 * 'free_training'` (aucune competence unique exigee par
 * validateSessionMetadata pour ce type) tout en renseignant `parcoursId`
 * (contrairement a une vraie session d'entrainement libre) - ce qui
 * permet a `findActiveSession()`/`countPreviousAttempts()` deja existantes
 * (parametrees par parcoursId+competencyId) de continuer a fonctionner
 * telles quelles avec `competencyId: null`, sans nouvelle fonction de
 * comptage. Meme garantie que startNewSession() : ne cree jamais de
 * session vide si aucune question n'est disponible.
 * @param {string} parcoursId
 * @returns {Promise<object>}
 */
export async function startParcoursMixedSession(parcoursId) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour démarrer une évaluation.', 'not_authenticated');

  const prepared = await prepareParcoursMixedEvaluation(ctx.uid, parcoursId);
  if (!prepared.authorized) {
    return denied(prepared.message, prepared.reason);
  }

  const [user, previousAttempts] = await Promise.all([
    getUserByUid(ctx.uid),
    countPreviousAttempts(ctx.uid, parcoursId, null),
  ]);

  const now = nowIso();
  const session = completeSessionMetadata({
    userId: ctx.uid,
    organizationId: (user && user.organizationId) || null,
    sessionType: 'free_training',
    parcoursId: parcoursId,
    competencyId: null,
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

  return success('Évaluation démarrée.', { session: session, parcours: prepared.parcours });
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
 * Equivalent de restartSession() ci-dessus pour une evaluation de parcours
 * MIXTE (voir startParcoursMixedSession) - meme principe, l'ancienne
 * session n'est jamais supprimee, seulement marquee `abandoned`.
 * @param {string} oldSessionId
 * @param {string} parcoursId
 * @returns {Promise<object>}
 */
export async function restartParcoursMixedSession(oldSessionId, parcoursId) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour recommencer une évaluation.', 'not_authenticated');

  const oldSession = await getSessionById(oldSessionId);
  if (oldSession && oldSession.userId === ctx.uid && oldSession.status === SESSION_STATUSES.IN_PROGRESS) {
    const events = appendEvent(oldSession, 'evaluation_restarted');
    await updateSessionFields(oldSessionId, { status: SESSION_STATUSES.ABANDONED, updatedAt: nowIso(), events: events });
  }

  return startParcoursMixedSession(parcoursId);
}

/**
 * SPRINT 21.5, PHASE B1 : équivalent de restartSession() pour
 * l'entraînement libre - même principe (l'ancienne session n'est jamais
 * supprimée, seulement marquée `abandoned`).
 * @param {string} oldSessionId
 * @param {Array<string>} pedagogicalIds
 * @returns {Promise<object>}
 */
export async function restartFreeTrainingSession(oldSessionId, pedagogicalIds) {
  const ctx = getCurrentUserContext();
  if (!ctx || !ctx.uid) return denied('Vous devez être connecté pour recommencer un entraînement.', 'not_authenticated');

  const oldSession = await getSessionById(oldSessionId);
  if (oldSession && oldSession.userId === ctx.uid && oldSession.status === SESSION_STATUSES.IN_PROGRESS) {
    const events = appendEvent(oldSession, 'evaluation_restarted');
    await updateSessionFields(oldSessionId, { status: SESSION_STATUSES.ABANDONED, updatedAt: nowIso(), events: events });
  }

  return startNewFreeTrainingSession(pedagogicalIds);
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
