/* ============================================================
   Otaku Time — application bootstrap & orchestration
   Three sections: Upcoming · Watchlist · Recently aired.
   ============================================================ */

import { qs, qsa, esc, prefersReducedMotion } from "./utils/dom.js";
import { titleOf } from "./utils/format.js";
import { timeAgo } from "./utils/time.js";
import { rank } from "./utils/search-rank.js";

import { watchlist } from "./storage/watchlist.js";
import { getPrefs, prefsStore } from "./services/prefs.js";
import { initTheme } from "./services/theme.js";
import { startClock, tickNow } from "./services/clock.js";
import { checkNotifications, mergeReminders } from "./services/notifications.js";
import {
  schedules,
  loadSchedule,
  onScheduleChange,
  restoreFromCache,
  needsLoad,
} from "./services/schedule.js";
import * as pool from "./services/media-pool.js";
import { on as busOn, emit } from "./services/bus.js";

import { enhanceSelects, observeSelects } from "./components/select.js";
import { showToast } from "./components/toast.js";
import * as upcoming from "./features/upcoming/index.js";
import * as watchlistFeature from "./features/watchlist/index.js";
import * as recent from "./features/recently-aired/index.js";
import * as searchFeature from "./features/search/index.js";
import { initDetail, openDetail } from "./features/detail/index.js";
import { initSettings, openSettings } from "./features/settings/index.js";

const SECTION_TITLES = {
  upcoming: "Upcoming",
  watchlist: "Watchlist",
  recent: "Recently aired",
};

const SECTION_ORDER = ["upcoming", "watchlist", "recent"];

const features = {
  upcoming,
  watchlist: watchlistFeature,
  recent,
  search: searchFeature,
};

let section = "upcoming";
let query = "";

const SEARCH_DEBOUNCE_MS = 350;
const STALE_RELOAD_MS = 15 * 60 * 1000;

let searchTimer = null;
let searchAbort = null;
let searchGeneration = 0;

/* ------------------------------------------------------------
   Render context shared with feature modules
   ------------------------------------------------------------ */

function makeContext(animate = false) {
  return {
    animate,
    prefs: getPrefs,
    query: () => query,
    section: () => section,
    announce: showToast,
    navigate: (target) => navigate(target),
    openSettings: () => openSettings(document.activeElement),
    render: () => render(),
    watchlistChanged: () => {
      updateCounts(true);
      syncSaveButtons();
      render();
    },
    scheduleChanged: () => render(),
  };
}

let ctx = makeContext();

/* ------------------------------------------------------------
   Rendering

   Every paint goes through render(), which skips work entirely
   when nothing observable changed (signature below) and only
   plays entrance animations when animateNext is pending —
   section switches and first paint, never routine data refreshes.
   ------------------------------------------------------------ */

let lastRenderKey = null;
let animateNext = true;

function renderKey() {
  const parts = [section, query.trim()];
  if (query.trim()) {
    const search = searchFeature.state;
    parts.push(
      search.results.map((media) => media.id).join(","),
      search.loading,
      search.error,
      search.warning
    );
  } else if (section === "watchlist") {
    parts.push(JSON.stringify(features.watchlist.filters));
    parts.push(
      watchlist
        .all()
        .map((item) => `${item.id}:${item.watched}:${item.episodes}:${item.createdAt}`)
        .join(",")
    );
    parts.push(watchlist.isCorrupt(), watchlist.storageAvailable());
  } else {
    const kind = section === "recent" ? "recent" : "upcoming";
    const state = schedules[kind];
    parts.push(JSON.stringify(features[section].filters));
    parts.push(
      state.events.length,
      state.page,
      state.more,
      state.loading,
      state.error,
      state.warning,
      state.source
    );
  }
  const prefs = getPrefs();
  parts.push(prefs.timezone, prefs.hour12);
  return parts.join("|");
}

