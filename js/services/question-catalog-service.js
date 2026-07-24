// ===================== SERVICE DE CATALOGUE DE QUESTIONS (FIRESTORE) =====================
// Responsabilite UNIQUE : toute lecture et ecriture Firestore de la
// collection GLOBALE `questions` (jamais sous `users/{uid}` - les
// questions sont communes a tous les utilisateurs, voir RAPPORT_SPRINT10.md).
//
// Utilise l'IDENTIFIANT PEDAGOGIQUE (ex. "PHARM-BAP-000124") DIRECTEMENT
// comme identifiant de document Firestore - jamais un identifiant genere
// aleatoirement par Firestore. Cela permet des mises a jour, une
// synchronisation et des imports incrementaux naturels : reimporter un
// fichier corrige met simplement a jour le MEME document.
//
// Ce fichier ne contient AUCUNE regle de validation (voir
// question-import-validator.js) ni de construction de document (voir
// question-parser.js) : il ne fait que lire et ecrire ce qu'on lui donne
// deja construit et valide.
//
// Sprint 11 (Banque de questions) : etend ce meme service (une seule
// responsabilite - Firestore I/O sur `questions` - mais davantage
// d'operations) avec la pagination reelle, la recherche bornee, et les
// operations de gestion (changement de statut, edition limitee,
// suppression). Aucune regle metier ni journalisation ici : voir
// js/services/question-bank-service.js, seul appelant legitime de ces
// nouvelles fonctions.

import { db, auth } from "../firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { MAX_QUESTIONS_PER_IMPORT } from "./question-import-validator.js";
import { buildFilterDescriptors } from "./question-filter-utils.js";
import { API_BASE_URL } from "../config.js";

async function callQuestionsApi(path, options) {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options && options.headers) },
  });
  return res;
}

const QUESTIONS_COLLECTION = 'questions';

// Sprint 11 : taille de page par defaut pour la navigation paginee de la
// Banque de questions (voir js/services/question-bank-service.js).
export const DEFAULT_BANK_PAGE_SIZE = 25;

// Sprint 11 : plafond de balayage pour la recherche textuelle (voir
// Correctif Sprint 11 ("preparer l'architecture pour un futur moteur de
// recherche, eviter que cette limite soit codee de maniere rigide") :
// cette valeur reste le DEFAUT du balayage borne (voir searchQuestionsBounded
// ci-dessous), mais n'est plus une constante figee - voir
// js/services/question-search-provider.js, qui expose getSearchScanLimit()/
// setSearchScanLimit() comme point de configuration central. Ne JAMAIS lire
// cette variable directement depuis un autre fichier : passer par
// question-search-provider.js, seul point d'entree recommande pour la
// recherche (voir ce fichier pour le detail de la preparation architecturale).
let defaultSearchScanLimit = 500;

/** Limite de balayage actuellement configuree (voir question-search-
 * provider.js pour l'API de configuration recommandee - exportee ici
 * uniquement pour compatibilite et tests directs de ce fichier). */
export function getDefaultSearchScanLimit() {
  return defaultSearchScanLimit;
}
/** Reconfigure la limite par defaut du balayage borne. N'affecte que les
 * appels futurs qui ne precisent pas explicitement `options.maxScan`. */
export function setDefaultSearchScanLimit(n) {
  if (typeof n === 'number' && n > 0) defaultSearchScanLimit = n;
}

function logCatalogError(context, err) {
  const code = (err && err.code) || 'erreur-inconnue';
  console.error('[question-catalog-service] ' + context + ' : ' + code, err);
}

/**
 * Relit un document existant par son identifiant pedagogique (utilise
 * directement comme identifiant de document Firestore).
 *
 * @param {string} pedagogicalId
 * @returns {Promise<object|null>}
 */
export async function getExistingQuestionByPedagogicalId(pedagogicalId) {
  try {
    const result = await getExistingQuestionsByPedagogicalIds([pedagogicalId]);
    if (result.error) return null;
    return result.map.get(pedagogicalId) || null;
  } catch (err) {
    logCatalogError('lecture de la question ' + pedagogicalId, err);
    return null;
  }
}

