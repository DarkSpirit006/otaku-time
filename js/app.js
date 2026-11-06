/* ============================================================
   Otaku Time — bootstrap & orchestration

   Three sections (Upcoming · Watchlist · Recently aired), a hash
   router for sections and `#show/<id>` detail routes, one render
   loop, and the interaction layer (keyboard, palette, gestures).
   ============================================================ */

import { qs, qsa, esc, prefersReducedMotion } from "./utils/dom.js";
import { titleOf } from "./utils/format.js";
import { timeAgo } from "./utils/time.js";
import { rank } from "./utils/search-rank.js";
import { parseRoute, SECTIONS } from "./utils/router.js";

import { watchlist } from "./storage/watchlist.js";
import { getPrefs, prefsStore } from "./services/prefs.js";
import { initTheme } from "./services/theme.js";
import { startClock, tickNow } from "./services/clock.js";
import { checkNotifications, mergeReminders } from "./services/notifications.js";
import {
  schedules,
  loadSchedule,
  refreshLoaded,
  onScheduleChange,
  restoreFromCache,
  needsLoad,
  scheduleSignature,
} from "./services/schedule.js";
import * as pool from "./services/media-pool.js";
import { syncFromEvents, syncFromList } from "./services/metadata.js";
import { on as busOn, emit } from "./services/bus.js";
import { initPwa } from "./services/pwa.js";

import { enhanceSelects, observeSelects } from "./components/select.js";
import { showToast, initToast } from "./components/toast.js";
import { renderWire, wireLines } from "./components/wire.js";
import { initPalette, openPalette, closePalette, openHelp, closeHelp, isHelpOpen } from "./components/palette.js";
import { offerUndo } from "./services/undo.js";

import * as upcoming from "./features/upcoming/index.js";
import * as watchlistFeature from "./features/watchlist/index.js";
import * as recent from "./features/recently-aired/index.js";
import * as searchFeature from "./features/search/index.js";
// The detail sheet and the settings sheet are the two heavy modules and
// are only needed when someone opens them, so they load on demand. Each
// loader resolves only after the module has been initialised, so a deep
// link arriving before the idle warm-up still opens correctly.
let detailReady = null;
let settingsReady = null;

function loadDetail() {
  detailReady ??= import("./features/detail/index.js").then((mod) => {
    mod.initDetail(ctx);
    return mod;
  });
  return detailReady;
}

function loadSettings() {
  settingsReady ??= import("./features/settings/index.js").then((mod) => {
    mod.initSettings(ctx);
    return mod;
  });
  return settingsReady;
}

const isDetailOpen = () => qs("#detail-dialog")?.open === true;

function openDetail(media, opener) {
  loadDetail()
    .then((mod) => mod.openDetail(media, opener))
    .catch(() => showToast("Couldn't open that title."));
}

function closeDetail(options) {
  loadDetail().then((mod) => mod.closeDetail(options)).catch(() => {});
}

function openSettings(opener) {
  loadSettings()
    .then((mod) => mod.openSettings(opener))
    .catch(() => showToast("Couldn't open settings."));
}

const SECTION_TITLES = {
  upcoming: "Upcoming",
  watchlist: "Watchlist",
  recent: "Recently aired",
};

const features = {
  upcoming,
  watchlist: watchlistFeature,
  recent,
  search: searchFeature,
};

const SEARCH_DEBOUNCE_MS = 300;
const STALE_RELOAD_MS = 15 * 60 * 1000;

let section = "upcoming";
let query = "";
let ctx = null;
let lastRenderKey = null;
let animateNext = true;
// Set as soon as the person does anything. Boot is async (cache restore
// runs through IndexedDB), so a slow first paint must never overwrite a
// query or a section the user already chose.
let interacted = false;

let searchTimer = null;
let searchAbort = null;
let searchGeneration = 0;

const scrollMemory = new Map();
let pendingDetailId = null;

/* ------------------------------------------------------------
   Context shared with feature modules
   ------------------------------------------------------------ */

function makeContext(animate = false) {
  return {
    animate,
    prefs: getPrefs,
    query: () => query,
    section: () => section,
    announce: showToast,
    navigate: (target) => navigate(target),
    openSettings: (opener) => openSettings(opener),
    render: () => render(),
    watchlistChanged: () => {
      updateCounts(true);
      syncSaveButtons();
      render();
    },
    scheduleChanged: () => render(),
    closeDetailRoute: () => leaveDetailRoute(),
  };
}

/* ------------------------------------------------------------
   Rendering
   ------------------------------------------------------------ */

