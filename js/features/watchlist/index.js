/* ============================================================
   Otaku Time — Watchlist

   A personal library, not a grid dump: status, progress and the
   next airing of everything you follow, with sorting, filtering,
   grouping and manual order.
   ============================================================ */

import { watchlist, LIST_STATUSES, LIST_STATUS_LABELS, progressCap } from "../../storage/watchlist.js";
import { watchlistCard } from "../../components/card.js";
import { emptyState, notice, sectionHead } from "../../components/states.js";
import { airingState, episodesBehind, progressPercent } from "../../utils/media-state.js";
import { esc } from "../../utils/dom.js";
import { icon } from "../../components/icons.js";
import { showToast } from "../../components/toast.js";
import { durationLabel } from "../../utils/format.js";

const SORTS = {
  added: { label: "Recently added", compare: (a, b) => b.createdAt - a.createdAt },
  updated: { label: "Recently updated", compare: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) },
  title: {
    label: "Title",
    compare: (a, b) => titleKey(a).localeCompare(titleKey(b), undefined, { sensitivity: "base" }),
  },
  airing: { label: "Airing soon", compare: (a, b) => airingRank(a) - airingRank(b) },
  progress: {
    label: "Progress",
    compare: (a, b) => (progressPercent(b) ?? -1) - (progressPercent(a) ?? -1),
  },
  manual: { label: "Manual order", compare: (a, b) => a.order - b.order || a.id - b.id },
};

function titleKey(item) {
  return item.title?.english || item.title?.romaji || item.title?.native || "";
}

function airingRank(item) {
  const state = airingState(item);
  if (state.kind === "countdown" && state.epoch) return state.epoch;
  if (state.kind === "airing") return Date.now() / 1000;
  return Number.MAX_SAFE_INTEGER;
}

export const state = {
  sort: "added",
  status: "all",
  format: "all",
  genre: "all",
  progress: "all",
  group: false,
};

/* ------------------------------------------------------------ */

/**
 * Four printed columns: titles, episodes logged, time spent, shows behind.
 *
 * Summing "episodes behind" across the shelf produced numbers that looked
 * authoritative and were not: a title whose episode count AniList has not
 * published has no reliable ceiling, so 87 + 156 + 6 read as "249 behind"
 * for a shelf of three shows that air weekly. Behindness is a per-show
 * fact here, so the column counts shows — and says so.
 */
function statsBlock(items) {
  const total = items.length;
  const episodes = items.reduce((sum, item) => sum + (Number.isInteger(item.watched) ? item.watched : 0), 0);
  const behind = items.filter((item) => (episodesBehind(item) || 0) > 0).length;

  // Time spent only counts what we can price: hours × watched episodes.
  const minutes = items.reduce((sum, item) => {
    const watched = Number.isInteger(item.watched) ? item.watched : 0;
    const duration = Number(item.duration);
    return sum + (watched > 0 && Number.isFinite(duration) && duration > 0 ? watched * duration : 0);
  }, 0);

  const stats = [
    { value: total, label: "Titles" },
    { value: episodes, label: "Episodes logged" },
    { value: minutes > 0 ? durationLabel(minutes) : "—", label: "Time spent" },
    { value: behind, label: "Behind schedule" },
  ];

  return `<div class="stats" role="list" aria-label="Watchlist statistics">
    ${stats
      .map(
        (stat) => `<div class="stat" role="listitem">
          <span class="stat__value">${stat.value}</span>
          <span class="stat__label">${stat.label}</span>
        </div>`
      )
      .join("")}
  </div>`;
}

function selectControl({ id, label, value, options }) {
  return `<div class="field">
    <label class="field__label" for="${id}">${esc(label)}</label>
    <select class="native-select" id="${id}" data-filter="${id}">
      ${options
        .map(
          (option) =>
            `<option value="${esc(option.value)}" ${option.value === value ? "selected" : ""}>${esc(option.label)}</option>`
        )
        .join("")}
    </select>
  </div>`;
}

