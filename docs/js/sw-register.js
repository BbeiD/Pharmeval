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
// depuis la racine du domaine personnalise (pharmeval.be depuis le
// 29/07/2026, pharmeval.pro redirige desormais vers lui - voir CNAME),
// jamais depuis un sous-dossier.
//
// Les service workers exigent un contexte securise (HTTPS, ou localhost en
// developpement) - l'enregistrement echoue silencieusement ailleurs (ex.
// tant que le certificat du domaine n'est pas encore actif), sans jamais
// bloquer le chargement normal de la page.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(function(reg) {
        // Quand un nouveau SW prend le contrôle (après update), recharge
        // la page pour que l'utilisateur ait immédiatement la dernière
        // version des fichiers statiques — sans action manuelle.
        navigator.serviceWorker.addEventListener('controllerchange', function() {
          window.location.reload();
        });
        // Vérifie activement si une mise à jour est disponible.
        reg.update().catch(function() {});
      })
      .catch(function(err) {
        console.error('[sw-register] Échec de l\'enregistrement du service worker :', err);
      });
  });
}
