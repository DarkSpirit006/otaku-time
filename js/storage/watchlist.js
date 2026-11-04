/* ============================================================
   Otaku Time — watchlist store
   Local-first. Versioned. Corrupt data is never overwritten —
   it stays in storage while the session works from memory and
   the user is warned. Injectable storage for tests.
   ============================================================ */

import { storageGet, storageSet, parseStoredJson } from "./local.js";

export const WATCHLIST_KEY = "otaku-time.watchlist.v1";
export const LEGACY_WATCHLIST_KEY = "okaeri.watchlist.v1";
export const SCHEMA_VERSION = 2;

const DEFAULT_STORE = { getItem: (k) => storageGet(k).value, setItem: (k, v) => storageSet(k, v) };

/** Clamp progress into the media's episode bounds. */
function clampProgress(media, progress) {
  const total = Number.isInteger(media.episodes) && media.episodes > 0 ? media.episodes : null;
  let value = Number.isInteger(progress) ? progress : 0;
  value = Math.max(0, value);
  if (total !== null) value = Math.min(total, value);
  return value;
}

/**
 * Create a watchlist store.
 * @param {{getItem?:Function, setItem?:Function}} [storage]
 */
export function createWatchlist(storage = DEFAULT_STORE) {
  const state = {
    items: [],
    available: true,
    dirty: false,
    problem: "",
    corrupt: false,
    version: SCHEMA_VERSION,
  };
  let legacyHandled = false;

  function syncToStorage() {
    let result;
    try {
      result =
        storage.setItem(WATCHLIST_KEY, JSON.stringify({ version: SCHEMA_VERSION, items: state.items })) || {
          status: "ok",
          problem: "",
        };
    } catch (error) {
      const quota =
        error instanceof Error &&
        (error.name === "QuotaExceededError" ||
          error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          error.code === 22);
      result = {
        status: quota ? "quota" : "unavailable",
        problem: quota
          ? "This browser's storage is full — changes stay in memory for now."
          : "Local storage is unavailable.",
      };
    }
    if (result.status === "ok") {
      state.dirty = false;
      state.problem = "";
      state.available = true;
    } else {
      state.dirty = true;
      state.available = false;
      state.problem = result.problem;
    }
  }

  function read(force = false) {
    // Unsaved in-memory changes are newer than anything on disk.
    if (!force && state.dirty) return;
    if (force) legacyHandled = true; // never re-adopt legacy on cross-tab refresh
    let raw;
    try {
      raw = storage.getItem(WATCHLIST_KEY);
    } catch {
      state.available = false;
      state.dirty = true;
      state.problem = "Local storage is unavailable.";
      return;
    }

    if (raw === null || raw === undefined || raw === "") {
      // Adopt the legacy key once, if present (same storage backend).
      if (!legacyHandled) {
        legacyHandled = true;
        try {
          const legacy = storage.getItem(LEGACY_WATCHLIST_KEY);
          if (legacy !== null && legacy !== undefined && legacy !== "") {
            const result = storage.setItem(WATCHLIST_KEY, legacy);
            if (!result || result.status === "ok") return read();
          }
        } catch {
          /* adoption is best-effort */
        }
      }
      state.items = [];
      state.available = true;
      state.dirty = false;
      state.problem = "";
      state.corrupt = false;
      return;
    }

    const parsed = parseStoredJson(raw);
    const data = parsed.ok ? parsed.data : null;
    const valid =
      data &&
      data.version === SCHEMA_VERSION &&
      Array.isArray(data.items) &&
      data.items.every(
        (item) =>
          item &&
          typeof item === "object" &&
          Number.isInteger(item.id) &&
          item.id > 0 &&
          typeof item.title === "object" &&
          item.title !== null &&
          Number.isInteger(item.watched) &&
          item.watched >= 0
      );

    if (!valid) {
      state.corrupt = true;
      state.available = true;
      state.dirty = false;
      state.problem =
        "Your saved watchlist could not be read. The unreadable copy was left untouched.";
      return; // storage keeps the original value
    }

    state.corrupt = false;
    state.items = data.items;
    state.available = true;
    state.dirty = false;
    state.problem = "";
  }

  function save() {
    if (!state.available) {
      state.dirty = true;
      return;
    }
    syncToStorage();
  }

  function all() {
    read();
    return state.items;
  }

  function find(id) {
    return all().find((item) => item.id === id) ?? null;
  }

  function has(id) {
    return find(id) !== null;
  }

  function toggle(media) {
    read();
    const index = state.items.findIndex((item) => item.id === media.id);
    let item;
    if (index >= 0) {
      item = state.items[index];
      state.items.splice(index, 1);
      syncToStorage();
      return { item, removed: true };
    }
    const nextAiring =
      Number.isInteger(media.nextAiringEpisode?.airingAt) ? media.nextAiringEpisode.airingAt : null;
    item = {
      id: media.id,
      title: {
        romaji: media.title?.romaji || "",
        english: media.title?.english || "",
        native: media.title?.native || "",
      },
      coverImage: {
        medium: media.coverImage?.medium || null,
        large: media.coverImage?.large || media.coverImage?.medium || null,
        extraLarge: media.coverImage?.extraLarge || null,
      },
      format: media.format || null,
      status: media.status || null,
      episodes: Number.isInteger(media.episodes) ? media.episodes : null,
      duration: Number.isInteger(media.duration) ? media.duration : null,
      averageScore: Number.isInteger(media.averageScore) ? media.averageScore : null,
      season: media.season || null,
      seasonYear: Number.isInteger(media.seasonYear) ? media.seasonYear : null,
      genres: Array.isArray(media.genres) ? media.genres.filter((g) => typeof g === "string") : [],
      nextAiringEpisode: nextAiring !== null ? { airingAt: nextAiring } : null,
      watched: 0,
      createdAt: Date.now(),
    };
    state.items.push(item);
    syncToStorage();
    return { item, removed: false };
  }

  function setProgress(media, progress) {
    read();
    const item = state.items.find((i) => i.id === media.id);
    if (!item) return false;
    const next = clampProgress(media, progress);
    if (next === item.watched) return true;
    item.watched = next;
    syncToStorage();
    return true;
  }

  function update(id, patch) {
    read();
    const item = state.items.find((i) => i.id === id);
    if (!item || !patch || typeof patch !== "object") return false;
    if (patch.title && typeof patch.title === "object") {
      item.title = { ...item.title, ...pickStrings(patch.title) };
    }
    if (patch.coverImage && typeof patch.coverImage === "object") {
      item.coverImage = { ...item.coverImage, ...pickStrings(patch.coverImage) };
    }
    if (Number.isInteger(patch.episodes)) item.episodes = patch.episodes;
    if (Number.isInteger(patch.duration)) item.duration = patch.duration;
    if (Number.isInteger(patch.averageScore)) item.averageScore = patch.averageScore;
    if (typeof patch.format === "string") item.format = patch.format;
    if (typeof patch.status === "string") item.status = patch.status;
    if (Array.isArray(patch.genres)) {
      item.genres = patch.genres.filter((g) => typeof g === "string");
    }
    if (patch.nextAiringEpisode && Number.isInteger(patch.nextAiringEpisode.airingAt)) {
      item.nextAiringEpisode = { airingAt: patch.nextAiringEpisode.airingAt };
    } else if (patch.nextAiringEpisode === null) {
      item.nextAiringEpisode = null;
    }
    if (Number.isInteger(patch.watched)) {
      item.watched = clampProgress(item, patch.watched);
    }
    syncToStorage();
    return true;
  }

  function pickStrings(object) {
    const out = {};
    for (const [key, value] of Object.entries(object)) {
      if (typeof value === "string" && value) out[key] = value;
    }
    return out;
  }

  function storageAvailable() {
    read();
    return state.available;
  }

  function storageProblem() {
    read();
    return state.problem;
  }

  function isCorrupt() {
    read();
    return state.corrupt;
  }

  function dirty() {
    read();
    return state.dirty;
  }

  /** Build the export payload. */
  function exportData() {
    return {
      app: "Otaku Time",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      items: all(),
    };
  }

  /**
   * Validate and merge an imported payload.
   * Accepts Otaku Time (v2) and legacy Okaeri (v1/v2) shapes.
   * Returns {added, skipped, invalid, persisted, problem?}.
   */
  function importData(data) {
    read();
    if (!data || typeof data !== "object") {
      return { added: 0, skipped: 0, invalid: 0, persisted: false, problem: "Nothing to import." };
    }
    if (data.schemaVersion !== 1 && data.schemaVersion !== 2) {
      return { added: 0, skipped: 0, invalid: 0, persisted: false, problem: "Unknown backup version." };
    }
    if (!Array.isArray(data.items)) {
      return { added: 0, skipped: 0, invalid: 0, persisted: false, problem: "Backup has no items." };
    }

    const existing = new Set(all().map((item) => item.id));
    let added = 0;
    let invalid = 0;
    let skipped = 0;

    for (const candidate of data.items) {
      if (!candidate || typeof candidate !== "object" || !Number.isInteger(candidate.id) || candidate.id <= 0) {
        invalid++;
        continue;
      }
      if (existing.has(candidate.id)) {
        skipped++;
        continue;
      }
      const title = candidate.title && typeof candidate.title === "object" ? candidate.title : {};
      const mediaLike = {
        id: candidate.id,
        title: {
          romaji: typeof title.romaji === "string" ? title.romaji : "",
          english: typeof title.english === "string" ? title.english : "",
          native: typeof title.native === "string" ? title.native : "",
        },
        coverImage:
          candidate.coverImage && typeof candidate.coverImage === "object"
            ? candidate.coverImage
            : {},
        format: typeof candidate.format === "string" ? candidate.format : "",
        status: typeof candidate.status === "string" ? candidate.status : "",
        episodes: Number.isInteger(candidate.episodes) ? candidate.episodes : null,
        duration: Number.isInteger(candidate.duration) ? candidate.duration : null,
        averageScore: Number.isInteger(candidate.averageScore) ? candidate.averageScore : null,
        season: typeof candidate.season === "string" ? candidate.season : "",
        seasonYear: Number.isInteger(candidate.seasonYear) ? candidate.seasonYear : null,
        genres: Array.isArray(candidate.genres) ? candidate.genres : [],
        nextAiringEpisode:
          candidate.nextAiringEpisode && Number.isInteger(candidate.nextAiringEpisode.airingAt)
            ? { id: 0, episode: 0, airingAt: candidate.nextAiringEpisode.airingAt }
            : null,
      };
      if (!mediaLike.title.romaji && !mediaLike.title.english && !mediaLike.title.native) {
        invalid++;
        continue;
      }
      const result = toggle(mediaLike);
      if (!result || result.removed) {
        invalid++;
        continue;
      }
      const item = result.item;
      if (Number.isInteger(candidate.watched)) item.watched = clampProgress(item, candidate.watched);
      if (Number.isInteger(candidate.createdAt)) item.createdAt = candidate.createdAt;
      existing.add(candidate.id);
      added++;
    }

    save();
    return { added, skipped, invalid, persisted: !state.dirty && state.available };
  }

  return {
    key: WATCHLIST_KEY,
    legacyKey: LEGACY_WATCHLIST_KEY,
    read,
    all,
    find,
    has,
    toggle,
    setProgress,
    update,
    storageAvailable,
    storageProblem,
    isCorrupt,
    dirty: dirty,
    exportData,
    importData,
    save,
  };
}

/** Default app-wide watchlist store (localStorage-backed). */
export const watchlist = createWatchlist();
