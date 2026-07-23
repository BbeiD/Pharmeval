// ===================== CONTROLEUR DE LA PAGE "RESULTAT DE L'EVALUATION" (Sprint 18) =====================
// Aucune logique metier ici : relit un EvaluationResult DEJA CALCULE
// (js/services/evaluation-result-service.js) et l'affiche - ne recalcule
// JAMAIS rien ("Ne jamais recalculer le résultat à chaque ouverture",
// SPRINT18 section 12).

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { formatDateFr } from "./services/date-utils.js";
import { getResultForCurrentUser, resolveExplanations, resolveJustificationResourceRefs } from "./services/evaluation-result-service.js";

// PROTOTYPE (test David, 23/07/2026 - "images dans les justifications",
// voir GUIDE_GENERATION_QUESTIONS_PDF.md) : chemin LOCAL de test uniquement,
// pointant vers le dossier de travail hors Git ou vivent les images du
// premier lot pilote. Ne fonctionnera PAS une fois pousse en production -
// Phase 2 (vrai stockage, cf. discussion IT) doit fixer un emplacement
// reel avant toute mise en service. A retirer/remplacer a ce moment-la.
const JUSTIFICATION_IMAGE_BASE_PATH = 'data/catalogue-review/_test_justification_images/';
import { COMPETENCY_STATUS_LABELS } from "./services/correction-policy-service.js";
import { getParcoursById } from "./services/parcours-catalog-service.js";
import { getCompetencyById } from "./services/competency-catalog-service.js";
import { icon } from "./icons.js";

const QUESTION_STATUS_LABELS = {
  correct: icon('feedback-correct', { size: 13 }) + ' Correcte',
  incorrect: icon('feedback-incorrect', { size: 13 }) + ' Incorrecte',
  unanswered: 'Sans réponse',
};
const QUESTION_STATUS_CLASS = { correct: 'er-q-correct', incorrect: 'er-q-incorrect', unanswered: 'er-q-unanswered' };
const COMPETENCY_STATUS_CLASS = { mastered: 'bank-badge-published', to_reinforce: 'bank-badge-draft', not_acquired: 'bank-badge-archived' };

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function qs(id) { return document.getElementById(id); }

onAuthStateChanged(auth, async function(user) {
  if (!user) { clearCurrentUserContext(); window.location.href = 'index.html'; return; }
  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }
  await init();
});

async function init() {
  const resultId = new URLSearchParams(window.location.search).get('resultId');
  const result = await getResultForCurrentUser(resultId);

  qs('er-loading').style.display = 'none';

  if (!result.authorized) {
    qs('er-denied-message').textContent = result.message || 'Ce résultat est introuvable.';
    qs('er-denied').style.display = 'block';
    return;
  }

  qs('er-view').style.display = 'block';
  await render(result.result);
}

async function render(result) {
  // SPRINT 21.5, PHASE B1 : un resultat d'entrainement libre n'a ni
  // parcoursId ni competencyId (voir evaluation-correction-service.js) -
  // masquage du bloc parcours/competence, jamais un "null" affiche tel
  // quel. Comportement "parcours" historique ci-dessous entierement
  // inchange dans le bloc else.
  if (!result.competencyId) {
    qs('er-breadcrumb-root').textContent = 'Entraînement libre';
    qs('er-breadcrumb-root').href = 'entrainement-libre.html';
    qs('er-breadcrumb-sep1').style.display = 'none';
    qs('er-breadcrumb-parcours').style.display = 'none';
    qs('er-breadcrumb-sep2').style.display = 'none';
    qs('er-competency-name').textContent = 'Entraînement libre' + (result.createdAt ? ' — soumis le ' + formatDateFr(result.createdAt) : '');
    qs('er-back-parcours').textContent = '← Retour à l\'entraînement libre';
    qs('er-back-parcours').href = 'entrainement-libre.html';
    qs('er-progression-link').style.display = 'none';
    qs('er-competency-section').style.display = 'none';

    renderScoreCard(result.score);

    const allPedagogicalIds = result.competencyResults.reduce(function(acc, c) {
      return acc.concat(c.questionResults.map(function(q) { return q.pedagogicalId; }));
    }, []);
    const [explanations, resourceRefs] = await Promise.all([
      resolveExplanations(allPedagogicalIds),
      resolveJustificationResourceRefs(allPedagogicalIds),
    ]);
    renderQuestionList(result.competencyResults, explanations, resourceRefs);
    return;
  }

  const [parcours, competency] = await Promise.all([
    getParcoursById(result.parcoursId),
    getCompetencyById(result.competencyId),
  ]);
  const parcoursName = (parcours && parcours.name) || 'Parcours';
  const competencyName = (competency && competency.name) || 'Compétence';
  const parcoursLink = result.parcoursId ? ('parcours-detail.html?id=' + encodeURIComponent(result.parcoursId)) : 'mes-parcours.html';

  qs('er-breadcrumb-parcours').textContent = parcoursName;
  qs('er-breadcrumb-parcours').href = parcoursLink;
  qs('er-competency-name').textContent = competencyName + (result.createdAt ? ' — soumise le ' + formatDateFr(result.createdAt) : '');
  qs('er-back-parcours').href = parcoursLink;
  qs('er-progression-link').href = 'mes-competences.html?competencyId=' + encodeURIComponent(result.competencyId);

  renderScoreCard(result.score);
  renderCompetencyResults(result.competencyResults, competencyName);

  const allPedagogicalIds = result.competencyResults.reduce(function(acc, c) {
    return acc.concat(c.questionResults.map(function(q) { return q.pedagogicalId; }));
  }, []);
  const [explanations, resourceRefs] = await Promise.all([
    resolveExplanations(allPedagogicalIds),
    resolveJustificationResourceRefs(allPedagogicalIds),
  ]);
  renderQuestionList(result.competencyResults, explanations, resourceRefs);
}

