const CACHE = 'soundtouch-v1';
const OFFLINE_URL = '/';

// On install — cache the shell
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll([OFFLINE_URL]))
    );
    self.skipWaiting();
});

// On activate — remove old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch — network first, fall back to cache for navigation
self.addEventListener('fetch', e => {
    // Only handle GET navigation requests (page loads)
    if (e.request.method !== 'GET') return;
    if (e.request.mode !== 'navigate') return;

    e.respondWith(
        fetch(e.request)
            .then(res => {
                // Update cache with fresh response
                const clone = res.clone();
                caches.open(CACHE).then(cache => cache.put(OFFLINE_URL, clone));
                return res;
            })
            .catch(() =>
                // Network failed — serve cached shell
                caches.match(OFFLINE_URL)
            )
    );
});
