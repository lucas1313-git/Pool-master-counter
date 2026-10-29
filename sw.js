// Pool Master Counter's service worker (P21): the app opens with no network,
// and bad bar Wi-Fi never holds up start-up.
// - the page and its ?v= files (the app shell): from the cache first, in a
//   cache named after the ?v= tag this worker was registered with
//   (sw.js?v=...) - a new tag is a new worker and a fresh shell cache, the
//   old one deleted; the page itself is answered from the cache at once and
//   refreshed in the background (its new ?v= files fetched before the new
//   page is kept, so the cache never holds a page without its files);
// - languages, settings and data JSON: the network first, the cache after
//   3 s or offline (kept without their cache-busting ?v=<time>);
// - the camera's models: cached on first use, kept across versions;
// - the server's own endpoints (/api/, /voice, /ws) are never touched.
var VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
var SHELL = "pmc-shell-" + VERSION;
var DATA = "pmc-data";
var MODELS = "pmc-models";
var NETWORK_WAIT_MS = 3000;

function scopePath(path) {
  return new URL(path, self.registration.scope).href;
}

// the page's own ?v= files, read from its HTML
function shellFilesOf(html) {
  var out = [];
  var re = /(?:src|href)="([^"]+\?v=[^"]+)"/g;
  var m;
  while ((m = re.exec(html))) {
    if (!/^https?:/.test(m[1])) out.push(scopePath(m[1]));
  }
  return out;
}

function cachePage(cache, response) {
  return response.clone().text().then(function (html) {
    var files = shellFilesOf(html);
    return Promise.all(files.map(function (url) {
      return cache.match(url).then(function (hit) {
        return hit || fetch(url).then(function (res) { if (res.ok) return cache.put(url, res); });
      });
    })).then(function () {
      return cache.put(scopePath("index.html"), response);
    });
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL).then(function (cache) {
      return fetch(scopePath("index.html"), { cache: "reload" }).then(function (res) {
        if (!res.ok) return null;
        return Promise.all([
          cachePage(cache, res),
          Promise.all(["manifest.json", "icons/icon-192.png", "icons/icon-512.png"].map(function (p) {
            return fetch(scopePath(p)).then(function (r) { if (r.ok) return cache.put(scopePath(p), r); }).catch(function () {});
          }))
        ]);
      });
    }).catch(function () {}).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf("pmc-shell-") === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromCacheFirst(cacheName, request, key) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(key || request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res.ok) cache.put(key || request, res.clone());
        return res;
      });
    });
  });
}

// the network, but never more than NETWORK_WAIT_MS when the cache has an answer
function fromNetworkFirst(cacheName, request, key) {
  return caches.open(cacheName).then(function (cache) {
    var network = fetch(request).then(function (res) {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    return cache.match(key).then(function (hit) {
      if (!hit) return network;
      var timer = new Promise(function (resolve) { setTimeout(function () { resolve(hit); }, NETWORK_WAIT_MS); });
      return Promise.race([network.catch(function () { return hit; }), timer]);
    });
  });
}

// the page: the cached copy at once, the network's kept for next time
function pageFromCache(request) {
  return caches.open(SHELL).then(function (cache) {
    var key = scopePath("index.html");
    return cache.match(key).then(function (hit) {
      var update = fetch(request, { cache: "no-store" }).then(function (res) {
        if (res.ok && res.type === "basic") return cachePage(cache, res.clone()).then(function () { return res; });
        return res;
      });
      if (hit) {
        update.catch(function () {});
        return hit;
      }
      return update;
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  var path = url.pathname.slice(new URL(self.registration.scope).pathname.length - 1);
  if (/^\/(api|voice|ws)(\/|$)/.test(path)) return;
  if (request.mode === "navigate") {
    if (path === "/" || path === "/index.html") {
      event.respondWith(pageFromCache(request));
      return;
    }
    event.respondWith(fromNetworkFirst(DATA, request, url.origin + url.pathname));
    return;
  }
  // (the models' weights and descriptions never change under one name; the
  // camera's scripts do, so they're network-first like the data)
  if (/^\/camera\/models\//.test(path)) {
    event.respondWith(fromCacheFirst(MODELS, request, url.origin + url.pathname));
    return;
  }
  if (/^\/camera\/.*\.js$/.test(path)) {
    event.respondWith(fromNetworkFirst(DATA, request, url.origin + url.pathname));
    return;
  }
  if (url.searchParams.has("v") && /\.(js|css)$/.test(path)) {
    event.respondWith(fromCacheFirst(SHELL, request));
    return;
  }
  if (/\.json$/.test(path)) {
    event.respondWith(fromNetworkFirst(DATA, request, url.origin + url.pathname));
    return;
  }
  if (/^\/(icons|images|sounds)\//.test(path) || /\.(png|svg|jpg|webp|woff2?|mp3|wav)$/.test(path)) {
    event.respondWith(fromCacheFirst(SHELL, request));
  }
});
