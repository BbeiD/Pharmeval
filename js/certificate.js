// ===================== CERTIFICAT / ATTESTATION (Pharmeval) =====================
// Trois modes selon le paramètre ?type= :
//   - type=custom (défaut)            : sélection interactive des parcours → attestation
//   - type=parcours&parcoursId=X      : certificat de réussite d'un parcours à 100 %
//   - type=global                      : attestation tous parcours (redirige vers custom)
//
// Données : UNIQUEMENT réelles (Firestore via services existants).
// AUCUNE écriture Firestore ici.

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

function certRef(uid, suffix) {
  const now = new Date();
  const ymd = now.getFullYear()
    + ('0' + (now.getMonth() + 1)).slice(-2)
    + ('0' + now.getDate()).slice(-2);
  const uidPart = uid.slice(-6).toUpperCase();
  const s = (suffix || 'CUST').replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase();
  return 'PH-' + ymd + '-' + uidPart + '-' + s;
}

// Renvoie la date du PREMIER résultat à 100 % (la plus ancienne dans la liste triée newest-first).
function firstHundredDate(att) {
  if (!att || !att.attempts || att.attempts.length === 0) return null;
  const hundreds = att.attempts.filter(function(a) { return a.percent === 100; });
  if (hundreds.length === 0) return null;
  return hundreds[hundreds.length - 1].date;
}

// ---------------------------------------------------------------------------
// Helpers HTML du document imprimable
// ---------------------------------------------------------------------------

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

