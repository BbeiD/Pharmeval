// ===================== LOGIQUE PURE — DEFI DU JOUR =====================
// Aucune dependance Firestore ici (meme principe que question-progress-
// logic.js) : selection deterministe des questions du jour + calcul de la
// serie, testables directement, sans mock Firebase.
//
// "Défi DU jour" (David, 22/07/2026) : LE MEME defi pour tous les
// utilisateurs un jour donne (pas un tirage personnalise) - la selection
// ci-dessous est deterministe a partir de la date seule (aucun
// Math.random) : deux utilisateurs, ou le meme utilisateur qui recharge
// la page, obtiennent TOUJOURS les memes questions pour une date donnee et
// un meme pool de depart.

export const DAILY_CHALLENGE_QUESTION_COUNT = 5;

/** Hash FNV-1a 32 bits d'une chaine - deterministe, jamais Math.random. */
function hashStringToSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG deterministe (mulberry32) - seul generateur "aleatoire" utilise ici,
 * jamais Math.random(), pour garantir un resultat reproductible a partir
 * de la seule graine fournie. */
function mulberry32(seed) {
  let a = seed;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Choisit `count` identifiants parmi `eligibleIds`, de facon DETERMINISTE
 * a partir de `dateStr` seul - le meme jour, avec le meme pool de depart,
 * produit TOUJOURS le meme resultat (quel que soit l'utilisateur ou le
 * nombre de rechargements de page). Trie d'abord `eligibleIds` (l'ordre de
 * retour d'une requete Firestore n'est pas garanti stable) avant de tirer,
 * pour ne jamais faire dependre le resultat d'un ordre accidentel.
 *
 * @param {Array<string>} eligibleIds
 * @param {string} dateStr - 'AAAA-MM-JJ' (voir date-utils.js#todayDateStr)
 * @param {number} [count]
 * @returns {Array<string>} au plus `count` identifiants, ou tous si le pool est plus petit
 */
export function pickDailyChallengeIds(eligibleIds, dateStr, count) {
  const n = count || DAILY_CHALLENGE_QUESTION_COUNT;
  const sorted = (eligibleIds || []).slice().sort();
  if (sorted.length <= n) return sorted;

  const rng = mulberry32(hashStringToSeed(dateStr));
  const pool = sorted.slice();
  const picked = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

/**
 * Complete les metadonnees d'une progression de defi ("daily_challenge_progress/{uid}"),
 * memes garanties que competency-progress-metadata-service.js/question-
 * progress-catalog-service.js : jamais de donnee inventee, valeurs neutres
 * par defaut pour un utilisateur n'ayant encore jamais releve de defi.
 * @param {object} partial
 * @returns {object}
 */
export function completeDailyChallengeProgress(partial) {
  const p = partial || {};
  return {
    userId: p.userId || null,
    currentStreak: (typeof p.currentStreak === 'number') ? p.currentStreak : 0,
    bestStreak: (typeof p.bestStreak === 'number') ? p.bestStreak : 0,
    totalCompleted: (typeof p.totalCompleted === 'number') ? p.totalCompleted : 0,
    lastCompletedDate: p.lastCompletedDate || null,
    lastResultId: p.lastResultId || null,
    updatedAt: p.updatedAt || null,
  };
}

/**
 * Calcule la nouvelle progression apres avoir termine le defi de `dateStr` -
 * pure fonction (aucune lecture/ecriture ici, voir daily-challenge-
 * service.js pour l'orchestration Firestore). IDEMPOTENT : si
 * `existing.lastCompletedDate === dateStr` (defi de ce jour deja compte),
 * renvoie l'etat INCHANGE - jamais un double comptage, meme si cette
 * fonction est appelee plusieurs fois pour le meme jour.
 *
 * @param {object} existing - deja complete (completeDailyChallengeProgress()), ou null/absent
 * @param {string} dateStr - jour du defi qui vient d'etre termine
 * @param {string} resultId
 * @param {string} nowIso
 * @returns {{progress:object, changed:boolean}}
 */
export function computeDailyChallengeStreak(existing, dateStr, resultId, nowIso) {
  const prev = completeDailyChallengeProgress(existing);
  if (prev.lastCompletedDate === dateStr) {
    return { progress: prev, changed: false };
  }

  const yesterdayStr = shiftDateStrLocal(dateStr, -1);
  const isConsecutive = prev.lastCompletedDate === yesterdayStr;
  const currentStreak = isConsecutive ? prev.currentStreak + 1 : 1;

  return {
    progress: completeDailyChallengeProgress({
      userId: prev.userId,
      currentStreak: currentStreak,
      bestStreak: Math.max(prev.bestStreak, currentStreak),
      totalCompleted: prev.totalCompleted + 1,
      lastCompletedDate: dateStr,
      lastResultId: resultId,
      updatedAt: nowIso,
    }),
    changed: true,
  };
}

// Copie locale volontaire de shiftDateStr (date-utils.js) : ce fichier est
// delibrement SANS AUCUNE dependance (meme principe que question-progress-
// logic.js, "testable directement") - importer date-utils.js ici casserait
// cette garantie pour un unique decalage de jour.
function shiftDateStrLocal(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
