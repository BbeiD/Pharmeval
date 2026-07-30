// ===================== CONTROLEUR "MON PROFIL" (refonte visuelle, phase 1) =====================
// Nouvelle page VOLONTAIREMENT MINIMALE (decision prise avec David) :
// affichage en lecture seule d'informations DEJA REELLES (fiche
// utilisateur + profil declare lors de l'assistant de premiere connexion,
// js/onboarding.js) - jamais un champ invente pour combler visuellement.
// Reportes a une prochaine etape : photo de profil editable (aucun chemin
// d'upload n'existe aujourd'hui), onglets Preferences/Securite, "Vos
// badges" (aucun systeme de badges n'existe dans le modele de donnees).

import { auth } from "./firebase-config.js";
import {
  onAuthStateChanged, signOut,
  updateProfile, updateEmail, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument, PROFESSION_OPTIONS, ORGANIZATION_TYPE_OPTIONS, saveProfileUpdate } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getUserByUid } from "./services/user-management-service.js";
import { formatDateFr, formatRelativeFr } from "./services/date-utils.js";
import { getRecentActivityForUser } from "./services/recent-activity-service.js";
import { renderSiteHeader } from "./site-header.js";
import { hasPermission, PERMISSIONS } from "./services/authorization-service.js";
import { icon } from "./icons.js";
import { getEvaluationsForStatistics } from "./services/history-service.js";
import { calculateOverview } from "./services/statistics-service.js";
import { getParcoursCompletionForUser } from "./services/parcours-completion-service.js";

function qs(id) { return document.getElementById(id); }
function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function optionLabel(options, value) {
  const opt = options.find(function(o) { return o.value === value; });
  return opt ? opt.label : null;
}
function initialsFrom(displayName, email) {
  const name = (displayName || '').trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return (email || '?').slice(0, 2).toUpperCase();
}

onAuthStateChanged(auth, async function(user) {
  const loadingEl = qs('mp-loading');
  const viewEl = qs('mp-view');

  if (!user) { clearCurrentUserContext(); window.location.href = 'index.html'; return; }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('mon-profil');

  await render();
  initEditSection();
  initSecuritySection();
  loadProfileActivity();
});

async function render() {
  const ctx = getCurrentUserContext();
  if (!ctx) return;

  qs('mp-name').textContent = ctx.displayName || 'Utilisateur Pharmeval';
  qs('mp-email').textContent = ctx.email || '';

  const avatarEl = qs('mp-avatar');
  avatarEl.innerHTML = ctx.photoURL
    ? '<img src="' + escapeHtml(ctx.photoURL) + '" alt="">'
    : escapeHtml(initialsFrom(ctx.displayName, ctx.email));

  const profile = ctx.profile || {};
  const professionLabel = profile.profession === 'other'
    ? (profile.professionOther || 'Autre')
    : (optionLabel(PROFESSION_OPTIONS, profile.profession) || null);
  const organizationTypeLabel = profile.organizationType === 'other'
    ? (profile.organizationTypeOther || 'Autre')
    : (optionLabel(ORGANIZATION_TYPE_OPTIONS, profile.organizationType) || null);

  qs('mp-profession').textContent = professionLabel || '—';
  qs('mp-organization').textContent = profile.organizationName
    ? (profile.organizationName + (organizationTypeLabel ? ' (' + organizationTypeLabel + ')' : ''))
    : '—';

  // "Membre depuis" - lecture directe de la fiche Firestore (createdAt
  // n'est pas porte par le contexte en memoire, voir app-context.js).
  const fullUser = await getUserByUid(ctx.uid);
  qs('mp-member-since').textContent = (fullUser && fullUser.createdAt) ? formatDateFr(fullUser.createdAt) : '—';

  renderMenu(ctx);
  await renderStats(ctx);
}

/**
 * AJOUT (refonte visuelle, phase 3, mockup mobile fourni par David,
 * 27/07/2026) : memes tuiles REELLES que l'accueil (js/home.js), mais
 * uniquement le "score moyen" + "evaluations realisees" + "parcours en
 * cours" - jamais un nouveau calcul, meme services deja existants.
 */
