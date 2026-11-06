/* ============================================================
   Otaku Time — service worker

   · Precaches the app shell so a cold, offline reload works.
   · Navigation requests: network first, cached shell as fallback.
   · Same-origin static assets: stale-while-revalidate.
   · AniList artwork: stale-while-revalidate, best-effort.
   · GraphQL POSTs are never touched — the API client owns its
     own network-first + IndexedDB fallback.
   ============================================================ */

const VERSION = "otaku-time-v4";
const SHELL_CACHE = `${VERSION}-shell`;
const ART_CACHE = `${VERSION}-art`;
const ART_LIMIT = 220;

/**
 * Only caches shaped like this worker's own are ever deleted. A shared
 * origin (GitHub Pages serves many projects under one host) may hold
 * caches from another app, another service worker, or a future Otaku
 * Time build — none of those belong to this worker.
 */
const OWNED_CACHE = /^otaku-time-v\d+-(?:shell|art)$/;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./js/theme-boot.js",
  "./js/app.js",
  "./js/api/anilist.js",
  "./js/api/client.js",
  "./js/api/normalize.js",
  "./js/api/queries.js",
  "./js/components/card.js",
  "./js/components/icons.js",
  "./js/components/palette.js",
  "./js/components/select.js",
  "./js/components/states.js",
  "./js/components/toast.js",
  "./js/components/wire.js",
  "./js/features/detail/facts.js",
  "./js/features/detail/index.js",
  "./js/features/recently-aired/index.js",
  "./js/features/search/index.js",
  "./js/features/settings/index.js",
  "./js/features/upcoming/index.js",
  "./js/features/watchlist/index.js",
  "./js/services/bus.js",
  "./js/services/clock.js",
  "./js/services/media-pool.js",
  "./js/services/metadata.js",
  "./js/services/notifications.js",
  "./js/services/prefs.js",
  "./js/services/pwa.js",
  "./js/services/schedule.js",
  "./js/services/theme.js",
  "./js/services/undo.js",
  "./js/storage/cache.js",
  "./js/storage/local.js",
  "./js/storage/migrate.js",
  "./js/storage/preferences.js",
  "./js/storage/watchlist.js",
  "./js/utils/calendar.js",
  "./js/utils/dom.js",
  "./js/utils/format.js",
  "./js/utils/ics.js",
  "./js/utils/media-state.js",
  "./js/utils/router.js",
  "./js/utils/schedule-core.js",
  "./js/utils/search-rank.js",
  "./js/utils/time.js",
  "./css/variables.css",
  "./css/base.css",
  "./css/layout.css",
  "./css/components/buttons.css",
  "./css/components/cards.css",
  "./css/components/forms.css",
  "./css/components/dialogs.css",
  "./css/components/palette.css",
  "./css/features/upcoming.css",
  "./css/features/calendar.css",
  "./css/features/watchlist.css",
  "./css/features/recently-aired.css",
  "./css/features/search.css",
  "./css/responsive.css",
  "./assets/fonts/inter-latin.woff2",
  "./assets/fonts/plex-mono-400-latin.woff2",
  "./assets/fonts/syne-700-latin.woff2",
  "./assets/fonts/syne-800-latin.woff2",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Add individually so one 404 cannot fail the whole install.
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch {
            /* missing optional asset */
          }
        })
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const stale = keys.filter(
        (key) => OWNED_CACHE.test(key) && key !== SHELL_CACHE && key !== ART_CACHE
      );
      await Promise.all(stale.map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/** Trim the artwork cache so it cannot grow without bound. */
async function trimArtCache() {
  try {
    const cache = await caches.open(ART_CACHE);
    const keys = await cache.keys();
    if (keys.length <= ART_LIMIT) return;
    for (const request of keys.slice(0, keys.length - ART_LIMIT)) {
      await cache.delete(request);
    }
  } catch {
    /* quota or storage failure — artwork is optional */
  }
}

/**
 * Can this response be stored?
 *
 * An opaque response is a cross-origin `no-cors` reply: the browser
 * hides the status (0) and the headers, and the body cannot be read —
 * but it is still a complete copy of the image, and <img> tags always
 * produce one. Refusing opaque responses would mean caching no poster
 * at all, which is why artwork opts in explicitly and same-origin
 * assets never do.
 */
function isCacheable(response, { allowOpaque = false } = {}) {
  if (!response) return false;
  if (response.type === "opaque") return allowOpaque;
  return response.ok;
}

async function staleWhileRevalidate(request, cacheName, { allowOpaque = false, onStored } = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (isCacheable(response, { allowOpaque })) {
        try {
          await cache.put(request, response.clone());
          // Housekeeping runs after the write that grew the cache, never
          // before it — a trim that races the put leaves the cache over
          // its limit until the next poster happens to arrive.
          if (onStored) await onStored();
        } catch {
          /* cache write can fail under quota pressure */
        }
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => {});
    return cached;
  }

  const response = await network;
  if (response) return response;
  return new Response("", { status: 504, statusText: "Offline" });
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put("./index.html", response.clone()).catch(() => {});
      return response;
    }
    throw new Error("bad response");
  } catch {
    const cached = (await cache.match(request)) || (await cache.match("./index.html"));
    if (cached) return cached;
    return new Response(
      "<!doctype html><title>Offline</title><p>Otaku Time needs one online visit before it can work offline.",
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // GraphQL POSTs go straight to the network

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // AniList's image CDN, and only that host: posters are the one
  // cross-origin request this app makes, and they arrive opaque.
  if (url.hostname === "s4.anilist.co") {
    event.respondWith(
      staleWhileRevalidate(request, ART_CACHE, { allowOpaque: true, onStored: trimArtCache })
    );
  }
});

/* ------------------------------------------------------------
   Notifications
   ------------------------------------------------------------ */

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const mediaId = event.notification.data?.mediaId;
  const target = mediaId ? `./#show/${mediaId}` : "./";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) {
        if ("focus" in client) {
          try {
            await client.focus();
          } catch {
            /* some platforms refuse focus */
          }
          client.postMessage({ type: "OPEN_SHOW", mediaId });
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});