function renderKey() {
  const parts = [section, query.trim(), upcoming.currentView(), JSON.stringify(upcoming.state.filters)];

  if (query.trim()) {
    const search = searchFeature.state;
    parts.push(
      search.results.map((media) => media.id).join(","),
      search.loading,
      search.error,
      search.warning
    );
  } else if (section === "watchlist") {
    parts.push(
      watchlist
        .all()
        .map(
          (item) =>
            `${item.id}:${item.watched}:${item.listStatus}:${item.score}:${item.notes?.length}:${item.order}:${item.updatedAt}:${item.mediaStatus}:${item.nextAiringEpisode?.airingAt}`
        )
        .join(","),
      watchlist.isCorrupt(),
      watchlist.storageAvailable(),
      JSON.stringify(watchlistFeature.state)
    );
  } else {
    const kind = section === "recent" ? "recent" : "upcoming";
    const state = schedules[kind];
    parts.push(
      scheduleSignature(kind),
      state.page,
      state.more,
      state.loading,
      state.refreshing,
      state.error,
      state.warning,
      state.source
    );
  }

  const prefs = getPrefs();
  parts.push(prefs.timezone, prefs.hour12, prefs.weekStartsOn);
  parts.push(upcoming.state.weekOffset);
  return parts.join("|");
}

let lastRenderedIds = new Set();

function render() {
  const key = renderKey();
  if (key === lastRenderKey) {
    updateSyncStatus();
    updateWire();
    return;
  }
  lastRenderKey = key;
  // render() only runs when the data signature moved, so this is a
  // genuine content change — never skip it on the minute check.
  updateWire({ force: true });

  const animate = animateNext;
  ctx = makeContext(animate);

  const app = qs("#app");
  const previousIds = lastRenderedIds;
  const scrollY = window.scrollY;
  const hasQuery = Boolean(query.trim());

  if (hasQuery) {
    updateNav();
    updateTitle("Search");
    searchFeature.render(ctx);
  } else {
    const feature = features[section] || features.upcoming;
    feature.render(ctx);
    updateNav();
    updateTitle(SECTION_TITLES[section] || "Upcoming");
  }

  if (scrollY > 0 && window.scrollY !== scrollY) window.scrollTo(0, scrollY);

  if (!animate && !hasQuery && app && previousIds.size > 0) {
    const fresh = qsa("[data-eid]", app).filter((el) => !previousIds.has(el.dataset.eid));
    fresh.slice(0, 24).forEach((el) => el.classList.add("item-in"));
  }
  lastRenderedIds = app ? new Set(qsa("[data-eid]", app).map((el) => el.dataset.eid)) : new Set();

  if (animate && !qs("#app .skeleton-card, #app .skeleton-row, #app .skeleton-cal")) animateNext = false;
  updateSyncStatus();
  revealBlurUp();
}

/** Blur-up: posters fade in once decoded, never before. */
function revealBlurUp() {
  for (const img of qsa("img[data-blur-up]")) {
    if (img.dataset.blurBound) continue;
    img.dataset.blurBound = "1";
    if (img.complete && img.naturalWidth) img.classList.add("is-loaded");
    else img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    img.addEventListener("error", () => img.classList.add("is-broken"), { once: true });
  }
}

function updateTitle(label) {
  document.title = `${label} · Otaku Time`;
}

/* ------------------------------------------------------------
   Navigation + routing
   ------------------------------------------------------------ */

function navigate(target, { push = true, focusMain = false } = {}) {
  interacted = true;
  if (!SECTIONS.includes(target)) target = "upcoming";
  const from = section;
  if (target === section && !focusMain) {
    render();
    return;
  }

  if (push) {
    scrollMemory.set(section, window.scrollY);
    history.pushState({ section: target }, "", `#${target}`);
  }
  section = target;
  if (query) setQuery("", { silent: true });
  if (target !== "upcoming") upcoming.setView("timeline");

  animateNext = true;
  features[section].onActivate?.(ctx);
  render();

  if (from !== section) window.scrollTo({ top: focusMain ? 0 : scrollMemory.get(target) || 0 });
  if (focusMain) qs("#main")?.focus?.({ preventScroll: true });
  emit("section:changed", { section });
}

/** Apply whatever the current hash says. */
function applyRoute({ initial = false } = {}) {
  const route = parseRoute(location.hash);

  if (route.invalid) {
    showToast("That link doesn't point to a title we can open.");
    history.replaceState({ section }, "", `#${section}`);
    return;
  }
  if (route.unknown) {
    history.replaceState({ section }, "", `#${section}`);
    return;
  }

  if (route.mediaId !== null) {
    openShow(route.mediaId, { fromRoute: true });
    return;
  }

  if (isDetailOpen()) {
    // Back/forward moved away from a detail route: close without pushing.
    closeDetail({ viaHistory: false });
  }

  if (route.view === "calendar") {
    upcoming.setView("calendar");
  }

  if (route.section && route.section !== section) {
    if (initial) {
      section = route.section;
      features[section].onActivate?.(ctx);
    } else {
      navigate(route.section, { push: false, focusMain: true });
    }
  } else if (route.section === section) {
    render();
  }
}