function render() {
  const key = renderKey();
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  const animate = animateNext;
  ctx = makeContext(animate);

  // Search view takes over the full content area.
  if (query.trim()) {
    updateNav();
    updateTitle("Search");
    searchFeature.render(ctx);
  } else {
    const feature = features[section] || features.upcoming;
    feature.render(ctx);
    updateNav();
    updateTitle(SECTION_TITLES[section] || "Upcoming");
  }

  // Skeleton frames don't consume the pending entrance animation —
  // real content should still fade in when it arrives.
  if (animate && !qs("#app .skeleton-card")) animateNext = false;
}

function updateTitle(label) {
  document.title = `${label} · Otaku Time`;
}

/* ------------------------------------------------------------
   Navigation
   ------------------------------------------------------------ */

function navigate(target, { focusMain = false } = {}) {
  if (!SECTION_ORDER.includes(target)) target = "upcoming";
  if (target === section && !focusMain) {
    render();
    return;
  }
  section = target;
  if (query) {
    setQuery("", { silent: true });
  }
  if (location.hash !== `#${target}`) {
    history.replaceState(null, "", `#${target}`);
  }

  animateNext = true;
  features[section].onActivate?.(ctx); // loads data if needed
  render();
  updateSyncStatus();

  if (focusMain) {
    const main = qs("#main");
    main?.focus?.({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  emit("section:changed", { section });
}

function updateNav() {
  for (const link of qsa("[data-nav]")) {
    const active = link.dataset.nav === section;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  // Sidebar sliding indicator
  const indicator = qs(".nav__indicator");
  const activeLink = qs(`.nav__link[data-nav="${section}"]`);
  if (indicator && activeLink) {
    indicator.style.setProperty("--indicator-y", `${activeLink.offsetTop}px`);
    indicator.classList.add("is-visible");
  }

  // Bottom tab bar indicator (mobile)
  const tabbar = qs(".tabbar");
  const tabIndex = SECTION_ORDER.indexOf(section);
  if (tabbar && tabIndex >= 0) {
    tabbar.style.setProperty("--indicator-x", `${tabIndex * 100}%`);
  }
}

function updateCounts(bump = false) {
  const count = watchlist.all().length;
  for (const el of qsa("[data-nav-count]")) {
    const hidden = count <= 0;
    if (el.hidden !== hidden) el.hidden = hidden;
    const previous = Number(el.textContent);
    el.textContent = String(count);
    if (bump && previous !== count && !prefersReducedMotion()) {
      el.classList.remove("is-bumped");
      void el.offsetWidth;
      el.classList.add("is-bumped");
    }
  }
}

/* ------------------------------------------------------------
   Sync status (sidebar + topbar instances)
   ------------------------------------------------------------ */

function syncInfo() {
  const kind = section === "recent" ? "recent" : "upcoming";
  const state = schedules[kind];
  if (state.loading && !state.events.length) {
    return { state: "loading", text: "Syncing with AniList…" };
  }
  if (state.error) {
    return { state: "error", text: state.error };
  }
  if (state.source === "cache" || (state.syncedAt && Date.now() - state.syncedAt > STALE_RELOAD_MS)) {
    return { state: "cache", text: "Last saved schedule" };
  }
  if (state.syncedAt) {
    return { state: "live", text: "Live from AniList" };
  }
  return { state: "loading", text: "Syncing with AniList…" };
}

function updateSyncStatus() {
  const { state, text } = syncInfo();
  for (const el of qsa(".js-sync")) {
    if (el.dataset.state !== state) el.dataset.state = state;
    const label = qs(".sync__text", el);
    if (label && label.textContent !== text) label.textContent = text;
  }

  // Keep "#section-meta" fresh without a full repaint (renderKey omits syncedAt).
  if (section === "upcoming" || section === "recent") {
    const meta = qs("#section-meta");
    const schedule = schedules[section === "recent" ? "recent" : "upcoming"];
    if (meta && schedule) {
      const value = schedule.syncedAt
        ? `Synced ${timeAgo(schedule.syncedAt / 1000)}${schedule.source === "cache" ? " · from cache" : ""}`
        : "";
      if (meta.textContent !== value) meta.textContent = value;
    }
  }
}

/* ------------------------------------------------------------
   Save / progress actions
   ------------------------------------------------------------ */

function findMedia(id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) return null;
  return pool.findById(numeric) || watchlist.find(numeric) || null;
}

function toggleSave(id, button) {
  const media = findMedia(id);
  if (!media) {
    showToast("That title isn't available right now.");
    return;
  }
  const result = watchlist.toggle(media);
  if (!result) {
    showToast(watchlist.storageProblem() || "Couldn't update your watchlist.");
    return;
  }

  if (!watchlist.storageAvailable()) {
    showToast(watchlist.storageProblem() || "Saved for this session only.");
  } else {
    showToast(result.removed ? "Removed from watchlist" : "Saved to watchlist");
  }

  // Sync every save control for this title without repainting the view.
  syncSaveButtons();
  if (button && !prefersReducedMotion()) {
    button.classList.remove("is-pop");
    void button.offsetWidth;
    button.classList.add("is-pop");
  }

  updateCounts(true);
  if (section === "watchlist") render(); // progress/stats live here
}

/** Bring every [data-action="save"] control in line with storage. */
function syncSaveButtons() {
  for (const button of qsa('[data-action="save"]')) {
    const id = Number(button.dataset.id);
    if (!Number.isInteger(id)) continue;
    const isSaved = watchlist.has(id);
    if (button.classList.contains("btn")) {
      // Text button (spotlight): swap label + variant.
      button.classList.toggle("btn--secondary", isSaved);
      button.classList.toggle("btn--ghost", !isSaved);
      const label = isSaved ? "In watchlist" : "Add to watchlist";
      if (button.textContent.trim() !== label) button.textContent = label;
    } else {
      button.classList.toggle("is-saved", isSaved);
      const media = pool.findById(id) || watchlist.find(id);
      const title = media ? titleOf(media) : "";
      if (title && button.hasAttribute("aria-label")) {
        button.setAttribute(
          "aria-label",
          isSaved ? `Remove ${title} from watchlist` : `Save ${title} to watchlist`
        );
      }
    }
  }
}

function bumpProgress(id, delta, button) {
  const media = findMedia(id);
  const item = media ? watchlist.find(media.id) : null;
  if (!media || !item) return;

  const next = item.watched + delta;
  if (!watchlist.setProgress(media, next)) {
    showToast(watchlist.storageProblem() || "Couldn't update progress.");
    return;
  }

  if (button && !prefersReducedMotion()) {
    button.classList.remove("is-pop");
    void button.offsetWidth;
    button.classList.add("is-pop");
  }

  updateCounts(true);
  if (section === "watchlist") render();
}

/* ------------------------------------------------------------
   Section refresh
   ------------------------------------------------------------ */

async function refreshCurrent() {
  const kind = section === "recent" ? "recent" : "upcoming";
  for (const button of qsa(".js-refresh")) {
    button.classList.add("is-spinning");
    button.disabled = true;
  }
  try {
    await loadSchedule(kind, { reset: true, force: true });
  } finally {
    for (const button of qsa(".js-refresh")) {
      button.classList.remove("is-spinning");
      button.disabled = false;
    }
  }
}

/* ------------------------------------------------------------
   Search
   ------------------------------------------------------------ */

function setQuery(value, { silent = false } = {}) {
  const hadQuery = Boolean(query.trim());
  query = value ?? "";
  const input = qs("#search");
  if (input && input.value !== query) input.value = query;
  const clear = qs("#clear-search");
  if (clear) clear.hidden = !query;

  if (!silent) {
    const hasQuery = Boolean(query.trim());
    if (hadQuery !== hasQuery) animateNext = true; // entering/leaving search
    if (hasQuery) runSearch(query);
    else {
      cancelSearch();
      searchFeature.setResults({ results: [] });
      render();
    }
  }
}

function cancelSearch() {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  if (searchAbort) {
    searchAbort.abort();
    searchAbort = null;
  }
}

async function runSearch(rawQuery) {
  const trimmed = rawQuery.trim();
  if (!trimmed) return;

  const generation = ++searchGeneration;
  cancelSearch();

  // Instant local ranking while the remote request is pending.
  const local = rank(trimmed, pool.poolItems());
  searchFeature.setResults({ results: local, loading: true });
  render();

  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    try {
      const { items, warning } = await pool.remoteSearch(trimmed, searchAbort.signal);
      if (generation !== searchGeneration) return;
      const merged = mergeRanked(local, items, trimmed);
      searchFeature.setResults({ results: merged, loading: false, warning });
      render();
    } catch (error) {
      if (generation !== searchGeneration || error?.code === "ABORTED") return;
      searchFeature.setResults({
        results: local,
        loading: false,
        error: error?.message || "Search is unavailable right now.",
      });
      render();
    }
  }, SEARCH_DEBOUNCE_MS);
}

/** Merge local + remote results, keeping the strongest rank per id. */
function mergeRanked(local, remote, trimmed) {
  const byId = new Map();
  const order = [];
  for (const list of [local, remote]) {
    for (const media of list) {
      if (!media || byId.has(media.id)) continue;
      byId.set(media.id, media);
      order.push(media.id);
    }
  }
  // Re-rank the union so fuzzy local matches keep their position.
  const union = order.map((id) => byId.get(id));
  const ranked = rank(trimmed, union);
  const rankedIds = new Set(ranked.map((m) => m.id));
  return [...ranked, ...union.filter((m) => !rankedIds.has(m.id))];
}

/* ------------------------------------------------------------
   Event wiring
   ------------------------------------------------------------ */

function onClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const actionEl = target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    switch (action) {
      case "detail": {
        const media = findMedia(id);
        if (media) openDetail(media, actionEl);
        else showToast("Details aren't available for that title yet.");
        return;
      }
      case "save":
        event.preventDefault();
        event.stopPropagation();
        toggleSave(id, actionEl);
        return;
      case "bump":
        event.preventDefault();
        event.stopPropagation();
        bumpProgress(id, Number(actionEl.dataset.delta) || 0, actionEl);
        return;
      case "retry":
        refreshCurrent();
        return;
      default:
        break;
    }

    // Feature-specific actions (clear filters, go-upcoming, open-settings…)
    const feature = query.trim() ? null : features[section];
    feature?.handleAction?.(action, actionEl, ctx);
  }
}

