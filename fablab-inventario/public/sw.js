// Service Worker para FabLab Inventario PWA
// Cachea la app shell y permite uso offline básico.

const CACHE_NAME = 'fablab-v2'; // v2: editor de elementos, traslado y export
const SHELL_ASSETS = [
  '/',
  '/index.html',
];

// Instalar: cachear app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
      ),
    ),
  );
  self.clients.claim();
});

// Fetch: cache primero para shell, red para datos de API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API: red primero (siempre datos frescos)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  // App shell: cache primero
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }),
  );
});
