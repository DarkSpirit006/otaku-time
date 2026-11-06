import test from "node:test";
import assert from "node:assert/strict";

import {
  createWatchlist,
  progressCap,
  WATCHLIST_KEY,
  BACKUP_KEY,
  SCHEMA_VERSION,
} from "../../js/storage/watchlist.js";

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
      return { status: "ok", problem: "" };
    },
    removeItem: (key) => map.delete(key),
    dump() {
      return Object.fromEntries(map);
    },
  };
}

const MEDIA = {
  id: 42,
  title: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End", native: "葬送のフリーレン" },
  coverImage: { medium: "m.jpg", large: "l.jpg", extraLarge: "xl.jpg", color: "#3b4a6b" },
  format: "TV",
  status: "RELEASING",
  episodes: 28,
  duration: 24,
  averageScore: 88,
  season: "FALL",
  seasonYear: 2023,
  genres: ["Adventure", "Drama"],
  nextAiringEpisode: { episode: 12, airingAt: 1795000000 },
};

/* ------------------------------------------------------------
   Migration
   ------------------------------------------------------------ */

test("v1 payload migrates to v3, preserving every user value", () => {
  const v1 = {
    version: 1,
    items: [
      {
        id: 7,
        title: { romaji: "Old Show" },
        status: "FINISHED",
        episodes: 12,
        watched: 9,
        createdAt: 1000,
      },
    ],
  };
  const storage = fakeStorage({ [WATCHLIST_KEY]: JSON.stringify(v1) });
  const list = createWatchlist(storage);
  const item = list.find(7);

  assert.equal(item.watched, 9, "progress preserved");
  assert.equal(item.createdAt, 1000, "saved timestamp preserved");
  assert.equal(item.episodes, 12);
  assert.equal(item.mediaStatus, "FINISHED", "AniList status moved to mediaStatus");
  assert.equal(item.listStatus, null, "personal status is never guessed");
  assert.equal(item.statusSource, null);
  assert.equal(JSON.parse(storage.dump()[WATCHLIST_KEY]).version, SCHEMA_VERSION);
  assert.equal(list.migratedFrom(), 1);
});

test("v2 payload migrates with defaults for new fields", () => {
  const v2 = {
    version: 2,
    items: [{ id: 8, title: { romaji: "Two" }, watched: 2, createdAt: 5, nextAiringEpisode: { airingAt: 1795000000 } }],
  };
  const list = createWatchlist(fakeStorage({ [WATCHLIST_KEY]: JSON.stringify(v2) }));
  const item = list.find(8);
  assert.equal(item.listStatus, null);
  assert.equal(item.score, null);
  assert.equal(item.notes, "");
  assert.equal(typeof item.order, "number");
  assert.deepEqual(item.reminder, { enabled: null, lead: null });
});

test("migration keeps a backup of the previous payload", () => {
  const raw = JSON.stringify({ version: 2, items: [{ id: 9, title: { romaji: "Nine" }, watched: 0 }] });
  const storage = fakeStorage({ [WATCHLIST_KEY]: raw });
  createWatchlist(storage).read();
  assert.equal(storage.dump()[BACKUP_KEY], raw);
  assert.equal(JSON.parse(storage.dump()[WATCHLIST_KEY]).version, 3);
});

test("migration is idempotent", () => {
  const storage = fakeStorage({
    [WATCHLIST_KEY]: JSON.stringify({ version: 2, items: [{ id: 10, title: { romaji: "Ten" }, watched: 4 }] }),
  });
  const first = createWatchlist(storage);
  first.read();
  const snapshot = storage.dump()[WATCHLIST_KEY];
  const second = createWatchlist(storage);
  assert.equal(second.find(10).watched, 4);
  assert.equal(storage.dump()[WATCHLIST_KEY], snapshot, "second read writes nothing");
  assert.equal(first.migratedFrom(), 2);
  assert.equal(second.migratedFrom(), null);
});

