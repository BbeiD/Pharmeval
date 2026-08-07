// ===================== METADONNEES D'UNE SESSION D'EVALUATION (Sprint 17) =====================
// Definit le MODELE DE DONNEES d'une "session d'evaluation" (collection
// Firestore dediee `evaluation_sessions`) : une tentative d'un utilisateur
// de repondre aux questions liees a UNE competence d'UN parcours.
//
// Utilitaire pur (aucun appel Firestore) - meme role que
// assignment-metadata-service.js (Sprint 15) / competency-metadata-
// service.js (Sprint 13) pour leurs domaines respectifs.
//
// NOM DE FICHIER (ecart volontaire par rapport au cadrage) : le cadrage
// suggere "evaluation-service.js" pour le service determinant les
// questions d'une evaluation. Ce nom est DEJA PRIS par un service Sprint 4
// totalement different (js/services/evaluation-service.js, synchronisation
// des RESULTATS de l'ancien moteur de quiz QDB vers `users/{uid}/evaluations`
// - une fonctionnalite deja validee, sans aucun rapport avec les sessions
// d'evaluation par parcours de ce sprint). Reutiliser ce nom aurait cree
// une confusion durable entre deux systemes distincts. Les fichiers de ce
// sprint sont donc nommes explicitement autour de "evaluation-session" et
// "parcours-evaluation" - voir RAPPORT_SPRINT17.md, section "Choix
// d'architecture", pour le detail complet de cette decision.

const ID_PREFIX_SESSION = 'EVALSESS';

function randomIdSuffix() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0] + crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
}

/**
 * Genere un identifiant stable de session (ex. "EVALSESS-a1b2c3d4e5f6g7h8").
 * Identifiant ALEATOIRE (pas deterministe a partir de userId/parcoursId/
 * competencyId) - meme convention que le reste du projet (parcours,
 * competences, attributions). La regle "une seule session active a la
 * fois" (SPRINT17, section 4) est donc appliquee au niveau APPLICATIF
 * (voir evaluation-session-service.js, findActiveSession() appelee AVANT
 * toute creation), pas par construction d'identifiant - meme principe
 * honnête déjà appliqué à assignmentExists() au Sprint 15.
 * @returns {string}
 */
export function generateSessionId() {
  return ID_PREFIX_SESSION + '-' + randomIdSuffix();
}

/** Statuts d'une session d'evaluation (SPRINT17, section 3). */
export const SESSION_STATUSES = Object.freeze({
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  // "Le statut abandoned peut etre prevu dans le modele sans devoir encore
  // creer une interface complete pour l'abandon" (SPRINT17, section 3) :
  // valeur reconnue par le schema et par les regles Firestore, mais
  // AUCUN bouton "Abandonner" n'existe dans evaluation.html ce sprint.
  ABANDONED: 'abandoned',
});

