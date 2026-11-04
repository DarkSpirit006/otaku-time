/* ============================================================
   Otaku Time — schedule state machine
   Owns the upcoming/recent schedules: loading, pagination,
   cache restore, staleness and the IntersectionObserver
   auto-load sentinel.
   ============================================================ */

import { schedule as fetchSchedule, clearApiCache } from "../api/anilist.js";
import { readSnapshot, writeSnapshot, clearAllSnapshots, dropLegacyCache } from "../storage/cache.js";

const PAGE_LIMIT = 100;
const STALE_MS = 15 * 60 * 1000;

export const KINDS = ["upcoming", "recent"];

function createState() {
  return {
    events: [],
    page: 0, // 0 = no page fetched yet (first load becomes page 1)
    more: false,
    anchor: 0,
    loading: false,
    attempted: false,
    error: "",
    warning: "",
    syncedAt: 0,
    source: "network",
  };
}

export const schedules = {
  upcoming: createState(),
  recent: createState(),
};

/** Bumped whenever the API cache or stored data changes. */
let cacheRevision = 0;

const listeners = new Set();

function notify(kind) {
  for (const fn of listeners) fn(kind);
}

/** Subscribe to schedule updates. Returns an unsubscribe function. */
export function onScheduleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSchedule(kind) {
  return schedules[kind];
}

export function getRevision() {
  return cacheRevision;
}

/** True when a section's data is older than the staleness window. */
export function isStale(kind) {
  const state = schedules[kind];
  return !state.syncedAt || Date.now() - state.syncedAt > STALE_MS;
}

/** True when a section needs its first load. */
export function needsLoad(kind) {
  const state = schedules[kind];
  if (state.loading) return false;
  if (state.error) return false; // explicit user action only
  if (isStale(kind)) return true;
  if (kind === "upcoming" && (!state.events.length || !state.more)) return !state.attempted;
  if (kind === "recent" && !state.events.length) return !state.attempted;
  return false;
}

/**
 * Load (or load the next page of) a schedule.
 * @param {'upcoming'|'recent'} kind
 * @param {{reset?:boolean, force?:boolean}} [options]
 */
export async function loadSchedule(kind, options = {}) {
  const state = schedules[kind];
  if (state.loading) return;
  if (!KINDS.includes(kind)) return;

  // page 0 means nothing has been fetched yet — normalize to a first load.
  const firstLoad = state.page === 0;
  const wantReset = options.reset === true || firstLoad;
  if (!wantReset) {
    // Real pagination: only when more pages exist.
    if (!state.more || state.page >= PAGE_LIMIT) return;
  }

  state.loading = true;
  state.error = "";
  notify(kind);

  const page = wantReset ? 1 : state.page + 1;
  // Page 1 always anchors at "now"; later pages reuse the original window.
  const anchor = wantReset || !state.anchor ? Math.floor(Date.now() / 1000) : state.anchor;
  const previousEvents = wantReset ? [] : state.events.slice();

  try {
    const { page: result, warning } = await fetchSchedule(kind, page, anchor, options.force === true);

    if (result) {
      state.events = wantReset ? result.events : previousEvents.concat(result.events);
      state.page = result.page;
      state.more = result.more;
      state.anchor = result.anchor;
      state.attempted = true;
      state.warning = warning;
      state.source = "network";
      state.syncedAt = Date.now();
      state.loading = false;
      notify(kind);

      writeSnapshot(kind, {
        events: state.events,
        page: state.page,
        more: state.more,
        anchor: state.anchor,
        syncedAt: state.syncedAt,
      }).catch(() => {});
    } else {
      state.loading = false;
      state.attempted = true;
      state.error = warning || "AniList sent an unexpected response. Try again shortly.";
      if (!state.events.length) {
        state.source = "network";
        state.warning = "";
      }
      notify(kind);
    }
  } catch (error) {
    state.loading = false;
    state.attempted = true;
    state.error =
      error?.name === "AniListError" ? error.message : "Unexpected error while loading the schedule.";
    if (!state.events.length) {
      state.source = "network";
      state.warning = "";
    }
    notify(kind);
  }
}

/**
 * Restore a section from IndexedDB before the network (instant paint).
 * @returns {Promise<boolean>} whether a snapshot was applied
 */
export async function restoreFromCache(kind) {
  const snapshot = await readSnapshot(kind);
  if (!snapshot) return false;
  const state = schedules[kind];
  state.events = snapshot.events || [];
  state.page = Number.isInteger(snapshot.page) ? snapshot.page : 1;
  state.more = snapshot.more === true;
  state.anchor = Number.isInteger(snapshot.anchor) ? snapshot.anchor : Math.floor(Date.now() / 1000);
  state.syncedAt = Number.isInteger(snapshot.syncedAt) ? snapshot.syncedAt : 0;
  state.source = "cache";
  state.attempted = false;
  state.error = "";
  state.warning =
    state.syncedAt && Date.now() - state.syncedAt > STALE_MS
      ? "Showing your last saved schedule — it may be out of date."
      : "";
  notify(kind);
  return true;
}

/**
 * Clear API + persistent cache for a section.
 * The displayed data stays on screen (stale-but-usable) until
 * the next explicit load.
 */
export async function clearCaches(kind) {
  cacheRevision++;
  clearApiCache();
  await clearAllSnapshots();
  await dropLegacyCache();
  const state = schedules[kind];
  state.syncedAt = 0;
  state.source = "network";
  state.attempted = false;
  notify(kind);
}

/* ------------------------------------------------------------
   Sentinel: auto-load the next page near the end of the list
   ------------------------------------------------------------ */

let observer = null;
let sentinelKind = null;
let observerRevision = 0;

/** Attach (or move) the infinite-scroll sentinel. */
export function attachSentinel(el, kind) {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  sentinelKind = kind;
  if (!el || typeof IntersectionObserver === "undefined") return;
  const expectedRevision = cacheRevision;
  const expectedKind = kind;
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (cacheRevision !== expectedRevision || sentinelKind !== expectedKind) return;
      const state = schedules[expectedKind];
      if (state.loading || !state.more || state.error || state.page >= PAGE_LIMIT) return;
      loadSchedule(expectedKind).catch(() => {});
    },
    { rootMargin: "400px" }
  );
  observer.observe(el);
}

/** Detach the sentinel (e.g. when leaving the section). */
export function detachSentinel() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  sentinelKind = null;
}