/**
 * Relit plusieurs documents par leurs identifiants pedagogiques, en
 * parallele. Retourne une correspondance identifiant -> document existant
 * (absent de la Map si la question n'existe pas encore - une CREATION).
 *
 * IMPORTANT (correctif de fiabilite) : effectue ses PROPRES lectures brutes
 * plutot que de reutiliser getExistingQuestionByPedagogicalId() ci-dessus,
 * qui avale ses erreurs individuellement et retourne `null` aussi bien pour
 * "n'existe pas" que pour "la lecture a echoue". Reutiliser cette fonction
 * ici aurait rendu une panne Firestore totale indiscernable d'un import ne
 * comportant que des nouvelles questions - un risque reel d'importer des
 * doublons ou de manquer des mises a jour sans jamais le savoir. Ici, la
 * moindre erreur individuelle fait echouer l'ENSEMBLE de l'operation
 * (error:true), jamais un resultat partiel presente comme fiable.
 *
 * Passe desormais par l'API (Cloud Function, meme regle de visibilite que
 * firestore.rules), en un seul appel HTTP pour tout le lot plutot qu'une
 * lecture Firestore par identifiant - la garantie "erreur individuelle =
 * echec de tout le lot" ci-dessus reste inchangee (toute erreur de l'appel
 * remonte au catch englobant).
 *
 * @param {Array<string>} pedagogicalIds
 * @returns {Promise<{map:Map<string,object>, error:boolean}>}
 */
export async function getExistingQuestionsByPedagogicalIds(pedagogicalIds) {
  const unique = Array.from(new Set((pedagogicalIds || []).filter(Boolean)));
  if (unique.length === 0) return { map: new Map(), error: false };
  try {
    if (!auth.currentUser) return { map: new Map(), error: false };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/questions-by-ids?ids=${unique.map(encodeURIComponent).join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logCatalogError('lecture groupee des questions existantes (API ' + res.status + ')', null);
      return { map: new Map(), error: true };
    }
    const body = await res.json();
    return { map: new Map(Object.entries(body)), error: false };
  } catch (err) {
    logCatalogError('lecture groupee des questions existantes', err);
    return { map: new Map(), error: true };
  }
}

/**
 * Ecrit un lot de documents question dans Firestore en UN SEUL bloc
 * atomique (writeBatch).
 *
 * CORRECTIF (post-Sprint 10) : n'accepte plus qu'un unique writeBatch,
 * jamais un decoupage en plusieurs blocs successifs. GARANTIE D'ATOMICITE
 * REELLE : Firestore garantit que TOUTES les ecritures d'un writeBatch
 * reussissent ou qu'AUCUNE n'est appliquee. Comme js/services/question-
 * import-validator.js refuse desormais tout fichier depassant
 * MAX_QUESTIONS_PER_IMPORT (500) AVANT meme d'atteindre cette fonction,
 * cette garantie s'applique desormais a l'integralite de tout import
 * reellement traite - plus de zone grise "atomique par bloc, pas au-dela".
 *
 * DEFENSE EN PROFONDEUR : si cette fonction recevait malgre tout plus de
 * MAX_QUESTIONS_PER_IMPORT documents (ex. appel direct contournant
 * import-service.js/le validateur), elle refuse d'ecrire plutot que de
 * silencieusement decouper en plusieurs blocs comme avant ce correctif -
 * jamais de compromis sur l'atomicite, meme en cas de contournement.
 *
 * @param {Map<string, object>} documentsByPedagogicalId - identifiant -> document Firestore complet
 * @returns {Promise<{success:boolean, writtenCount:number, error:boolean}>}
 */