/** Open a detail dialog and reflect it in the URL. */
async function openShow(id, { fromRoute = false } = {}) {
  let media = pool.findById(id) || watchlist.find(id);

  if (!media) {
    try {
      const { media: fetched } = await import("./api/anilist.js").then((api) => api.details(id));
      if (fetched) {
        pool.addMedia(fetched);
        media = fetched;
      }
    } catch {
      media = null;
    }
  }

  if (!media) {
    showToast("That title isn't on AniList anymore.");
    if (fromRoute) history.replaceState({ section }, "", `#${section}`);
    return;
  }

  if (!fromRoute) history.pushState({ detail: id }, "", `#show/${id}`);
  openDetail(media, document.activeElement);
}

function leaveDetailRoute() {
  if (history.state?.detail) history.back();
  else history.replaceState({ section }, "", `#${section}`);
}

function updateNav() {
  for (const link of qsa("[data-nav]")) {
    const active = link.dataset.nav === section;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  // The rail and tab-bar indicators are positioned by CSS classes, never
  // inline styles, so the strict CSP holds.
  const tabIndex = SECTIONS.indexOf(section);
  const nav = qs(".nav");
  if (nav) {
    nav.dataset.active = String(tabIndex);
    nav.classList.add("has-active");
  }
  const tabbar = qs(".tabbar");
  if (tabbar && tabIndex >= 0) tabbar.dataset.active = String(tabIndex);
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
   Sync status
   ------------------------------------------------------------ */

function updateSyncStatus() {
  const kind = section === "recent" ? "recent" : "upcoming";
  const state = schedules[kind];
  let status = "live";
  let text = "Live from AniList";

  if (!navigator.onLine) {
    status = "offline";
    text = "Offline — saved data";
  } else if (state.loading && !state.events.length) {
    status = "loading";
    text = "Syncing with AniList…";
  } else if (state.refreshing) {
    status = "loading";
    text = "Refreshing…";
  } else if (state.error) {
    status = "error";
    text = state.error;
  } else if (state.source === "cache") {
    status = "cache";
    text = "Last saved schedule";
  } else if (state.syncedAt && Date.now() - state.syncedAt > STALE_RELOAD_MS) {
    status = "cache";
    text = "Saved schedule — refreshing";
  }

  for (const el of qsa(".js-sync")) {
    if (el.dataset.state !== status) el.dataset.state = status;
    const label = qs(".sync__text", el);
    if (label && label.textContent !== text) label.textContent = text;
  }

  const meta = qs("#section-meta");
  if (meta && (section === "upcoming" || section === "recent")) {
    const schedule = schedules[kind];
    const value = schedule.syncedAt
      ? `synced ${timeAgo(schedule.syncedAt / 1000)}${schedule.source === "cache" ? " · cache" : ""}`
      : "";
    if (value.includes("synced")) meta.dataset.synced = value;
  }
}

/* ------------------------------------------------------------
   Broadcast wire
   ------------------------------------------------------------ */

let wireMinute = -1;

/**
 * Keep the wire in step with the loaded windows.
 *
 * Countdowns inside it are minute-scale, so this refreshes when the
 * minute changes rather than on every clock tick — a strip that is
 * rewritten once a second would fight its own animation.
 */
function updateWire({ force = false } = {}) {
  const el = qs("#wire");
  if (!el) return;
  const minute = Math.floor(Date.now() / 60_000);
  // Data changes must always redraw: the minute check exists only to
  // stop the countdown text from re-rendering every tick.
  if (!force && minute === wireMinute) return;
  wireMinute = minute;

  renderWire(
    el,
    wireLines({
      upcoming: schedules.upcoming.events,
      recent: schedules.recent.events,
      now: Math.floor(Date.now() / 1000),
      tracked: watchlist.all().length,
    })
  );
}

/* ------------------------------------------------------------
   Save + progress
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

  syncSaveButtons();
  if (button && !prefersReducedMotion()) {
    button.classList.remove("is-pop");
    void button.offsetWidth;
    button.classList.add("is-pop");
  }
  updateCounts(true);

  if (result.removed) {
    offerUndo({
      message: `Removed ${titleOf(media)}`,
      restore: () => {
        const ok = watchlist.restore(result.item);
        syncSaveButtons();
        updateCounts();
        render();
        return ok;
      },
    });
  } else {
    showToast(watchlist.storageAvailable() ? "Saved to watchlist" : "Saved for this session only.");
  }

  if (section === "watchlist" || query) render();
}

function syncSaveButtons() {
  for (const button of qsa('[data-action="save"]')) {
    const id = Number(button.dataset.id);
    if (!Number.isInteger(id)) continue;
    const isSaved = watchlist.has(id);
    if (button.classList.contains("btn")) {
      button.classList.toggle("btn--secondary", isSaved);
      button.classList.toggle("btn--ghost", !isSaved);
      const label = isSaved ? "In watchlist" : "Add to watchlist";
      if (button.textContent.trim() !== label) button.textContent = label;
    } else {
      button.classList.toggle("is-saved", isSaved);
      button.setAttribute("aria-pressed", String(isSaved));
      const media = pool.findById(id) || watchlist.find(id);
      const title = media ? titleOf(media) : "";
      if (title) {
        button.setAttribute(
          "aria-label",
          isSaved ? `Remove ${title} from watchlist` : `Save ${title} to watchlist`
        );
      }
    }
  }
}

function stepProgress(id, delta, button) {
  const media = findMedia(id);
  const item = media ? watchlist.find(media.id) : watchlist.find(Number(id));
  if (!item) return;

  const before = item.watched;
  const next = before + delta;
  if (!watchlist.setWatched(item.id, next)) {
    showToast(watchlist.storageProblem() || "Couldn't update progress.");
    return;
  }

  const after = watchlist.find(item.id).watched;
  if (after === before) {
    if (delta > 0) {
      showToast("That's the last aired episode — progress can't go further yet.");
    }
    return;
  }

  if (button && !prefersReducedMotion()) {
    button.classList.remove("is-pop");
    void button.offsetWidth;
    button.classList.add("is-pop");
  }

  updateCounts(true);
  render();
}

/* ------------------------------------------------------------
   Section refresh
   ------------------------------------------------------------ */

async function refreshCurrent({ background = false, announce = true } = {}) {
  const kind = section === "recent" ? "recent" : "upcoming";
  const buttons = qsa(".js-refresh");
  for (const button of buttons) {
    button.classList.add("is-spinning");
    button.disabled = true;
  }
  try {
    if (background && schedules[kind].events.length) {
      await refreshLoaded(kind);
      if (announce) showToast("Schedule refreshed.");
    } else {
      await loadSchedule(kind, { reset: true, force: true });
      if (announce) showToast("Schedule reloaded.");
    }
    // Keep saved titles in step with the fresh data.
    const { updated } = syncFromEvents(schedules[kind].events);
    if (updated && section === "watchlist") render();
  } catch {
    if (announce) showToast("Refresh failed — keeping what's on screen.");
  } finally {
    for (const button of qsa(".js-refresh")) {
      button.classList.remove("is-spinning");
      button.disabled = false;
    }
    updateSyncStatus();
  }
}

/* ------------------------------------------------------------
   Search
   ------------------------------------------------------------ */

function setQuery(value, { silent = false } = {}) {
  interacted = true;
  const hadQuery = Boolean(query.trim());
  query = value ?? "";
  const input = qs("#search");
  if (input && input.value !== query) input.value = query;
  const clear = qs("#clear-search");
  if (clear) clear.hidden = !query;

  if (silent) return;
  const hasQuery = Boolean(query.trim());
  if (hadQuery !== hasQuery) animateNext = true;
  if (hasQuery) runSearch(query);
  else {
    cancelSearch();
    searchFeature.setResults({ results: [] });
    render();
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

  const local = rank(trimmed, pool.poolItems());
  searchFeature.setResults({ results: local, loading: true });
  render();

  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    try {
      const { items, warning } = await pool.remoteSearch(trimmed, searchAbort.signal);
      if (generation !== searchGeneration) return;
      searchFeature.setResults({
        results: mergeSearch(items, local),
        loading: false,
        warning,
      });
      syncFromList(items);
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

/**
 * AniList's SEARCH_MATCH order wins; local fuzzy hits are appended
 * only when the remote list didn't already contain them.
 */
function mergeSearch(remote, local) {
  const seen = new Set();
  const merged = [];
  for (const media of remote) {
    if (!media || seen.has(media.id)) continue;
    seen.add(media.id);
    merged.push(media);
  }
  for (const media of local) {
    if (!media || seen.has(media.id)) continue;
    seen.add(media.id);
    merged.push(media);
  }
  return merged;
}

/* ------------------------------------------------------------
   Click routing
   ------------------------------------------------------------ */

function onClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const actionEl = target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;

  switch (action) {
    case "detail": {
      event.preventDefault();
      const media = findMedia(id);
      if (media) openShow(media.id);
      else showToast("Details aren't available for that title yet.");
      return;
    }
    case "save":
      event.preventDefault();
      event.stopPropagation();
      toggleSave(id, actionEl);
      return;
    case "step":
      event.preventDefault();
      event.stopPropagation();
      stepProgress(id, Number(actionEl.dataset.delta) || 0, actionEl);
      return;
    case "retry":
      refreshCurrent({ background: false });
      return;
    case "genre": {
      const genre = actionEl.dataset.value;
      if (!genre) return;
      const media = watchlist.find(Number(actionEl.closest("[data-id]")?.dataset.id));
      if (media) {
        watchlistFeature.state.genre = genre;
        closeDetail();
        leaveDetailRoute();
        navigate("watchlist");
      }
      return;
    }
    default:
      break;
  }

  const feature = query.trim() ? null : features[section];
  feature?.handleAction?.(action, actionEl, ctx);
}

function onChange(event) {
  if (query.trim()) return;
  const feature = features[section];
  feature?.handleChange?.(event, ctx);
}

/* ------------------------------------------------------------
   Keyboard
   ------------------------------------------------------------ */

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTyping(target) {
  return Boolean(
    target instanceof Element &&
      (TYPING.has(target.tagName) || target.isContentEditable || target.closest("[contenteditable=true]"))
  );
}

function focusedCard() {
  const active = document.activeElement;
  const el = active?.closest?.("[data-eid]") || active?.closest?.(".cal-slot");
  return el || null;
}

function focusRelative(delta) {
  const app = qs("#app");
  const items = qsa(".card__open, .row__open, .cal-slot, .lead-panel__open", app);
  if (!items.length) return;
  const active = document.activeElement;
  const index = items.findIndex((el) => el === active || el.contains(active));
  const next = index < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, index + delta));
  const el = items[next];
  el.focus?.({ preventScroll: false });
  el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

let pendingPrefix = null;
let pendingPrefixAt = 0;

function onKeyDown(event) {
  const typing = isTyping(event.target);
  const meta = event.metaKey || event.ctrlKey;
  const detailOpen = isDetailOpen();
  const settingsOpen = Boolean(qs("#settings-dialog")?.open);
  const anyModal = detailOpen || settingsOpen || isHelpOpen();

  // Palette: the one global shortcut that works while typing.
  if (meta && event.key.toLowerCase() === "k") {
    event.preventDefault();
    togglePalette();
    return;
  }

  if (typing) {
    if (event.key === "Escape") {
      const input = event.target;
      if (input.id === "search") {
        setQuery("");
        input.blur();
      } else {
        input.blur();
      }
    }
    return;
  }

  // Prefix sequences (g then u/w/r/c), valid for 1.2s.
  const now = Date.now();
  if (pendingPrefix === "g" && now - pendingPrefixAt < 1200) {
    const map = { u: "upcoming", w: "watchlist", r: "recent" };
    if (map[event.key]) {
      event.preventDefault();
      pendingPrefix = null;
      navigate(map[event.key], { focusMain: true });
      return;
    }
    if (event.key === "c") {
      event.preventDefault();
      pendingPrefix = null;
      upcoming.setView("calendar");
      navigate("upcoming", { focusMain: true });
      return;
    }
  }
  pendingPrefix = null;

  if (event.key === "Escape") {
    if (anyModal) return; // dialogs handle their own Escape
    if (query) {
      event.preventDefault();
      setQuery("");
      return;
    }
    return;
  }

  if (anyModal) return;

  if (event.key === "g" && !meta && !event.altKey) {
    pendingPrefix = "g";
    pendingPrefixAt = now;
    return;
  }
  if (event.key === "/") {
    event.preventDefault();
    const input = qs("#search");
    input?.focus();
    input?.select();
    return;
  }
  if (event.key === "?") {
    event.preventDefault();
    openHelp();
    return;
  }
  if (event.key === "j" || event.key === "k") {
    event.preventDefault();
    focusRelative(event.key === "j" ? 1 : -1);
    return;
  }
  if (event.key === "t") {
    event.preventDefault();
    qs(".js-theme-toggle")?.click();
    return;
  }
  if (event.key === "f" && section === "watchlist") {
    event.preventDefault();
    watchlistFeature.state.group = !watchlistFeature.state.group;
    render();
    return;
  }

  const card = focusedCard();
  const cardId = card ? Number(card.dataset.id || card.querySelector("[data-id]")?.dataset.id) : null;

  if (event.key === "s" && cardId) {
    event.preventDefault();
    toggleSave(cardId, card.querySelector("[data-action=save]"));
    return;
  }
  if ((event.key === "+" || event.key === "=") && cardId) {
    event.preventDefault();
    stepProgress(cardId, 1, card.querySelector("[data-action=step][data-delta='1']"));
    return;
  }
  if (event.key === "-" && cardId) {
    event.preventDefault();
    stepProgress(cardId, -1, card.querySelector("[data-action=step][data-delta='-1']"));
    return;
  }
}

/* ------------------------------------------------------------
   Command palette
   ------------------------------------------------------------ */

function paletteCommands(currentQuery) {
  const commands = [];
  const push = (item) => commands.push(item);

  push({ id: "nav-upcoming", group: "Go", label: "Upcoming", icon: "calendar", hint: "g u", run: () => navigate("upcoming", { focusMain: true }) });
  push({ id: "nav-watchlist", group: "Go", label: "Watchlist", icon: "bookmark", hint: "g w", run: () => navigate("watchlist", { focusMain: true }) });
  push({ id: "nav-recent", group: "Go", label: "Recently aired", icon: "clock", hint: "g r", run: () => navigate("recent", { focusMain: true }) });
  push({
    id: "nav-calendar",
    group: "Go",
    label: "Calendar — this week",
    icon: "layers",
    hint: "g c",
    run: () => {
      upcoming.setView("calendar");
      navigate("upcoming", { focusMain: true });
    },
  });

  push({ id: "act-settings", group: "Actions", label: "Open settings", icon: "settings", run: () => openSettings() });
  push({ id: "act-refresh", group: "Actions", label: "Refresh the schedule", icon: "refresh", run: () => refreshCurrent() });
  push({
    id: "act-theme",
    group: "Actions",
    label: "Switch theme",
    icon: "sparkle",
    hint: "t",
    run: () => qs(".js-theme-toggle")?.click(),
  });
  push({ id: "act-help", group: "Actions", label: "Keyboard shortcuts", icon: "keyboard", hint: "?", run: () => openHelp() });
  push({
    id: "act-export",
    group: "Actions",
    label: "Export watchlist as JSON",
    icon: "download",
    run: () => openSettings(),
    hint: "Settings → Your data",
  });

  const saved = watchlist.all();
  for (const item of saved.slice(0, 30)) {
    const title = titleOf(item);
    if (currentQuery && !rank(currentQuery, [item]).length) continue;
    push({
      id: `show-${item.id}`,
      group: "Your watchlist",
      label: title,
      icon: "bookmark",
      hint: Number.isInteger(item.watched) ? `${item.watched} watched` : "",
      run: () => openShow(item.id),
    });
  }

  if (currentQuery) {
    push({
      id: "search-remote",
      group: "Search",
      label: `Search AniList for “${currentQuery}”`,
      icon: "search",
      hint: "Enter",
      run: () => {
        setQuery(currentQuery);
        qs("#search")?.focus();
      },
    });
  }

  return commands;
}

async function paletteSearch(queryText) {
  try {
    const { items } = await pool.remoteSearch(queryText);
    return items.slice(0, 6).map((media) => ({
      id: `remote-${media.id}`,
      group: "AniList",
      label: titleOf(media),
      hint: media.format || "",
      icon: "film",
      run: () => openShow(media.id),
    }));
  } catch {
    return [];
  }
}

function togglePalette() {
  if (qs("#palette-dialog")?.open) closePalette();
  else openPalette();
}

/* ------------------------------------------------------------
   Gestures
   ------------------------------------------------------------ */

function bindGestures() {
  const app = qs("#app");
  if (!app) return;

  let startX = 0;
  let startY = 0;
  let tracking = null;
  let locked = false;

  app.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse") return;
      const card = event.target.closest?.(".card--saved");
      if (!card) return;
      tracking = card;
      locked = false;
      startX = event.clientX;
      startY = event.clientY;
      card.classList.add("is-dragging");
    },
    { passive: true }
  );

  app.addEventListener(
    "pointermove",
    (event) => {
      if (!tracking) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!locked) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
          tracking.classList.remove("is-dragging");
          tracking = null; // vertical scroll wins
          return;
        }
        if (Math.abs(dx) > 18) locked = true;
      }
      if (!locked) return;
      tracking.classList.toggle("is-swipe-right", dx > 0);
      tracking.classList.toggle("is-swipe-left", dx < 0);
    },
    { passive: true }
  );

  const finish = (event) => {
    if (!tracking) return;
    const card = tracking;
    const dx = (event.clientX ?? startX) - startX;
    card.classList.remove("is-dragging", "is-swipe-right", "is-swipe-left");
    tracking = null;

    if (!locked || Math.abs(dx) < 64) return;
    const id = Number(card.dataset.id);
    if (!Number.isInteger(id)) return;

    if (dx > 0) {
      stepProgress(id, 1, null);
      if (navigator.vibrate) navigator.vibrate(8);
    } else {
      const removed = watchlist.remove(id);
      if (!removed) return;
      updateCounts();
      render();
      offerUndo({
        message: `Removed ${titleOf(removed)}`,
        restore: () => {
          const ok = watchlist.restore(removed);
          updateCounts();
          render();
          return ok;
        },
      });
      if (navigator.vibrate) navigator.vibrate([6, 30, 6]);
    }
  };

  app.addEventListener("pointerup", finish, { passive: true });
  app.addEventListener("pointercancel", () => {
    if (tracking) {
      tracking.classList.remove("is-dragging", "is-swipe-right", "is-swipe-left");
      tracking = null;
    }
  });

  // Pull to refresh (touch only, at the very top of the page).
  let pullStart = null;
  let pulled = false;
  document.addEventListener(
    "touchstart",
    (event) => {
      if (window.scrollY > 0 || event.touches.length !== 1) return;
      pullStart = event.touches[0].clientY;
      pulled = false;
    },
    { passive: true }
  );
  document.addEventListener(
    "touchmove",
    (event) => {
      if (pullStart === null || pulled) return;
      const delta = event.touches[0].clientY - pullStart;
      if (delta > 96) {
        pulled = true;
        refreshCurrent({ background: true });
      }
    },
    { passive: true }
  );
  document.addEventListener("touchend", () => {
    pullStart = null;
  });
}