// ---------------------------------------------------------------------------
// Score global + graphique simple (SVG, "graphique simple", SPRINT18 section 7)
// ---------------------------------------------------------------------------

function renderScoreCard(score) {
  qs('er-score-percent').textContent = score.percent + ' %';
  qs('er-score-correct').textContent = score.correctCount;
  qs('er-score-incorrect').textContent = score.incorrectCount;
  qs('er-score-unanswered').textContent = score.unansweredCount;
  qs('er-score-chart').innerHTML = buildDonutChart(score);
}

/**
 * Construit un donut SVG minimal a partir de 3 segments (correct/
 * incorrect/sans reponse) - "graphique simple", jamais une bibliotheque
 * de graphiques externe pour un besoin aussi limite. Aucune dependance,
 * aucune animation, purement descriptif.
 * @param {object} score
 * @returns {string} SVG
 */
function buildDonutChart(score) {
  const total = score.totalCount || 1;
  const radius = 42, circumference = 2 * Math.PI * radius;
  const segments = [
    { count: score.correctCount, color: '#1D9E75' },
    { count: score.incorrectCount, color: '#E24B4A' },
    { count: score.unansweredCount, color: '#B0B7C3' },
  ];
  let offset = 0;
  const circles = segments.map(function(seg) {
    const fraction = seg.count / total;
    const length = fraction * circumference;
    const circle = '<circle cx="60" cy="60" r="' + radius + '" fill="none" stroke="' + seg.color + '" stroke-width="16" ' +
      'stroke-dasharray="' + length.toFixed(2) + ' ' + (circumference - length).toFixed(2) + '" ' +
      'stroke-dashoffset="-' + offset.toFixed(2) + '" transform="rotate(-90 60 60)"></circle>';
    offset += length;
    return circle;
  }).join('');
  return (
    '<svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Répartition des réponses : ' + score.percent + '% de bonnes réponses">' +
      '<circle cx="60" cy="60" r="' + radius + '" fill="none" stroke="var(--border)" stroke-width="16"></circle>' +
      circles +
      '<text x="60" y="66" text-anchor="middle" font-size="20" font-weight="700" fill="var(--text)">' + score.percent + '%</text>' +
    '</svg>'
  );
}

// ---------------------------------------------------------------------------
// Résultats par compétence (SPRINT18, section 4)
// ---------------------------------------------------------------------------

function renderCompetencyResults(competencyResults, fallbackName) {
  qs('er-competency-results').innerHTML = competencyResults.map(function(c) {
    const badgeClass = COMPETENCY_STATUS_CLASS[c.status] || 'bank-badge-draft';
    const statusLabel = COMPETENCY_STATUS_LABELS[c.status] || c.status;
    return (
      '<div class="pv-competency-card">' +
        '<div class="pv-competency-card-stripe"></div>' +
        '<div class="pv-competency-card-body">' +
          '<h3>' + escapeHtml(fallbackName) + '</h3>' +
          '<div class="bank-detail-tags-row">' +
            '<span class="bank-badge ' + badgeClass + '">' + escapeHtml(statusLabel) + '</span>' +
            '<span class="bank-chip">' + c.percent + ' %</span>' +
          '</div>' +
          '<p>' + c.totalCount + ' question(s) · ' + c.correctCount + ' bonne(s) · ' + c.incorrectCount + ' mauvaise(s) · ' + c.unansweredCount + ' sans réponse</p>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

// ---------------------------------------------------------------------------
// Détail des questions (SPRINT18, section 8)
// ---------------------------------------------------------------------------

function renderQuestionList(competencyResults, explanations, resourceRefs) {
  const questionResults = competencyResults.reduce(function(acc, c) { return acc.concat(c.questionResults); }, []);
  qs('er-question-list').innerHTML = questionResults.map(function(q, i) {
    const userAnswerText = (typeof q.userAnswer === 'number' && Array.isArray(q.options)) ? q.options[q.userAnswer] : null;
    const correctAnswerText = (typeof q.correctAnswer === 'number' && Array.isArray(q.options)) ? q.options[q.correctAnswer] : null;
    const explanation = explanations.get(q.pedagogicalId);
    const refs = (resourceRefs && resourceRefs.get(q.pedagogicalId)) || [];

    let html = '<div class="er-question-card ' + (QUESTION_STATUS_CLASS[q.status] || '') + '">';
    html += '<div class="er-question-header"><strong>Question ' + (i + 1) + '</strong><span class="bank-chip">' + (QUESTION_STATUS_LABELS[q.status] || q.status) + '</span></div>';
    html += '<p class="er-question-statement">' + escapeHtml(q.question) + '</p>';
    html += '<div class="er-question-answers">';
    html += '<div><strong>Votre réponse :</strong> ' + escapeHtml(userAnswerText || 'Aucune réponse fournie') + '</div>';
    if (q.status !== 'correct') {
      html += '<div><strong>Bonne réponse :</strong> ' + escapeHtml(correctAnswerText || '—') + '</div>';
    }
    html += '</div>';
    if (explanation) {
      html += '<div class="er-question-explanation">' + icon('highlight-lightbulb', { size: 14 }) + ' ' + escapeHtml(explanation) + '</div>';
    }
    // PROTOTYPE (test David, 23/07/2026) : affichage local des images de
    // justification - voir JUSTIFICATION_IMAGE_BASE_PATH en tete de fichier.
    refs.forEach(function(filename) {
      html += '<img class="er-question-explanation-image" src="' + escapeHtml(JUSTIFICATION_IMAGE_BASE_PATH + filename) + '" alt="Illustration de la justification" loading="lazy">';
    });
    html += '</div>';
    return html;
  }).join('');
}
