/* ============================================================
   Otaku Time — schedule state machine

   Owns the upcoming/recent schedules: first load, pagination,
   cache restore, staleness, background refresh and the
   IntersectionObserver auto-load sentinel.

   Background refreshes deliberately never collapse the list:
   every already-loaded page is refetched against the stored
   anchor and merged by event id, so N pages stay N pages.
   ============================================================ */

import { schedule as fetchSchedule, clearApiCache } from "../api/anilist.js";
import { readSnapshot, writeSnapshot, clearAllSnapshots, dropLegacyCache } from "../storage/cache.js";
import { mergeEvents, pagesToRefresh, signatureOf, paginationSummary } from "../utils/schedule-core.js";

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
    refreshing: false,
    queued: null,
    inflight: null,
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

/** Content signature used by the renderer (ids + airing times). */
export function scheduleSignature(kind) {
  return signatureOf(schedules[kind].events);
}

/** Honest "N loaded" summary for the current state. */
export function scheduleSummary(kind) {
  const state = schedules[kind];
  return paginationSummary({ loaded: state.events.length, more: state.more, page: state.page });
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

function finish(state, kind) {
  state.loading = false;
  state.refreshing = false;
  state.inflight = null;
  notify(kind);
}

function persist(kind, state) {
  writeSnapshot(kind, {
    events: state.events,
    page: state.page,
    more: state.more,
    anchor: state.anchor,
    syncedAt: state.syncedAt,
  }).catch(() => {});
}

/* ------------------------------------------------------------
   Load modes: first | page | reset | refresh
   ------------------------------------------------------------ */

async function runLoad(kind, mode, force) {
  const state = schedules[kind];
  state.loading = true;
  state.refreshing = mode === "refresh";
  state.error = "";
  notify(kind);

  if (mode === "first" || mode === "reset") {
    const anchor = Math.floor(Date.now() / 1000);
    try {
      const { page: result, warning } = await fetchSchedule(kind, 1, anchor, force);
      if (!result) throw new Error(warning || "EMPTY_RESPONSE");
      state.events = result.events.slice();
      state.page = result.page;
      state.more = result.more;
      state.anchor = result.anchor;
      state.attempted = true;
      state.warning = warning || "";
      state.source = "network";
      state.syncedAt = Date.now();
      persist(kind, state);
    } catch (error) {
      state.attempted = true;
      state.error =
        error?.name === "AniListError" ? error.message : "Unexpected error while loading the schedule.";
      if (!state.events.length) {
        state.source = "network";
        state.warning = "";
      }
    } finally {
      finish(state, kind);
    }
    return;
  }

  if (mode === "page") {
    if (!state.more || state.page >= PAGE_LIMIT) {
      finish(state, kind);
      return;
    }
    const page = state.page + 1;
    try {
      const { page: result, warning } = await fetchSchedule(kind, page, state.anchor, force);
      if (!result) throw new Error(warning || "EMPTY_RESPONSE");
      state.events = mergeEvents(state.events, result.events, { keepMissing: true });
      state.page = result.page;
      state.more = result.more;
      state.attempted = true;
      state.warning = warning || "";
      state.source = "network";
      state.syncedAt = Date.now();
      persist(kind, state);
    } catch (error) {
      state.attempted = true;
      state.warning =
        error?.name === "AniListError"
          ? error.message
          : "Couldn't load more episodes. Scroll again to retry.";
    } finally {
      finish(state, kind);
    }
    return;
  }

  // ---- refresh: refetch every loaded page against the stored anchor ----
  const pages = pagesToRefresh(Math.max(1, state.page));
  const anchor = state.anchor || Math.floor(Date.now() / 1000);
  const collected = [];
  let failure = null;
  let lastMore = state.more;

  for (const page of pages) {
    try {
      const { page: result, warning } = await fetchSchedule(kind, page, anchor, force);
      if (!result) throw new Error(warning || "EMPTY_RESPONSE");
      collected.push(...result.events);
      lastMore = result.more;
      if (!result.more) break;
    } catch (error) {
      failure = error;
      break;
    }
  }

  if (failure) {
    // Keep everything already on screen; background work never destroys data.
    state.attempted = true;
    state.warning =
      failure?.name === "AniListError"
        ? `Couldn't refresh: ${failure.message}`
        : "Couldn't refresh the schedule. Showing the last loaded episodes.";
    finish(state, kind);
    return;
  }

  state.events = mergeEvents(state.events, collected, { keepMissing: false });
  state.page = Math.min(pages.length, Math.max(1, pages.length));
  state.more = lastMore;
  state.anchor = anchor;
  state.attempted = true;
  state.warning = "";
  state.source = "network";
  state.syncedAt = Date.now();
  persist(kind, state);
  finish(state, kind);
}

/**
 * Load, paginate, reset or background-refresh a schedule.
 * Requests that arrive while a load is running are coalesced into one
 * follow-up run instead of being silently dropped.
 *
 * @param {'upcoming'|'recent'} kind
 * @param {{reset?:boolean, force?:boolean, refresh?:boolean}} [options]
 */
export function loadSchedule(kind, options = {}) {
  if (!KINDS.includes(kind)) return Promise.resolve();
  const state = schedules[kind];

  if (state.loading) {
    if (options.reset || options.refresh || options.force) {
      state.queued = { reset: Boolean(options.reset), force: true, refresh: Boolean(options.refresh) };
    }
    return state.inflight || Promise.resolve();
  }

  const firstLoad = state.page === 0;
  let mode;
  if (options.refresh) mode = "refresh";
  else if (options.reset || firstLoad) mode = "first";
  else mode = "page";

  if (mode === "page" && (!state.more || state.page >= PAGE_LIMIT)) return Promise.resolve();

  const promise = runLoad(kind, mode, options.force === true).then(async () => {
    const queued = state.queued;
    state.queued = null;
    if (!queued) return;
    // A refresh request that arrived mid-load runs now, as a refresh.
    if (queued.refresh && !queued.reset) await loadSchedule(kind, { refresh: true, force: true });
    else await loadSchedule(kind, { reset: true, force: queued.force });
  });

  state.inflight = promise;
  return promise;
}

/** Background refresh of everything currently loaded. */
export function refreshLoaded(kind, { force = true } = {}) {
  return loadSchedule(kind, { refresh: true, force });
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

/** In-memory + on-disk removal of every cached schedule. */
export async function clearCaches() {
  cacheRevision++;
  clearApiCache();
  const removed = await clearAllSnapshots();
  await dropLegacyCache();
  for (const kind of KINDS) {
    const state = schedules[kind];
    state.events = [];
    state.page = 0;
    state.more = false;
    state.anchor = 0;
    state.syncedAt = 0;
    state.source = "network";
    state.attempted = false;
    state.warning = "";
    state.error = "";
    notify(kind);
  }
  return removed;
}

/** Wipe caches from memory only (used after an undo restores them). */
export function resetCacheRevision() {
  cacheRevision++;
}

/* ------------------------------------------------------------
   Sentinel: auto-load the next page near the end of the list
   ------------------------------------------------------------ */

let observer = null;
let sentinelKind = null;

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
