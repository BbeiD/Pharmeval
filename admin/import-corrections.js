import { auth } from "../js/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "../js/services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "../js/services/app-context.js";
import { hasPermission, PERMISSIONS } from "../js/services/authorization-service.js";
import { renderSiteHeader } from "../js/site-header.js";
import { API_BASE_URL } from "../js/config.js";

let parsedRows = [];

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
  renderSiteHeader('administration');

  document.getElementById('ic-file-input').addEventListener('change', onFileChange);
});

function onFileChange(e) {
  document.getElementById('ic-analyze-btn').disabled = !e.target.files.length;
}

async function parseFile(file) {
  const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
  if (isXlsx) {
    const XLSX = window.XLSX;
    if (!XLSX) throw new Error('Librairie SheetJS non chargée — rechargez la page.');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return raw
      .map(function(r) {
        const o = {};
        Object.keys(r).forEach(function(k) { o[k.trim()] = String(r[k] != null ? r[k] : '').trim(); });
        return o;
      })
      .filter(function(r) { return r.pedagogicalId; });
  }
  const text = await file.text();
  return parseCSV(text);
}

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const lines = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines.push(cur); cur = '';
    } else { cur += ch; }
  }
  if (cur) lines.push(cur);

  function splitLine(line) {
    const fields = []; let f = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i+1] === '"') { f += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q) { fields.push(f); f = ''; }
      else f += ch;
    }
    fields.push(f);
    return fields;
  }

  const headers = splitLine(lines[0] || '');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitLine(lines[i]);
    const obj = {};
    headers.forEach(function(h, j) { obj[h.trim()] = (vals[j] || '').trim(); });
    if (obj.pedagogicalId) rows.push(obj);
  }
  return rows;
}

window.analyzeFile = async function analyzeFile() {
  const file = document.getElementById('ic-file-input').files[0];
  if (!file) return;
  const btn = document.getElementById('ic-analyze-btn');
  btn.disabled = true;
  btn.textContent = 'Analyse…';
  showMessage('', false);

  try {
    parsedRows = await parseFile(file);
    if (!parsedRows.length) {
      showMessage('Le fichier est vide ou mal formaté.', true);
      btn.textContent = 'Analyser'; btn.disabled = false;
      return;
    }

    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API_BASE_URL + '/api/admin/import-corrections-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ rows: parsedRows, dryRun: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      showMessage('Erreur dry-run : ' + (data.error || res.status), true);
      btn.textContent = 'Analyser'; btn.disabled = false;
      return;
    }

    renderPreview(data, parsedRows.length);
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
  const btn = document.getElementById('ic-import-btn');
  btn.disabled = true;
  btn.textContent = 'Import en cours…';
  showMessage('', false);

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API_BASE_URL + '/api/admin/import-corrections-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ rows: parsedRows, dryRun: false }),
    });
    const data = await res.json();
    if (!res.ok) {
      showMessage('Erreur import : ' + (data.error || res.status), true);
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
  parsedRows = [];
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
  el.className = 'admin-message' + (isError ? ' admin-message-error' : ' admin-message-success');
  el.textContent = msg;
}
