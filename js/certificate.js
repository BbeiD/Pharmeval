// ===================== CERTIFICAT / ATTESTATION (Pharmeval) =====================
// Gère deux modes selon le paramètre ?type= de l'URL :
//   - type=parcours&parcoursId=X  : certificat de réussite d'un parcours à 100 %
//   - type=global                  : attestation récapitulant tous les parcours à 100 %
//
// Données : UNIQUEMENT des données réelles issues de Firestore via les services
// existants (parcours-completion-service, evaluation-result-service).
// AUCUNE écriture Firestore ici — lecture et rendu seulement.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { PROFESSION_OPTIONS } from "./services/user-service.js";
import { setCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getParcoursCompletionForUser } from "./services/parcours-completion-service.js";
import { getParcoursAttemptSummaryForUser } from "./services/evaluation-result-service.js";
import { formatDateFr } from "./services/date-utils.js";

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getProfessionLabel(profile) {
  if (!profile || !profile.profession) return null;
  if (profile.profession === 'other') return profile.professionOther || 'Autre profession';
  const opt = PROFESSION_OPTIONS.find(function(o) { return o.value === profile.profession; });
  return opt ? opt.label : null;
}

function buildUserSubline(ctx) {
  const profile = ctx.profile || {};
  const profession = getProfessionLabel(profile);
  const org = profile.organizationName || null;
  if (profession && org) return profession + ' — ' + org;
  return profession || org || '';
}

// Référence unique : date + 6 derniers chars uid + début parcoursId (ou 'GLOB')
function certRef(uid, parcoursId) {
  const now = new Date();
  const ymd = now.getFullYear()
    + ('0' + (now.getMonth() + 1)).slice(-2)
    + ('0' + now.getDate()).slice(-2);
  const uidPart = uid.slice(-6).toUpperCase();
  const pPart = parcoursId
    ? parcoursId.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase()
    : 'GLOB';
  return 'PH-' + ymd + '-' + uidPart + '-' + pPart;
}

// Dans la liste d'attempts (triée du plus récent au plus ancien), renvoie
// la date du PREMIER résultat à 100 % (= le plus ancien dans la liste filtrée).
function firstHundredDate(att) {
  if (!att || !att.attempts || att.attempts.length === 0) return null;
  const hundreds = att.attempts.filter(function(a) { return a.percent === 100; });
  if (hundreds.length === 0) return null;
  return hundreds[hundreds.length - 1].date;
}

function headerHtml(subtitle) {
  return (
    '<div class="cert-header">' +
      '<img src="assets/brand/pharmeval-logo-full.png" alt="Pharmeval" class="cert-logo">' +
      '<div class="cert-header-label">' + escapeHtml(subtitle) + '</div>' +
    '</div>'
  );
}

function footerHtml(ref) {
  return (
    '<hr class="cert-divider">' +
    '<div class="cert-footer">' +
      '<span class="cert-footer-brand">Pharmeval</span>' +
      '<span>Formation officinale continue en Belgique</span>' +
      '<span class="cert-footer-ref">Réf. : ' + escapeHtml(ref) + '<br>Généré le ' + escapeHtml(formatDateFr(new Date())) + '</span>' +
    '</div>'
  );
}

function renderParcoursHtml(ctx, item, att) {
  const dateAchieved = firstHundredDate(att);
  const dateLine = dateAchieved
    ? 'Complété le <strong>' + escapeHtml(formatDateFr(dateAchieved)) + '</strong>'
    : 'Parcours réussi à 100 %';

  const subline = buildUserSubline(ctx);

  return (
    headerHtml('Certificat de réussite') +

    '<div class="cert-title">Certificat de réussite</div>' +
    '<div class="cert-title-bar"></div>' +

    '<p class="cert-preamble">Il est certifié que</p>' +

    '<div class="cert-user-name">' + escapeHtml(ctx.displayName || ctx.email) + '</div>' +
    (subline ? '<div class="cert-user-sub">' + escapeHtml(subline) + '</div>' : '') +

    '<p class="cert-connector">a réussi avec succès le parcours de formation</p>' +

    '<div class="cert-parcours-name">« ' + escapeHtml(item.name) + ' »</div>' +
    '<div class="cert-parcours-meta">' +
      item.questionCount + ' question' + (item.questionCount > 1 ? 's' : '') +
    '</div>' +

    '<div class="cert-score-badge">' +
      '<div class="cert-score-circle">' +
        '<span class="cert-score-circle-value">100</span>' +
        '<span class="cert-score-circle-unit">%</span>' +
      '</div>' +
    '</div>' +

    '<p class="cert-date-line">' + dateLine + '</p>' +

    footerHtml(certRef(ctx.uid, item.parcoursId))
  );
}