/**
 * Construit le "snapshot minimal et immuable" d'UNE question, tel
 * qu'enregistre dans une session au moment de sa creation (SPRINT17,
 * section 2).
 *
 * CHOIX D'ARCHITECTURE (a documenter clairement, comme demande) : ce
 * snapshot contient UNIQUEMENT ce qui est necessaire pour (a) afficher la
 * question de facon stable pendant toute la duree de la session et (b) la
 * corriger plus tard (Sprint 18), meme si la question source est ensuite
 * modifiee ou supprimee de la Banque de questions :
 *   - pedagogicalId, version, questionType (identite + type de rendu)
 *   - question (enonce - necessaire pour un rendu stable, voir note ci-dessous)
 *   - answers (options, DEJA dans l'ordre de presentation figé - voir
 *     parcours-evaluation-service.js, qui mélange les options AVANT
 *     d'appeler cette fonction, une seule fois, au demarrage de la session)
 *   - correctAnswer (cle de correction, deja remappee sur cet ordre figé)
 *   - points (bareme eventuel - `null` tant qu'aucun systeme de notation
 *     ponderee n'existe reellement, jamais une valeur inventee)
 *
 * VOLONTAIREMENT EXCLU du snapshot (pour rester "minimal", comme demande) :
 * l'explication pedagogique, les mots-cles, l'auteur, la source, les
 * objectifs pedagogiques - aucun de ces champs n'est necessaire pour
 * afficher ou corriger la question pendant la session ; ils pourront être
 * relus depuis la Banque de questions (si toujours disponible) au moment
 * ou un futur sprint (18) affichera un feedback détaillé - hors périmètre
 * ici ("Ne pas encore afficher : feedback par question").
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeQuestionSnapshot(partial) {
  const p = partial || {};
  return {
    pedagogicalId: p.pedagogicalId || null,
    version: p.version || 1,
    questionType: p.questionType || 'qcm',
    question: (p.question || '').toString(),
    answers: Array.isArray(p.answers) ? p.answers.slice() : [],
    correctAnswer: (p.correctAnswer !== undefined && p.correctAnswer !== null) ? p.correctAnswer : null,
    points: (typeof p.points === 'number') ? p.points : null, // "bareme eventuel" (SPRINT17) - jamais invente
  };
}

/**
 * Construit la reponse "value" d'une question - enveloppe generique
 * (SPRINT17, "architecture evolutive") : `value` peut etre un nombre
 * (choix unique/vrai-faux), un tableau de nombres (futur choix multiple),
 * ou une chaine (futur texte libre) - jamais retravaillee ici, ce fichier
 * ne connait pas la difference entre ces cas, seul question-renderer-
 * service.js sait interpreter/lire une valeur selon le type.
 * @param {*} value
 * @returns {object}
 */
export function completeAnswerEntry(value) {
  return {
    value: (value === undefined) ? null : value,
    answeredAt: new Date().toISOString(),
  };
}

/**
 * Construit les metadonnees completes d'une session a partir de valeurs
 * partielles. Jamais de donnee inventee : `dueDate`-like champs (ici
 * `submittedAt`) restent `null` tant qu'ils ne sont pas reellement
 * atteints.
 *
 * "Prévoir dès maintenant les champs utiles pour de futures règles"
 * (SPRINT17, section 4) : `attemptNumber`/`maxAttempts`/`attemptType` sont
 * stockes mais JAMAIS exploites pour bloquer ou autoriser quoi que ce soit
 * ce sprint (voir evaluation-session-service.js : aucune verification ne
 * lit ces champs).
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeSessionMetadata(partial) {
  const p = partial || {};
  return {
    id: p.id || generateSessionId(),
    userId: p.userId || null,
    organizationId: p.organizationId || null, // snapshot de users/{uid}.organizationId au moment de la creation (Sprint 14) - jamais relu dynamiquement ensuite
    // SPRINT 21.5, PHASE B1 : distingue une session de formation d'une
    // session d'entrainement libre - c'est CE champ, et lui seul, qui
    // separe les deux modes (jamais une seconde collection, jamais un
    // second moteur - voir en-tete de evaluation-session-service.js).
    // Valeur par defaut 'parcours' : toute session deja existante en
    // base, creee avant ce sprint, reste valide sans migration - elle n'a
    // simplement jamais ce champ renseigne explicitement, et
    // completeSessionMetadata() le complete a la lecture comme 'parcours'.
    sessionType: p.sessionType || 'parcours',
    parcoursId: p.parcoursId || null,
    competencyId: p.competencyId || null,
    assignmentId: p.assignmentId || null, // l'attribution (Sprint 15) qui a permis l'acces, si determinable avec certitude
    status: p.status || SESSION_STATUSES.IN_PROGRESS,
    startedAt: p.startedAt || null,
    updatedAt: p.updatedAt || null,
    submittedAt: p.submittedAt || null,
    questionIds: Array.isArray(p.questionIds) ? p.questionIds.slice() : [], // ordre FIGE au demarrage (voir parcours-evaluation-service.js)
    currentQuestionIndex: (typeof p.currentQuestionIndex === 'number') ? p.currentQuestionIndex : 0,
    answers: (p.answers && typeof p.answers === 'object') ? p.answers : {}, // map { [pedagogicalId]: {value, answeredAt} }
    questionSnapshot: (p.questionSnapshot && typeof p.questionSnapshot === 'object') ? p.questionSnapshot : {}, // map { [pedagogicalId]: snapshot }
    createdBy: p.createdBy || p.userId || null, // toujours l'utilisateur lui-meme ce sprint (pas de pre-provisionnement de session par un admin)

    // Journal LEGER embarque des 4 evenements du cycle de vie (SPRINT17,
    // section 18 : evaluation_started/resumed/restarted/submitted -
    // jamais un evenement par reponse) - voir evaluation-session-
    // service.js, en-tete, pour le choix d'architecture complet (pourquoi
    // pas le journal d'audit centralise admin-only, Sprint 8).
    events: Array.isArray(p.events) ? p.events.slice() : [],

    // --- "Préparer dès maintenant" (SPRINT17, section 4) : non exploités ---
    attemptNumber: (typeof p.attemptNumber === 'number') ? p.attemptNumber : 1,
    maxAttempts: (typeof p.maxAttempts === 'number') ? p.maxAttempts : null,
    attemptType: p.attemptType || 'standard',

    // AJOUT (Défi du jour) : marque une session de type 'free_training'
    // comme etant LE defi du jour ('AAAA-MM-JJ', voir date-utils.js#todayDateStr)
    // - jamais un nouveau sessionType (validateSessionMetadata() ci-dessous
    // continuerait de considerer 'free_training' comme dispense de
    // parcours/competence, exactement comme le fait deja une session
    // d'entrainement libre classique ou un parcours mixte, voir
    // parcoursId - meme principe applique ici). `null` pour toute session
    // qui n'est pas un defi.
    dailyChallengeDate: p.dailyChallengeDate || null,

    version: p.version || 1,
  };
}

/**
 * Valide une session. Ne leve jamais d'exception.
 * @param {object} session
 * @returns {{valid:boolean, errors:Array<string>}}
 */