export async function writeQuestionsBatch(documentsByPedagogicalId) {
  const entries = Array.from(documentsByPedagogicalId.entries());
  if (entries.length === 0) {
    return { success: true, writtenCount: 0, error: false };
  }

  if (entries.length > MAX_QUESTIONS_PER_IMPORT) {
    logCatalogError('ecriture du lot de questions', new Error('Lot de ' + entries.length + ' questions au-dela de la limite d\'atomicite (' + MAX_QUESTIONS_PER_IMPORT + ') - ecriture refusee (defense en profondeur, le validateur aurait deja du bloquer ce fichier).'));
    return { success: false, writtenCount: 0, error: true };
  }

  try {
    const res = await callQuestionsApi('/api/questions/batch', {
      method: 'POST',
      body: JSON.stringify({ documents: Object.fromEntries(entries) }),
    });
    if (!res || !res.ok) {
      logCatalogError('ecriture du lot de questions (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, writtenCount: 0, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('ecriture du lot de questions', err);
    return { success: false, writtenCount: 0, error: true };
  }
}

// ---------------------------------------------------------------------------
// Sprint 11 : navigation, recherche, et actions de gestion de la Banque de
// questions. Reutilise la MEME collection `questions` (aucune duplication),
// simplement de nouvelles operations de lecture/ecriture dessus.
// ---------------------------------------------------------------------------

/**
 * "Ne pas masquer une erreur Firestore d'index manquant" - meme patron que
 * document-source-catalog-service.js (Sprint 20), reutilise ici tel quel
 * (Sprint 21.5, Phase B0) plutot que duplique sous une forme legerement
 * differente.
 * @param {*} err
 * @returns {boolean}
 */
function isIndexMissingError(err) {
  return !!err && err.code === 'failed-precondition' && /index/i.test(err.message || '');
}
const INDEX_MISSING_MESSAGE = 'Cette fonctionnalité nécessite un index Firestore qui n\'est pas encore déployé (voir firestore.indexes.json et la procédure de déploiement). Contactez l\'administrateur technique.';

/**
 * Traduit les descripteurs purs (voir question-filter-utils.js, seule
 * source de verite pour LA LOGIQUE de filtrage) en clauses reelles du
 * SDK Firestore (`where(...)`). Aucune logique de filtrage ici, jamais
 * dupliquee - uniquement la traduction descripteur -> appel SDK.
 * @param {object} filters
 * @returns {Array} clauses Firestore pretes a etre passees a query(...)
 */
export function buildFilterClauses(filters) {
  return buildFilterDescriptors(filters).map(function(d) { return where(d.field, d.op, d.value); });
}

/**
 * Charge UNE PAGE de questions, filtree et triee cote SERVEUR (vraie
 * pagination Firestore par curseur - jamais un chargement de toute la
 * collection). Utilisee pour la navigation normale (sans recherche
 * textuelle) de la Banque de questions - voir question-bank-service.js.
 *
 * IMPORTANT (a savoir avant publication) : combiner un filtre d'egalite
 * (`where`) avec un tri (`orderBy`) sur un champ different necessite un
 * INDEX COMPOSITE Firestore. Voir firestore.indexes.json (propose, non
 * deploye) pour les combinaisons filtre+tri recommandees. Sans l'index
 * correspondant deploye, Firestore renverra une erreur explicite (avec un
 * lien de creation automatique de l'index) plutot qu'un resultat errone -
 * jamais un risque de donnee incorrecte, seulement une fonctionnalite
 * indisponible tant que l'index n'est pas cree.
 *
 * @param {{filters:object, sortField:string, sortDirection:('asc'|'desc'), pageSize:number, cursorDoc:(object|null)}} options
 * @returns {Promise<{items:Array<object>, lastDoc:(object|null), hasMore:boolean, error:boolean}>}
 */
export async function queryQuestionsPage(options) {
  const opts = options || {};
  const pageSize = opts.pageSize || DEFAULT_BANK_PAGE_SIZE;
  try {
    const colRef = collection(db, QUESTIONS_COLLECTION);
    const clauses = buildFilterClauses(opts.filters);
    clauses.push(orderBy(opts.sortField || 'createdAt', opts.sortDirection || 'desc'));
    clauses.push(limit(pageSize));
    if (opts.cursorDoc) clauses.push(startAfter(opts.cursorDoc));
    const q = query(colRef, ...clauses);
    const snap = await getDocs(q);
    const items = [];
    let lastRawDoc = null;
    snap.forEach(function(d) { items.push(d.data()); lastRawDoc = d; });
    return { items: items, lastDoc: lastRawDoc, hasMore: items.length === pageSize, error: false };
  } catch (err) {
    logCatalogError('chargement d\'une page de questions', err);
    return { items: [], lastDoc: null, hasMore: false, error: true, message: isIndexMissingError(err) ? INDEX_MISSING_MESSAGE : null };
  }
}

/**
 * Balayage BORNE (jamais toute la collection) pour la recherche textuelle
 * libre, qui n'est PAS nativement supportee par Firestore (pas de
 * recherche plein texte / sous-chaine sur des champs arbitraires, y
 * compris un champ tableau comme `tags`). Retourne un lot borne (par
 * defaut getDefaultSearchScanLimit(), deja filtre par egalite cote serveur
 * si des filtres sont actifs), sur lequel js/services/question-bank-
 * service.js applique ensuite la correspondance textuelle et une
 * pagination cote client.
 *
 * CORRECTIF Sprint 11 : la limite n'est plus figee - `options.maxScan`
 * permet de la surcharger par appel (utilise par js/services/question-
 * search-provider.js, le point d'entree recommande pour la recherche -
 * voir ce fichier pour la preparation d'un futur moteur externe).
 *
 * LIMITE HONNETE (documentee, pas cachee) : si la base depasse
 * significativement la limite configuree de questions correspondant aux
 * filtres actifs, une recherche textuelle peut manquer des resultats plus
 * anciens non compris dans ce balayage. Une recherche reellement
 * exhaustive a grande echelle necessiterait un moteur de recherche dedie
 * (ex. Algolia, Meilisearch, ou une Cloud Function d'indexation) - voir
 * js/services/question-search-provider.js, qui prepare l'architecture
 * pour accueillir un tel moteur sans devoir modifier ce fichier ni
 * question-bank-service.js le jour venu. Le drapeau `truncated` du
 * resultat permet a l'interface de le signaler clairement plutot que de
 * laisser croire a une recherche exhaustive.
 *
 * @param {{filters:object, sortField:string, sortDirection:string, maxScan?:number}} options
 * @returns {Promise<{items:Array<object>, truncated:boolean, error:boolean, scanLimit:number}>}
 */
export async function searchQuestionsBounded(options) {
  const opts = options || {};
  const scanLimit = (typeof opts.maxScan === 'number' && opts.maxScan > 0) ? opts.maxScan : defaultSearchScanLimit;
  try {
    if (!auth.currentUser) return { items: [], truncated: false, error: false, scanLimit: scanLimit };
    const token = await auth.currentUser.getIdToken();
    const params = new URLSearchParams({
      maxScan: String(scanLimit),
      sortField: opts.sortField || 'createdAt',
      sortDirection: opts.sortDirection || 'desc',
    });
    if (opts.filters) params.set('filters', JSON.stringify(opts.filters));
    const res = await fetch(`${API_BASE_URL}/api/questions/search-bounded?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logCatalogError('balayage de recherche (API ' + res.status + ')', null);
      return { items: [], truncated: false, error: true, scanLimit: scanLimit };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('balayage de recherche', err);
    return { items: [], truncated: false, error: true, scanLimit: scanLimit, message: isIndexMissingError(err) ? INDEX_MISSING_MESSAGE : null };
  }
}

/**
 * Change UNIQUEMENT le statut d'une question (Publier / Archiver / Remettre
 * en brouillon - voir js/services/question-bank-service.js pour la
 * confirmation et la journalisation). Ne modifie jamais aucun autre champ.
 *
 * @param {string} pedagogicalId
 * @param {string} newStatus
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateQuestionStatus(pedagogicalId, newStatus) {
  try {
    const res = await callQuestionsApi(`/api/questions/${pedagogicalId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res || !res.ok) {
      logCatalogError('changement de statut de la question ' + pedagogicalId + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('changement de statut de la question ' + pedagogicalId, err);
    return { success: false, error: true };
  }
}

/**
 * Met a jour UNIQUEMENT les champs de classification documentaire d'une
 * question (documentSourceId/documentSectionId/functionalCode/
 * classificationVersion). Miroir exact de la mise a jour n°4 de
 * firestore.rules (isRequesterCatalogAdmin(), statut TOUJOURS inchange) -
 * DISTINCTE de l'ancien editeur limite du Sprint 11 (explanation/tags/
 * source, isRequesterAdmin()), retire le 24/07/2026 : les deux regles
 * etaient a tort servies par une seule fonction cote client
 * (updateQuestionFields()), dont la liste blanche ne correspondait qu'a
 * l'editeur - consequence, le reclassement en masse (document-count-
 * service.js#applyBulkClassificationDeltas) n'ecrivait jamais reellement
 * documentSourceId/documentSectionId malgre un succes apparent. Voir git
 * history pour l'ancienne fonction ; l'editeur limite lui-meme n'a plus
 * aucun appelant reel (retire cote admin, voir question-bank-service.js).
 * @param {string} pedagogicalId
 * @param {{documentSourceId?:(string|null), documentSectionId?:(string|null), functionalCode?:string, classificationVersion?:number}} fields
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function updateQuestionClassification(pedagogicalId, fields) {
  try {
    const res = await callQuestionsApi(`/api/questions/${pedagogicalId}/classification`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    if (!res || !res.ok) {
      logCatalogError('classification de la question ' + pedagogicalId + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('classification de la question ' + pedagogicalId, err);
    return { success: false, error: true };
  }
}

/**
 * Supprime DEFINITIVEMENT une question (suppression reelle, pas un
 * archivage - voir js/services/question-bank-service.js pour la
 * confirmation et la journalisation obligatoires avant tout appel). Aucun
 * retour en arriere possible une fois la suppression confirmee.
 *
 * @param {string} pedagogicalId
 * @returns {Promise<{success:boolean, error:boolean}>}
 */
export async function deleteQuestionDocument(pedagogicalId) {
  try {
    const res = await callQuestionsApi(`/api/questions/${pedagogicalId}`, { method: 'DELETE' });
    if (!res || !res.ok) {
      logCatalogError('suppression de la question ' + pedagogicalId + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('suppression de la question ' + pedagogicalId, err);
    return { success: false, error: true };
  }
}

/**
 * Archive EN CASCADE toutes les questions rattachees a une source
 * documentaire (utilise par "Supprimer le referentiel", voir
 * document-source-service.js#deleteDocumentSource) - jamais une
 * suppression reelle, uniquement un changement de statut. Les questions
 * deja en corbeille sont ignorees (decision individuelle deja prise sur
 * CETTE question, independante du sort de sa source).
 * @param {string} documentSourceId
 * @returns {Promise<{success:boolean, archivedCount:number, error:boolean}>}
 */
export async function archiveQuestionsBySource(documentSourceId) {
  try {
    const res = await callQuestionsApi('/api/questions/archive-by-source', {
      method: 'POST',
      body: JSON.stringify({ documentSourceId }),
    });
    if (!res || !res.ok) {
      logCatalogError('archivage en cascade des questions de la source ' + documentSourceId + ' (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, archivedCount: 0, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('archivage en cascade des questions de la source ' + documentSourceId, err);
    return { success: false, archivedCount: 0, error: true };
  }
}

/**
 * Resout les identifiants pedagogiques de toutes les questions PUBLIEES
 * rattachees a un LOT de sources documentaires (utilise pour construire le
 * pool d'une evaluation de parcours mixte ainsi que pour le calcul de
 * progression - voir parcours-evaluation-service.js et parcours-completion-
 * service.js, un seul point de verite pour cette resolution). Decoupe par
 * lots de 30 (limite Firestore d'une clause `in`, meme limite deja
 * documentee et appliquee dans assignment-catalog-service.js).
 * @param {Array<string>} sourceIds
 * @returns {Promise<Array<string>>}
 */
export async function getPublishedQuestionIdsBySourceIds(sourceIds) {
  const unique = Array.from(new Set((sourceIds || []).filter(Boolean)));
  if (unique.length === 0) return [];

  const CHUNK_SIZE = 30;
  const ids = [];
  try {
    for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
      const chunk = unique.slice(i, i + CHUNK_SIZE);
      const snap = await getDocs(query(
        collection(db, QUESTIONS_COLLECTION),
        where('status', '==', 'published'),
        where('documentSourceId', 'in', chunk),
      ));
      snap.forEach(function(d) { ids.push(d.id); });
    }
    return ids;
  } catch (err) {
    logCatalogError('resolution des questions publiees pour ' + unique.length + ' source(s)', err);
    return [];
  }
}

/**
 * Publie EN MASSE toutes les questions actuellement au statut "draft"
 * (bouton "Publier toutes les questions en brouillon", voir
 * question-bank-service.js). Ne touche a aucune question dans un autre
 * statut (review/published/archived/trash restent inchangees).
 * @returns {Promise<{success:boolean, publishedCount:number, error:boolean}>}
 */
export async function publishAllDraftQuestions() {
  try {
    const res = await callQuestionsApi('/api/questions/publish-all-draft', { method: 'POST' });
    if (!res || !res.ok) {
      logCatalogError('publication en masse des questions en brouillon (API ' + (res ? res.status : 'hors-ligne') + ')', null);
      return { success: false, publishedCount: 0, error: true };
    }
    return await res.json();
  } catch (err) {
    logCatalogError('publication en masse des questions en brouillon', err);
    return { success: false, publishedCount: 0, error: true };
  }
}
