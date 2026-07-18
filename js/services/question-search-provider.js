// ===================== FOURNISSEUR DE RECHERCHE (ABSTRACTION) =====================
// Correctif Sprint 11 ("preparer l'architecture pour une future integration
// d'un moteur de recherche (Algolia, Meilisearch ou equivalent), eviter que
// cette limite soit codee de maniere rigide").
//
// Ce fichier N'IMPLEMENTE PAS d'integration avec un moteur externe - c'est
// explicitement un point de PREPARATION, pas une implementation (comme
// demande). Il fait UNE chose : isoler js/services/question-bank-service.js
// (et donc admin/bank.js) de la maniere DONT la recherche est reellement
// executee aujourd'hui (un balayage Firestore borne, voir
// question-catalog-service.js). Le jour ou un moteur externe (Algolia,
// Meilisearch...) sera reellement integre, SEUL ce fichier devra changer -
// ni question-bank-service.js, ni admin/bank.js n'auront besoin d'etre
// modifies, tant que la forme du resultat retourne reste la meme.
//
// Aujourd'hui, un seul fournisseur existe reellement : le balayage borne
// Firestore deja construit au Sprint 10/11 (question-catalog-service.js).

import { searchQuestionsBounded, getDefaultSearchScanLimit, setDefaultSearchScanLimit } from "./question-catalog-service.js";

/**
 * Fournisseurs de recherche connus. Un seul est reellement implemente
 * aujourd'hui (FIRESTORE_BOUNDED_SCAN). Les autres sont des reservations
 * de nom pour une integration future - les ajouter ici ne suffit pas a les
 * activer, voir searchQuestions() ci-dessous qui devra etre etendue le
 * jour ou l'un d'eux sera reellement cable.
 */
export const SEARCH_PROVIDERS = Object.freeze({
  FIRESTORE_BOUNDED_SCAN: 'firestore_bounded_scan', // implemente (Sprint 10/11)
  ALGOLIA: 'algolia',           // reserve, non implemente
  MEILISEARCH: 'meilisearch',   // reserve, non implemente
});

let activeProvider = SEARCH_PROVIDERS.FIRESTORE_BOUNDED_SCAN;

/**
 * Fournisseur de recherche actuellement actif. Aujourd'hui toujours
 * FIRESTORE_BOUNDED_SCAN - exposee pour que l'interface puisse, si
 * souhaite, indiquer a l'utilisateur quel mecanisme de recherche est en
 * vigueur (ex. dans un futur message d'aide).
 *
 * @returns {string}
 */
export function getActiveSearchProvider() {
  return activeProvider;
}

/**
 * Change le fournisseur de recherche actif. Ne fait rien de plus que
 * changer la variable : un fournisseur non implemente (ALGOLIA,
 * MEILISEARCH) fera echouer searchQuestions() ci-dessous avec une erreur
 * explicite plutot que d'echouer silencieusement - voir searchQuestions().
 * Reservee a une future mise en place reelle de ces fournisseurs ; ne pas
 * appeler avec autre chose que FIRESTORE_BOUNDED_SCAN tant qu'aucun autre
 * fournisseur n'est reellement implemente.
 *
 * @param {string} providerName - une valeur de SEARCH_PROVIDERS
 */
export function setActiveSearchProvider(providerName) {
  if (Object.values(SEARCH_PROVIDERS).indexOf(providerName) !== -1) {
    activeProvider = providerName;
  }
}

/**
 * Limite de balayage actuellement configuree pour le fournisseur borne
 * Firestore (voir question-catalog-service.js). PAS une valeur figee dans
 * le code : configurable via setSearchScanLimit() ci-dessous, sans devoir
 * modifier aucun fichier. Un futur fournisseur externe (Algolia,
 * Meilisearch) n'aurait probablement plus besoin de cette notion de
 * "balayage borne" (une vraie recherche plein texte cote serveur n'a pas
 * cette limitation) - cette fonction resterait neanmoins disponible pour
 * une compatibilite ascendante du fournisseur actuel.
 *
 * @returns {number}
 */
export function getSearchScanLimit() {
  return getDefaultSearchScanLimit();
}

/**
 * Reconfigure la limite de balayage du fournisseur borne Firestore, sans
 * modifier aucun fichier de code - exactement la demande du correctif
 * ("eviter que cette limite soit codee de maniere rigide").
 *
 * @param {number} n
 */
export function setSearchScanLimit(n) {
  setDefaultSearchScanLimit(n);
}

/**
 * Point d'entree UNIQUE de recherche, utilise par js/services/question-
 * bank-service.js. Toujours la MEME forme de resultat, quel que soit le
 * fournisseur actif - c'est cette stabilite de forme qui permet de changer
 * de fournisseur plus tard sans modifier les appelants.
 *
 * @param {{filters:object, sortField:string, sortDirection:string, maxScan?:number}} options
 * @returns {Promise<{items:Array<object>, truncated:boolean, error:boolean, provider:string, scanLimit:number}>}
 */
export async function searchQuestions(options) {
  if (activeProvider === SEARCH_PROVIDERS.FIRESTORE_BOUNDED_SCAN) {
    const result = await searchQuestionsBounded(options);
    return Object.assign({}, result, { provider: activeProvider });
  }
  // Point d'extension future : brancher ici un veritable adaptateur
  // Algolia/Meilisearch, en respectant la MEME forme de resultat
  // ({items, truncated, error, provider, scanLimit}) que ci-dessus, pour
  // que question-bank-service.js n'ait jamais besoin d'etre modifie.
  logUnsupportedProviderError(activeProvider);
  return { items: [], truncated: false, error: true, provider: activeProvider, scanLimit: getSearchScanLimit() };
}

function logUnsupportedProviderError(providerName) {
  console.error('[question-search-provider] Fournisseur de recherche non implemente : "' + providerName + '". Seul "' + SEARCH_PROVIDERS.FIRESTORE_BOUNDED_SCAN + '" est reellement cable a ce jour.');
}