function onChange(event) {
  const filter = event.target.closest?.("[data-filter]");
  if (filter && !query.trim()) {
    const feature = features[section];
    feature?.handleFilter?.(filter.dataset.filter, filter.value, ctx);
    return;
  }
}

function bindChrome() {
  for (const button of qsa(".js-refresh")) {
    button.addEventListener("click", () => refreshCurrent());
  }
  for (const button of qsa(".js-settings-open")) {
    button.addEventListener("click", () => openSettings(button));
  }

  const input = qs("#search");
  input?.addEventListener("input", () => setQuery(input.value));

  qs("#clear-search")?.addEventListener("click", () => {
    setQuery("");
    input?.focus();
  });

  document.addEventListener("keydown", (event) => {
    const active = document.activeElement;
    const typing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement ||
      active?.isContentEditable;

    if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      input?.focus();
      input?.select();
      return;
    }

    if (event.key === "Escape") {
      if (qs("#detail-dialog")?.open || qs("#settings-dialog")?.open) return; // dialogs handle their own Esc
      if (query) {
        event.preventDefault();
        setQuery("");
        input?.focus();
      }
    }
  });
}

function bindHash() {
  window.addEventListener("hashchange", () => {
    const target = location.hash.replace(/^#/, "");
    if (SECTION_ORDER.includes(target) && target !== section) {
      navigate(target, { focusMain: true });
    }
  });
}

function bindStorage() {
  window.addEventListener("storage", (event) => {
    if (
      event.key === null ||
      event.key === watchlist.key ||
      event.key === watchlist.legacyKey
    ) {
      watchlist.read(true);
      updateCounts();
      syncSaveButtons();
      render();
    }
    if (event.key === prefsStore.key || event.key === prefsStore.legacyKey) {
      prefsStore.refresh();
      tickNow();
      render();
    }
    mergeReminders();
  });

  window.addEventListener("online", () => {
    showToast("Back online.");
    const kind = section === "recent" ? "recent" : "upcoming";
    const state = schedules[kind];
    if (state.error || needsLoad(kind)) {
      loadSchedule(kind, { reset: true, force: true }).catch(() => {});
    }
  });

  window.addEventListener("offline", () => showToast("You're offline — showing saved data."));
}

function bindLifecycle() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    tickNow();
    const kind = section === "recent" ? "recent" : "upcoming";
    if (needsLoad(kind)) {
      loadSchedule(kind, { reset: schedules[kind].events.length > 0 }).catch(() => {});
    }
  });

  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const kind = section === "recent" ? "recent" : "upcoming";
    if (needsLoad(kind)) {
      loadSchedule(kind, { reset: schedules[kind].events.length > 0 }).catch(() => {});
    }
  }, STALE_RELOAD_MS);

  busOn("watchlist:changed", () => {
    updateCounts(true);
    render();
  });
}

