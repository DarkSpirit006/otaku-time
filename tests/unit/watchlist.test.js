import test from "node:test";
import assert from "node:assert/strict";

import { createWatchlist, WATCHLIST_KEY, LEGACY_WATCHLIST_KEY } from "../../js/storage/watchlist.js";

/** In-memory localStorage stand-in with optional failure injection. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const failures = { set: null };
  return {
    failures,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      if (failures.set) {
        const err = new Error("quota");
        err.name = failures.set;
        throw err;
      }
      map.set(key, String(value));
    },
    removeItem: (key) => map.delete(key),
    dump() {
      return Object.fromEntries(map);
    },
  };
}

const MEDIA = {
  id: 101,
  title: { romaji: "Test Romaji", english: "Test English", native: "テスト" },
  coverImage: { medium: "https://s4.anilist.co/m.jpg", large: "https://s4.anilist.co/l.jpg" },
  format: "TV",
  status: "RELEASING",
  episodes: 12,
  duration: 24,
  averageScore: 82,
  season: "FALL",
  seasonYear: 2026,
  genres: ["Action"],
  nextAiringEpisode: { id: 1, episode: 3, airingAt: 1794000000 },
};

test("toggle adds and removes items, persisting each change", () => {
  const storage = fakeStorage();
  const list = createWatchlist(storage);

  const added = list.toggle(MEDIA);
  assert.equal(added.removed, false);
  assert.equal(list.has(101), true);
  assert.equal(JSON.parse(storage.dump()[WATCHLIST_KEY]).items.length, 1);

  const removed = list.toggle(MEDIA);
  assert.equal(removed.removed, true);
  assert.equal(list.has(101), false);
  assert.equal(JSON.parse(storage.dump()[WATCHLIST_KEY]).items.length, 0);
});

test("saved items are normalized with clamped progress", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  const item = list.find(101);
  assert.equal(item.watched, 0);
  assert.equal(item.episodes, 12);
  assert.equal(item.nextAiringEpisode.airingAt, 1794000000);
  assert.ok(Number.isInteger(item.createdAt));
});

test("setProgress clamps into [0, episodes]", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  assert.equal(list.setProgress(MEDIA, -5), true);
  assert.equal(list.find(101).watched, 0);

  list.setProgress(MEDIA, 999);
  assert.equal(list.find(101).watched, 12, "clamped to total");

  list.setProgress(MEDIA, 5);
  assert.equal(list.find(101).watched, 5);

  assert.equal(list.setProgress({ id: 999 }, 1), false, "unknown id refused");
});

test("unknown ids cannot be progressed without being saved", () => {
  const list = createWatchlist(fakeStorage());
  assert.equal(list.setProgress(MEDIA, 3), false);
});

test("export produces a versioned payload and filename-safe shape", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  list.setProgress(MEDIA, 4);
  const payload = list.exportData();
  assert.equal(payload.app, "Otaku Time");
  assert.equal(payload.schemaVersion, 3);
  assert.ok(Array.isArray(payload.items));
  assert.equal(payload.items[0].watched, 4);
  assert.ok(!Number.isNaN(Date.parse(payload.exportedAt)));
});

test("import merges valid items, skips dupes, counts invalid", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);

  const result = list.importData({
    app: "Otaku Time",
    schemaVersion: 2,
    items: [
      MEDIA, // dupe → skipped
      { id: 202, title: { romaji: "Second" }, watched: 3, createdAt: 123 }, // added
      { id: -1, title: { romaji: "Bad id" } }, // invalid
      { id: 303, title: {} }, // invalid (no title)
      null, // invalid
    ],
  });

  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.invalid, 3);
  assert.equal(result.persisted, true);
  assert.equal(list.all().length, 2);
  assert.equal(list.find(202).watched, 3);
  assert.equal(list.find(202).createdAt, 123);
});

test("import accepts legacy Okaeri v1 payloads", () => {
  const list = createWatchlist(fakeStorage());
  const result = list.importData({
    app: "Okaeri",
    schemaVersion: 1,
    items: [{ id: 404, title: { romaji: "Legacy" }, watched: 2 }],
  });
  assert.equal(result.added, 1);
  assert.equal(list.find(404).watched, 2);
});

test("import rejects unknown schema versions without touching data", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  const result = list.importData({ schemaVersion: 99, items: [{ id: 1, title: { romaji: "X" } }] });
  assert.equal(result.added, 0);
  assert.ok(result.problem);
  assert.equal(list.all().length, 1, "existing data untouched");
});

test("import rejects payloads without an items array", () => {
  const list = createWatchlist(fakeStorage());
  assert.ok(list.importData({ schemaVersion: 2 }).problem);
  assert.ok(list.importData({ schemaVersion: 2, items: "nope" }).problem);
  assert.ok(list.importData(null).problem);
});

test("corrupt stored JSON is preserved and reported, never overwritten", () => {
  const storage = fakeStorage({ [WATCHLIST_KEY]: "{definitely not json" });
  const list = createWatchlist(storage);

  assert.equal(list.isCorrupt(), true);
  assert.match(list.storageProblem(), /could not be read/i);
  assert.equal(storage.dump()[WATCHLIST_KEY], "{definitely not json", "file untouched");

  // Reads behave as empty; a later toggle repairs storage with valid data
  assert.deepEqual(list.all(), []);
  list.toggle(MEDIA);
  assert.equal(list.isCorrupt(), false);
  assert.equal(storage.dump()[WATCHLIST_KEY].includes("Test English"), true);
});

test("wrong-shape stored data is treated as corrupt", () => {
  const storage = fakeStorage({ [WATCHLIST_KEY]: JSON.stringify({ version: 2, items: [{ id: "x" }] }) });
  const list = createWatchlist(storage);
  assert.equal(list.isCorrupt(), true);
  assert.equal(storage.dump()[WATCHLIST_KEY], JSON.stringify({ version: 2, items: [{ id: "x" }] }));
});

test("storage quota failures keep data in memory and surface a warning", () => {
  const storage = fakeStorage();
  const list = createWatchlist(storage);
  storage.failures.set = "QuotaExceededError";

  list.toggle(MEDIA);
  assert.equal(list.storageAvailable(), false);
  assert.match(list.storageProblem(), /storage is full/i);
  assert.equal(list.dirty(), true);
  assert.equal(list.has(101), true, "session data retained");

  // Storage recovers → next mutation persists everything
  storage.failures.set = null;
  list.toggle({ ...MEDIA, id: 102 });
  assert.equal(list.storageAvailable(), true);
  assert.equal(JSON.parse(storage.dump()[WATCHLIST_KEY]).items.length, 2);
});

test("unavailable storage never throws", () => {
  const storage = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("SecurityError");
    },
  };
  const list = createWatchlist(storage);
  assert.doesNotThrow(() => list.toggle(MEDIA));
  assert.equal(list.has(101), true, "memory-only session");
  assert.equal(list.storageAvailable(), false);
});

test("adopts the legacy okaeri key on first read", () => {
  const legacyItem = {
    id: 555,
    title: { romaji: "Legacy Show" },
    watched: 7,
    episodes: 12,
    createdAt: 111,
  };
  const storage = fakeStorage({
    [LEGACY_WATCHLIST_KEY]: JSON.stringify({ version: 2, items: [legacyItem] }),
  });
  const list = createWatchlist(storage);
  assert.equal(list.has(555), true, "adopted without re-prompt");
  assert.equal(list.find(555).watched, 7);
  // canonical key written; legacy left intact
  assert.ok(storage.dump()[WATCHLIST_KEY]);
  assert.ok(storage.dump()[LEGACY_WATCHLIST_KEY], "legacy key preserved");
});

test("corrupt legacy data is copied but never parsed as truth", () => {
  const storage = fakeStorage({ [LEGACY_WATCHLIST_KEY]: "garbage" });
  const list = createWatchlist(storage);
  assert.deepEqual(list.all(), []);
  assert.equal(list.isCorrupt(), true, "invalid payload reported");
  assert.match(list.storageProblem(), /could not be read/i);
  assert.equal(storage.dump()[LEGACY_WATCHLIST_KEY], "garbage", "legacy file untouched");
});