async function renderStats(ctx) {
  const gridEl = qs('mp-stats-grid');
  if (!gridEl) return;

  const [evalResult, completionResult] = await Promise.all([
    getEvaluationsForStatistics(),
    getParcoursCompletionForUser(ctx.uid),
  ]);
  const overview = calculateOverview(evalResult.items);
  const completionItems = (completionResult && !completionResult.error) ? completionResult.items : [];
  const inProgressCount = completionItems.filter(function(c) { return c.percent !== null && c.percent < 100; }).length;

  const tiles = [
    { icon: icon('nav-paths-formations', { size: 20 }), iconCls: 'stat-card-icon-blue', accentCls: 'stat-card-accent-blue', value: String(inProgressCount), label: 'Parcours en cours' },
    { icon: icon('nav-evaluations-stats', { size: 20 }), iconCls: 'stat-card-icon-orange', accentCls: 'stat-card-accent-orange', value: String(overview.count), label: 'Évaluations réalisées' },
    { icon: icon('highlight-star-filled', { size: 20 }), iconCls: 'stat-card-icon-green', accentCls: '', value: overview.averageScore !== null ? (overview.averageScore + '%') : '—', label: 'Score moyen' },
  ];
  gridEl.innerHTML = tiles.map(function(t) {
    return '<div class="stat-card ' + t.accentCls + '"><div class="stat-card-icon ' + t.iconCls + '">' + t.icon + '</div>' +
      '<div class="stat-card-value">' + escapeHtml(t.value) + '</div>' +
      '<div class="stat-card-label">' + escapeHtml(t.label) + '</div></div>';
  }).join('');
}

/**
 * AJOUT : "Mon profil" devient le point d'acces pour "Mes compétences",
 * "Mes évaluations" et "Administration" - retires de la barre de
 * navigation (5 icones desormais, voir js/site-header.js) mais toujours
 * pleinement fonctionnels, memes cibles exactes qu'avant (href identique
 * a l'ancienne entree de NAV_ITEMS). "Se déconnecter" rejoint aussi ce
 * menu (en plus du menu deroulant de la sidebar, qui reste inchange).
 */
function renderMenu(ctx) {
  const listEl = qs('mp-menu-list');
  if (!listEl) return;
  const isAdmin = hasPermission(PERMISSIONS.MANAGE_USERS);

  const rows = [
    { href: 'mes-competences.html', iconKey: 'nav-skills', label: 'Mes compétences' },
    { href: 'index.html?history=1', iconKey: 'nav-evaluations-stats', label: 'Mes évaluations' },
  ];
  if (isAdmin) rows.push({ href: 'index.html?admin=1', iconKey: 'nav-administration', label: 'Administration' });

  listEl.innerHTML = rows.map(function(r) {
    return '<a class="mp-menu-row" href="' + escapeHtml(r.href) + '">' +
      '<span class="mp-menu-row-icon">' + icon(r.iconKey, { size: 18 }) + '</span>' +
      '<span class="mp-menu-row-label">' + escapeHtml(r.label) + '</span>' +
      icon('action-chevron-right', { size: 16 }) +
    '</a>';
  }).join('') +
  '<button type="button" class="mp-menu-row mp-menu-row-logout" id="mp-logout-btn">' +
    '<span class="mp-menu-row-icon">' + icon('action-restore', { size: 18 }) + '</span>' +
    '<span class="mp-menu-row-label">Se déconnecter</span>' +
  '</button>';

  qs('mp-logout-btn').addEventListener('click', async function() {
    clearCurrentUserContext();
    try { await signOut(auth); } catch (err) { console.error('Erreur de déconnexion :', err); }
    window.location.href = 'index.html';
  });
}

// ── Helpers messages ─────────────────────────────────────────────────────────

function showMsg(id, text, isError) {
  var el = qs(id);
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  el.style.padding = '8px 12px';
  el.style.borderRadius = '8px';
  el.style.fontSize = '13px';
  el.style.marginBottom = '10px';
  if (isError) {
    el.style.background = 'rgba(226,75,74,0.15)';
    el.style.border = '1px solid rgba(226,75,74,0.4)';
    el.style.color = '#ffb4b3';
  } else {
    el.style.background = 'rgba(29,158,117,0.15)';
    el.style.border = '1px solid rgba(29,158,117,0.4)';
    el.style.color = '#34D399';
  }
}

