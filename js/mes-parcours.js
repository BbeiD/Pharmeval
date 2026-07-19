// ===================== CONTROLEUR "MES PARCOURS" (Sprint 15) =====================
// Espace UTILISATEUR (pas un ecran d'administration) : accessible a TOUTE
// personne connectee, pour SA PROPRE liste de parcours attribues
// uniquement - aucune permission d'administration requise ici (voir
// js/services/assignment-service.js, getAssignedParcoursForUser(), et
// firestore.rules pour la garantie reelle cote serveur).
//
// Aucune logique metier ici : appelle assignment-service.js et affiche le
// resultat. "Aucune progression n'est encore calculée" (SPRINT15) : ce
// fichier n'affiche que ce que l'attribution et le parcours exposent deja
// (nom, description, statut) - jamais un pourcentage ou un score invente.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, clearCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getAssignedParcoursForUser } from "./services/assignment-service.js";
import { PARCOURS_COLOR_HEX, resolveParcoursColorHex } from "./services/parcours-metadata-service.js";

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showMessage(status, message) {
  const el = document.getElementById('mesparcours-message');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  el.className = 'admin-message admin-message-' + status;
  el.textContent = message;
  el.style.display = 'block';
}

onAuthStateChanged(auth, async function(user) {
  const loadingEl = document.getElementById('mesparcours-loading');
  const viewEl = document.getElementById('mesparcours-view');

  if (!user) {
    clearCurrentUserContext();
    window.location.href = 'index.html';
    return;
  }

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (viewEl) viewEl.style.display = 'block';

  await loadMyParcours();
});

async function loadMyParcours() {
  const ctx = getCurrentUserContext();
  const gridEl = document.getElementById('mesparcours-grid');
  const emptyEl = document.getElementById('mesparcours-empty');
  gridEl.innerHTML = '<div class="bank-list-loading">Chargement de vos parcours…</div>';
  emptyEl.style.display = 'none';

  const result = await getAssignedParcoursForUser(ctx && ctx.uid);
  if (result.error) {
    gridEl.innerHTML = '';
    showMessage('error', 'Impossible de charger vos parcours pour le moment. Réessayez plus tard.');
    return;
  }

  if (result.items.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  gridEl.innerHTML = result.items.map(cardHtml).join('');
}

function cardHtml(entry) {
  const p = entry.parcours;
  const hex = p.color ? resolveParcoursColorHex(p.color) : null;
  const stripe = hex ? 'background:' + escapeHtml(hex) + ';' : '';
  const mandatoryBadge = entry.assignment && entry.assignment.mandatory
    ? '<span class="bank-chip" style="background:#C62828;color:#fff;">Obligatoire</span>' : '';
  const dueBadge = entry.assignment && entry.assignment.dueDate
    ? '<span class="bank-chip">Échéance : ' + escapeHtml(entry.assignment.dueDate) + '</span>' : '';
  return (
    '<div class="mesparcours-card">' +
      '<div class="mesparcours-card-stripe" style="' + stripe + '"></div>' +
      '<div class="mesparcours-card-body">' +
        '<h3>' + (p.icon ? escapeHtml(p.icon) + ' ' : '') + escapeHtml(p.name) + '</h3>' +
        '<p>' + escapeHtml(p.description || 'Aucune description disponible.') + '</p>' +
        '<div class="bank-detail-tags-row">' +
          '<span class="bank-chip bank-badge-published">🟢 Publié</span>' + mandatoryBadge + dueBadge +
        '</div>' +
        '<button class="btn-primary" onclick="openParcours(\'' + escapeHtml(p.id) + '\')">Ouvrir</button>' +
      '</div>' +
    '</div>'
  );
}

// SPRINT16 : "Ouvrir" mène désormais à la véritable page de consultation
// du parcours (parcours-detail.html), qui revérifie elle-même
// l'attribution avant d'afficher quoi que ce soit (voir js/services/
// parcours-view-service.js) - ce fichier ne fait que naviguer, aucune
// logique metier ici.
export function openParcours(parcoursId) {
  window.location.href = 'parcours-detail.html?id=' + encodeURIComponent(parcoursId);
}
window.openParcours = openParcours;
