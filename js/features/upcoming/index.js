/* ============================================================
   Otaku Time — Upcoming section
   Spotlight (next episode) + date-grouped poster grid.
   ============================================================ */

import { getSchedule, loadSchedule, needsLoad, attachSentinel, detachSentinel } from "../../services/schedule.js";
import { dayKey, dayLabel, isTodayOrTomorrow, nextDayKey, timeAgo } from "../../utils/time.js";
import { eventCard, dayGroup, spotlight } from "../../components/card.js";
import { skeletonGrid, emptyState, notice, sectionHead } from "../../components/states.js";
import { watchlist } from "../../storage/watchlist.js";
import { icon } from "../../components/icons.js";
import { esc } from "../../utils/dom.js";

export const filters = { date: "week", format: "all", sort: "time" };

const DATE_OPTIONS = [
  ["week", "Next 7 days"],
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["24h", "Next 24 hours"],
  ["all", "Everything"],
];

const FORMAT_OPTIONS = [
  ["all", "All formats"],
  ["TV", "TV"],
  ["MOVIE", "Movie"],
  ["OVA", "OVA"],
  ["ONA", "ONA"],
  ["SPECIAL", "Special"],
  ["TV_SHORT", "TV short"],
  ["MUSIC", "Music"],
];

const SORT_OPTIONS = [
  ["time", "Air time"],
  ["title", "Title"],
  ["score", "Score"],
];

function selectField({ id, label, options, value }) {
  const opts = options
    .map(([val, text]) => `<option value="${esc(val)}"${val === value ? " selected" : ""}>${esc(text)}</option>`)
    .join("");
  return `<div class="filter">
    <span class="filter__label" id="${id}-label">${esc(label)}</span>
    <select id="${id}" class="native-select" data-filter="${id.replace("filter-", "")}" aria-labelledby="${id}-label">${opts}</select>
  </div>`;
}

function filterBar(count) {
  return `<div class="filter-bar" role="group" aria-label="Filters">
    ${selectField({ id: "filter-date", label: "Date", options: DATE_OPTIONS, value: filters.date })}
    ${selectField({ id: "filter-format", label: "Format", options: FORMAT_OPTIONS, value: filters.format })}
    ${selectField({ id: "filter-sort", label: "Sort", options: SORT_OPTIONS, value: filters.sort })}
    <span class="filter-bar__count" id="filter-count">${count} episode${count === 1 ? "" : "s"}</span>
  </div>`;
}

/** Apply the current filters to the schedule events. */
function applyFilters(events, prefs) {
  const now = Date.now() / 1000;
  const nowMs = Date.now();
  const zone = prefs.timezone;

  let list = events.filter((event) => {
    if (filters.format !== "all" && event.media.format !== filters.format) return false;
    switch (filters.date) {
      case "today":
        return dayKey(event.airingAt * 1000, zone) === dayKey(nowMs, zone);
      case "tomorrow":
        return dayKey(event.airingAt * 1000, zone) === nextDayKey(nowMs, zone);
      case "24h":
        return event.airingAt >= now && event.airingAt <= now + 86400;
      case "all":
        return true;
      case "week":
      default:
        return event.airingAt >= now - 3 * 3600 && event.airingAt <= now + 7 * 86400;
    }
  });

  if (filters.sort === "title") {
    list = list.slice().sort((a, b) =>
      (a.media.title.english || a.media.title.romaji || "").localeCompare(
        b.media.title.english || b.media.title.romaji || ""
      )
    );
  } else if (filters.sort === "score") {
    list = list.slice().sort((a, b) => (b.media.averageScore ?? -1) - (a.media.averageScore ?? -1));
  } else {
    list = list.slice().sort((a, b) => a.airingAt - b.airingAt);
  }
  return list;
}

