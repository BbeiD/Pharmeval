// ===================== LOGIQUE PURE — COMPOSITION DU POOL D'ENTRAINEMENT LIBRE (Sprint 21.5, Phase B1) =====================
// Aucune dependance Firestore. Voir free-training-service.js pour
// l'orchestration reelle.
//
// PRINCIPE (respecte le cadrage Phase B0, point 3 - "eviter une
// explosion du nombre d'index") : SEULS status + documentSourceId
// (+ documentSectionId OU + difficulty, jamais les deux en meme temps
// cote serveur) passent par une clause Firestore (voir free-training-
// service.js). Tags, "avec images", et la difficulte quand une section
// est deja choisie sont TOUJOURS des post-filtres ici, sur le pool DEJA
// BORNE retourne par searchQuestionsBounded().

/**
 * @param {Array<object>} items - questions (documents complets) deja
 *   chargees, deja bornees (voir searchQuestionsBounded)
 * @param {{tag?:string, difficulty?:string, sectionAlreadyScoped?:boolean}} filters
 * @returns {Array<object>}
 */
export function applySecondaryFilters(items, filters) {
  const f = filters || {};
  return items.filter(function(q) {
    if (f.tag && !(Array.isArray(q.tags) && q.tags.indexOf(f.tag) !== -1)) return false;
    // La difficulte n'est filtree ICI (cote client) que si une section a
    // deja ete choisie - sinon elle est deja filtree cote serveur (voir
    // free-training-service.js) et ne doit jamais l'etre deux fois.
    if (f.difficulty && f.sectionAlreadyScoped && q.difficulty !== f.difficulty) return false;
    return true;
  });
}

/**
 * Melange Fisher-Yates - meme algorithme que parcours-evaluation-
 * service.js (shuffle()), reimplemente ici pour rester une fonction PURE
 * sans dependance croisee avec un fichier qui, lui, importe Firestore.
 * @param {Array} arr
 * @returns {Array} copie melangee, ne mute jamais l'original
 */
function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
  }
  return copy;
}

/**
 * Choisit `count` questions au hasard dans le pool déjà filtré. Si le
 * pool contient MOINS que `count` questions, retourne tout le pool
 * (jamais une erreur, jamais un remplissage inventé) - `actualCount`
 * permet à l'appelant de le signaler honnêtement à l'utilisateur.
 * @param {Array<object>} items
 * @param {number} count
 * @returns {{selected:Array<object>, actualCount:number, requestedCount:number}}
 */
export function pickRandomSubset(items, count) {
  const n = Math.min(count, items.length);
  const selected = shuffle(items).slice(0, n);
  return { selected: selected, actualCount: selected.length, requestedCount: count };
}

/**
 * AJOUT ("Test me", demande directe de David) : comme pickRandomSubset()
 * ci-dessus, mais REPARTIT le tirage sur les groupes (ex. une source
 * documentaire = un theme) plutot qu'un tirage uniforme sur le pool fusionne
 * - sans cette repartition, une grosse source (ex. 84 questions) dominerait
 * mecaniquement le tirage face a une petite (ex. 5 questions), a l'oppose
 * de l'objectif "sur tous les themes". Repartition en tourniquet : un
 * groupe melange (ordre des groupes ET ordre au sein de chaque groupe,
 * jamais un biais previsible), une question prise a chaque groupe a tour
 * de role jusqu'a atteindre `count` ou epuiser tous les groupes.
 *
 * @param {Array<object>} items
 * @param {number} count
 * @param {function(object):string} groupKeyFn - ex. q => q.documentSourceId
 * @returns {{selected:Array<object>, actualCount:number, requestedCount:number}}
 */
export function pickDiversifiedSubset(items, count, groupKeyFn) {
  const groupsMap = new Map();
  items.forEach(function(item) {
    const key = groupKeyFn(item);
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(item);
  });

  const groups = shuffle(Array.from(groupsMap.values()).map(shuffle));
  const selected = [];
  let remaining = groups.reduce(function(acc, g) { return acc + g.length; }, 0);
  let cursor = 0;
  while (selected.length < count && remaining > 0) {
    const group = groups[cursor % groups.length];
    if (group.length > 0) {
      selected.push(group.shift());
      remaining -= 1;
    }
    cursor += 1;
  }

  return { selected: selected, actualCount: selected.length, requestedCount: count };
}
