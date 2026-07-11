var CACHE_NAME = "ping-shell-v1";
var SHELL_FILES = ["/", "/index.html", "/app.js", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL_FILES); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

// Network-first for the API (never serve stale AI results), cache-first for the shell.
self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (url.pathname.indexOf("/api/") === 0) return; // let API calls hit the network directly
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
