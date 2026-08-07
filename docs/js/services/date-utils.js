// ===================== UTILITAIRE DE DATES (PARTAGE) =====================
// Fonction unique de conversion/format de date, utilisee par js/history.js
// (affichage des cartes) et js/services/statistics-service.js (tri
// chronologique pour la tendance). Extraite ici pour ne jamais dupliquer
// cette logique (Sprint 6, section 13 de la demande).
//
// Ce fichier n'effectue aucun appel Firestore : c'est un utilitaire pur,
// pas un service au sens des autres fichiers de js/services/.

/**
 * Convertit une valeur de date, quel que soit son format d'origine, en
 * objet Date natif. Gere explicitement :
 *  - un Timestamp Firestore reel (methode .toDate()) ;
 *  - un objet "brut" { seconds, nanoseconds } (Timestamp serialise) ;
 *  - une chaine ISO ;
 *  - un objet Date deja construit.
 *
 * Retourne `null` si la valeur est absente ou ne peut pas etre interpretee
 * comme une date valide (jamais une Date invalide silencieuse).
 *
 * @param {*} value
 * @returns {Date|null}
 */
export function toComparableDate(value) {
  if (!value) return null;

  let d = null;

  if (typeof value === 'object' && typeof value.toDate === 'function') {
    d = value.toDate();
  } else if (typeof value === 'object' && typeof value.seconds === 'number') {
    d = new Date(value.seconds * 1000 + Math.round((value.nanoseconds || 0) / 1e6));
  } else if (value instanceof Date) {
    d = value;
  } else {
    d = new Date(value);
  }

  if (!d || isNaN(d.getTime())) return null;
  return d;
}

/**
 * Formate une date (dans n'importe lequel des formats geres par
 * toComparableDate) en francais lisible (ex. "17 juillet 2026"). Retourne
 * toujours une chaine - jamais "Invalid Date" - meme pour une valeur
 * absente ou non interpretable.
 *
 * @param {*} value
 * @returns {string}
 */
export function formatDateFr(value) {
  const d = toComparableDate(value);
  if (!d) return '';
  try {
    return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return '';
  }
}

/**
 * Millisecondes depuis epoque pour une valeur de date quelconque, utile
 * pour trier ou comparer des evaluations de facon fiable quel que soit le
 * format de `completedAt` recu. Retourne 0 pour une valeur non
 * interpretable (placee arbitrairement au debut du temps plutot que de
 * provoquer un tri incoherent ou un crash).
 *
 * @param {*} value
 * @returns {number}
 */
export function toMillis(value) {
  const d = toComparableDate(value);
  return d ? d.getTime() : 0;
}

/**
 * AJOUT ("Activité récente", demande directe de David) : horodatage relatif
 * lisible ("Il y a 2 h", "Hier", "Il y a 3 jours") - au-dela d'une semaine,
 * retombe sur formatDateFr() ci-dessus (une date absolue reste plus utile
 * qu'un "il y a 12 jours" imprecis). `nowMs` est PARAMETRABLE (jamais
 * Date.now() implicite) uniquement pour rester testable de façon
 * deterministe - les appelants reels omettent ce parametre.
 * @param {*} value
 * @param {number} [nowMs]
 * @returns {string}
 */
export function formatRelativeFr(value, nowMs) {
  const d = toComparableDate(value);
  if (!d) return '';
  const now = (typeof nowMs === 'number') ? nowMs : Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return formatDateFr(value); // horodatage futur (horloge decalee) - jamais "il y a -3h"

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'À l\'instant';
  if (minutes < 60) return 'Il y a ' + minutes + ' min';

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'Il y a ' + hours + ' h';

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  if (days < 7) return 'Il y a ' + days + ' jours';

  return formatDateFr(value);
}

/**
 * AJOUT (Défi du jour) : date du jour, au format 'AAAA-MM-JJ', dans le
 * fuseau LOCAL du navigateur (pas UTC - "aujourd'hui" doit correspondre à
 * la date que voit réellement l'utilisateur). Sert d'identifiant du "défi
 * du jour" en cours (voir daily-challenge-logic.js) - jamais un Timestamp
 * Firestore, une simple chaîne comparable et triable directement.
 * @returns {string}
 */
export function todayDateStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

/**
 * Décale une date 'AAAA-MM-JJ' d'un nombre de jours (positif ou négatif) -
 * arithmétique pure sur la chaîne, sans dépendre du fuseau horaire courant
 * (interprétée en UTC pour ce seul calcul, la chaîne résultat reste un
 * simple 'AAAA-MM-JJ' comparable à todayDateStr() ci-dessus).
 * @param {string} dateStr
 * @param {number} deltaDays
 * @returns {string}
 */
export function shiftDateStr(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
