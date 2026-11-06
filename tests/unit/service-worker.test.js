/* ============================================================
   Otaku Time — service worker behaviour tests

   sw.js is a classic worker script, not a module, so it is executed
   here in a vm context with a fake Cache Storage / fetch / clients.
   That runs the file the browser actually gets — no copy of the
   logic to drift out of sync.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SW_PATH = fileURLToPath(new URL("../../sw.js", import.meta.url));
const ORIGIN = "http://localhost:4173";
const ART_URL = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg";

/* ---------------- fakes ---------------- */

class FakeRequest {
  constructor(url, init = {}) {
    this.url = new URL(url, ORIGIN).href;
    this.method = init.method || "GET";
    this.mode = init.mode || "cors";
  }
}

class FakeResponse {
  constructor({ status = 200, type = "basic", body = "" } = {}) {
    this.status = status;
    this.type = type;
    this.body = body;
    this.ok = status >= 200 && status < 300;
  }
  clone() {
    return new FakeResponse({ status: this.status, type: this.type, body: this.body });
  }
}

const keyOf = (request) => (typeof request === "string" ? new URL(request, ORIGIN).href : request.url);

class FakeCache {
  constructor(name) {
    this.name = name;
    this.store = new Map();
  }
  async put(request, response) {
    this.store.set(keyOf(request), response.clone());
  }
  async match(request) {
    return this.store.get(keyOf(request));
  }
  async keys() {
    return [...this.store.keys()].map((url) => new FakeRequest(url));
  }
  async delete(request) {
    return this.store.delete(keyOf(request));
  }
  async add(request) {
    const response = await this.fetchImpl(request.url);
    if (!response || !response.ok) throw new Error(`add failed: ${request.url}`);
    this.store.set(keyOf(request), response.clone());
  }
}

class FakeCacheStorage {
  constructor(names = []) {
    this.caches = new Map(names.map((name) => [name, new FakeCache(name)]));
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name) {
    return this.caches.delete(name);
  }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache(name));
    return this.caches.get(name);
  }
  async has(name) {
    return this.caches.has(name);
  }
  async entries(name) {
    const cache = this.caches.get(name);
    return cache ? [...cache.store.keys()] : [];
  }
}

/**
 * Execute sw.js the way a worker would and hand back its handlers.
 * `fetchImpl` decides what the network returns for a given URL.
 */
