import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG } from "../js/config.js";
import { API_BASE_URL } from "../js/config.js";
import { renderSiteHeader } from "../js/site-header.js";

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

let parsedRows = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }
  const snap = await getDoc(doc(db, "users", user.uid));
  const d = snap.exists() ? snap.data() : {};
  if (d.role !== "admin" || d.status !== "active") {
    document.getElementById("ic-loading").style.display = "none";
    document.getElementById("ic-denied").style.display = "";
    return;
  }
  renderSiteHeader(document.getElementById("site-header-mount"), { user, db, auth });
  document.getElementById("ic-loading").style.display = "none";
  document.getElementById("ic-view").style.display = "";
  document.getElementById("ic-file-input").addEventListener("change", onFileChange);
});

function onFileChange(e) {
  const btn = document.getElementById("ic-analyze-btn");
  btn.disabled = !e.target.files.length;
}

function parseCSV(text) {
  const lines = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);

  const splitLine = (line) => {
    const fields = [];
    let f = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { f += '"'; i++; }
        else q = !q;
      } else if (ch === "," && !q) {
        fields.push(f);
        f = "";
      } else {
        f += ch;
      }
    }
    fields.push(f);
    return fields;
  };

  const rows = [];
  // strip BOM
  const firstLine = lines[0].replace(/^﻿/, "");
  const headers = splitLine(firstLine);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitLine(lines[i]);
    const obj = {};
    headers.forEach((h, j) => { obj[h.trim()] = (vals[j] || "").trim(); });
    if (obj.pedagogicalId) rows.push(obj);
  }
  return rows;
}

window.analyzeFile = async function analyzeFile() {
  const file = document.getElementById("ic-file-input").files[0];
  if (!file) return;
  const btn = document.getElementById("ic-analyze-btn");
  btn.disabled = true;
  btn.textContent = "Analyse…";
  showMessage("", false);

  try {
    const text = await file.text();
    parsedRows = parseCSV(text);
    if (!parsedRows.length) { showMessage("Le fichier CSV est vide ou mal formaté.", true); btn.textContent = "Analyser"; btn.disabled = false; return; }

    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API_BASE_URL + "/api/admin/import-corrections-csv", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ rows: parsedRows, dryRun: true }),
    });
    const data = await res.json();
    if (!res.ok) { showMessage("Erreur dry-run : " + (data.error || res.status), true); btn.textContent = "Analyser"; btn.disabled = false; return; }

    renderPreview(data, parsedRows.length);
    document.getElementById("ic-step2").style.display = "";
    document.getElementById("ic-step1").style.display = "none";
  } catch (err) {
    showMessage("Erreur : " + err.message, true);
    btn.textContent = "Analyser";
    btn.disabled = false;
  }
};

function renderPreview(data, total) {
  const el = document.getElementById("ic-preview");
  const notFoundHtml = data.notFound && data.notFound.length
    ? `<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--text2)">${data.notFound.length} IDs introuvables dans Firestore</summary>
        <ul style="font-size:12px;color:var(--text2);margin-top:8px">${data.notFound.map((id) => `<li>${id}</li>`).join("")}</ul>
       </details>`
    : "";

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px">
      <div class="ic-stat"><span class="ic-stat-num">${total}</span><span class="ic-stat-label">Lignes lues</span></div>
      <div class="ic-stat ic-stat-update"><span class="ic-stat-num">${data.updated}</span><span class="ic-stat-label">Mises à jour</span></div>
      <div class="ic-stat ic-stat-delete"><span class="ic-stat-num">${data.deleted}</span><span class="ic-stat-label">Suppressions</span></div>
      <div class="ic-stat ic-stat-warn"><span class="ic-stat-num">${data.notFound ? data.notFound.length : 0}</span><span class="ic-stat-label">Introuvables</span></div>
    </div>
    <p style="color:var(--text2);font-size:13px;margin:0">Vérifiez les chiffres ci-dessus avant de confirmer. <strong>Les suppressions sont irréversibles.</strong></p>
    ${notFoundHtml}
  `;
}

window.confirmImport = async function confirmImport() {
  const btn = document.getElementById("ic-import-btn");
  btn.disabled = true;
  btn.textContent = "Import en cours…";
  showMessage("", false);

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API_BASE_URL + "/api/admin/import-corrections-csv", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ rows: parsedRows, dryRun: false }),
    });
    const data = await res.json();
    if (!res.ok) { showMessage("Erreur import : " + (data.error || res.status), true); btn.textContent = "Confirmer l'import"; btn.disabled = false; return; }

    document.getElementById("ic-step2").style.display = "none";
    renderResults(data);
    document.getElementById("ic-step3").style.display = "";
  } catch (err) {
    showMessage("Erreur : " + err.message, true);
    btn.textContent = "Confirmer l'import";
    btn.disabled = false;
  }
};

function renderResults(data) {
  document.getElementById("ic-results").innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px">
      <div class="ic-stat ic-stat-update"><span class="ic-stat-num">${data.updated}</span><span class="ic-stat-label">Mises à jour</span></div>
      <div class="ic-stat ic-stat-delete"><span class="ic-stat-num">${data.deleted}</span><span class="ic-stat-label">Supprimées</span></div>
      <div class="ic-stat ic-stat-warn"><span class="ic-stat-num">${data.notFound ? data.notFound.length : 0}</span><span class="ic-stat-label">Introuvables</span></div>
    </div>
    <p style="color:var(--green-dark);font-weight:600;margin-top:16px">✓ Import terminé avec succès.</p>
  `;
}

window.resetForm = function resetForm() {
  parsedRows = [];
  document.getElementById("ic-file-input").value = "";
  document.getElementById("ic-analyze-btn").disabled = true;
  document.getElementById("ic-analyze-btn").textContent = "Analyser";
  document.getElementById("ic-step1").style.display = "";
  document.getElementById("ic-step2").style.display = "none";
  document.getElementById("ic-step3").style.display = "none";
  showMessage("", false);
};

function showMessage(msg, isError) {
  const el = document.getElementById("ic-message");
  if (!msg) { el.style.display = "none"; return; }
  el.style.display = "";
  el.className = "admin-message" + (isError ? " admin-message-error" : " admin-message-success");
  el.textContent = msg;
}
