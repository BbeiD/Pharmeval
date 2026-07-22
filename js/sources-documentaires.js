// ===================== CONTROLEUR "SOURCES DOCUMENTAIRES" (refonte visuelle, phase 1) =====================
// Espace UTILISATEUR (pas un ecran d'administration) : accessible a toute
// personne connectee, en LECTURE SEULE - aucune permission d'administration
// requise. Reutilise EXACTEMENT les memes fonctions que l'entrainement
// libre (browseActiveDocumentSources()/getActiveSectionTree(), deja
// construites et deja publiques - voir js/services/document-source-
// service.js / document-section-service.js), aucune nouvelle logique
// metier ici, aucune ecriture Firestore.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext } from "./services/app-context.js";
import { browseActiveDocumentSources } from "./services/document-source-service.js";
import { getActiveSectionTree } from "./services/document-section-service.js";
import { DOCUMENT_SOURCE_TYPE_LABELS } from "./services/document-source-metadata-service.js";
import { renderSiteHeader } from "./site-header.js";

function qs(id) { return document.getElementById(id); }
function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showMessage(status, message) {
  const el = qs('src-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

let state = { items: [], selectedId: null };

onAuthStateChanged(auth, async function(user) {
  const loadingEl = qs('src-loading');
  const viewEl = qs('src-view');

  if (!user) { clearCurrentUserContext(); window.location.href = 'index.html'; return; }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';
  renderSiteHeader('sources');

  await loadSources();
});

async function loadSources() {
  const listEl = qs('src-list');
  const emptyEl = qs('src-empty');
  const columnsEl = qs('src-columns');
  listEl.innerHTML = '<div class="bank-list-loading">Chargement…</div>';

  const result = await browseActiveDocumentSources();
  if (result.error) {
    listEl.innerHTML = '';
    columnsEl.style.display = 'none';
    showMessage('error', result.message || 'Impossible de charger les sources documentaires pour le moment.');
    return;
  }

  state.items = result.items || [];
  if (state.items.length === 0) {
    columnsEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';
  columnsEl.style.display = 'grid';
  renderList();
}

function renderList() {
  qs('src-list').innerHTML = state.items.map(function(s) {
    const selected = s.id === state.selectedId ? ' bank-row-selected' : '';
    const typeLabel = DOCUMENT_SOURCE_TYPE_LABELS[s.sourceType] || s.sourceType || '—';
    return (
      '<div class="bank-row' + selected + '" onclick="selectSource(\'' + escapeHtml(s.id) + '\')">' +
        '<div class="bank-row-top">' +
          '<span class="bank-row-id">' + escapeHtml(s.name) + '</span>' +
          '<span class="bank-badge bank-badge-published">' + escapeHtml(typeLabel) + '</span>' +
        '</div>' +
        (s.sourceOrganizationName ? '<div class="bank-row-meta">' + escapeHtml(s.sourceOrganizationName) + (s.version ? ' · v' + escapeHtml(s.version) : '') + '</div>' : '') +
      '</div>'
    );
  }).join('');
}

export async function selectSource(sourceId) {
  state.selectedId = sourceId;
  renderList();

  const source = state.items.find(function(s) { return s.id === sourceId; });
  if (!source) return;

  qs('src-detail-placeholder').style.display = 'none';
  const detailEl = qs('src-detail');
  detailEl.style.display = 'block';
  detailEl.innerHTML = '<div class="bank-list-loading">Chargement du sommaire…</div>';

  const result = await getActiveSectionTree(sourceId);
  detailEl.innerHTML = detailHtml(source, result.items || []);
}

function detailHtml(source, sections) {
  const typeLabel = DOCUMENT_SOURCE_TYPE_LABELS[source.sourceType] || source.sourceType || '—';
  let html = '<div class="bank-detail-card">';
  html += '<div class="bank-detail-header"><h3>' + escapeHtml(source.name) + '</h3><span class="bank-badge bank-badge-published">' + escapeHtml(typeLabel) + '</span></div>';

  if (source.description) {
    html += '<p class="pv-header-description">' + escapeHtml(source.description) + '</p>';
  }

  html += '<div class="bank-detail-section"><h4>Détails</h4>';
  html += '<div class="bank-detail-row"><strong>Organisme :</strong> ' + escapeHtml(source.sourceOrganizationName || '—') + '</div>';
  html += '<div class="bank-detail-row"><strong>Version :</strong> ' + escapeHtml(source.version || '—') + '</div>';
  if (source.academicYear) html += '<div class="bank-detail-row"><strong>Année académique :</strong> ' + escapeHtml(source.academicYear) + '</div>';
  html += '</div>';

  html += '<div class="bank-detail-section"><h4>Sommaire</h4>';
  if (sections.length === 0) {
    html += '<p class="pv-list-empty">Aucune section pour cette source (elle est composée directement de questions non classées par section).</p>';
  } else {
    html += '<ul class="bank-timeline-list">' + sections.map(function(s) {
      const indent = '— '.repeat(s.level || 0);
      return '<li class="bank-timeline-item"><div class="bank-timeline-label">' + escapeHtml(indent) + escapeHtml(s.name) + '</div></li>';
    }).join('') + '</ul>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

window.selectSource = selectSource;