function renderGlobalHtml(ctx, items, attemptResult) {
  const completed = items.filter(function(i) { return i.percent === 100; });
  const totalQ = completed.reduce(function(s, i) { return s + i.questionCount; }, 0);

  const rows = completed.map(function(item) {
    const att = !attemptResult.error ? attemptResult.byParcoursId.get(item.parcoursId) : null;
    const date = firstHundredDate(att);
    return (
      '<tr>' +
        '<td>' + escapeHtml(item.name) + '</td>' +
        '<td style="text-align:center;">' + item.questionCount + '</td>' +
        '<td style="text-align:center;color:#1D9E75;font-weight:700;">100 %</td>' +
        '<td style="text-align:right;white-space:nowrap;color:#555;">' +
          (date ? escapeHtml(formatDateFr(date)) : '—') +
        '</td>' +
      '</tr>'
    );
  }).join('');

  const subline = buildUserSubline(ctx);

  return (
    headerHtml('Attestation de formation continue') +

    '<div class="cert-title">Attestation de formation continue</div>' +
    '<div class="cert-title-bar"></div>' +

    '<p class="cert-preamble">Il est attesté que</p>' +

    '<div class="cert-user-name">' + escapeHtml(ctx.displayName || ctx.email) + '</div>' +
    (subline ? '<div class="cert-user-sub">' + escapeHtml(subline) + '</div>' : '') +

    '<p class="cert-connector">' +
      'a réalisé et réussi les parcours de formation suivants<br>' +
      'sur la plateforme <strong>Pharmeval</strong> :' +
    '</p>' +

    '<table class="cert-table">' +
      '<thead><tr>' +
        '<th>Parcours</th>' +
        '<th style="text-align:center;">Questions</th>' +
        '<th style="text-align:center;">Score</th>' +
        '<th style="text-align:right;">Complété le</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr class="cert-table-total">' +
        '<td><strong>Total — ' + completed.length + ' parcours</strong></td>' +
        '<td style="text-align:center;"><strong>' + totalQ + '</strong></td>' +
        '<td colspan="2"></td>' +
      '</tr></tfoot>' +
    '</table>' +

    footerHtml(certRef(ctx.uid, null))
  );
}

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('cert-loading');
  const errorEl   = document.getElementById('cert-error');
  const rootEl    = document.getElementById('cert-root');

  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  function showError(msg) {
    document.getElementById('cert-error-msg').textContent = msg;
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
    const ctx = getCurrentUserContext();

    const params     = new URLSearchParams(window.location.search);
    const type       = params.get('type') || 'parcours';
    const parcoursId = params.get('parcoursId');

    const [completionResult, attemptResult] = await Promise.all([
      getParcoursCompletionForUser(ctx.uid),
      getParcoursAttemptSummaryForUser(ctx.uid),
    ]);

    if (completionResult.error) throw new Error('Erreur lors du chargement des parcours.');

    const paperEl = document.getElementById('cert-paper');

    if (type === 'global') {
      const completed = completionResult.items.filter(function(i) { return i.percent === 100; });
      if (completed.length === 0) {
        showError('Aucun parcours réussi à 100 % — l\'attestation n\'est pas encore disponible.');
        return;
      }
      document.title = 'Attestation — Pharmeval';
      paperEl.innerHTML = renderGlobalHtml(ctx, completionResult.items, attemptResult);
    } else {
      if (!parcoursId) {
        showError('Paramètre manquant (parcoursId).');
        return;
      }
      const item = completionResult.items.find(function(i) { return i.parcoursId === parcoursId; });
      if (!item || item.percent !== 100) {
        showError('Ce certificat est disponible uniquement pour les parcours réussis à 100 %.');
        return;
      }
      const att = !attemptResult.error ? attemptResult.byParcoursId.get(parcoursId) : null;
      document.title = 'Certificat — Pharmeval';
      paperEl.innerHTML = renderParcoursHtml(ctx, item, att);
    }

    loadingEl.style.display = 'none';
    rootEl.style.display = 'block';
  } catch (err) {
    console.error('[certificate.js]', err);
    showError('Une erreur est survenue lors de la génération du certificat.');
  }
});
