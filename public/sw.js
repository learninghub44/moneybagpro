// Minimal service worker: enables "Add to Home Screen" / install prompts and
// caches the static app shell only. Deliberately does NOT cache API calls,
// WebSocket connections, or bot XML files — this is a live trading app, so
// price/contract data must always come from the network, never from cache.
const CACHE_NAME = 'trading-bot-shell-v1';
// Deliberately excludes '/' (the HTML document) — caching the app shell HTML
// is what causes a stale app referencing deleted JS chunk hashes after a new
// deploy, which is exactly the class of bug this project's
// removeLegacyPwaState() was written to clean up. Only cache assets that are
// safe to serve stale: the manifest and icons.
const SHELL_ASSETS = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;

    // Only handle same-origin GET requests for the static shell itself.
    // Everything else (API calls, Deriv WebSocket, bot XML fetches, OAuth,
    // any cross-origin request) passes straight through to the network.
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (!SHELL_ASSETS.includes(url.pathname)) return;

    event.respondWith(
        caches.match(request).then(cached => {
            const network = fetch(request)
                .then(response => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
