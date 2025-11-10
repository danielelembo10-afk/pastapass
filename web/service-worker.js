// Simple cache so app loads fast when opened from Home Screen
const CACHE = "pasta-pass-v1";
const ASSETS = ["/mobile.html", "/assets/logo.png", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