test("an interrupted migration leaves the original payload intact", () => {
  const raw = JSON.stringify({ version: 2, items: [{ id: 11, title: { romaji: "Eleven" }, watched: 6 }] });
  const storage = fakeStorage({ [WATCHLIST_KEY]: raw });
  storage.failures.set = "QuotaExceededError";
  const list = createWatchlist(storage);

  assert.equal(list.find(11).watched, 6, "in-memory data is usable");
  assert.equal(storage.dump()[WATCHLIST_KEY], raw, "storage still holds the pre-migration payload");
  assert.equal(list.storageAvailable(), false);

  storage.failures.set = null;
  list.setWatched(11, 7);
  assert.equal(JSON.parse(storage.dump()[WATCHLIST_KEY]).items[0].watched, 7);
  assert.equal(JSON.parse(storage.dump()[WATCHLIST_KEY]).version, 3);
});

test("unknown future fields on stored items survive a round trip", () => {
  const storage = fakeStorage({
    [WATCHLIST_KEY]: JSON.stringify({
      version: 3,
      items: [{ id: 12, title: { romaji: "Twelve" }, watched: 0, colourTag: "amber", nested: { a: 1 } }],
    }),
  });
  const list = createWatchlist(storage);
  assert.equal(list.find(12).colourTag, "amber");
  list.setWatched(12, 1);
  const persisted = JSON.parse(storage.dump()[WATCHLIST_KEY]).items[0];
  assert.equal(persisted.colourTag, "amber");
  assert.deepEqual(persisted.nested, { a: 1 });
});

/* ------------------------------------------------------------
   Personal data
   ------------------------------------------------------------ */

test("personal status, score and notes persist and are independent of mediaStatus", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  assert.equal(list.setListStatus(42, "watching"), true);
  assert.equal(list.setScore(42, 95), true);
  assert.equal(list.setNotes(42, "Rewatching with friends"), true);

  const item = list.find(42);
  assert.equal(item.listStatus, "watching");
  assert.equal(item.statusSource, "user");
  assert.equal(item.score, 95);
  assert.equal(item.notes, "Rewatching with friends");
  assert.equal(item.mediaStatus, "RELEASING", "AniList status untouched");
});

test("invalid personal values are refused, not coerced", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  assert.equal(list.setListStatus(42, "binging"), false);
  assert.equal(list.setScore(42, 101), false);
  assert.equal(list.find(42).score, null);
});

test("manual ordering survives reorder and move", () => {
  const list = createWatchlist(fakeStorage());
  for (const id of [1, 2, 3]) list.toggle({ ...MEDIA, id, title: { romaji: `Show ${id}` } });
  list.reorder([3, 1, 2]);
  const order = () => list.all().slice().sort((a, b) => a.order - b.order).map((i) => i.id);
  assert.deepEqual(order(), [3, 1, 2]);
  assert.deepEqual(list.move(1, -1), [1, 3, 2]);
  assert.equal(list.move(2, 1), null, "cannot move past the end");
  assert.deepEqual(order(), [1, 3, 2]);
});

/* ------------------------------------------------------------
   Metadata sync
   ------------------------------------------------------------ */

test("syncMeta refreshes API fields without touching user data", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  list.setWatched(42, 9);
  list.setListStatus(42, "watching");
  list.setScore(42, 80);
  list.setNotes(42, "keep me");
  const createdAt = list.find(42).createdAt;

  const result = list.syncMeta({
    id: 42,
    status: "FINISHED",
    episodes: 28,
    averageScore: 91,
    coverImage: { color: "#112233" },
    nextAiringEpisode: null,
  });

  const item = list.find(42);
  assert.equal(result.changed, true);
  assert.equal(item.mediaStatus, "FINISHED");
  assert.equal(item.averageScore, 91);
  assert.equal(item.coverImage.color, "#112233");
  assert.equal(item.coverImage.large, "l.jpg", "existing artwork kept when not resent");
  assert.equal(item.watched, 9, "progress kept");
  assert.equal(item.listStatus, "watching", "personal status kept");
  assert.equal(item.statusSource, "user");
  assert.equal(item.score, 80);
  assert.equal(item.notes, "keep me");
  assert.equal(item.createdAt, createdAt);
});