function notifyCheck() {
  checkNotifications({
    schedules: {
      upcoming: schedules.upcoming.events,
      recent: schedules.recent.events,
    },
    watchlistItems: () => watchlist.all(),
  });
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */

async function init() {
  initTheme();
  initDetail(ctx);
  initSettings(ctx);

  enhanceSelects(document);
  observeSelects(document.body);

  bindChrome();
  bindHash();
  bindStorage();
  bindLifecycle();

  document.getElementById("app")?.addEventListener("click", onClick);
  document.getElementById("app")?.addEventListener("change", onChange);

  // Cross-schedule updates → refresh the visible view + status.
  onScheduleChange((kind) => {
    // Seed the media pool with whatever arrived.
    pool.addAll(schedules[kind].events);
    updateSyncStatus();
    if (query.trim()) return;
    const visible =
      (kind === "recent" && section === "recent") || (kind === "upcoming" && section !== "recent");
    if (!visible) return;
    // A "fetch started" flip with content already on screen changes nothing
    // visible — repainting here is what caused load-time flashing.
    const state = schedules[kind];
    if (state.loading && state.events.length) return;
    render();
  });

  busOn("prefs:changed", () => {
    tickNow();
    render();
  });

  // First: paint instantly from the persistent cache when present.
  await Promise.all([restoreFromCache("upcoming"), restoreFromCache("recent")]);
  pool.addAll(schedules.upcoming.events);
  pool.addAll(schedules.recent.events);

  // Adopt existing local data + seed the pool from it.
  watchlist.read();
  for (const item of watchlist.all()) {
    pool.addMedia({
      id: item.id,
      title: item.title,
      coverImage: item.coverImage,
      format: item.format,
      status: item.status,
      episodes: item.episodes,
      duration: item.duration,
      averageScore: item.averageScore,
      genres: item.genres,
      nextAiringEpisode: item.nextAiringEpisode,
      type: "ANIME",
      isAdult: false,
    });
  }
  updateCounts();

  const initial = location.hash.replace(/^#/, "");
  section = SECTION_ORDER.includes(initial) ? initial : "upcoming";
  if (!location.hash) history.replaceState(null, "", "#upcoming");

  features[section].onActivate?.(ctx);
  render();
  updateSyncStatus();

  startClock(notifyCheck);
  notifyCheck();

  // Ensure upcoming loads even when starting on another section.
  if (section !== "upcoming" && needsLoad("upcoming")) {
    loadSchedule("upcoming", { reset: true }).catch(() => {});
  }

  // Watch for storage problems the user should know about.
  const problem = watchlist.storageProblem();
  if (problem) showToast(problem);
  const prefsProblem = prefsStore.warning();
  if (prefsProblem) showToast(prefsProblem, 6000);
}

init().catch((error) => {
  console.error("Otaku Time failed to start:", error);
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML = `<div class="notice" role="alert">Something went wrong while starting Otaku Time. Your saved data was not modified. ${esc(
      error?.message || ""
    )}</div>`;
  }
});
