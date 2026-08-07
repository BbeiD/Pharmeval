// ===================== LOGIQUE APPLICATIVE PHARMEVAL (Sprint 21.5, Phase B2) =====================
// SUPPRESSION DEFINITIVE DU MOTEUR DE QUIZ V1 (themes/pathologies/questions
// locales - voir CHANGELOG et RAPPORT_PHASE_B2.md) : ce fichier ne contient
// plus que la navigation interne minimale entre les trois panneaux qui
// restent sur index.html (accueil, historique, administration). Le moteur
// d'evaluation reel vit desormais entierement dans js/services/ (Sprint 17+)
// et l'entree utilisateur se fait par js/entrainement-libre.js (Phase B1).
//
// CONVERTI EN MODULE (refonte visuelle, phase 1) : uniquement pour importer
// renderSiteHeader() et garder le surlignage de la navigation partagee
// cohérent avec la vue reellement affichee - `window.show/goHome/
// selectProfile` restent exposes a l'identique, aucun appel existant
// (onclick="goHome()", js/recommendation.js, js/history.js) n'a besoin
// de changer.
//
// Fonctions volontairement conservees ici (et pourquoi) :
// - show(id)      : bascule entre home-view / history-view / admin-view,
//                    seuls panneaux internes restants sur index.html.
// - goHome()       : appelee depuis index.html (bouton "Accueil"), et
//                    depuis js/recommendation.js / js/history.js (guard
//                    `typeof window.goHome === 'function'`) - CONSERVEE
//                    pour ne jamais transformer ces appels existants en
//                    no-op silencieux.
// - selectProfile(): appelee automatiquement par js/auth.js (revealApp(),
//                    Phase A) apres connexion - CONSERVEE avec ce nom exact
//                    pour ne rien avoir a modifier dans auth.js ; ne fait
//                    plus aucun filtrage par profil (Phase B2 : plus de
//                    themes a filtrer), affiche simplement l'accueil.

import { renderSiteHeader } from "./site-header.js";

function show(id) {
  ['home-view', 'history-view', 'admin-view'].forEach(function(v) {
    var el = document.getElementById(v);
    if (el) el.style.display = v === id ? 'block' : 'none';
  });
}

function goHome() {
  show('home-view');
  // CORRECTIF (constat fait en testant depuis "Sources documentaires") :
  // sans cet appel, revenir a l'accueil en mode SPA (clic sur "Accueil"
  // dans l'en-tete partage pendant qu'on est deja sur index.html) laissait
  // la navigation surlignee sur l'onglet precedent (ex. "Mes évaluations").
  renderSiteHeader('accueil');
}

// Conserve ce nom exact (appele par js/auth.js) - ne fait plus de
// filtrage par profil, Phase B2 ayant supprime le systeme de themes.
function selectProfile(profile) {
  void profile; // parametre conserve pour compatibilite d'appel, plus utilise
  show('home-view');
  renderSiteHeader('accueil');
}

window.show = show;
window.goHome = goHome;
window.selectProfile = selectProfile;