/** Group events by calendar day (sorted groups, chronological within). */
function groupByDay(events, prefs) {
  const groups = new Map();
  for (const event of events) {
    const key = dayKey(event.airingAt * 1000, prefs.timezone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export function render(ctx) {
  const app = document.getElementById("app");
  detachSentinel();
  const state = getSchedule("upcoming");
  const prefs = ctx.prefs();
  const events = state.events;

  const head = sectionHead({
    eyebrow: "Schedule",
    title: "Upcoming",
    meta: state.syncedAt
      ? `Synced ${esc(timeAgo(state.syncedAt / 1000))}${state.source === "cache" ? " · from cache" : ""}`
      : "",
    aside: filterBar(applyFilters(events, prefs).length),
  });

  // First paint: skeleton until we have something to show.
  if (state.loading && !events.length) {
    app.innerHTML = `${head}${notice(state.error || "", "danger")}<div class="${ctx.animate ? "view-enter" : ""}">${skeletonGrid(8)}</div>`;
    return;
  }

  if (state.error && !events.length) {
    app.innerHTML = `${head}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${notice(state.error, "danger")}
        ${emptyState({
          icon: "calendar",
          title: "Couldn't load the schedule",
          text: "AniList is unreachable right now. Your saved shows are unaffected.",
          action: `<button class="btn btn--primary" data-action="retry">Try again</button>`,
        })}
      </div>`;
    return;
  }

  const filtered = applyFilters(events, prefs);
  const nowSeconds = Date.now() / 1000;

  if (!filtered.length) {
    const emptyCopy =
      events.length === 0
        ? {
            icon: "calendar",
            title: "Nothing scheduled yet",
            text: "The schedule will appear as soon as AniList responds.",
          }
        : filters.date === "today"
          ? { icon: "calendar", title: "No episodes today", text: "Try widening the date filter." }
          : filters.date === "tomorrow"
            ? { icon: "calendar", title: "Nothing airs tomorrow", text: "Try widening the date filter." }
            : { icon: "search", title: "No episodes match", text: "Adjust the date or format filter." };
    app.innerHTML = `${head}${notice(state.error, state.error ? "danger" : "warning")}${state.warning ? notice(state.warning, "warning") : ""}
      <div class="${ctx.animate ? "view-enter" : ""}">${emptyState({ ...emptyCopy, action: `<button class="btn btn--ghost" data-action="clear-filters">Clear filters</button>` })}</div>`;
    return;
  }

  // Spotlight = the next episode at/after now (falls back to first filtered).
  const nextUp =
    filtered.find((event) => event.airingAt >= nowSeconds - 120) ||
    filtered.find((event) => event.airingAt >= nowSeconds - 3600) ||
    null;

  const spotlightHtml = nextUp
    ? spotlight(nextUp, prefs, { saved: watchlist.has(nextUp.media.id) })
    : "";

  const groups = groupByDay(filtered, prefs);
  const todayKey = dayKey(Date.now(), prefs.timezone);
  let staggerIndex = 0;

  const groupsHtml = groups
    .map(([key, list]) => {
      const label = dayLabel(list[0].airingAt * 1000, prefs.timezone);
      const relative = isTodayOrTomorrow(key, prefs.timezone)
        ? new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            timeZone: prefs.timezone,
          }).format(new Date(list[0].airingAt * 1000))
        : "";

      const cards = (subset) =>
        `<div class="card-grid${ctx.animate ? " stagger-in" : ""}">${subset
          .map((event) => {
            const html = eventCard(event, prefs);
            return html.replace(
              "<article class=",
              `<article style="--stagger:${Math.min(staggerIndex++, 10)}" class=`
            );
          })
          .join("")}</div>`;

      let content;
      if (key === todayKey) {
        const past = list.filter((event) => event.airingAt < nowSeconds);
        const future = list.filter((event) => event.airingAt >= nowSeconds);
        if (past.length && future.length) {
          content = `${cards(past)}<div class="now-divider"><span>Now</span></div>${cards(future)}`;
        } else {
          content = cards(list);
        }
      } else {
        content = cards(list);
      }

      return dayGroup({ key, label, relative, count: list.length, content });
    })
    .join("");

  const sentinel = state.more
    ? `<div class="load-sentinel" id="load-sentinel" aria-hidden="true"><span class="load-spinner"></span></div>`
    : `<p class="loading-more">End of the current schedule window.</p>`;

  app.innerHTML = `
    <div class="${ctx.animate ? "view-enter" : ""}">
      ${head}
      ${notice(state.error, state.error ? "danger" : "warning")}
      ${state.warning ? notice(state.warning, "warning") : ""}
      ${spotlightHtml}
      ${groupsHtml}
      ${sentinel}
    </div>`;

  const sentinelEl = document.getElementById("load-sentinel");
  if (sentinelEl) attachSentinel(sentinelEl, "upcoming");
}

export function handleFilter(type, value, ctx) {
  if (type in filters) filters[type] = value;
  (ctx.render ? ctx.render() : render(ctx));
  ctx.announce?.(`Filter updated: ${value}`);
}

export function handleAction(name, el, ctx) {
  if (name === "clear-filters") {
    filters.date = "week";
    filters.format = "all";
    filters.sort = "time";
    (ctx.render ? ctx.render() : render(ctx));
    return true;
  }
  return false;
}

export function onActivate() {
  if (needsLoad("upcoming")) {
    loadSchedule("upcoming", { reset: getSchedule("upcoming").events.length > 0 }).catch(() => {});
  }
}