/* ------------------------------------------------------------
   Wiring
   ------------------------------------------------------------ */

function bindChrome() {
  for (const button of qsa(".js-refresh")) {
    button.addEventListener("click", () => refreshCurrent({ background: schedules[section === "recent" ? "recent" : "upcoming"].events.length > 0 }));
  }
  for (const button of qsa(".js-settings-open")) {
    button.addEventListener("click", () => openSettings(button));
  }
  for (const button of qsa(".js-palette-open")) {
    button.addEventListener("click", () => openPalette());
  }
  for (const button of qsa(".js-help-open")) {
    button.addEventListener("click", () => openHelp());
  }

  const input = qs("#search");
  if (input) {
    // A long placeholder is clipped on phones; keep the hint honest at the
    // width it is actually shown.
    const narrow = window.matchMedia("(max-width: 520px)");
    const setPlaceholder = () => {
      input.placeholder = narrow.matches ? "Search anime" : "Search anime, titles, synonyms…";
    };
    setPlaceholder();
    narrow.addEventListener?.("change", setPlaceholder);
  }
  input?.addEventListener("input", () => setQuery(input.value));
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      input.blur();
    }
  });

  qs("#clear-search")?.addEventListener("click", () => {
    setQuery("");
    input?.focus();
  });

  for (const link of qsa("[data-nav]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(link.dataset.nav, { focusMain: true });
    });
  }

  document.addEventListener("keydown", onKeyDown);

  const helpDialog = qs("#help-dialog");
  helpDialog?.addEventListener("click", (event) => {
    if (event.target === helpDialog || event.target.closest("[data-help-close]")) closeHelp();
  });
  helpDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeHelp();
  });

  const paletteDialog = qs("#palette-dialog");
  paletteDialog?.addEventListener("click", (event) => {
    if (event.target === paletteDialog) closePalette();
  });
  paletteDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePalette();
  });
}

