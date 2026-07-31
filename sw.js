// ===================== SERVICE WORKER — Etape 17 (PWA) =====================
// Strategie volontairement PRUDENTE, adaptee a une application dont TOUTES
// les donnees reelles viennent de Firebase (Firestore/Auth via le SDK
// client, API via Cloud Functions) - ce service worker ne rend jamais
// l'application "hors-ligne complet" (impossible sans dupliquer toute la
// logique metier), il sert uniquement a :
//   1. Accelerer les chargements repetes des fichiers STATIQUES (HTML/CSS/
//      JS/icones du meme domaine) via un cache local.
//      2. Offrir un repli minimal si le reseau est momentanement indisponible.
//
// REGLE ABSOLUE (jamais d'exception) : ne JAMAIS intercepter une requete
// vers Firebase/Firestore/Auth/Cloud Functions ou tout domaine externe
// (CDN) - uniquement le contenu STATIQUE du MEME ORIGINE. Une donnee
// metier mise en cache par erreur (score, question, session...)
// deviendrait rapidement fausse/perimee sans que l'utilisateur s'en
// rende compte - inacceptable pour une application d'evaluation.
//
// STRATEGIE "network-first" (jamais "cache-first") pour le contenu
// statique lui-meme : ce projet redeploie frequemment (plusieurs fois par
// session de travail) - un cache-first servirait indefiniment un ancien
// fichier JS/CSS deja corrige, potentiellement en contradiction avec un
// backend deja mis a jour. Le cache n'intervient QUE si le reseau echoue
// (repli hors-ligne), jamais comme premier choix.

const CACHE_VERSION = 'pharmeval-v3';

// Coeur minimal precache a l'installation - le reste du contenu statique
// (JS/CSS/pages non listees ici) est mis en cache PROGRESSIVEMENT au fil
// de la navigation reelle (voir le gestionnaire fetch ci-dessous), jamais
// precache en bloc : une liste exhaustive de tous les fichiers JS du
// projet serait vite perimee a chaque ajout de fichier (voir js/services/,
// des dizaines de fichiers) et n'apporterait rien que le cache progressif
// n'offre pas deja.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/assets/icons/pwa/icon-192.png',
  '/assets/icons/pwa/icon-512.png',
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      // { cache: 'reload' } contourne le cache HTTP du navigateur et force un
      // telechargement reseau reel - necesssaire ici pour que le precache
      // contienne toujours la version la plus recente des fichiers critiques,
      // independamment de tout cache HTTP residuel (ex. ancienne CSS mise en
      // cache par le navigateur avant un redeploi).
      return Promise.all(
        PRECACHE_URLS.map(function(url) {
          return fetch(new Request(url, { cache: 'reload' }))
            .then(function(resp) { if (resp && resp.ok) return cache.put(url, resp); })
            .catch(function() {});
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_VERSION; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

function isSameOriginStaticRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  // Jamais intercepter l'API (Cloud Functions passe par le meme domaine
  // que le front pour certains appels ? non - API_BASE_URL pointe vers
  // cloudfunctions.net, donc deja cross-origin et deja exclue par le test
  // ci-dessus. Cette exclusion explicite reste une securite supplementaire
  // si jamais un proxy same-origin etait ajoute un jour vers l'API.
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

self.addEventListener('fetch', function(event) {
  const request = event.request;
  if (!isSameOriginStaticRequest(request)) return; // jamais de respondWith - le navigateur gere nativement

  // CORRECTIF (constate en verifiant ce meme correctif en direct, 27/07/2026) :
  // fetch(request) SANS option respecte le cache HTTP habituel du
  // navigateur - une reponse encore "fraiche" au sens des en-tetes
  // Cache-Control pouvait donc etre servie SANS jamais recontacter le
  // serveur, malgre le nom "network-first" de cette strategie. { cache:
  // 'no-cache' } force une REVALIDATION reseau systematique (ETag/
  // Last-Modified - toujours rapide via un 304 si le fichier n'a pas
  // change, jamais une simple lecture locale aveugle). Necessaire ici
  // puisque ce projet redeploie plusieurs fois par session de travail.
  const revalidatedRequest = new Request(request, { cache: 'no-cache' });

  event.respondWith(
    fetch(revalidatedRequest)
      .then(function(networkResponse) {
        // Ne met en cache qu'une reponse reellement valide (jamais une
        // erreur 4xx/5xx, qui deviendrait un faux "succes" en cache).
        if (networkResponse && networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_VERSION).then(function(cache) { cache.put(request, clone); });
        }
        return networkResponse;
      })
      .catch(function() {
        // Reseau indisponible : repli sur le cache si une version
        // anterieure existe, sinon l'echec remonte normalement (jamais un
        // faux succes fabrique).
        return caches.match(request).then(function(cached) {
          if (cached) return cached;
          throw new Error('Ressource indisponible hors-ligne : ' + request.url);
        });
      })
  );
});
