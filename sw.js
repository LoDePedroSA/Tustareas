/* ============================================================
   TusTareas — Service Worker
   ============================================================ */

const CACHE = 'tustareas-v2';

const ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

/* ---------- Instalación ---------- */
self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ARCHIVOS).catch(err => {
        // Si algún archivo falla (ej: falta el PNG), no rompemos la instalación
        console.warn('Algún archivo no se pudo cachear:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

/* ---------- Activación ---------- */
self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(claves => Promise.all(
        claves.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- Fetch ---------- */
self.addEventListener('fetch', evento => {
  const peticion = evento.request;

  if (peticion.method !== 'GET') return;
  if (!peticion.url.startsWith('http')) return;

  evento.respondWith(
    caches.match(peticion).then(cacheada => {
      if (cacheada) return cacheada;

      return fetch(peticion)
        .then(respuesta => {
          if (respuesta && respuesta.status === 200) {
            const copia = respuesta.clone();
            caches.open(CACHE).then(c => c.put(peticion, copia)).catch(() => {});
          }
          return respuesta;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

/* ---------- Click en notificación ---------- */
self.addEventListener('notificationclick', evento => {
  evento.notification.close();

  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      for (const cliente of lista) {
        if ('focus' in cliente) return cliente.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});