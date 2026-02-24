// Service Worker for GemiHub — offline asset & navigation caching.
// Intentionally does NOT register a full PWA manifest (no display:standalone)
// so browsers will not show an install prompt.

const CACHE_NAME = "gemihub-sw-v1";

// ---- Install ----
self.addEventListener("install", (event) => {
  // Precache the index page so the app shell is available offline immediately.
  // The first navigation occurs before the SW takes control, so it won't be
  // runtime-cached without this. Assets are cached separately via warmup message.
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add("/"))
      .catch(() => {}) // don't block install if precache fails (e.g. not authenticated)
  );
  self.skipWaiting();
});

// ---- Activate ----
self.addEventListener("activate", (event) => {
  // Clean up old caches from previous SW versions
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("gemihub-sw-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

// ---- Message handler: cache warmup after first activation ----
// The page sends asset URLs after the SW first takes control, ensuring
// JS/CSS are in the Cache API for offline use (they load before the SW
// is active on the very first visit, so runtime caching misses them).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "warmup") {
    var urls = event.data.urls || [];
    event.waitUntil(
      caches.open(CACHE_NAME).then(function (cache) {
        var promises = urls.map(function (url) {
          return cache.match(url).then(function (existing) {
            if (existing) return; // Already cached
            return fetch(url, { credentials: "same-origin" })
              .then(function (resp) {
                if (resp.ok) return cache.put(url, resp);
              })
              .catch(function () {});
          });
        });
        return Promise.all(promises);
      })
    );
  }
});

// ---- Fetch ----
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Skip API and auth routes — API data is managed by IndexedDB on the client
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // Skip Vite dev server dependencies — never cache these
  if (url.pathname.startsWith("/node_modules/")) {
    return;
  }

  // Skip React Router single-fetch data requests — handled by clientLoader
  if (url.pathname.endsWith(".data")) {
    return;
  }

  // --- Hashed static assets (JS/CSS in /assets/, icons, favicon) → cache-first ---
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".ico")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        if (!navigator.onLine)
          return new Response("", { status: 503, statusText: "Service Unavailable" });
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // --- Navigation requests (HTML pages) → network-first, cache fallback ---
  if (request.mode === "navigate") {
    // Serve cached page when offline (or network unreachable).
    const serveCached = () =>
      caches
        .match(request, { ignoreVary: true })
        .then(
          (cached) =>
            cached ||
            caches.match(request, { ignoreSearch: true, ignoreVary: true })
        )
        .then((cached) => cached || caches.match("/", { ignoreVary: true }))
        .then(
          (cached) =>
            cached ||
            new Response("Offline — please reconnect and reload.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
        );

    // Skip network entirely when definitely offline.
    if (!navigator.onLine) {
      event.respondWith(serveCached());
      return;
    }

    // Online (or uncertain) — try network with a timeout fallback.
    // Some networks report online but hang for 15s+, so abort after 3s.
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 3000);
    event.respondWith(
      fetch(request, { signal: ac.signal })
        .then((response) => {
          clearTimeout(tid);
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          clearTimeout(tid);
          return serveCached();
        })
    );
    return;
  }

  // --- Other sub-resources (fonts, images, etc.) → stale-while-revalidate ---
  event.respondWith(
    caches.match(request).then((cached) => {
      // When offline, return cached immediately or fail fast (don't hang on fetch).
      // Render-blocking resources like Google Fonts CSS would block page paint otherwise.
      if (!navigator.onLine)
        return cached || new Response("", { status: 503, statusText: "Service Unavailable" });

      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(
          () =>
            cached ||
            new Response("", { status: 503, statusText: "Service Unavailable" })
        );

      return cached || networkFetch;
    })
  );
});