function bindHash() {
  window.addEventListener("popstate", () => applyRoute());
  window.addEventListener("hashchange", () => {
    // Anchor clicks inside the app are handled by the nav listener; this
    // covers manual URL edits and links from elsewhere.
    if (location.hash.startsWith("#show/")) applyRoute();
  });
}

function bindStorage() {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === watchlist.key || event.key === watchlist.legacyKey) {
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
    setOfflineBar(false);
    const kind = section === "recent" ? "recent" : "upcoming";
    if (schedules[kind].error || needsLoad(kind)) {
      loadSchedule(kind, { reset: true, force: true }).catch(() => {});
    }
  });

  window.addEventListener("offline", () => {
    setOfflineBar(true);
    showToast("You're offline — showing saved data.");
    render();
  });
}

function setOfflineBar(visible) {
  const bar = qs("#offline-bar");
  if (bar) bar.hidden = !visible;
  document.documentElement.dataset.online = visible ? "false" : "true";
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
      if (schedules[kind].events.length) refreshLoaded(kind).catch(() => {});
      else loadSchedule(kind).catch(() => {});
    }
  }, STALE_RELOAD_MS);

  busOn("watchlist:changed", () => {
    updateCounts(true);
    render();
  });

  // A notification clicked while this tab was open asks us to jump to a
  // title instead of opening a second window.
  navigator.serviceWorker?.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "OPEN_SHOW") return;
    const id = Number(data.mediaId);
    if (Number.isInteger(id) && id > 0) openShow(id);
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

