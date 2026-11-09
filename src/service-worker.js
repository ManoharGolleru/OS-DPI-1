var GHPATH = "/OS-DPI-1";
var APP_PREFIX = "osdpi_";
var VERSION = APP_VERSION;
var URLS = [
  `${GHPATH}/`,
  `${GHPATH}/index.html`,
  `${GHPATH}/index.css`,
  `${GHPATH}/index.js`,
  `${GHPATH}/xlsx.js`,
  `${GHPATH}/favicon.ico`,
  `${GHPATH}/icon.png`,
  `${GHPATH}/tracky-mouse/lib/clmtrackr.js`,
  `${GHPATH}/tracky-mouse/lib/stats.js`,
  `${GHPATH}/tracky-mouse/lib/tf.js`,
  `${GHPATH}/tracky-mouse/facemesh.worker.js`,
  `${GHPATH}/tracky-mouse/lib/facemesh/facemesh.js`,
  `${GHPATH}/tracky-mouse/lib/facemesh/facemesh/model.json`,
  `${GHPATH}/tracky-mouse/lib/facemesh/facemesh/group1-shard1of1.bin`,
  `${GHPATH}/tracky-mouse/lib/facemesh/blazeface/model.json`,
  `${GHPATH}/tracky-mouse/lib/facemesh/blazeface/group1-shard1of1.bin`,
];

var CACHE_NAME = APP_PREFIX + VERSION;
self.addEventListener("fetch", function (/** @type {FetchEvent} */ e) {
  const url = new URL(e.request.url);
  if (URLS.includes(url.pathname)) {
    // Network first, so a deploy shows up on the next load instead of
    // waiting behind the update button; the cache still covers offline use.
    e.respondWith(
      // no-cache: revalidate with the server, never a stale HTTP-cache copy
      fetch(e.request, { cache: "no-cache" })
        .then(function (response) {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          }
          return response;
        })
        .catch(function () {
          return caches.match(e.request).then(
            (cached) => cached || Response.error(),
          );
        }),
    );
  }
});

self.addEventListener("install", function (/** @type {ExtendableEvent} */ e) {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(
          URLS.map((url) => new Request(url, { cache: "reload" })),
        );
      })
      // take over right away rather than waiting for the update button
      .then(() =>
        /** @type {ServiceWorkerGlobalScope} */ (
          /** @type {unknown} */ (self)
        ).skipWaiting(),
      ),
  );
});

self.addEventListener("activate", function (/** @type {ExtendableEvent} */ e) {
  e.waitUntil(
    caches.keys().then(function (keyList) {
      var cacheWhitelist = keyList.filter(function (key) {
        return key.indexOf(APP_PREFIX);
      });
      cacheWhitelist.push(CACHE_NAME);
      return Promise.all(
        keyList.map(function (key, i) {
          if (cacheWhitelist.indexOf(key) === -1) {
            return caches.delete(keyList[i]);
          }
        }),
      );
    }),
  );
});
self.addEventListener("message", (/** @type {MessageEvent} */ event) => {
  if (event.data === "SKIP_WAITING") {
    /** @type {ServiceWorkerGlobalScope} */ (
      /** @type {unknown} */ (self)
    ).skipWaiting();
  }
});