function toolbar(all) {
  const formats = [...new Set(all.map((item) => item.format).filter(Boolean))].sort();
  const genres = [...new Set(all.flatMap((item) => item.genres || []))].sort();

  const statusChip = (value, label) =>
    `<button class="chip${state.status === value ? " is-active" : ""}" data-action="wl-status"
      data-value="${value}" aria-pressed="${state.status === value}">${esc(label)}</button>`;

  return `<div class="library-tools">
    <div class="library-tools__row">
      <div class="chips" role="group" aria-label="Filter by status">
        ${statusChip("all", "All")}
        ${LIST_STATUSES.map((status) => statusChip(status, LIST_STATUS_LABELS[status])).join("")}
      </div>
      <div class="library-tools__selects">
        ${selectControl({
          id: "sort",
          label: "Sort",
          value: state.sort,
          options: Object.entries(SORTS).map(([value, sort]) => ({ value, label: sort.label })),
        })}
        ${selectControl({
          id: "format",
          label: "Format",
          value: state.format,
          options: [
            { value: "all", label: "All formats" },
            ...formats.map((format) => ({ value: format, label: format.replace(/_/g, " ") })),
          ],
        })}
        ${selectControl({
          id: "genre",
          label: "Genre",
          value: state.genre,
          options: [
            { value: "all", label: "All genres" },
            ...genres.map((genre) => ({ value: genre, label: genre })),
          ],
        })}
        ${selectControl({
          id: "progress",
          label: "Progress",
          value: state.progress,
          options: [
            { value: "all", label: "Any progress" },
            { value: "unstarted", label: "Unstarted" },
            { value: "started", label: "In progress" },
            { value: "complete", label: "Complete" },
            { value: "behind", label: "Behind" },
          ],
        })}
      </div>
    </div>
    <div class="library-tools__row library-tools__row--sub">
      <button class="ghost-toggle${state.group ? " is-active" : ""}" data-action="wl-group"
        aria-pressed="${state.group}">${icon("layers")}<span>Group by status</span></button>
      <p class="library-tools__count" role="status"></p>
    </div>
  </div>`;
}

function matchesProgress(item) {
  const percent = progressPercent(item);
  switch (state.progress) {
    case "unstarted":
      return (item.watched || 0) === 0;
    case "started":
      return (item.watched || 0) > 0 && percent !== 100;
    case "complete":
      return percent === 100;
    case "behind":
      return (episodesBehind(item) || 0) > 0;
    default:
      return true;
  }
}

function applyFilters(items) {
  return items.filter((item) => {
    if (state.status !== "all" && item.listStatus !== state.status) return false;
    if (state.format !== "all" && item.format !== state.format) return false;
    if (state.genre !== "all" && !(item.genres || []).includes(state.genre)) return false;
    return matchesProgress(item);
  });
}

function cardGrid(items, prefs, { manual = false } = {}) {
  return `<div class="card-grid card-grid--library stagger-in">${items
    .map((item, index) =>
      watchlistCard(item, prefs).replace("<article class=\"card ", `<article data-index="${index}" class="card `)
    )
    .join("")}</div>`;
}

/** Up/down controls that make manual order usable without dragging. */
function manualBar(items) {
  return `<div class="manual-bar" role="group" aria-label="Manual order controls">
    ${items
      .map(
        (item, index) => `<div class="manual-bar__item">
          <span class="manual-bar__pos">${String(index + 1).padStart(2, "0")}</span>
          <span class="manual-bar__title">${esc(
            item.title?.english || item.title?.romaji || item.title?.native || "Untitled"
          )}</span>
          <button class="step-btn" data-action="move" data-id="${item.id}" data-delta="-1"
            aria-label="Move ${esc(titleKey(item))} up" ${index === 0 ? "disabled" : ""}>${icon("chevron-up")}</button>
          <button class="step-btn" data-action="move" data-id="${item.id}" data-delta="1"
            aria-label="Move ${esc(titleKey(item))} down" ${index === items.length - 1 ? "disabled" : ""}>${icon("chevron-down")}</button>
        </div>`
      )
      .join("")}
  </div>`;
}

/* ------------------------------------------------------------ */

export function render(ctx) {
  const app = document.getElementById("app");
  const prefs = ctx.prefs();
  const problem = watchlist.storageProblem();
  const all = watchlist.all().slice();

  const head = sectionHead({
    index: "02",
    title: "Watch",
    tail: "list",
    meta: all.length
      ? `${all.length} title${all.length === 1 ? "" : "s"} · stored in this browser only`
      : "",
    aside: `<button class="btn btn--ghost btn--sm" type="button" data-action="add-titles">+ Add titles</button>`,
  });

  if (watchlist.isCorrupt()) {
    app.innerHTML = `${head}${notice(problem, "danger")}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${emptyState({
          icon: "bell",
          title: "Saved data needs attention",
          text: "Your existing data was left untouched. You can restore a backup from Settings.",
          action: `<button class="btn btn--secondary" data-action="open-settings">Open settings</button>`,
        })}
      </div>`;
    return;
  }

  if (!all.length) {
    app.innerHTML = `${head}${problem ? notice(problem, "warning") : ""}
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

  const filtered = applyFilters(all);
  const sorted = filtered.slice().sort(SORTS[state.sort]?.compare || SORTS.added.compare);
  const manual = state.sort === "manual";

  let body;
  if (!filtered.length) {
    body = emptyState({
      icon: "search",
      title: "No titles match these filters",
      text: "Loosen a filter to see more of your library.",
      action: `<button class="btn btn--secondary" data-action="wl-reset">Clear filters</button>`,
    });
  } else if (state.group) {
    body = LIST_STATUSES.map((status) => {
      const group = sorted.filter((item) => item.listStatus === status);
      if (!group.length) return "";
      return `<section class="library-group" aria-labelledby="group-${status}">
        <header class="library-group__head">
          <h2 id="group-${status}">${esc(LIST_STATUS_LABELS[status])}</h2>
          <span>${group.length}</span>
        </header>
        ${cardGrid(group, prefs)}
      </section>`;
    }).join("");
    const unset = sorted.filter((item) => !item.listStatus);
    if (unset.length) {
      body += `<section class="library-group" aria-labelledby="group-none">
        <header class="library-group__head"><h2 id="group-none">No status</h2><span>${unset.length}</span></header>
        ${cardGrid(unset, prefs)}
      </section>`;
    }
  } else {
    body = `${manual ? manualBar(sorted) : ""}${cardGrid(sorted, prefs, { manual })}`;
  }

  app.innerHTML = `
    <div class="${ctx.animate ? "view-enter" : ""}">
      ${head}
      ${problem ? notice(problem, "warning") : ""}
      ${statsBlock(all)}
      ${toolbar(all)}
      <p class="library-count">Showing <strong>${filtered.length}</strong> of ${all.length}</p>
      ${body}
    </div>`;
}

