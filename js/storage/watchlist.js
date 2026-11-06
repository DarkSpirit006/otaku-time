/* ============================================================
   Otaku Time — watchlist store (schema v3)

   Two kinds of data live on each item and are never mixed:

     API-owned   title, coverImage, format, mediaStatus, episodes,
                 duration, averageScore, season, seasonYear,
                 genres, nextAiringEpisode, studios
                 → refreshed from AniList by syncMeta()

     user-owned  watched, listStatus, statusSource, score, notes,
                 order, createdAt, reminder
                 → only changed by explicit user actions

   Migration is one atomic write: the previous payload is copied to
   BACKUP_KEY first, the whole store is rebuilt in memory, then
   persisted once. A crash mid-way leaves the old value untouched.
   ============================================================ */

import { storageGet, storageSet, parseStoredJson } from "./local.js";

export const WATCHLIST_KEY = "otaku-time.watchlist.v1";
export const LEGACY_WATCHLIST_KEY = "okaeri.watchlist.v1";
export const BACKUP_KEY = "otaku-time.watchlist.v3-backup";
export const SCHEMA_VERSION = 3;

/** Personal viewing status — deliberately separate from AniList's mediaStatus. */
export const LIST_STATUSES = ["watching", "planned", "completed", "dropped", "onhold"];
export const LIST_STATUS_LABELS = {
  watching: "Watching",
  planned: "Planned",
  completed: "Completed",
  dropped: "Dropped",
  onhold: "On hold",
};

const DEFAULT_STORE = { getItem: (k) => storageGet(k).value, setItem: (k, v) => storageSet(k, v) };

function isInt(value) {
  return Number.isInteger(value);
}

function stringsOnly(object, keys) {
  const out = {};
  for (const key of keys) {
    if (typeof object?.[key] === "string" && object[key]) out[key] = object[key];
  }
  return out;
}

function normaliseTitle(title) {
  return {
    romaji: typeof title?.romaji === "string" ? title.romaji : "",
    english: typeof title?.english === "string" ? title.english : "",
    native: typeof title?.native === "string" ? title.native : "",
  };
}

function normaliseCover(cover) {
  return {
    medium: typeof cover?.medium === "string" ? cover.medium : null,
    large: typeof cover?.large === "string" ? cover.large : null,
    extraLarge: typeof cover?.extraLarge === "string" ? cover.extraLarge : null,
    color: typeof cover?.color === "string" ? cover.color : null,
  };
}

function normaliseNextAiring(next) {
  if (!next || !Number.isFinite(next.airingAt)) return null;
  return {
    episode: isInt(next.episode) ? next.episode : null,
    airingAt: Math.round(next.airingAt),
  };
}

/**
 * Highest episode number that can be trusted as aired.
 * `episodes` is exact when known; otherwise the next airing episode
 * minus one is the last aired one. Null means "no reliable bound".
 */
export function progressCap(media) {
  const total = isInt(media?.episodes) && media.episodes > 0 ? media.episodes : null;
  if (total !== null) return { cap: total, source: "total" };
  const next = isInt(media?.nextAiringEpisode?.episode) ? media.nextAiringEpisode.episode : null;
  if (next !== null && next > 1) return { cap: next - 1, source: "aired" };
  return { cap: null, source: null };
}

/** Clamp progress into the highest reliable bound (or [0, ∞) when unknown). */
function clampProgress(media, progress) {
  const { cap } = progressCap(media);
  let value = isInt(progress) ? progress : 0;
  value = Math.max(0, value);
  if (cap !== null) value = Math.min(cap, value);
  return value;
}