export function validateSessionMetadata(session) {
  const errors = [];
  const s = session || {};
  if (!s.userId) errors.push('La session doit être associée à un utilisateur.');
  // SPRINT 21.5, PHASE B1 : une session d'entrainement libre (sessionType
  // === 'free_training') n'a ni parcours ni competence par definition -
  // cette exigence ne s'applique donc plus qu'aux sessions de formation
  // (comportement inchange pour tout appelant existant, qui ne renseigne
  // jamais sessionType et retombe donc sur 'parcours').
  if (s.sessionType !== 'free_training') {
    if (!s.parcoursId) errors.push('La session doit être associée à un parcours.');
    if (!s.competencyId) errors.push('La session doit être associée à une compétence.');
  }
  if (Object.values(SESSION_STATUSES).indexOf(s.status) === -1) {
    errors.push('Statut de session invalide : "' + s.status + '".');
  }
  if (!Array.isArray(s.questionIds) || s.questionIds.length === 0) {
    errors.push('La session doit contenir au moins une question.');
  }
  return { valid: errors.length === 0, errors: errors };
}

/**
 * Indique si une question a reçu une réponse exploitable (valeur non
 * nulle/vide) - utilisée pour la navigation compacte (question répondue /
 * non répondue) et pour le décompte avant soumission ("3 questions sont
 * encore sans réponse").
 * @param {*} answerEntry - une entrée de `session.answers[pedagogicalId]`
 * @returns {boolean}
 */
export function isQuestionAnswered(answerEntry) {
  if (!answerEntry || answerEntry.value === null || answerEntry.value === undefined) return false;
  if (Array.isArray(answerEntry.value)) return answerEntry.value.length > 0;
  if (typeof answerEntry.value === 'string') return answerEntry.value.trim().length > 0;
  return true; // nombre (index de reponse) : 0 est une reponse valide (premiere option)
}