/* ------------------------------------------------------------ */

export function handleAction(name, el, ctx) {
  if (name === "go-upcoming") {
    ctx.navigate?.("upcoming");
    return true;
  }
  if (name === "open-settings") {
    ctx.openSettings?.();
    return true;
  }
  if (name === "wl-status") {
    const value = el.dataset.value;
    state.status = state.status === value && value !== "all" ? "all" : value;
    ctx.render();
    return true;
  }
  if (name === "wl-group") {
    state.group = !state.group;
    ctx.render();
    return true;
  }
  if (name === "wl-reset") {
    state.status = "all";
    state.format = "all";
    state.genre = "all";
    state.progress = "all";
    ctx.render();
    return true;
  }
  if (name === "move") {
    watchlist.move(Number(el.dataset.id), Number(el.dataset.delta));
    ctx.render();
    return true;
  }
  return false;
}

/** Select and input filters inside the section. */
/**
 * The episode field on a saved card. Typing a number and pressing Enter (or
 * leaving the field) commits it — the field exists precisely so a viewer can
 * jump to episode 9 instead of tapping +1 nine times.
 *
 * Returns false when the field is not a progress input, so the caller can
 * carry on with the filter selects.
 */
function commitProgress(input, ctx) {
  const id = Number(input.dataset.id);
  const item = watchlist.find(id);
  if (!item) return false;

  const typed = Number.parseInt(input.value, 10);
  if (!Number.isFinite(typed)) {
    // Garbage in the field is not a command: restore what is stored.
    input.value = String(item.watched);
    return true;
  }

  if (watchlist.setWatched(id, typed)) {
    const stored = watchlist.find(id);
    const { cap, source } = progressCap(stored);
    // The input is not repainted until the section re-renders, so it has to
    // be corrected here or it keeps showing the number the store rejected.
    input.value = String(stored.watched);
    if (typed > cap) {
      showToast(
        source === "aired"
          ? `Progress capped at episode ${cap} — AniList hasn't published a total yet.`
          : `Progress capped at episode ${cap}.`
      );
    }
    ctx.render();
  }
  return true;
}

export function handleChange(event, ctx) {
  const progress = event.target.closest("[data-progress-input]");
  if (progress) {
    if (commitProgress(progress, ctx)) return true;
  }

  const field = event.target.closest("[data-filter]");
  if (!field) return false;
  const key = field.dataset.filter;
  if (key === "sort") state.sort = field.value;
  else if (key === "format") state.format = field.value;
  else if (key === "genre") state.genre = field.value;
  else if (key === "progress") state.progress = field.value;
  else return false;
  ctx.render();
  return true;
}
