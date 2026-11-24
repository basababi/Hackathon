const cacheName = "terrasense-shell-__BUILD__";
const files = [
  "/",
  "/index.html",
  "/household",
  "/household.html",
  "/manifest.webmanifest",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/src/app.js",
  "/src/icons.js",
  "/src/data.js",
  "/src/charts.js",
  "/src/ui.js",
  "/src/store.js",
  "/src/calendar.js",
  "/src/analysis.js",
  "/src/analysis.css",
  "/src/home-entry.js",
  "/src/home-ui.js",
  "/src/home-store.js",
  "/src/home-scan.js",
  "/src/home.css",
  "/src/home-scan.css",
  "/src/field-report.css",
  "/src/field-report.js",
  "/src/offline.js",
  "/src/backup.js",
  "/src/backup.css",
  "/src/schema.js",
  "/src/schedule.js",
  "/src/color-reading.js",
  "/src/workflows.js",
  "/src/map.js",
  "/src/style.css",
  "/src/map.css",
  "/src/workflows.css",
  "/assets/mark.svg",
  "/assets/ger-district.webp",
  "/assets/inter.ttf",
  "/assets/map-labels.js",
  "/assets/map-ulaanbaatar.webp",
];
const allowed = new Set(files);
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) =>
        cache.addAll(files.map((url) => new Request(url, { cache: "reload" }))),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("terrasense-shell-") && key !== cacheName,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !allowed.has(url.pathname)
  )
    return;
  const development = cacheName.endsWith("__BUILD__");
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(url.pathname);
      if (hit && !development) return hit;
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(url.pathname, response.clone());
        return response;
      } catch (error) {
        if (hit) return hit;
        throw error;
      }
    })(),
  );
});