test("syncMeta is a no-op when nothing changed", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  const stamp = list.find(42).metaUpdatedAt;
  const result = list.syncMeta({
    id: 42,
    status: MEDIA.status,
    episodes: MEDIA.episodes,
    averageScore: MEDIA.averageScore,
    nextAiringEpisode: MEDIA.nextAiringEpisode,
  });
  assert.equal(result.changed, false);
  assert.equal(list.find(42).metaUpdatedAt, stamp);
});

test("a rescheduled episode is recorded with both timestamps", () => {
  const now = Date.now();
  const list = createWatchlist(fakeStorage(), { now: () => now });
  list.toggle({ ...MEDIA, nextAiringEpisode: { episode: 12, airingAt: Math.floor(now / 1000 + 3600) } });

  const result = list.syncMeta({
    id: 42,
    nextAiringEpisode: { episode: 12, airingAt: Math.floor(now / 1000 + 7200) },
  });

  assert.equal(result.changed, true);
  assert.equal(result.scheduleChange.from, Math.floor(now / 1000 + 3600));
  assert.equal(result.scheduleChange.to, Math.floor(now / 1000 + 7200));
  assert.equal(list.find(42).scheduleChange.to, result.scheduleChange.to);
});

test("no schedule-change badge without a previous timestamp", () => {
  const now = Date.now();
  const list = createWatchlist(fakeStorage(), { now: () => now });
  list.toggle({ ...MEDIA, nextAiringEpisode: null });
  const result = list.syncMeta({ id: 42, nextAiringEpisode: { episode: 5, airingAt: Math.floor(now / 1000 + 600) } });
  assert.equal(result.changed, true);
  assert.equal(result.scheduleChange, null);
  assert.equal(list.find(42).scheduleChange, null);
});

test("a new episode number at a new time is not a reschedule", () => {
  const now = Date.now();
  const list = createWatchlist(fakeStorage(), { now: () => now });
  // Episode 3 was scheduled; AniList now reports episode 4. That is the
  // show moving on, not an episode being pushed back.
  list.toggle({ ...MEDIA, nextAiringEpisode: { episode: 3, airingAt: Math.floor(now / 1000 + 3600) } });
  const result = list.syncMeta({
    id: 42,
    nextAiringEpisode: { episode: 4, airingAt: Math.floor(now / 1000 + 86400) },
  });
  assert.equal(result.scheduleChange, null);
  assert.equal(list.find(42).scheduleChange, null);
  assert.equal(list.find(42).nextAiringEpisode.episode, 4);
});

test("an already-past previous timestamp does not produce a reschedule badge", () => {
  const now = Date.now();
  const list = createWatchlist(fakeStorage(), { now: () => now });
  list.toggle({ ...MEDIA, nextAiringEpisode: { episode: 3, airingAt: Math.floor(now / 1000 - 86400) } });
  const result = list.syncMeta({ id: 42, nextAiringEpisode: { episode: 4, airingAt: Math.floor(now / 1000 + 3600) } });
  assert.equal(result.scheduleChange, null);
});

/* ------------------------------------------------------------
   Progress bounds
   ------------------------------------------------------------ */

test("progressCap prefers the episode total then the next airing episode", () => {
  assert.deepEqual(progressCap({ episodes: 12, nextAiringEpisode: { episode: 4 } }), {
    cap: 12,
    source: "total",
  });
  assert.deepEqual(progressCap({ episodes: null, nextAiringEpisode: { episode: 7 } }), {
    cap: 6,
    source: "aired",
  });
  assert.deepEqual(progressCap({ episodes: null, nextAiringEpisode: null }), { cap: null, source: null });
  assert.deepEqual(progressCap({ episodes: null, nextAiringEpisode: { episode: 1 } }), {
    cap: null,
    source: null,
  });
});

