// Minimal service worker: makes the site installable and shows a friendly page when the phone is offline.
// It deliberately caches NOTHING else, so results, fixtures, the table and payments are always live and never stale.
const OFFLINE = "/offline.html";
const CACHE = "efa-offline-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return; // everything except page loads goes straight to the network
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});
