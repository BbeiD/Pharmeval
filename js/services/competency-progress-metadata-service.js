// ===================== METADONNEES D'UNE PROGRESSION DE COMPETENCE (Sprint 19) =====================
// Definit le MODELE DE DONNEES d'un document `competency_progress` : "la
// progression d'un utilisateur pour UNE compétence" (SPRINT19, "Nouvelle
// entité"). Utilitaire pur (aucun appel Firestore) - meme role que les
// autres `*-metadata-service.js` du projet.
//
// "La progression est un état. Les résultats restent des événements."
// (SPRINT19, "Séparation des responsabilités") : ce document ne contient
// JAMAIS de copie du contenu d'une evaluation (questions, reponses) - vu
// evaluation_results (Sprint 18) pour cela. Seul un HISTORIQUE MINIMAL
// (date + pourcentage + reference au resultat) est conserve ici, pour
// tracer l'evolution dans le temps sans dupliquer ce qui existe deja.

/**
 * Identifiant STABLE et DETERMINISTE d'un document de progression : la
 * paire (utilisateur, competence) determine entierement l'identifiant,
 * jamais un identifiant aleatoire. Garantit nativement "un document par
 * utilisateur et par competence" (SPRINT19, "Nouvelle entité") sans
 * jamais avoir besoin d'une requete de verification d'existence avant
 * ecriture - meme principe deja applique par evaluation-correction-
 * service.js (Sprint 18, resultIdForSession()).
 * @param {string} userId
 * @param {string} competencyId
 * @returns {string}
 */
export function progressionIdFor(userId, competencyId) {
  return userId + '_' + competencyId;
}

/**
 * Construit une entree d'historique minimale ("Conserver l'historique des
 * résultats... Ne jamais perdre les anciennes valeurs.", SPRINT19).
 * @param {{date:string, percent:number, resultId:string}} partial
 * @returns {object}
 */
export function completeHistoryEntry(partial) {
  const p = partial || {};
  return {
    date: p.date || null,
    percent: (typeof p.percent === 'number') ? p.percent : 0,
    resultId: p.resultId || null, // reference vers evaluation_results/{id} - jamais une copie du resultat
  };
}

/**
 * Construit les metadonnees completes d'une progression a partir de
 * valeurs partielles, completant par des defauts surs. Jamais de donnee
 * inventee : les champs sans evaluation restent a leur valeur neutre
 * (0/null), jamais un niveau ou un score presente comme reel avant la
 * premiere evaluation.
 *
 * @param {object} partial
 * @returns {object}
 */
export function completeProgressionMetadata(partial) {
  const p = partial || {};
  const userId = p.userId || null;
  const competencyId = p.competencyId || null;
  return {
    id: p.id || (userId && competencyId ? progressionIdFor(userId, competencyId) : null),
    userId: userId,
    competencyId: competencyId,
    organizationId: p.organizationId || null, // snapshot de users/{uid}.organizationId (Sprint 14), rafraichi a chaque mise a jour (peut changer si l'utilisateur change d'organisation)

    evaluationCount: (typeof p.evaluationCount === 'number') ? p.evaluationCount : 0,
    bestPercent: (typeof p.bestPercent === 'number') ? p.bestPercent : 0,
    lastPercent: (typeof p.lastPercent === 'number') ? p.lastPercent : 0,
    averagePercent: (typeof p.averagePercent === 'number') ? p.averagePercent : 0,
    trend: p.trend || 'stable',

    firstEvaluationAt: p.firstEvaluationAt || null,
    lastEvaluationAt: p.lastEvaluationAt || null,
    updatedAt: p.updatedAt || null,

    // "Prévoir également : currentLevel, masteryStatus, confidenceScore.
    // Même si tous ces champs ne sont pas encore pleinement exploités."
    // (SPRINT19) - currentLevel/confidenceScore SONT exploités par ce
    // sprint (page "Mes compétences", radar) ; masteryStatus reutilise
    // directement l'enumeration deja definie par CorrectionPolicy
    // (Sprint 18 : mastered/to_reinforce/not_acquired), jamais une
    // nouvelle echelle parallele.
    currentLevel: p.currentLevel || 'discovery',
    masteryStatus: p.masteryStatus || null,
    confidenceScore: (typeof p.confidenceScore === 'number') ? p.confidenceScore : 0,

    history: Array.isArray(p.history) ? p.history.map(completeHistoryEntry) : [],
    createdBy: p.createdBy || userId,
    version: p.version || 1,

    // Journal LEGER embarque (meme principe deja etabli aux Sprints 17-18
    // pour audit_logs, reserve aux administrateurs - voir evaluation-
    // session-service.js, en-tete, pour la justification complete).
    events: Array.isArray(p.events) ? p.events.slice() : [],
  };
}