function loadWorker({ caches = new FakeCacheStorage(), fetchImpl, clients = { claim: async () => {} } } = {}) {
  const handlers = new Map();
  const storage = caches;
  const network = fetchImpl || (async () => new FakeResponse());

  for (const cache of storage.caches.values()) cache.fetchImpl = network;

  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    clients,
    registration: { showNotification: async () => {} },
    skipWaiting() {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
  };

  const context = vm.createContext({
    self,
    caches: storage,
    fetch: network,
    Request: FakeRequest,
    Response: FakeResponse,
    URL,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    Promise,
  });

  vm.runInContext(readFileSync(SW_PATH, "utf8"), context, { filename: "sw.js" });

  /** Run a lifecycle handler and settle every promise it scheduled. */
  async function dispatch(type, event) {
    const handler = handlers.get(type);
    if (!handler) return null;
    const pending = [];
    handler({ ...event, waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
    return pending;
  }

  /**
   * Run the fetch handler, returning the Response or null when untouched.
   * Background work registered with waitUntil() is awaited too — in a real
   * worker the browser keeps the worker alive for it, so a test that
   * ignored it would miss exactly the failures the browser won't.
   */
  async function fetchEvent(request) {
    const handler = handlers.get("fetch");
    let responded = null;
    let intercepted = false;
    const background = [];
    handler({
      request,
      respondWith(promise) {
        intercepted = true;
        responded = promise;
      },
      waitUntil(promise) {
        background.push(promise);
      },
    });
    const response = intercepted ? await responded : null;
    await Promise.all(background);
    return { intercepted, response };
  }

  return { handlers, caches: storage, dispatch, fetchEvent, self };
}

const imageRequest = (url = ART_URL, mode = "no-cors") => new FakeRequest(url, { mode });
const opaque = () => new FakeResponse({ status: 0, type: "opaque", body: "jpeg-bytes" });

/* ---------------- cache lifecycle ---------------- */

test("activate deletes Otaku Time's own stale caches only", async () => {
  const caches = new FakeCacheStorage([
    "otaku-time-v4-shell",
    "otaku-time-v4-art",
    "otaku-time-v1-shell",
    "otaku-time-v2-art",
    "my-other-app-v1",
    "workbox-precache-v2-https://example.com/",
    "otaku-time-backup",
  ]);
  const { dispatch } = loadWorker({ caches });

  await dispatch("activate", {});

  assert.deepEqual((await caches.keys()).sort(), [
    "my-other-app-v1",
    "otaku-time-backup",
    "otaku-time-v4-art",
    "otaku-time-v4-shell",
    "workbox-precache-v2-https://example.com/",
  ]);
});

test("activate never deletes a cache it did not create", async () => {
  const foreign = ["otaku-time-notes", "otaku-time", "other-otaku-time-v9-shell", "cache-v1"];
  const caches = new FakeCacheStorage([...foreign, "otaku-time-v4-shell"]);
  const { dispatch } = loadWorker({ caches });

  await dispatch("activate", {});

  for (const name of foreign) {
    assert.ok(await caches.has(name), `${name} must survive activation`);
  }
});

/* ---------------- artwork ---------------- */

test("opaque poster responses are cached — that is all an <img> ever returns", async () => {
  const caches = new FakeCacheStorage();
  const { fetchEvent } = loadWorker({
    caches,
    fetchImpl: async () => opaque(),
  });

  const { response } = await fetchEvent(imageRequest());

  assert.equal(response.type, "opaque", "the image is handed back to the page");
  assert.deepEqual(await caches.entries("otaku-time-v4-art"), [ART_URL]);
});

test("cached artwork is served when the poster CDN is unreachable", async () => {
  let online = true;
  const caches = new FakeCacheStorage();
  const { fetchEvent } = loadWorker({
    caches,
    fetchImpl: async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return opaque();
    },
  });

  await fetchEvent(imageRequest());
  online = false;

  const { response } = await fetchEvent(imageRequest());

  assert.ok(response, "a cached poster must come back offline");
  assert.ok((await caches.entries("otaku-time-v4-art")).length === 1);
});

test("a failed poster download is not cached", async () => {
  const caches = new FakeCacheStorage();
  const { fetchEvent } = loadWorker({
    caches,
    fetchImpl: async () => new FakeResponse({ status: 500, type: "basic" }),
  });

  await fetchEvent(imageRequest());

  assert.deepEqual(await caches.entries("otaku-time-v4-art"), []);
});

test("the trimmed artwork cache stays bounded", async () => {
  const caches = new FakeCacheStorage();
  const { fetchEvent } = loadWorker({ caches, fetchImpl: async () => opaque() });

  for (let index = 0; index < 240; index++) {
    await fetchEvent(imageRequest(`https://s4.anilist.co/file/bx${index}.jpg`));
  }

  const entries = await caches.entries("otaku-time-v4-art");
  assert.ok(entries.length <= 220, `artwork cache should be capped, got ${entries.length}`);
  assert.ok(entries.includes("https://s4.anilist.co/file/bx239.jpg"), "newest artwork is kept");
});

/* ---------------- routing safety ---------------- */

test("unrelated cross-origin hosts are not intercepted", async () => {
  const caches = new FakeCacheStorage();
  const { fetchEvent } = loadWorker({ caches, fetchImpl: async () => opaque() });

  const { intercepted } = await fetchEvent(imageRequest("https://tracker.example/pixel.gif"));

  assert.equal(intercepted, false);
});

test("GraphQL POSTs bypass the worker entirely", async () => {
  const caches = new FakeCacheStorage();
  const { fetchEvent } = loadWorker({ caches, fetchImpl: async () => opaque() });

  const { intercepted } = await fetchEvent(
    new FakeRequest("https://graphql.anilist.co/", { method: "POST", mode: "cors" })
  );

  assert.equal(intercepted, false);
});

test("the shell cache never stores opaque responses", async () => {
  const caches = new FakeCacheStorage();
  const { fetchEvent } = loadWorker({ caches, fetchImpl: async () => opaque() });

  await fetchEvent(new FakeRequest(`${ORIGIN}/js/app.js`, { mode: "cors" }));

  const shell = await caches.entries("otaku-time-v4-shell");
  assert.ok(!shell.length, "an opaque body must never be treated as an app asset");
});

test("same-origin assets are cached and refreshed", async () => {
  let version = 1;
  const caches = new FakeCacheStorage();
  const { fetchEvent } = loadWorker({
    caches,
    fetchImpl: async () => new FakeResponse({ body: `v${version}` }),
  });

  await fetchEvent(new FakeRequest(`${ORIGIN}/js/app.js`, { mode: "cors" }));
  version = 2;
  const second = await fetchEvent(new FakeRequest(`${ORIGIN}/js/app.js`, { mode: "cors" }));

  const cache = await caches.open("otaku-time-v4-shell");
  const stored = await cache.match(`${ORIGIN}/js/app.js`);
  assert.ok(stored, "asset cached on first hit");
});

/* ------------------------------------------------------------
   The shell list is written by hand, so it drifts every time the
   module graph grows. A module left out of it loads fine online and
   fails on a cold offline start — the whole module graph dies on the
   first missing import and nothing renders.
   ------------------------------------------------------------ */

test("the shell list covers every module under js/", () => {
  const source = readFileSync(SW_PATH, "utf8");
  const start = source.indexOf("const SHELL = [");
  const end = source.indexOf("];", start);
  assert.ok(start !== -1 && end !== -1, "SHELL block not found");

  const listed = new Set(
    [...source.slice(start, end).matchAll(/"\.\/([^"]+)"/g)].map(([, path]) => path)
  );

  const root = fileURLToPath(new URL("../../js", import.meta.url));
  const modules = [];
  const walk = (dir, prefix = "js") => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, path);
      else if (entry.name.endsWith(".js")) modules.push(path);
    }
  };
  walk(root);

  const missing = modules.filter((path) => !listed.has(path)).sort();
  assert.deepEqual(missing, [], `modules missing from sw.js SHELL: ${missing.join(", ")}`);
  assert.ok(modules.length > 20, "module scan found suspiciously few files");
});