/** Build a fresh v3 item from an AniList-shaped media object. */
function buildItem(media, now) {
  return {
    id: media.id,
    title: normaliseTitle(media.title),
    coverImage: normaliseCover(media.coverImage),
    format: media.format || null,
    mediaStatus: media.mediaStatus || media.status || null,
    episodes: isInt(media.episodes) ? media.episodes : null,
    duration: isInt(media.duration) ? media.duration : null,
    averageScore: isInt(media.averageScore) ? media.averageScore : null,
    season: media.season || null,
    seasonYear: isInt(media.seasonYear) ? media.seasonYear : null,
    genres: Array.isArray(media.genres) ? media.genres.filter((g) => typeof g === "string") : [],
    studios: Array.isArray(media.studios?.nodes)
      ? media.studios.nodes
          .filter((s) => s && typeof s.name === "string" && s.isAnimationStudio !== false)
          .map((s) => s.name)
          .slice(0, 4)
      : Array.isArray(media.studios)
        ? media.studios.filter((s) => typeof s === "string").slice(0, 4)
        : [],
    nextAiringEpisode: normaliseNextAiring(media.nextAiringEpisode),
    synonyms: Array.isArray(media.synonyms)
      ? media.synonyms.filter((s) => typeof s === "string").slice(0, 8)
      : [],
    metaUpdatedAt: now,

    // user-owned
    watched: 0,
    listStatus: null, // unknown until the user says so
    statusSource: null, // 'user' | 'auto'
    score: null,
    notes: "",
    order: now,
    createdAt: now,
    updatedAt: now,
    reminder: { enabled: null, lead: null }, // null = follow global preferences
    scheduleChange: null,
  };
}

/**
 * Fill defaults on a stored item without touching values that exist.
 * Unknown keys are preserved verbatim (forward compatibility).
 */
function migrateItem(raw, now, index) {
  const item = { ...raw };
  item.title = normaliseTitle(raw.title);
  item.coverImage = normaliseCover(raw.coverImage);
  if (!("mediaStatus" in item)) item.mediaStatus = raw.status ?? null;
  delete item.status;
  item.episodes = isInt(raw.episodes) && raw.episodes > 0 ? raw.episodes : null;
  item.duration = isInt(raw.duration) && raw.duration > 0 ? raw.duration : null;
  item.averageScore = isInt(raw.averageScore) ? raw.averageScore : null;
  item.genres = Array.isArray(raw.genres) ? raw.genres.filter((g) => typeof g === "string") : [];
  if (!Array.isArray(item.studios)) item.studios = [];
  if (!Array.isArray(item.synonyms)) item.synonyms = [];
  item.nextAiringEpisode = normaliseNextAiring(raw.nextAiringEpisode);
  if (!isInt(item.metaUpdatedAt)) item.metaUpdatedAt = isInt(raw.createdAt) ? raw.createdAt : now;

  item.watched = isInt(raw.watched) && raw.watched >= 0 ? raw.watched : 0;
  if (!("listStatus" in item) || (item.listStatus !== null && !LIST_STATUSES.includes(item.listStatus))) {
    item.listStatus = null;
  }
  if (item.statusSource !== "user" && item.statusSource !== "auto") item.statusSource = null;
  item.score = isInt(raw.score) && raw.score >= 0 && raw.score <= 100 ? raw.score : null;
  item.notes = typeof raw.notes === "string" ? raw.notes.slice(0, 4000) : "";
  if (!Number.isFinite(item.order)) item.order = isInt(raw.createdAt) ? raw.createdAt : now + index;
  if (!isInt(item.createdAt)) item.createdAt = now;
  if (!isInt(item.updatedAt)) item.updatedAt = item.createdAt;
  if (!item.reminder || typeof item.reminder !== "object") item.reminder = { enabled: null, lead: null };
  item.reminder = {
    enabled: typeof item.reminder.enabled === "boolean" ? item.reminder.enabled : null,
    lead: isInt(item.reminder.lead) && item.reminder.lead >= 0 ? item.reminder.lead : null,
  };
  if (!item.scheduleChange || !isInt(item.scheduleChange.to)) item.scheduleChange = null;
  return item;
}

