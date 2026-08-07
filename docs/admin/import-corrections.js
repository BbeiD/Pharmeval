import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { renderAdminNav } from "./admin-shell.js";
import { API_BASE_URL } from "../js/config.js";

// CORRECTIF SECURITE/FIABILITE (M3, 07/08/2026) : le fichier n'est plus
// parse ici - il est envoye BRUT au serveur (voir POST /api/admin/import-
// corrections-file, functions/index.js), qui parse desormais avec SheetJS
// cote Node. Un bug de parsing se corrige donc au prochain `firebase
// deploy --only functions`, plus jamais retarde par le cache du service
// worker (voir MEMORY, feedback_no_escalation_without_verification -
// c'est exactement ce qui a transforme un bug d'une ligne en incident de
// plusieurs heures cette semaine).
let selectedFile = null;

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('ic-loading');
  const deniedEl  = document.getElementById('ic-denied');
  const viewEl    = document.getElementById('ic-view');

  if (!user) {
    clearCurrentUserContext();
    window.location.href = '../index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur vérification compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';

  if (!hasPermission(PERMISSIONS.MANAGE_QUESTIONS)) {
    if (deniedEl) deniedEl.style.display = '';
    return;
  }

  if (deniedEl) deniedEl.style.display = 'none';
  if (viewEl) viewEl.style.display = '';
  renderAdminNav('bank');

  document.getElementById('ic-file-input').addEventListener('change', onFileChange);
});

function onFileChange(e) {
  selectedFile = e.target.files[0] || null;
  document.getElementById('ic-analyze-btn').disabled = !selectedFile;
}

async function uploadImportFile(file, dryRun) {
  const token = await auth.currentUser.getIdToken();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('dryRun', dryRun ? 'true' : 'false');
  const res = await fetch(API_BASE_URL + '/api/admin/import-corrections-file', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: formData,
  });
  const data = await res.json().catch(function() { return {}; });
  return { ok: res.ok, status: res.status, data: data };
}

window.analyzeFile = async function analyzeFile() {
  if (!selectedFile) return;
  const btn = document.getElementById('ic-analyze-btn');
  btn.disabled = true;
  btn.textContent = 'Analyse…';
  showMessage('', false);

  try {
    const result = await uploadImportFile(selectedFile, true);
    if (!result.ok) {
      showMessage('Erreur dry-run : ' + (result.data.error || result.status), true);
      btn.textContent = 'Analyser'; btn.disabled = false;
      return;
    }

    renderPreview(result.data, result.data.totalRows);
    document.getElementById('ic-step2').style.display = '';
    document.getElementById('ic-step1').style.display = 'none';
  } catch (err) {
    showMessage('Erreur : ' + err.message, true);
    btn.textContent = 'Analyser'; btn.disabled = false;
  }
};

function renderPreview(data, total) {
  const notFoundHtml = data.notFound && data.notFound.length
    ? '<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--text2)">' + data.notFound.length + ' IDs introuvables dans Firestore</summary>'
      + '<ul style="font-size:12px;color:var(--text2);margin-top:8px">' + data.notFound.map(function(id) { return '<li>' + id + '</li>'; }).join('') + '</ul></details>'
    : '';

  document.getElementById('ic-preview').innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px">'
    + '<div class="ic-stat"><span class="ic-stat-num">' + total + '</span><span class="ic-stat-label">Lignes lues</span></div>'
    + '<div class="ic-stat ic-stat-update"><span class="ic-stat-num">' + data.updated + '</span><span class="ic-stat-label">Mises à jour</span></div>'
    + '<div class="ic-stat ic-stat-delete"><span class="ic-stat-num">' + data.deleted + '</span><span class="ic-stat-label">Suppressions</span></div>'
    + '<div class="ic-stat ic-stat-warn"><span class="ic-stat-num">' + (data.notFound ? data.notFound.length : 0) + '</span><span class="ic-stat-label">Introuvables</span></div>'
    + '</div>'
    + '<p style="color:var(--text2);font-size:13px;margin:0">Vérifiez les chiffres avant de confirmer. <strong>Les suppressions sont irréversibles.</strong></p>'
    + notFoundHtml;
}

