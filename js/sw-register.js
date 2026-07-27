// ===================== ENREGISTREMENT DU SERVICE WORKER — Etape 17 (PWA) =====================
// Inclus sur CHAQUE page (top-level ET admin/) - voir sw.js (racine) pour
// la strategie de cache elle-meme.
//
// Chemin ABSOLU volontaire ('/sw.js', pas un chemin relatif comme le reste
// du projet) : un service worker enregistre avec un chemin relatif depuis
// une page admin/ (ex. "../sw.js") limiterait sa PORTEE ("scope") au
// dossier admin/ uniquement - il ne controlerait alors jamais les pages de
// premier niveau. Un chemin absolu depuis la racine du domaine garantit une
// portee sur tout le site, quelle que soit la page qui l'enregistre.
// Sans risque de portabilite ici : le site est desormais toujours servi
// depuis la racine du domaine personnalise (pharmeval.pro), jamais depuis
// un sous-dossier (voir CNAME, Etape "nom de domaine").
//
// Les service workers exigent un contexte securise (HTTPS, ou localhost en
// developpement) - l'enregistrement echoue silencieusement ailleurs (ex.
// tant que le certificat pharmeval.pro n'est pas encore actif), sans jamais
// bloquer le chargement normal de la page.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').catch(function(err) {
      console.error('[sw-register] Échec de l\'enregistrement du service worker :', err);
    });
  });
}
