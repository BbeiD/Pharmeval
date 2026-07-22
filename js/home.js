// ===================== CONTROLEUR DE L'ACCUEIL (Sprint 21.5+) =====================
// Complete l'accueil (index.html, #home-view) avec un apercu des parcours
// attribues a l'utilisateur, en plus de l'entree "Entrainement libre" deja
// presente - meme service que js/mes-parcours.js (getAssignedParcoursForUser),
// aucune logique metier ici, aucune ecriture Firestore.

import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureUserDocument } from "./services/user-service.js";
import { setCurrentUserContext, getCurrentUserContext } from "./services/app-context.js";
import { getAssignedParcoursForUser } from "./services/assignment-service.js";
import { resolveParcoursColorHex } from "./services/parcours-metadata-service.js";

// Nombre maximal de parcours affiches sur l'accueil - au-dela, l'utilisateur
// est renvoye vers "Mes parcours" (lien deja present dans la section, voir
// index.html) plutot que de surcharger la page d'accueil.
const MAX_HOME_PARCOURS = 4;

function escapeHtml(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

onAuthStateChanged(auth, async function(user) {
  if (!user) return;

  try {
    const userData = await ensureUserDocument(user);
    setCurrentUserContext(user, userData);
  } catch (err) {
    console.error('Erreur lors de la vérification du compte :', err);
  }

  await loadHomeParcours();
});

async function loadHomeParcours() {
  const gridEl = document.getElementById('home-parcours-grid');
  const emptyEl = document.getElementById('home-parcours-empty');
  if (!gridEl) return;

  const ctx = getCurrentUserContext();
  const result = await getAssignedParcoursForUser(ctx && ctx.uid);

  if (result.error || result.items.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.style.display = result.error ? 'none' : 'block';
    return;
  }

  emptyEl.style.display = 'none';
  gridEl.innerHTML = result.items.slice(0, MAX_HOME_PARCOURS).map(cardHtml).join('');
}

function cardHtml(entry) {
  const p = entry.parcours;
  const hex = p.color ? resolveParcoursColorHex(p.color) : null;
  const stripe = hex ? 'background:' + escapeHtml(hex) + ';' : '';
  const mandatoryBadge = entry.assignment && entry.assignment.mandatory
    ? '<span class="bank-chip" style="background:#C62828;color:#fff;">Obligatoire</span>' : '';
  return (
    '<div class="mesparcours-card">' +
      '<div class="mesparcours-card-stripe" style="' + stripe + '"></div>' +
      '<div class="mesparcours-card-body">' +
        '<h3>' + (p.icon ? escapeHtml(p.icon) + ' ' : '') + escapeHtml(p.name) + '</h3>' +
        '<p>' + escapeHtml(p.description || 'Aucune description disponible.') + '</p>' +
        '<div class="bank-detail-tags-row">' + mandatoryBadge + '</div>' +
        '<a class="btn-primary" href="parcours-detail.html?id=' + encodeURIComponent(p.id) + '">Ouvrir</a>' +
      '</div>' +
    '</div>'
  );
}