window.confirmImport = async function confirmImport() {
  if (!selectedFile) return;
  const btn = document.getElementById('ic-import-btn');
  btn.disabled = true;
  btn.textContent = 'Import en cours…';
  showMessage('', false);

  try {
    const result = await uploadImportFile(selectedFile, false);
    const data = result.data;
    if (!result.ok) {
      showMessage('Erreur import : ' + (data.error || result.status), true);
      btn.textContent = 'Confirmer l\'import'; btn.disabled = false;
      return;
    }

    document.getElementById('ic-step2').style.display = 'none';
    document.getElementById('ic-results').innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px">'
      + '<div class="ic-stat ic-stat-update"><span class="ic-stat-num">' + data.updated + '</span><span class="ic-stat-label">Mises à jour</span></div>'
      + '<div class="ic-stat ic-stat-delete"><span class="ic-stat-num">' + data.deleted + '</span><span class="ic-stat-label">Supprimées</span></div>'
      + '<div class="ic-stat ic-stat-warn"><span class="ic-stat-num">' + (data.notFound ? data.notFound.length : 0) + '</span><span class="ic-stat-label">Introuvables</span></div>'
      + '</div>'
      + '<p style="color:var(--green-dark);font-weight:600;margin-top:16px">✓ Import terminé avec succès.</p>';
    document.getElementById('ic-step3').style.display = '';
  } catch (err) {
    showMessage('Erreur : ' + err.message, true);
    btn.textContent = 'Confirmer l\'import'; btn.disabled = false;
  }
};

window.resetForm = function resetForm() {
  selectedFile = null;
  document.getElementById('ic-file-input').value = '';
  document.getElementById('ic-analyze-btn').disabled = true;
  document.getElementById('ic-analyze-btn').textContent = 'Analyser';
  document.getElementById('ic-step1').style.display = '';
  document.getElementById('ic-step2').style.display = 'none';
  document.getElementById('ic-step3').style.display = 'none';
  showMessage('', false);
};

function showMessage(msg, isError) {
  const el = document.getElementById('ic-message');
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.className = 'adm-message' + (isError ? ' adm-message-error' : ' adm-message-success');
  el.textContent = msg;
}

// ── Patch JSON V3 ──────────────────────────────────────────────────────────

let patchItems = [];

document.addEventListener('DOMContentLoaded', function() {
  const fi = document.getElementById('patch-file-input');
  if (fi) fi.addEventListener('change', function(e) {
    document.getElementById('patch-analyze-btn').disabled = !e.target.files.length;
  });
});

function showPatchMessage(msg, isError) {
  const el = document.getElementById('patch-message');
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.className = 'adm-message' + (isError ? ' adm-message-error' : ' adm-message-success');
  el.textContent = msg;
}