// Attestation avec tableau (sélection personnalisée ou tous les parcours).
function renderAttestationHtml(ctx, selectedItems, attemptResult) {
  const totalQ = selectedItems.reduce(function(s, i) { return s + i.questionCount; }, 0);

  const rows = selectedItems.map(function(item) {
    const att = !attemptResult.error ? attemptResult.byParcoursId.get(item.parcoursId) : null;
    const date = firstHundredDate(att);

    // Compétences ou thèmes testés (buckets non-questions, priorité aux compétences)
    const compBuckets = (item.buckets || []).filter(function(b) { return b.type === 'competency'; });
    const srcBuckets  = (item.buckets || []).filter(function(b) { return b.type === 'source'; });
    const subBuckets  = compBuckets.length > 0 ? compBuckets : srcBuckets;
    const subLabel    = compBuckets.length > 0 ? 'Compétences' : 'Thèmes';
    const subHtml = subBuckets.length > 0
      ? '<ul class="cert-competency-list">' +
        subBuckets.map(function(b) {
          return '<li>' + escapeHtml(b.label) + '</li>';
        }).join('') +
        '</ul>'
      : '';

    return (
      '<tr>' +
        '<td><div class="cert-parcours-cell">' + escapeHtml(item.name) + subHtml + '</div></td>' +
        '<td style="text-align:center;vertical-align:top;padding-top:10px;">' + item.questionCount + '</td>' +
        '<td style="text-align:center;vertical-align:top;padding-top:10px;color:#1D9E75;font-weight:700;">100 %</td>' +
        '<td style="text-align:right;vertical-align:top;padding-top:10px;white-space:nowrap;color:#555;">' +
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
        '<td><strong>Total — ' + selectedItems.length + ' parcours</strong></td>' +
        '<td style="text-align:center;"><strong>' + totalQ + '</strong></td>' +
        '<td colspan="2"></td>' +
      '</tr></tfoot>' +
    '</table>' +

    footerHtml(certRef(ctx.uid, null))
  );
}

// Certificat individuel (un seul parcours, mise en page centrée).
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

// ---------------------------------------------------------------------------
// UI de sélection (mode custom)
// ---------------------------------------------------------------------------

function showPreview(ctx, selectedItems, attemptResult, isCustom) {
  document.getElementById('cert-select-section').style.display = 'none';

  const paperEl = document.getElementById('cert-paper');
  paperEl.innerHTML = renderAttestationHtml(ctx, selectedItems, attemptResult);

  if (isCustom) {
    document.getElementById('cert-back-to-select').style.display = 'inline-flex';
  }

  document.getElementById('cert-preview-section').style.display = 'block';
}

function showSelectSection(ctx, completed, attemptResult) {
  document.getElementById('cert-preview-section').style.display = 'none';

  const content = document.getElementById('cert-select-content');

  function updateCounter() {
    const n = content.querySelectorAll('.cert-chk:checked').length;
    const counter = content.querySelector('#cert-select-count');
    if (counter) counter.textContent = n === 0 ? 'Aucun parcours sélectionné'
      : n === 1 ? '1 parcours sélectionné'
      : n + ' parcours sélectionnés';
    const btn = content.querySelector('#cert-generate-btn');
    if (btn) btn.disabled = n === 0;
  }

  const rows = completed.map(function(item, idx) {
    const att = !attemptResult.error ? attemptResult.byParcoursId.get(item.parcoursId) : null;
    const date = firstHundredDate(att);
    const meta = item.questionCount + ' question' + (item.questionCount > 1 ? 's' : '')
      + (date ? ' · ' + formatDateFr(date) : '');
    return (
      '<label class="cert-select-row" for="cert-chk-' + idx + '">' +
        '<input type="checkbox" id="cert-chk-' + idx + '" class="cert-chk" ' +
          'data-id="' + escapeHtml(item.parcoursId) + '" checked>' +
        '<div class="cert-select-row-info">' +
          '<span class="cert-select-row-name">' + escapeHtml(item.name) + '</span>' +
          '<span class="cert-select-row-meta">' + escapeHtml(meta) + '</span>' +
        '</div>' +
      '</label>'
    );
  }).join('');

  content.innerHTML = (
    '<h2 class="cert-select-title">Créer mon attestation</h2>' +
    '<p class="cert-select-sub">Cochez les parcours à inclure dans le document — par exemple, ceux réalisés sur l\'année écoulée.</p>' +
    '<div class="cert-select-controls">' +
      '<button class="cert-select-toggle-btn" id="cert-select-all">Tout sélectionner</button>' +
      '<button class="cert-select-toggle-btn" id="cert-deselect-all">Tout décocher</button>' +
    '</div>' +
    '<div class="cert-select-list">' + rows + '</div>' +
    '<p class="cert-select-count" id="cert-select-count">' + completed.length + ' parcours sélectionnés</p>' +
    '<button class="btn-primary cert-generate-btn" id="cert-generate-btn">Générer l\'attestation →</button>' +
    '<div style="margin-top:12px;">' +
      '<a href="javascript:history.back()" class="btn-secondary" style="font-size:13px;">← Retour</a>' +
    '</div>'
  );

  // Événements
  content.querySelector('#cert-select-all').addEventListener('click', function() {
    content.querySelectorAll('.cert-chk').forEach(function(c) { c.checked = true; });
    updateCounter();
  });
  content.querySelector('#cert-deselect-all').addEventListener('click', function() {
    content.querySelectorAll('.cert-chk').forEach(function(c) { c.checked = false; });
    updateCounter();
  });
  content.querySelectorAll('.cert-chk').forEach(function(c) {
    c.addEventListener('change', updateCounter);
  });
  content.querySelector('#cert-generate-btn').addEventListener('click', function() {
    const ids = Array.from(content.querySelectorAll('.cert-chk:checked')).map(function(c) {
      return c.getAttribute('data-id');
    });
    if (ids.length === 0) return;
    const selected = completed.filter(function(i) { return ids.indexOf(i.parcoursId) !== -1; });
    showPreview(ctx, selected, attemptResult, true);
  });

  // Bouton "Modifier la sélection" dans la section preview
  const backBtn = document.getElementById('cert-back-to-select');
  if (backBtn) {
    backBtn.onclick = function() {
      document.getElementById('cert-preview-section').style.display = 'none';
      document.getElementById('cert-select-section').style.display = 'block';
    };
  }

  document.getElementById('cert-select-section').style.display = 'block';
  updateCounter();
}

// ---------------------------------------------------------------------------
// Point d'entrée principal
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('cert-loading');
  const errorEl   = document.getElementById('cert-error');

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
    const type       = params.get('type') || 'custom';
    const parcoursId = params.get('parcoursId');

    const [completionResult, attemptResult] = await Promise.all([
      getParcoursCompletionForUser(ctx.uid),
      getParcoursAttemptSummaryForUser(ctx.uid),
    ]);

    if (completionResult.error) throw new Error('Erreur lors du chargement des parcours.');

    const completed = completionResult.items.filter(function(i) { return i.percent === 100; });

    loadingEl.style.display = 'none';

    if (type === 'parcours') {
      // Certificat individuel — pas de sélection
      if (!parcoursId) { showError('Paramètre manquant (parcoursId).'); return; }
      const item = completionResult.items.find(function(i) { return i.parcoursId === parcoursId; });
      if (!item || item.percent !== 100) {
        showError('Ce certificat est disponible uniquement pour les parcours réussis à 100 %.');
        return;
      }
      const att = !attemptResult.error ? attemptResult.byParcoursId.get(parcoursId) : null;
      document.title = 'Certificat — Pharmeval';
      document.getElementById('cert-paper').innerHTML = renderParcoursHtml(ctx, item, att);
      document.getElementById('cert-preview-section').style.display = 'block';

    } else {
      // Mode custom (ou global redirigé) — sélection d'abord
      if (completed.length === 0) {
        showError('Aucun parcours réussi à 100 % — l\'attestation n\'est pas encore disponible.');
        return;
      }
      document.title = 'Attestation — Pharmeval';

      // type=global : pré-sélectionner tous, passer par la sélection quand même
      showSelectSection(ctx, completed, attemptResult);
    }

  } catch (err) {
    console.error('[certificate.js]', err);
    showError('Une erreur est survenue lors de la génération du certificat.');
  }
});