function isItemShape(raw) {
  return (
    raw &&
    typeof raw === "object" &&
    isInt(raw.id) &&
    raw.id > 0 &&
    typeof raw.title === "object" &&
    raw.title !== null &&
    (raw.watched === undefined || (isInt(raw.watched) && raw.watched >= 0))
  );
}

function detectVersion(data) {
  if (!data || typeof data !== "object") return 0;
  const version = Number(data.version ?? data.schemaVersion);
  return Number.isInteger(version) ? version : 0;
}

/**
 * Create a watchlist store.
 * @param {{getItem?:Function, setItem?:Function}} [storage]
 */
export function createWatchlist(storage = DEFAULT_STORE, options = {}) {
  const now = options.now || (() => Date.now());
  const state = {
    items: [],
    available: true,
    dirty: false,
    problem: "",
    corrupt: false,
    migratedFrom: null,
    version: SCHEMA_VERSION,
  };
  let legacyHandled = false;

  function syncToStorage() {
    let result;
    try {
      result = storage.setItem(WATCHLIST_KEY, JSON.stringify({ version: SCHEMA_VERSION, items: state.items })) || {
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
    return result.status === "ok";
  }

  /** Copy the pre-migration payload aside before the first v3 write. */
  function backup(raw) {
    try {
      if (storage.getItem(BACKUP_KEY) === null) storage.setItem(BACKUP_KEY, raw);
      return true;
    } catch {
      return false;
    }
  }

  function read(force = false) {
    if (!force && state.dirty) return;
    if (force) legacyHandled = true;
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
    const version = detectVersion(data);
    const valid = data && Array.isArray(data.items) && data.items.every(isItemShape);

    if (!valid) {
      state.corrupt = true;
      state.available = true;
      state.dirty = false;
      state.problem = "Your saved watchlist could not be read. The unreadable copy was left untouched.";
      return;
    }

    if (version >= 1 && version <= SCHEMA_VERSION) {
      const stamp = now();
      state.items = data.items.map((item, index) => migrateItem(item, stamp, index));
      if (version < SCHEMA_VERSION) {
        state.migratedFrom = version;
        backup(raw);
        // Persist the upgraded shape immediately; if the write fails the
        // original value stays in storage and the session keeps working.
        state.corrupt = false;
        syncToStorage();
        return; // syncToStorage owns available/dirty/problem after a migration
      }
    } else {
      state.corrupt = true;
      state.available = true;
      state.problem = "This watchlist was saved by a newer version of Otaku Time and was left untouched.";
      return;
    }

    state.corrupt = false;
    state.available = true;
    state.dirty = false;
    state.problem = "";
  }

  function save() {
    if (!state.available) {
      state.dirty = true;
      return false;
    }
    return syncToStorage();
  }

  function touch(item) {
    item.updatedAt = now();
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

  function nextOrder() {
    return state.items.reduce((max, item) => Math.max(max, Number(item.order) || 0), 0) + 1;
  }

  function toggle(media) {
    read();
    const index = state.items.findIndex((item) => item.id === media.id);
    if (index >= 0) {
      const [item] = state.items.splice(index, 1);
      syncToStorage();
      return { item, removed: true };
    }
    const item = buildItem(media, now());
    item.order = nextOrder();
    state.items.push(item);
    syncToStorage();
    return { item, removed: false };
  }

  /** Explicit removal that never returns a boolean surprise. */
  function remove(id) {
    read();
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [item] = state.items.splice(index, 1);
    syncToStorage();
    return item;
  }

  /** Restore a previously removed item at its original position. */
  function restore(item) {
    read();
    if (!item || !isInt(item.id) || item.id <= 0) return false;
    const existing = state.items.findIndex((entry) => entry.id === item.id);
    if (existing >= 0) state.items.splice(existing, 1);
    const restored = migrateItem(item, now(), state.items.length);
    const order = Number(item.order);
    if (Number.isFinite(order)) {
      const before = state.items.findIndex((entry) => Number(entry.order) > order);
      if (before >= 0) state.items.splice(before, 0, restored);
      else state.items.push(restored);
    } else {
      state.items.push(restored);
    }
    syncToStorage();
    return true;
  }

  function setProgress(media, progress) {
    read();
    const item = state.items.find((i) => i.id === media.id);
    if (!item) return false;
    const next = clampProgress({ ...item, ...media }, progress);
    if (next === item.watched) return true;
    item.watched = next;
    touch(item);
    syncToStorage();
    return true;
  }

  /** Change watched episodes for a saved id, clamped to reliable bounds. */
  function setWatched(id, progress) {
    read();
    const item = state.items.find((i) => i.id === id);
    if (!item) return false;
    const next = clampProgress(item, progress);
    if (next === item.watched) return true;
    item.watched = next;
    touch(item);
    syncToStorage();
    return true;
  }

  function setListStatus(id, status) {
    read();
    const item = state.items.find((i) => i.id === id);
    if (!item) return false;
    if (status !== null && !LIST_STATUSES.includes(status)) return false;
    item.listStatus = status;
    item.statusSource = status === null ? null : "user";
    touch(item);
    syncToStorage();
    return true;
  }

  function setScore(id, score) {
    read();
    const item = state.items.find((i) => i.id === id);
    if (!item) return false;
    if (score === null) item.score = null;
    else if (isInt(score) && score >= 0 && score <= 100) item.score = score;
    else return false;
    touch(item);
    syncToStorage();
    return true;
  }

  function setNotes(id, notes) {
    read();
    const item = state.items.find((i) => i.id === id);
    if (!item) return false;
    item.notes = typeof notes === "string" ? notes.slice(0, 4000) : "";
    touch(item);
    syncToStorage();
    return true;
  }

  function setReminder(id, patch = {}) {
    read();
    const item = state.items.find((i) => i.id === id);
    if (!item) return false;
    const next = { ...item.reminder, ...patch };
    item.reminder = {
      enabled: typeof next.enabled === "boolean" ? next.enabled : null,
      lead: isInt(next.lead) && next.lead >= 0 ? next.lead : null,
    };
    touch(item);
    syncToStorage();
    return true;
  }

  /** Assign manual ordering from an explicit list of ids. */
  function reorder(ids) {
    read();
    if (!Array.isArray(ids)) return false;
    let position = 0;
    const seen = new Set();
    for (const id of ids) {
      const item = state.items.find((i) => i.id === id);
      if (!item || seen.has(id)) continue;
      item.order = position++;
      seen.add(id);
    }
    // Items not mentioned keep their relative order after the listed ones.
    for (const item of state.items) {
      if (seen.has(item.id)) continue;
      item.order = position++;
    }
    syncToStorage();
    return true;
  }

  /** Move one item up/down in manual order. Returns the new id order. */
  function move(id, direction) {
    read();
    const sorted = state.items.slice().sort((a, b) => a.order - b.order || a.id - b.id);
    const index = sorted.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return null;
    const [item] = sorted.splice(index, 1);
    sorted.splice(target, 0, item);
    reorder(sorted.map((entry) => entry.id));
    return sorted.map((entry) => entry.id);
  }

  /**
   * Synchronise API-owned metadata for one saved title.
   * Never touches user-owned fields. Records airing-time changes.
   */
  function syncMeta(media) {
    if (!media || !isInt(media.id)) return { changed: false, scheduleChange: null };
    read();
    const item = state.items.find((i) => i.id === media.id);
    if (!item) return { changed: false, scheduleChange: null };

    let changed = false;
    const patch = {
      title: media.title ? normaliseTitle({ ...item.title, ...stripEmpty(media.title) }) : item.title,
      coverImage: media.coverImage ? normaliseCover({ ...item.coverImage, ...stripEmpty(media.coverImage) }) : item.coverImage,
      format: typeof media.format === "string" ? media.format : item.format,
      mediaStatus: typeof media.status === "string" ? media.status : item.mediaStatus,
      episodes: isInt(media.episodes) && media.episodes > 0 ? media.episodes : item.episodes,
      duration: isInt(media.duration) && media.duration > 0 ? media.duration : item.duration,
      averageScore: isInt(media.averageScore) ? media.averageScore : item.averageScore,
      season: typeof media.season === "string" ? media.season : item.season,
      seasonYear: isInt(media.seasonYear) ? media.seasonYear : item.seasonYear,
      genres: Array.isArray(media.genres) && media.genres.length ? media.genres : item.genres,
      studios:
        Array.isArray(media.studios?.nodes) && media.studios.nodes.length
          ? media.studios.nodes
              .filter((s) => s && typeof s.name === "string")
              .map((s) => s.name)
              .slice(0, 4)
          : item.studios,
      synonyms:
        Array.isArray(media.synonyms) && media.synonyms.length ? media.synonyms.slice(0, 8) : item.synonyms,
    };

    for (const [key, value] of Object.entries(patch)) {
      if (JSON.stringify(item[key]) !== JSON.stringify(value)) {
        item[key] = value;
        changed = true;
      }
    }

    // Airing schedule (only when the API actually reported one).
    let scheduleChange = null;
    if ("nextAiringEpisode" in media) {
      const next = normaliseNextAiring(media.nextAiringEpisode);
      const previous = item.nextAiringEpisode;
      const stamp = now() / 1000;
      // Only the same episode moving counts as a reschedule; a new
      // episode number is simply the show moving forward.
      if (
        next &&
        previous &&
        previous.episode === next.episode &&
        previous.airingAt !== next.airingAt &&
        previous.airingAt > stamp - 3600
      ) {
        scheduleChange = { from: previous.airingAt, to: next.airingAt, at: now(), episode: next.episode };
        item.scheduleChange = scheduleChange;
        changed = true;
      } else if (!next && previous) {
        if (previous.airingAt > stamp) {
          item.scheduleChange = { from: previous.airingAt, to: null, at: now(), episode: previous.episode };
          scheduleChange = item.scheduleChange;
          changed = true;
        }
      }
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        item.nextAiringEpisode = next;
        changed = true;
      }
    }

    if (item.scheduleChange && item.scheduleChange.to && item.scheduleChange.to < now() / 1000 - 86400) {
      item.scheduleChange = null;
    }

    if (changed) {
      item.metaUpdatedAt = now();
      syncToStorage();
    }
    return { changed, scheduleChange };
  }

  function stripEmpty(object) {
    const out = {};
    for (const [key, value] of Object.entries(object)) {
      if (typeof value === "string" && value) out[key] = value;
    }
    return out;
  }

  function update(id, patch) {
    read();
    const item = state.items.find((i) => i.id === id);
    if (!item || !patch || typeof patch !== "object") return false;
    if (patch.title && typeof patch.title === "object") {
      item.title = { ...item.title, ...stringsOnly(patch.title, ["romaji", "english", "native"]) };
    }
    if (patch.coverImage && typeof patch.coverImage === "object") {
      item.coverImage = {
        ...item.coverImage,
        ...stringsOnly(patch.coverImage, ["medium", "large", "extraLarge", "color"]),
      };
    }
    if (isInt(patch.episodes)) item.episodes = patch.episodes;
    if (isInt(patch.duration)) item.duration = patch.duration;
    if (isInt(patch.averageScore)) item.averageScore = patch.averageScore;
    if (typeof patch.format === "string") item.format = patch.format;
    if (typeof patch.status === "string") item.mediaStatus = patch.status;
    if (typeof patch.mediaStatus === "string") item.mediaStatus = patch.mediaStatus;
    if (Array.isArray(patch.genres)) item.genres = patch.genres.filter((g) => typeof g === "string");
    if (patch.nextAiringEpisode && isInt(patch.nextAiringEpisode.airingAt)) {
      item.nextAiringEpisode = normaliseNextAiring(patch.nextAiringEpisode);
    } else if (patch.nextAiringEpisode === null) {
      item.nextAiringEpisode = null;
    }
    if (isInt(patch.watched)) item.watched = clampProgress(item, patch.watched);
    touch(item);
    syncToStorage();
    return true;
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

  function migratedFrom() {
    read();
    return state.migratedFrom;
  }

  function exportData() {
    return {
      app: "Otaku Time",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      items: all(),
    };
  }

  /**
   * Validate a whole payload without touching state.
   * @returns {{ok:boolean, problem?:string, items?:Array, valid:number, invalid:number}}
   */
  function validateImport(data) {
    if (!data || typeof data !== "object") {
      return { ok: false, problem: "Nothing to import.", valid: 0, invalid: 0 };
    }
    const version = detectVersion(data);
    if (version < 1 || version > SCHEMA_VERSION) {
      return { ok: false, problem: "Unknown backup version.", valid: 0, invalid: 0 };
    }
    if (!Array.isArray(data.items)) {
      return { ok: false, problem: "Backup has no items.", valid: 0, invalid: 0 };
    }
    let invalid = 0;
    const items = [];
    const stamp = now();
    for (const candidate of data.items) {
      if (!isItemShape(candidate)) {
        invalid++;
        continue;
      }
      const migrated = migrateItem(candidate, stamp, items.length);
      if (!migrated.title.romaji && !migrated.title.english && !migrated.title.native) {
        invalid++;
        continue;
      }
      items.push(migrated);
    }
    return { ok: true, items, valid: items.length, invalid };
  }

  /**
   * Merge an imported payload (default) or replace the library.
   * @returns {{added:number, skipped:number, invalid:number, persisted:boolean, problem?:string}}
   */
  function importData(data, { mode = "merge" } = {}) {
    read();
    const checked = validateImport(data);
    if (!checked.ok) {
      return { added: 0, skipped: 0, invalid: checked.invalid, persisted: false, problem: checked.problem };
    }

    if (mode === "replace") {
      const previous = state.items.slice();
      state.items = checked.items.map((item, index) => ({ ...item, order: index }));
      const persisted = syncToStorage();
      return {
        added: checked.items.length,
        skipped: 0,
        invalid: checked.invalid,
        persisted,
        replaced: previous.length,
      };
    }

    const existing = new Set(state.items.map((item) => item.id));
    let added = 0;
    let skipped = 0;

    for (const item of checked.items) {
      if (existing.has(item.id)) {
        skipped++;
        continue;
      }
      state.items.push({ ...item, order: nextOrder() });
      existing.add(item.id);
      added++;
    }

    const persisted = save();
    return { added, skipped, invalid: checked.invalid, persisted: !state.dirty && state.available };
  }

  /** Full in-memory snapshot for undo of bulk operations. */
  function snapshot() {
    return JSON.parse(JSON.stringify(all()));
  }

  /** Replace the entire library atomically (used by undo). */
  function restoreSnapshot(items) {
    if (!Array.isArray(items)) return false;
    read();
    state.items = items.map((item, index) => migrateItem(item, now(), index));
    return syncToStorage();
  }

  return {
    key: WATCHLIST_KEY,
    legacyKey: LEGACY_WATCHLIST_KEY,
    backupKey: BACKUP_KEY,
    read,
    all,
    find,
    has,
    toggle,
    remove,
    restore,
    setProgress,
    setWatched,
    setListStatus,
    setScore,
    setNotes,
    setReminder,
    reorder,
    move,
    syncMeta,
    update,
    validateImport,
    importData,
    snapshot,
    restoreSnapshot,
    storageAvailable,
    storageProblem,
    isCorrupt,
    migratedFrom,
    dirty,
    exportData,
    save,
  };
}

/** Default app-wide watchlist store (localStorage-backed). */
export const watchlist = createWatchlist();