window.analyzePatch = async function analyzePatch() {
  const file = document.getElementById('patch-file-input').files[0];
  if (!file) return;
  const btn = document.getElementById('patch-analyze-btn');
  btn.disabled = true; btn.textContent = 'Analyse…';
  showPatchMessage('', false);
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    patchItems = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
    if (!patchItems.length) { showPatchMessage('Fichier JSON invalide ou vide.', true); btn.disabled = false; btn.textContent = 'Analyser'; return; }

    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API_BASE_URL + '/api/admin/apply-question-patch-v3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ items: patchItems, dryRun: true }),
    });
    const report = await res.json();
    if (!res.ok) { showPatchMessage('Erreur dry-run : ' + (report.error || res.status), true); btn.disabled = false; btn.textContent = 'Analyser'; return; }

    const conflitsHtml = report.conflits && report.conflits.length
      ? '<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--warning)">' + report.conflits.length + ' conflit(s) — cliquer pour voir</summary>'
        + '<ul style="font-size:12px;margin-top:8px">' + report.conflits.map(function(c) { return '<li>' + c.pedagogicalId + ' — ' + c.current + '…</li>'; }).join('') + '</ul></details>'
      : '';

    document.getElementById('patch-preview').innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin-bottom:12px">'
      + '<div class="ic-stat"><span class="ic-stat-num">' + patchItems.length + '</span><span class="ic-stat-label">Items</span></div>'
      + '<div class="ic-stat ic-stat-update"><span class="ic-stat-num">' + report.mis_a_jour.length + '</span><span class="ic-stat-label">À mettre à jour</span></div>'
      + '<div class="ic-stat"><span class="ic-stat-num">' + (report.deja_conforme ? report.deja_conforme.length : 0) + '</span><span class="ic-stat-label">Déjà conformes</span></div>'
      + '<div class="ic-stat ic-stat-warn"><span class="ic-stat-num">' + (report.conflits ? report.conflits.length : 0) + '</span><span class="ic-stat-label">Conflits</span></div>'
      + '<div class="ic-stat ic-stat-delete"><span class="ic-stat-num">' + (report.introuvables ? report.introuvables.length : 0) + '</span><span class="ic-stat-label">Introuvables</span></div>'
      + '</div>' + conflitsHtml;

    document.getElementById('patch-step1').style.display = 'none';
    document.getElementById('patch-step2').style.display = '';
  } catch (err) {
    showPatchMessage('Erreur : ' + err.message, true);
    btn.disabled = false; btn.textContent = 'Analyser';
  }
};

window.applyPatch = async function applyPatch() {
  if (!confirm('Appliquer le patch sur ' + patchItems.length + ' questions ?\nSeul le champ "question" sera modifié. Continuer ?')) return;
  const btn = document.getElementById('patch-apply-btn');
  btn.disabled = true; btn.textContent = 'Application…';
  showPatchMessage('', false);
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API_BASE_URL + '/api/admin/apply-question-patch-v3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ items: patchItems, dryRun: false }),
    });
    const report = await res.json();
    if (!res.ok) { showPatchMessage('Erreur : ' + (report.error || res.status), true); btn.disabled = false; btn.textContent = 'Appliquer le patch'; return; }

    document.getElementById('patch-step2').style.display = 'none';
    document.getElementById('patch-results').innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px">'
      + '<div class="ic-stat ic-stat-update"><span class="ic-stat-num">' + report.mis_a_jour.length + '</span><span class="ic-stat-label">Mis à jour</span></div>'
      + '<div class="ic-stat"><span class="ic-stat-num">' + (report.deja_conforme ? report.deja_conforme.length : 0) + '</span><span class="ic-stat-label">Déjà conformes</span></div>'
      + '<div class="ic-stat ic-stat-warn"><span class="ic-stat-num">' + (report.conflits ? report.conflits.length : 0) + '</span><span class="ic-stat-label">Conflits</span></div>'
      + '<div class="ic-stat ic-stat-delete"><span class="ic-stat-num">' + (report.introuvables ? report.introuvables.length : 0) + '</span><span class="ic-stat-label">Introuvables</span></div>'
      + '</div>'
      + '<p style="color:var(--green-dark);font-weight:600;margin-top:16px">✓ Patch appliqué.</p>';
    document.getElementById('patch-step3').style.display = '';
    console.log('[PatchV3]', report);
  } catch (err) {
    showPatchMessage('Erreur : ' + err.message, true);
    btn.disabled = false; btn.textContent = 'Appliquer le patch';
  }
};

window.resetPatch = function resetPatch() {
  patchItems = [];
  document.getElementById('patch-file-input').value = '';
  document.getElementById('patch-analyze-btn').disabled = true;
  document.getElementById('patch-analyze-btn').textContent = 'Analyser';
  document.getElementById('patch-step1').style.display = '';
  document.getElementById('patch-step2').style.display = 'none';
  document.getElementById('patch-step3').style.display = 'none';
  showPatchMessage('', false);
};
