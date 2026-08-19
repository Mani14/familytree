// Minimal service worker: its only job is to make the app installable
// ("Add to Home Screen") — Chromium requires a registered service worker with
// a fetch handler before it offers installation. Deliberately caches NOTHING:
// the tree's data already works offline through Firestore's own cache, and a
// naive asset cache here would risk serving stale JS/CSS after a deploy (the
// exact kind of silent breakage the repo has been bitten by before). Passing
// every request through untouched keeps updates instant while still satisfying
// the installability requirement.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