function hideMsg(id) {
  var el = qs(id);
  if (el) el.style.display = 'none';
}

// ── Section édition du profil ─────────────────────────────────────────────────

function initEditSection() {
  var ctx = getCurrentUserContext();
  if (!ctx) return;
  var profile = ctx.profile || {};

  // Remplir les selects
  var profSel = qs('mp-edit-profession');
  profSel.innerHTML = PROFESSION_OPTIONS.map(function(o) {
    return '<option value="' + escapeHtml(o.value) + '"' + (profile.profession === o.value ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
  }).join('');

  var orgSel = qs('mp-edit-org-type');
  orgSel.innerHTML = '<option value="">— Sélectionnez —</option>' + ORGANIZATION_TYPE_OPTIONS.map(function(o) {
    return '<option value="' + escapeHtml(o.value) + '"' + (profile.organizationType === o.value ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
  }).join('');

  // Pré-remplir les champs texte
  qs('mp-edit-name').value          = ctx.displayName || '';
  qs('mp-edit-org-name').value      = profile.organizationName   || '';
  qs('mp-edit-profession-other').value = profile.professionOther   || '';
  qs('mp-edit-org-type-other').value   = profile.organizationTypeOther || '';

  syncOtherFields();
  profSel.addEventListener('change', syncOtherFields);
  orgSel.addEventListener('change', syncOtherFields);

  qs('mp-edit-btn').addEventListener('click', openEdit);
  qs('mp-cancel-btn').addEventListener('click', closeEdit);
  qs('mp-save-btn').addEventListener('click', handleSaveProfile);
}

function syncOtherFields() {
  qs('mp-profession-other-wrap').style.display = qs('mp-edit-profession').value === 'other' ? '' : 'none';
  qs('mp-org-type-other-wrap').style.display   = qs('mp-edit-org-type').value   === 'other' ? '' : 'none';
}

function openEdit() {
  qs('mp-info-read').style.display = 'none';
  qs('mp-info-edit').style.display = '';
  qs('mp-edit-btn').style.display  = 'none';
  hideMsg('mp-edit-msg');
}

function closeEdit() {
  qs('mp-info-read').style.display = '';
  qs('mp-info-edit').style.display = 'none';
  qs('mp-edit-btn').style.display  = '';
}

async function handleSaveProfile() {
  var ctx         = getCurrentUserContext();
  var displayName = qs('mp-edit-name').value.trim();
  var profession  = qs('mp-edit-profession').value;
  var profOther   = qs('mp-edit-profession-other').value.trim();
  var orgName     = qs('mp-edit-org-name').value.trim();
  var orgType     = qs('mp-edit-org-type').value;
  var orgTypeOther = qs('mp-edit-org-type-other').value.trim();

  if (!displayName) { showMsg('mp-edit-msg', 'Veuillez saisir votre nom d\'affichage.', true); return; }
  if (!profession)  { showMsg('mp-edit-msg', 'Veuillez sélectionner votre profession.', true); return; }

  var btn = qs('mp-save-btn');
  btn.disabled    = true;
  btn.textContent = 'Enregistrement…';

  try {
    if (auth.currentUser && displayName !== ctx.displayName) {
      await updateProfile(auth.currentUser, { displayName: displayName });
    }
    await saveProfileUpdate(ctx.uid, {
      displayName:           displayName,
      profession:            profession,
      professionOther:       profession === 'other' ? profOther : '',
      organizationType:      orgType,
      organizationTypeOther: orgType === 'other' ? orgTypeOther : '',
      organizationName:      orgName,
    });

    // Mettre à jour le contexte en mémoire
    ctx.displayName                    = displayName;
    ctx.profile.profession             = profession;
    ctx.profile.professionOther        = profession === 'other' ? profOther : '';
    ctx.profile.organizationType       = orgType;
    ctx.profile.organizationTypeOther  = orgType === 'other' ? orgTypeOther : '';
    ctx.profile.organizationName       = orgName;

    // Rafraîchir l'affichage en lecture seule
    qs('mp-name').textContent = displayName;
    var profLabel = profession === 'other'
      ? (profOther || 'Autre')
      : (optionLabel(PROFESSION_OPTIONS, profession) || '—');
    var orgTypeLabel = orgType === 'other'
      ? (orgTypeOther || 'Autre')
      : (optionLabel(ORGANIZATION_TYPE_OPTIONS, orgType) || null);
    qs('mp-profession').textContent  = profLabel;
    qs('mp-organization').textContent = orgName
      ? (orgName + (orgTypeLabel ? ' (' + orgTypeLabel + ')' : ''))
      : '—';
    qs('mp-avatar').innerHTML = ctx.photoURL
      ? '<img src="' + escapeHtml(ctx.photoURL) + '" alt="">'
      : escapeHtml(initialsFrom(displayName, ctx.email));

    closeEdit();
  } catch (err) {
    console.error('Erreur mise à jour profil :', err);
    showMsg('mp-edit-msg', 'Une erreur est survenue. Veuillez réessayer.', true);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Enregistrer';
  }
}

// ── Section sécurité (e-mail + mot de passe) ─────────────────────────────────

function initSecuritySection() {
  var user = auth.currentUser;
  if (!user) return;

  var isPasswordProvider = user.providerData.some(function(p) { return p.providerId === 'password'; });
  if (!isPasswordProvider) return;

  var card = qs('mp-security-card');
  if (card) card.style.display = '';

  qs('mp-sec-email-display').textContent = user.email || '';

  // — E-mail —
  qs('mp-change-email-btn').addEventListener('click', function() {
    qs('mp-email-form').style.display       = '';
    qs('mp-change-email-btn').style.display = 'none';
    hideMsg('mp-email-msg');
  });
  qs('mp-cancel-email-btn').addEventListener('click', function() {
    qs('mp-email-form').style.display       = 'none';
    qs('mp-change-email-btn').style.display = '';
    qs('mp-new-email').value  = '';
    qs('mp-email-pwd').value  = '';
    hideMsg('mp-email-msg');
  });
  qs('mp-confirm-email-btn').addEventListener('click', handleEmailChange);

  // — Mot de passe —
  qs('mp-change-pwd-btn').addEventListener('click', function() {
    qs('mp-pwd-form').style.display       = '';
    qs('mp-change-pwd-btn').style.display = 'none';
    hideMsg('mp-pwd-msg');
  });
  qs('mp-cancel-pwd-btn').addEventListener('click', function() {
    qs('mp-pwd-form').style.display       = 'none';
    qs('mp-change-pwd-btn').style.display = '';
    qs('mp-current-pwd').value = '';
    qs('mp-new-pwd').value     = '';
    qs('mp-confirm-pwd').value = '';
    hideMsg('mp-pwd-msg');
  });
  qs('mp-confirm-pwd-btn').addEventListener('click', handlePasswordChange);
}

async function handleEmailChange() {
  var user     = auth.currentUser;
  var newEmail = qs('mp-new-email').value.trim();
  var pwd      = qs('mp-email-pwd').value;

  if (!newEmail) { showMsg('mp-email-msg', 'Veuillez saisir le nouvel e-mail.', true); return; }
  if (!pwd)      { showMsg('mp-email-msg', 'Veuillez saisir votre mot de passe actuel.', true); return; }

  var btn = qs('mp-confirm-email-btn');
  btn.disabled = true; btn.textContent = 'Confirmation…';

  try {
    var cred = EmailAuthProvider.credential(user.email, pwd);
    await reauthenticateWithCredential(user, cred);
    await updateEmail(user, newEmail);
    await saveProfileUpdate(getCurrentUserContext().uid, { email: newEmail });

    qs('mp-email').textContent              = newEmail;
    qs('mp-sec-email-display').textContent  = newEmail;
    getCurrentUserContext().email           = newEmail;
    qs('mp-new-email').value  = '';
    qs('mp-email-pwd').value  = '';
    showMsg('mp-email-msg', 'Adresse e-mail mise à jour.', false);
  } catch (err) {
    console.error('Erreur changement e-mail :', err);
    var msg = err.code === 'auth/wrong-password'       ? 'Mot de passe incorrect.'
            : err.code === 'auth/invalid-credential'   ? 'Mot de passe incorrect.'
            : err.code === 'auth/email-already-in-use' ? 'Cet e-mail est déjà utilisé par un autre compte.'
            : err.code === 'auth/invalid-email'        ? 'Adresse e-mail invalide.'
            : 'Une erreur est survenue. Veuillez réessayer.';
    showMsg('mp-email-msg', msg, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmer';
  }
}

async function handlePasswordChange() {
  var user       = auth.currentUser;
  var currentPwd = qs('mp-current-pwd').value;
  var newPwd     = qs('mp-new-pwd').value;
  var confirmPwd = qs('mp-confirm-pwd').value;

  if (!currentPwd)            { showMsg('mp-pwd-msg', 'Veuillez saisir votre mot de passe actuel.', true); return; }
  if (!newPwd)                { showMsg('mp-pwd-msg', 'Veuillez saisir votre nouveau mot de passe.', true); return; }
  if (newPwd.length < 6)     { showMsg('mp-pwd-msg', 'Le mot de passe doit comporter au moins 6 caractères.', true); return; }
  if (newPwd !== confirmPwd) { showMsg('mp-pwd-msg', 'Les mots de passe ne correspondent pas.', true); return; }

  var btn = qs('mp-confirm-pwd-btn');
  btn.disabled = true; btn.textContent = 'Enregistrement…';

  try {
    var cred = EmailAuthProvider.credential(user.email, currentPwd);
    await reauthenticateWithCredential(user, cred);
    await updatePassword(user, newPwd);

    qs('mp-current-pwd').value = '';
    qs('mp-new-pwd').value     = '';
    qs('mp-confirm-pwd').value = '';
    showMsg('mp-pwd-msg', 'Mot de passe mis à jour avec succès.', false);
  } catch (err) {
    console.error('Erreur changement mot de passe :', err);
    var msg = err.code === 'auth/wrong-password'     ? 'Mot de passe actuel incorrect.'
            : err.code === 'auth/invalid-credential' ? 'Mot de passe actuel incorrect.'
            : err.code === 'auth/weak-password'      ? 'Le nouveau mot de passe est trop faible (minimum 6 caractères).'
            : 'Une erreur est survenue. Veuillez réessayer.';
    showMsg('mp-pwd-msg', msg, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Enregistrer';
  }
}

// ── Activité récente ─────────────────────────────────────────────────────────

const PROFILE_ACTIVITY_ICON = {
  evaluation_completed: { icon: 'content-question-bank',     cls: 'stat-card-icon-blue' },
  score_improved:       { icon: 'feedback-trend-up',          cls: 'stat-card-icon-green' },
  parcours_started:     { icon: 'nav-paths-formations',       cls: 'stat-card-icon-orange' },
  streak:               { icon: 'feedback-streak-regularity', cls: 'stat-card-icon-orange' },
};

async function loadProfileActivity() {
  const listEl = qs('mp-activity-list');
  const emptyEl = qs('mp-activity-empty');
  if (!listEl) return;

  const ctx = getCurrentUserContext();
  const result = await getRecentActivityForUser(ctx && ctx.uid);

  if (result.error || result.items.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  function escH(s) { return (s == null ? '' : String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  emptyEl.style.display = 'none';
  listEl.innerHTML = result.items.map(function(event) {
    const conf = PROFILE_ACTIVITY_ICON[event.type] || PROFILE_ACTIVITY_ICON.evaluation_completed;
    return (
      '<div class="home-activity-row">' +
        '<div class="stat-card-icon ' + conf.cls + '" style="width:32px;height:32px;margin-bottom:0;">' + icon(conf.icon, { size: 16 }) + '</div>' +
        '<div class="home-activity-text">' +
          '<div class="home-activity-label">' + escH(event.label) + '</div>' +
          '<div class="home-activity-detail">' + escH(event.detail) + '</div>' +
        '</div>' +
        '<div class="home-activity-time">' + escH(formatRelativeFr(event.date)) + '</div>' +
      '</div>'
    );
  }).join('');
}
