/* Service worker — makes the app open with no connection.
 *
 * Strategy is NETWORK-FIRST with a cache fallback, not cache-first. The app is
 * six small files on wifi, so going to the network costs nothing and you never
 * get served a stale version after an edit — which is the usual pain with
 * cache-first. Offline, the cache answers instead.
 *
 * Your training data is not here: that lives in localStorage, which the cache
 * never touches. Clearing this cache only forces a re-download of the app.
 */
var VERSION = "v5";
var CACHE = "workout-program-" + VERSION;

/* Illustrations. Deliberately NOT in SHELL: they are fetched in the background
 * after activation so a 2.4 MB set never delays startup, but they must be
 * fetched eagerly rather than on first view — otherwise going offline leaves
 * every exercise you happen not to have opened without a picture.
 * Regenerated whenever images change; a test asserts it has not drifted. */
var MEDIA = [
  "./images/dead-hang.gif",
  "./images/hip-thrust-L1.gif",
  "./images/hip-thrust-L3.gif",
  "./images/hip-thrust-L4.gif",
  "./images/pike-pushup.jpg",
  "./images/pushup.gif",
  "./images/ring-facepull.gif",
  "./images/ring-leg-curl.jpg",
  "./images/ring-pullup.gif",
  "./images/split-squat-L1.gif",
  "./images/split-squat-L2.gif",
  "./images/split-squat-L4.gif",
  "./images/split-squat-L5.gif",
  "https://raw.githubusercontent.com/Th0masL/exercises-dataset/main/images/3523-aWedzZX.jpg",
  "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0472.gif",
  "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0677.gif",
  "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0688.gif",
  "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0805.gif",
  "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0808.gif",
  "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/1326.gif",
  "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/1373.gif",
];

var SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./progression.js",
  "./patch.js",
  "./audio.js",
  "./styles.css",
  "./data/images.js",
  "./data/program.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(function (c) {
        /* addAll is atomic — one 404 and nothing is cached. Add individually so
         * a missing optional file cannot break the whole install. */
        return Promise.all(
          SHELL.map(function (url) {
            return c.add(url).catch(function () {});
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (k) {
            return k === CACHE ? null : caches.delete(k);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
      .then(function () {
        /* Not awaited: warming the illustrations must not hold up activation. */
        caches.open(CACHE).then(function (c) {
          MEDIA.forEach(function (url) {
            c.match(url).then(function (hit) {
              if (!hit) c.add(url).catch(function () {});
            });
          });
        });
      })
  );
});

/* Go to the network with the HTTP cache bypassed. Without this the "network"
 * leg can be answered by the browser's own cache — a server that sends no
 * Cache-Control (python -m http.server, and plenty of static hosts) lets Chrome
 * apply heuristic freshness and skip revalidation entirely, so an edited file
 * would keep serving stale for hours. no-cache still sends a conditional
 * request, so a 304 costs almost nothing. */
function revalidating(req) {
  try {
    return new Request(req.url, { cache: "no-cache", credentials: "same-origin" });
  } catch (err) {
    return req;
  }
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    /* Illustrations are hotlinked from GitHub. Cross-origin requests are
     * normally left alone (YouTube links and so on), but these must survive
     * offline, so they get cache-FIRST treatment: they never change, and the
     * host is rate-limited at ~60 requests an hour. */
    if (url.hostname !== "raw.githubusercontent.com") return;
    e.respondWith(
      caches.match(req).then(function (hit) {
        return (
          hit ||
          fetch(req).then(function (res) {
            if (res && res.ok) {
              var copy = res.clone();
              caches.open(CACHE).then(function (c) {
                c.put(req, copy);
              });
            }
            return res;
          })
        );
      })
    );
    return;
  }

  e.respondWith(
    fetch(revalidating(req))
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) {
            c.put(req, copy);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          /* Only a NAVIGATION may fall back to the shell. Handing index.html to
           * an <img> or a stylesheet returns HTML with a 200, which fails to
           * decode and looks exactly like a missing file. */
          if (req.mode === "navigate") return caches.match("./index.html");
          return new Response("", { status: 504, statusText: "offline" });
        });
      })
  );
});