/**
 * Prototype switch for the phone feature layout.
 * `?spotlight=text` renders the next-episode block text-first, with the
 * artwork as a strip underneath instead of a poster on top. It exists so
 * the two compositions can be measured and compared; the winner becomes
 * the default and this comes out.
 */
function applyLayoutFlags() {
  const requested = new URLSearchParams(location.search).get("spotlight");
  if (requested === "text" || requested === "poster") {
    document.documentElement.dataset.spotlight = requested;
  }
}

async function init() {
  applyLayoutFlags();
  initTheme();
  initToast();
  ctx = makeContext(false);

  // Warm both sheets once the app is interactive; a failure here only
  // means the first open pays the fetch.
  const warm = () => {
    loadDetail().catch(() => {});
    loadSettings().catch(() => {});
  };
  if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 2500 });
  else setTimeout(warm, 1200);
  initPalette({
    getCommands: paletteCommands,
    onRun: (item) => item.run?.(),
    onSearch: paletteSearch,
  });

  loadDetail().then((mod) => mod.setCloseHandler(() => {
    // Any close path (Escape, backdrop, button) leaves the detail route.
    if (history.state?.detail) history.back();
  }));

  enhanceSelects(document);
  observeSelects(document.body);

  bindChrome();
  bindHash();
  bindStorage();
  bindLifecycle();
  bindGestures();

  const appRoot = document.getElementById("app");
  appRoot?.addEventListener("click", onClick);
  appRoot?.addEventListener("change", onChange);
  appRoot?.addEventListener("input", (event) => {
    const field = event.target.closest("[data-progress-input]");
    if (field && section === "watchlist") return; // committed on change
  });

  appRoot?.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      img.classList.add("is-broken");
      const fallback = img.parentElement?.querySelector(".card__poster-fallback");
      if (fallback) fallback.hidden = false;
    },
    true
  );

  onScheduleChange((kind) => {
    pool.addAll(schedules[kind].events);
    const { updated, rescheduled } = syncFromEvents(schedules[kind].events);
    if (rescheduled) showToast("An airing time changed for a title you follow.");
    updateSyncStatus();

    if (query.trim()) return;
    const visible =
      (kind === "recent" && section === "recent") || (kind === "upcoming" && section !== "recent");
    if (!visible) return;

    const state = schedules[kind];
    if (state.loading && state.events.length) return;
    render();
    if (updated && section === "watchlist") render();
  });

  busOn("prefs:changed", () => {
    tickNow();
    render();
  });

  await Promise.all([restoreFromCache("upcoming"), restoreFromCache("recent")]);
  pool.addAll(schedules.upcoming.events);
  pool.addAll(schedules.recent.events);

  watchlist.read();
  if (watchlist.migratedFrom()) {
    showToast("Watchlist upgraded to the new format — nothing was lost.", 6000);
  }
  for (const item of watchlist.all()) {
    pool.addMedia({
      id: item.id,
      title: item.title,
      coverImage: item.coverImage,
      format: item.format,
      status: item.mediaStatus,
      episodes: item.episodes,
      duration: item.duration,
      averageScore: item.averageScore,
      genres: item.genres,
      synonyms: item.synonyms,
      nextAiringEpisode: item.nextAiringEpisode,
      type: "ANIME",
      isAdult: false,
    });
  }
  updateCounts();

  // Route first, so a #show/… deep link lands on the right title.
  const route = parseRoute(location.hash);
  if (!location.hash) history.replaceState({ section: "upcoming" }, "", "#upcoming");
  section = route.section && SECTIONS.includes(route.section) ? route.section : "upcoming";
  if (route.view === "calendar") upcoming.setView("calendar");

  features[section].onActivate?.(ctx);
  updateSyncStatus();
  setOfflineBar(!navigator.onLine);
  if (!interacted) {
    render();
    if (route.mediaId !== null) openShow(route.mediaId, { fromRoute: true });
    else applyRoute({ initial: true });
  }

  startClock(notifyCheck);
  notifyCheck();

  if (section !== "upcoming" && needsLoad("upcoming")) {
    loadSchedule("upcoming", { reset: true }).catch(() => {});
  }
  if (section !== "recent" && needsLoad("recent")) {
    loadSchedule("recent", { reset: true }).catch(() => {});
  }

  const problem = watchlist.storageProblem();
  if (problem) showToast(problem);
  const prefsProblem = prefsStore.warning();
  if (prefsProblem) showToast(prefsProblem, 6000);

  initPwa({
    onUpdateReady: (apply) => {
      showToast("A new version is ready.", {
        actionLabel: "Update",
        ms: 12000,
        onAction: apply,
      });
    },
    onControllerChange: () => window.location.reload(),
  });
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

/* Expose a tiny surface for tests and the console. */
window.__otaku = { openShow, navigate, render, get section() { return section; } };
