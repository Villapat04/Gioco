const CACHE_NAME = 'impostore-game-v1'; // Cambia questo se aggiorni i file
const urlsToCache = [
  '/',
  '/index.html',
  // Se hai un file CSS esterno, aggiungilo qui:
  // '/style.css', 
  '/socket.io/socket.io.js', // Se il tuo index.html lo carica da qui

  // I TUOI LOGHI E ALTRE IMMAGINI
  '/logo_imposter.png',
  '/logo_detective.png',
  '/logo_infiltrato.png',
  '/clash_detective.png', 
  '/clash_impostor.png', // Se lo creerai
  '/clash_infiltrato.png', // Se lo creerai
  '/icon-192.png',
  '/icon-512.png'

  // AGGIUNGI QUI TUTTI GLI ALTRI FILE STATICI CHE VUOI CHE FUNZIONINO OFFLINE
  // Ad esempio, se hai un file 'background.jpg' nella cartella public, mettilo qui:
  // '/background.jpg',
];

// Evento 'install': Viene eseguito la prima volta che il service worker viene installato.
// Qui cachiamo tutti i file essenziali.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cache aperta!');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.error('Service Worker: Errore durante il caching: ', error);
      })
  );
});

// Evento 'fetch': Intercetta tutte le richieste di rete.
// Prova a servire il file dalla cache; se non lo trova, va in rete.
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Se troviamo una corrispondenza nella cache, la restituiamo
        if (response) {
          return response;
        }
        // Altrimenti, andiamo in rete per recuperare la risorsa
        return fetch(event.request);
      })
      .catch(error => {
        console.error('Service Worker: Errore durante il fetch: ', error);
        // Potresti voler restituire una pagina offline qui per i fallback
        // es. return caches.match('/offline.html');
      })
  );
});

// Evento 'activate': Viene eseguito quando il service worker viene attivato.
// Qui puliamo le vecchie cache.
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Service Worker: Eliminando vecchia cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});