/* ============================================================
   Otaku Time — Watchlist section
   Local data only: stats strip + tracked poster grid.
   ============================================================ */

import { watchlist } from "../../storage/watchlist.js";
import { watchlistCard } from "../../components/card.js";
import { emptyState, notice, sectionHead } from "../../components/states.js";
import { esc } from "../../utils/dom.js";

export const filters = { date: "all", format: "all", sort: "added" };

const DATE_OPTIONS = [
  ["all", "All time"],
  ["week", "Added this week"],
  ["recent", "Added recently"],
];

const SORT_OPTIONS = [
  ["added", "Recently added"],
  ["title", "Title"],
  ["progress", "Progress"],
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
    ${selectField({ id: "filter-date", label: "Added", options: DATE_OPTIONS, value: filters.date })}
    ${selectField({ id: "filter-sort", label: "Sort", options: SORT_OPTIONS, value: filters.sort })}
    <span class="filter-bar__count" id="filter-count">${count} title${count === 1 ? "" : "s"}</span>
  </div>`;
}

function applyFilters(items) {
  const now = Date.now();
  let list = items.filter((item) => {
    if (filters.date === "week") return now - item.createdAt <= 7 * 86400_000;
    if (filters.date === "recent") return now - item.createdAt <= 2 * 86400_000;
    return true;
  });

  if (filters.sort === "title") {
    list = list.slice().sort((a, b) =>
      (a.title.english || a.title.romaji || a.title.native || "").localeCompare(
        b.title.english || b.title.romaji || b.title.native || ""
      )
    );
  } else if (filters.sort === "progress") {
    list = list.slice().sort((a, b) => b.watched - a.watched || b.createdAt - a.createdAt);
  } else {
    list = list.slice().sort((a, b) => b.createdAt - a.createdAt);
  }
  return list;
}

function statsBlock(items) {
  const total = items.length;
  const completed = items.filter(
    (item) => Number.isInteger(item.episodes) && item.episodes > 0 && item.watched >= item.episodes
  ).length;
  const inProgress = items.filter((item) => item.watched > 0).length - completed;
  const episodes = items.reduce((sum, item) => sum + (Number.isInteger(item.watched) ? item.watched : 0), 0);

  return `<div class="stats" role="list" aria-label="Watchlist statistics">
    <div class="stat" role="listitem"><span class="stat__value">${total}</span><span class="stat__label">Titles tracked</span></div>
    <div class="stat" role="listitem"><span class="stat__value">${Math.max(0, inProgress)}</span><span class="stat__label">In progress</span></div>
    <div class="stat" role="listitem"><span class="stat__value">${completed}</span><span class="stat__label">Completed</span></div>
    <div class="stat" role="listitem"><span class="stat__value">${episodes}</span><span class="stat__label">Episodes watched</span></div>
  </div>`;
}

export function render(ctx) {
  const app = document.getElementById("app");
  const prefs = ctx.prefs();
  const all = watchlist.all();
  const storedProblem = watchlist.storageProblem();
  const filtered = applyFilters(all);

  const head = sectionHead({
    eyebrow: "Your library",
    title: "Watchlist",
    meta: all.length ? `Saved locally in this browser` : "",
    aside: all.length ? filterBar(filtered.length) : "",
  });

  if (watchlist.isCorrupt()) {
    app.innerHTML = `${head}${notice(storedProblem, "danger")}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${emptyState({
          icon: "bell",
          title: "Saved data needs attention",
          text: "Your existing file was left untouched. You can import a backup from Settings.",
          action: `<button class="btn btn--secondary" data-action="open-settings">Open settings</button>`,
        })}
      </div>`;
    return;
  }

  if (!all.length) {
    app.innerHTML = `${head}${storedProblem ? notice(storedProblem, "warning") : ""}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${emptyState({
          icon: "sparkle",
          title: "Your watchlist is empty",
          text: "Save shows from Upcoming or Recently aired and they'll live here — stored only in this browser.",
          action: `<button class="btn btn--primary" data-action="go-upcoming">Browse upcoming</button>`,
        })}
      </div>`;
    return;
  }

  if (!filtered.length) {
    app.innerHTML = `${head}${storedProblem ? notice(storedProblem, "warning") : ""}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${emptyState({
          icon: "search",
          title: "Nothing matches this filter",
          text: "No saved titles were added in that window.",
          action: `<button class="btn btn--ghost" data-action="clear-filters">Show everything</button>`,
        })}
      </div>`;
    return;
  }

  const cards = filtered
    .map(
      (item, index) =>
        watchlistCard(item, prefs).replace(
          "<article class=",
          `<article style="--stagger:${Math.min(index, 10)}" class=`
        )
    )
    .join("");

  app.innerHTML = `
    <div class="${ctx.animate ? "view-enter" : ""}">
      ${head}
      ${storedProblem ? notice(storedProblem, "warning") : ""}
      ${statsBlock(all)}
      <div class="card-grid${ctx.animate ? " stagger-in" : ""}">${cards}</div>
    </div>`;
}

export function handleFilter(type, value, ctx) {
  if (type in filters) filters[type] = value;
  (ctx.render ? ctx.render() : render(ctx));
}

export function handleAction(name, el, ctx) {
  if (name === "clear-filters") {
    filters.date = "all";
    filters.sort = "added";
    (ctx.render ? ctx.render() : render(ctx));
    return true;
  }
  if (name === "go-upcoming") {
    ctx.navigate?.("upcoming");
    return true;
  }
  if (name === "open-settings") {
    ctx.openSettings?.();
    return true;
  }
  return false;
}
