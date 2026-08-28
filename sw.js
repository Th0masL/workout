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
var CACHE_PREFIX = "workout-program-";
var CACHE = CACHE_PREFIX + VERSION;

/* Illustrations. Deliberately NOT in SHELL: the page asks the active worker to
 * fetch them in a waitUntil-backed background task, so a 2.4 MB set never
 * delays installation, but they must be
 * fetched eagerly rather than on first view — otherwise going offline leaves
 * every exercise you happen not to have opened without a picture.
 * Regenerated whenever images change; a test asserts it has not drifted. */
var MEDIA = [
  "./images/dead-hang.gif",
  "./images/hip-thrust-L1.gif",
  "./images/hip-thrust-L3.gif",
  "./images/hip-thrust-L4.gif",
  "./images/pike-pushup.gif",
  "./images/plank.svg",
  "./images/pushup.gif",
  "./images/ring-dip.svg",
  "./images/ring-facepull.gif",
  "./images/ring-leg-curl.gif",
  "./images/ring-pullup.gif",
  "./images/split-squat-L1.gif",
  "./images/split-squat-L2.gif",
  "./images/split-squat-L4.gif",
  "./images/split-squat-L5.gif",
  "https://raw.githubusercontent.com/Th0masL/exercises-dataset/main/videos/3523-aWedzZX.gif",
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
  "./tokens.css",
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
        /* Every entry is required to boot offline. Keep installation atomic so
         * a worker with half a shell never activates and claims the page. */
        return c.addAll(SHELL);
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
            /* Cache Storage is shared by every app on an origin. GitHub Pages
             * hosts several repository sites together, so only remove older
             * caches that belong to this app. */
            return k !== CACHE && k.indexOf(CACHE_PREFIX) === 0 ? caches.delete(k) : null;
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

/* A message task is used instead of an unobserved promise in activate. The
 * browser is allowed to terminate a worker as soon as its event settles, so
 * fire-and-forget warming could stop halfway through. waitUntil keeps this
 * worker alive, while leaving install/activate fast and atomic. */
function warmMedia() {
  return caches.open(CACHE).then(function (cache) {
    var ready = 0;
    var failed = 0;
    return Promise.all(
      MEDIA.map(function (url) {
        return cache
          .match(url)
          .then(function (hit) {
            if (hit) return true;
            return cache.add(url).then(function () { return true; });
          })
          .then(function () { ready += 1; })
          .catch(function () { failed += 1; });
      })
    ).then(function () {
      return { ready: ready, failed: failed, total: MEDIA.length };
    });
  });
}

self.addEventListener("message", function (e) {
  if (!e.data || e.data.type !== "CACHE_MEDIA") return;
  e.waitUntil(
    warmMedia().then(function (status) {
      if (e.source && e.source.postMessage) {
        e.source.postMessage({
          type: "MEDIA_CACHE_STATUS",
          ready: status.ready,
          failed: status.failed,
          total: status.total,
        });
      }
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
    /* Clone the original request so headers, range, mode, integrity and future
     * request fields survive; only the browser-cache policy changes. */
    return new Request(req, { cache: "no-cache" });
  } catch (err) {
    return req;
  }
}

/* A stalled connection is worse than being offline: fetch can wait for the
 * radio for many seconds before rejecting. Race it against a short deadline so
 * an already-cached screen opens promptly. The original request deliberately
 * keeps running and refreshes the cache if the connection eventually answers. */
function networkWithTimeout(req) {
  var network = fetch(revalidating(req)).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) {
        c.put(req, copy);
      });
    }
    return res;
  });
  var deadline = new Promise(function (_, reject) {
    setTimeout(function () { reject(new Error("network timeout")); }, 2500);
  });
  return Promise.race([network, deadline]);
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
    networkWithTimeout(req)
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
