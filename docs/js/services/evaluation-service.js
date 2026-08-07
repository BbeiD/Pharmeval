// ===================== IDENTIFIANT PEDAGOGIQUE D'UNE QUESTION =====================
// Seule responsabilite restante de ce fichier (voir git history pour
// l'ancien mecanisme de synchronisation V1 des evaluations vers
// users/{uid}/evaluations, retire le 24/07/2026 : plus aucun appelant nulle
// part dans le code, remplace depuis par evaluation_results/evaluation-
// session-service.js).

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
