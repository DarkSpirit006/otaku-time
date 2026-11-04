/* ============================================================
   Otaku Time — Recently aired section
   Reverse-chronological timeline grouped by day.
   ============================================================ */

import { getSchedule, loadSchedule, needsLoad, attachSentinel, detachSentinel } from "../../services/schedule.js";
import { dayKey, dayLabel, isTodayOrTomorrow, timeAgo } from "../../utils/time.js";
import { timelineRow, dayGroup } from "../../components/card.js";
import { skeletonGrid, emptyState, notice, sectionHead } from "../../components/states.js";
import { esc } from "../../utils/dom.js";

export const filters = { date: "48h", format: "all", sort: "time" };

const DATE_OPTIONS = [
  ["24h", "Last 24 hours"],
  ["48h", "Last 48 hours"],
  ["7d", "Last 7 days"],
  ["all", "Everything"],
];

const FORMAT_OPTIONS = [
  ["all", "All formats"],
  ["TV", "TV"],
  ["MOVIE", "Movie"],
  ["OVA", "OVA"],
  ["ONA", "ONA"],
  ["SPECIAL", "Special"],
];

const SORT_OPTIONS = [
  ["time", "Newest first"],
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
    ${selectField({ id: "filter-date", label: "Window", options: DATE_OPTIONS, value: filters.date })}
    ${selectField({ id: "filter-format", label: "Format", options: FORMAT_OPTIONS, value: filters.format })}
    ${selectField({ id: "filter-sort", label: "Sort", options: SORT_OPTIONS, value: filters.sort })}
    <span class="filter-bar__count" id="filter-count">${count} episode${count === 1 ? "" : "s"}</span>
  </div>`;
}

function applyFilters(events, prefs) {
  const now = Date.now() / 1000;
  let list = events.filter((event) => {
    if (filters.format !== "all" && event.media.format !== filters.format) return false;
    switch (filters.date) {
      case "24h":
        return event.airingAt >= now - 86400 && event.airingAt <= now;
      case "48h":
        return event.airingAt >= now - 2 * 86400 && event.airingAt <= now;
      case "7d":
        return event.airingAt >= now - 7 * 86400 && event.airingAt <= now;
      case "all":
      default:
        return true;
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
    list = list.slice().sort((a, b) => b.airingAt - a.airingAt);
  }
  return list;
}

export function render(ctx) {
  const app = document.getElementById("app");
  detachSentinel();
  const state = getSchedule("recent");
  const prefs = ctx.prefs();
  const events = state.events;
  const filtered = applyFilters(events, prefs);

  const head = sectionHead({
    eyebrow: "Schedule",
    title: "Recently aired",
    meta: state.syncedAt ? `Synced ${esc(timeAgo(state.syncedAt / 1000))}` : "",
    aside: events.length ? filterBar(filtered.length) : "",
  });

  if (state.loading && !events.length) {
    app.innerHTML = `${head}<div class="${ctx.animate ? "view-enter" : ""}">${skeletonGrid(6)}</div>`;
    return;
  }

  if (state.error && !events.length) {
    app.innerHTML = `${head}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${notice(state.error, "danger")}
        ${emptyState({
          icon: "clock",
          title: "Couldn't load recent episodes",
          text: "AniList is unreachable right now. Nothing was lost — try again in a moment.",
          action: `<button class="btn btn--primary" data-action="retry">Try again</button>`,
        })}
      </div>`;
    return;
  }

  if (!filtered.length) {
    app.innerHTML = `${head}${notice(state.error, state.error ? "danger" : "warning")}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${emptyState({
          icon: "clock",
          title: events.length ? "No episodes in this window" : "Nothing aired recently",
          text: events.length
            ? "Widen the time window to see more."
            : "The timeline fills in as episodes air.",
          action: `<button class="btn btn--ghost" data-action="clear-filters">Reset filters</button>`,
        })}
      </div>`;
    return;
  }

  // Group newest-first by day; keep reverse-chron order inside.
  const groups = new Map();
  for (const event of filtered) {
    const key = dayKey(event.airingAt * 1000, prefs.timezone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  const ordered = Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));

  let staggerIndex = 0;
  const html = ordered
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
      const rows = list
        .map((event) =>
          timelineRow(event, prefs).replace(
            "<article class=",
            `<article style="--stagger:${Math.min(staggerIndex++, 10)}" class=`
          )
        )
        .join("");
      return dayGroup({
        key,
        label,
        relative,
        count: list.length,
        content: `<div class="timeline__list">${rows}</div>`,
      });
    })
    .join("");

  const sentinel = state.more
    ? `<div class="load-sentinel" id="load-sentinel" aria-hidden="true"><span class="load-spinner"></span></div>`
    : `<p class="loading-more">End of the available history window.</p>`;

  app.innerHTML = `
    <div class="timeline ${ctx.animate ? "view-enter" : ""}">
      ${head}
      ${notice(state.error, state.error ? "danger" : "warning")}
      ${state.warning ? notice(state.warning, "warning") : ""}
      ${html}
      ${sentinel}
    </div>`;

  const sentinelEl = document.getElementById("load-sentinel");
  if (sentinelEl) attachSentinel(sentinelEl, "recent");
}

export function handleFilter(type, value, ctx) {
  if (type in filters) filters[type] = value;
  (ctx.render ? ctx.render() : render(ctx));
  ctx.announce?.(`Filter updated: ${value}`);
}

export function handleAction(name, el, ctx) {
  if (name === "clear-filters") {
    filters.date = "48h";
    filters.format = "all";
    filters.sort = "time";
    (ctx.render ? ctx.render() : render(ctx));
    return true;
  }
  return false;
}

export function onActivate() {
  if (needsLoad("recent")) {
    loadSchedule("recent", { reset: getSchedule("recent").events.length > 0 }).catch(() => {});
  }
}