test("sets watched episodes are capped by the reliable aired count", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle({ ...MEDIA, episodes: null, nextAiringEpisode: { episode: 5, airingAt: 1795000000 } });
  list.setWatched(42, 99);
  assert.equal(list.find(42).watched, 4, "capped at the last aired episode");
});

/* ------------------------------------------------------------
   Import / export / undo
   ------------------------------------------------------------ */

test("export includes personal fields and the v3 schema", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  list.setListStatus(42, "onhold");
  list.setScore(42, 70);
  list.setNotes(42, "note");
  const payload = list.exportData();
  assert.equal(payload.schemaVersion, 3);
  assert.equal(payload.items[0].listStatus, "onhold");
  assert.equal(payload.items[0].score, 70);
  assert.equal(payload.items[0].notes, "note");
});

test("a v3 export imports back losslessly", () => {
  const source = createWatchlist(fakeStorage());
  source.toggle(MEDIA);
  source.setWatched(42, 11);
  source.setListStatus(42, "completed");
  source.setScore(42, 88);
  source.setNotes(42, "great");
  source.reorder([42]);

  const target = createWatchlist(fakeStorage());
  const result = target.importData(source.exportData());
  assert.equal(result.added, 1);
  const item = target.find(42);
  assert.equal(item.watched, 11);
  assert.equal(item.listStatus, "completed");
  assert.equal(item.score, 88);
  assert.equal(item.notes, "great");
});

test("replace mode swaps the whole library atomically", () => {
  const storage = fakeStorage();
  const list = createWatchlist(storage);
  list.toggle(MEDIA);
  list.toggle({ ...MEDIA, id: 43, title: { romaji: "Other" } });

  const result = list.importData(
    { schemaVersion: 3, items: [{ id: 99, title: { romaji: "Only" }, watched: 2 }] },
    { mode: "replace" }
  );
  assert.equal(result.added, 1);
  assert.equal(result.replaced, 2);
  assert.deepEqual(list.all().map((i) => i.id), [99]);
  assert.equal(JSON.parse(storage.dump()[WATCHLIST_KEY]).items.length, 1, "one write, one state");
});

test("validateImport rejects the whole file before any change", () => {
  const storage = fakeStorage();
  const list = createWatchlist(storage);
  list.toggle(MEDIA);
  const before = JSON.stringify(list.all());

  const bad = list.validateImport({ schemaVersion: 3, items: [{ id: 1, title: { romaji: "Ok" } }, "junk"] });
  assert.equal(bad.ok, true);
  assert.equal(bad.invalid, 1);

  const broken = list.validateImport({ schemaVersion: 42, items: [] });
  assert.equal(broken.ok, false);
  assert.match(broken.problem, /version/i);
  assert.equal(JSON.stringify(list.all()), before);
});

test("snapshot and restoreSnapshot round-trip the whole library", () => {
  const list = createWatchlist(fakeStorage());
  list.toggle(MEDIA);
  list.setWatched(42, 3);
  const snap = list.snapshot();

  list.importData({ schemaVersion: 3, items: [] }, { mode: "replace" });
  assert.equal(list.all().length, 0);

  assert.equal(list.restoreSnapshot(snap), true);
  assert.equal(list.find(42).watched, 3);
});

test("removing and restoring a single item keeps its position and fields", () => {
  const list = createWatchlist(fakeStorage());
  for (const id of [1, 2, 3]) list.toggle({ ...MEDIA, id, title: { romaji: `Show ${id}` } });
  list.reorder([1, 2, 3]);
  list.setScore(2, 77);

  const removed = list.remove(2);
  assert.equal(removed.id, 2);
  assert.equal(list.has(2), false);

  list.restore(removed);
  assert.equal(list.find(2).score, 77);
  const order = list.all().slice().sort((a, b) => a.order - b.order).map((i) => i.id);
  assert.deepEqual(order, [1, 2, 3]);
});
