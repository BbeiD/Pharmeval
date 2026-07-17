// ===================== VOS RECOMMANDATIONS (INTERFACE) =====================
// Rendu uniquement. Aucun calcul metier ici : toute la logique de regles
// vit dans js/services/recommendation-service.js.
//
// Chaine de responsabilite :
//   Firestore -> history-service -> statistics-service -> recommendation-service -> recommendation.js -> Interface

import { generateRecommendations } from "./services/recommendation-service.js";

const TYPE_ICONS = {
  weakness: '🎯',
  forgotten_theme: '🕒',
  progression: '📈',
  regression: '📉',
  regularity_good: '🔥',
  regularity_inactive: '👋',
  exceptional: '🏆',
};

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * Rendu pur a partir d'une liste d'evaluations deja chargee (meme liste que
 * celle transmise a js/statistics.js - voir js/history.js pour le partage
 * d'une seule lecture Firestore entre les deux sections).
 *
 * @param {Array<object>} evaluations
 */
export function renderRecommendationsFromData(evaluations) {
  const container = document.getElementById('recommendations-body');
  if (!container) return;

  const result = generateRecommendations(evaluations || []);

  if (result.insufficientData) {
    container.innerHTML =
      '<div class="reco-empty">' +
        '<p>Continuez vos évaluations.</p>' +
        '<p>Nous construirons bientôt votre profil d\u2019apprentissage.</p>' +
      '</div>';
    return;
  }

  if (result.recommendations.length === 0) {
    container.innerHTML = '<div class="reco-empty"><p>Rien de particulier à signaler pour le moment : continuez ainsi !</p></div>';
    return;
  }

  container.innerHTML = result.recommendations.map(cardHtml).join('');
}

/** Message convivial en cas d'erreur (jamais de detail Firebase brut). */
export function renderRecommendationsError() {
  const container = document.getElementById('recommendations-body');
  if (container) {
    container.innerHTML = '<div class="reco-error">Impossible de charger vos recommandations pour le moment.</div>';
  }
}

export function renderRecommendationsLoading() {
  const container = document.getElementById('recommendations-body');
  if (container) container.innerHTML = '<div class="reco-loading">Analyse en cours…</div>';
}

function confidenceLabel(confidence) {
  if (confidence >= 80) return 'Fortement recommandé';
  if (confidence >= 55) return 'Recommandé';
  return 'Peu de données disponibles';
}

function cardHtml(rec) {
  const icon = TYPE_ICONS[rec.type] || '💡';
  const confPct = Math.round(rec.confidence);
  const actionAttrs = rec.action.enabled
    ? 'onclick="handleRecommendationAction(\'' + escapeHtml(rec.action.actionId) + '\', \'' + escapeHtml(rec.id) + '\')"'
    : 'disabled title="Bientôt disponible"';

  return (
    '<div class="reco-card" data-reco-id="' + escapeHtml(rec.id) + '">' +
      '<div class="reco-card-header">' +
        '<span class="reco-card-icon">' + icon + '</span>' +
        '<span class="reco-card-title">' + escapeHtml(rec.title) + '</span>' +
      '</div>' +
      '<div class="reco-card-description">' + escapeHtml(rec.description) + '</div>' +
      '<div class="reco-card-confidence">' + confPct + ' % · ' + escapeHtml(confidenceLabel(rec.confidence)) + '</div>' +
      '<div class="reco-card-actions">' +
        '<button class="btn-primary reco-action-btn" ' + actionAttrs + '>' + escapeHtml(rec.action.label) + '</button>' +
        '<button class="btn-secondary reco-ignore-btn" onclick="ignoreRecommendation(\'' + escapeHtml(rec.id) + '\')">Ignorer</button>' +
      '</div>' +
      '<details class="reco-why">' +
        '<summary>Pourquoi cette recommandation ?</summary>' +
        '<p>' + escapeHtml(rec.reason) + '</p>' +
      '</details>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Actions. Certaines ne sont pas encore implementees (voir action.enabled
// dans recommendation-service.js) : le bouton reste visible mais desactive,
// prevu proprement pour une activation future (evolutivite demandee).
// ---------------------------------------------------------------------------

/**
 * Repartit vers l'action associee a une recommandation. Seule
 * "start-evaluation" est implementee ce sprint : ferme le Centre de
 * progression et affiche l'accueil - l'utilisateur choisit ensuite lui-meme
 * son theme (le moteur propose, il ne decide jamais a la place de
 * l'utilisateur, conformement a la philosophie demandee).
 *
 * @param {string} actionId
 * @param {string} recommendationId
 */
export function handleRecommendationAction(actionId, recommendationId) {
  if (actionId === 'start-evaluation') {
    if (typeof window.closeHistoryView === 'function') window.closeHistoryView();
    if (typeof window.goHome === 'function') window.goHome();
    return;
  }
  // 'view-errors' et 'increase-difficulty' : prevus pour une version future
  // (voir RAPPORT_SPRINT7.md, "Evolutivite") ; les boutons correspondants
  // sont actuellement rendus desactives, cette branche ne devrait donc pas
  // etre atteinte - elle reste neanmoins definie proprement plutot que de
  // laisser un comportement silencieux si un bouton etait active par erreur.
  console.info('[recommendation.js] Action "' + actionId + '" pas encore implementee (recommandation ' + recommendationId + ').');
}

/**
 * Retire une recommandation ignoree par l'utilisateur de l'affichage.
 * Volontairement limite a la session en cours (aucune persistance) : ce
 * sprint ne prevoit pas de memoriser les recommandations ignorees d'une
 * session a l'autre (evolution possible pour un sprint futur).
 *
 * @param {string} recommendationId
 */
export function ignoreRecommendation(recommendationId) {
  const container = document.getElementById('recommendations-body');
  if (!container) return;
  const cards = container.querySelectorAll('.reco-card');
  let target = null;
  cards.forEach(function(card) {
    if (card.getAttribute('data-reco-id') === recommendationId) target = card;
  });
  if (target && target.parentNode) target.parentNode.removeChild(target);
}

// Rattachement explicite a window (attributs onclick du HTML classique).
window.handleRecommendationAction = handleRecommendationAction;
window.ignoreRecommendation = ignoreRecommendation;
