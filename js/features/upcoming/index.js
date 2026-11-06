/* ============================================================
   Otaku Time — Upcoming

   Two views of the same data:
     Timeline  editorial day groups, lead panels, lineup grid
     Calendar  a seven-day week board with a live time marker

   The calendar is a secondary view inside this section; both read
   the same loaded schedule and never invent data beyond it.
   ============================================================ */

import {
  getSchedule,
  loadSchedule,
  needsLoad,
  attachSentinel,
  detachSentinel,
  scheduleSummary,
} from "../../services/schedule.js";
import { dayKey, dayLabel, isTodayOrTomorrow, timeAgo } from "../../utils/time.js";
import {
  addDays,
  bucketByDay,
  dayNumber,
  minutesIntoDay,
  startOfWeek,
  weekKeys,
  weekLabel,
  weekdayLabel,
} from "../../utils/calendar.js";
import { eventCard, dayGroup, spotlight, leadStrip, timelineRow } from "../../components/card.js";
import { skeletonGrid, skeletonCalendar, emptyState, notice, sectionHead } from "../../components/states.js";
import { watchlist } from "../../storage/watchlist.js";
import { esc } from "../../utils/dom.js";
import { icon } from "../../components/icons.js";
import { buildCalendar, icsFileName } from "../../utils/ics.js";
import { offerUndo } from "../../services/undo.js";
import { showToast } from "../../components/toast.js";

const VIEWS = ["timeline", "calendar"];

export const state = {
  view: "timeline",
  weekOffset: 0,
  filters: { mine: false, format: "all", genre: "all" },
};

/** External navigation (router / command palette) can switch the view. */
export function setView(view) {
  state.view = VIEWS.includes(view) ? view : "timeline";
}

export function currentView() {
  return state.view;
}

/* ------------------------------------------------------------ */

function viewSwitch() {
  const button = (value, label, iconName) =>
    `<button class="seg-btn${state.view === value ? " is-active" : ""}" data-action="set-view"
      data-view="${value}" aria-pressed="${state.view === value}">${icon(iconName)}<span>${label}</span></button>`;
  return `<div class="seg" role="group" aria-label="Upcoming view">
    ${button("timeline", "Timeline", "list")}
    ${button("calendar", "Calendar", "calendar")}
  </div>`;
}

function groupByDay(events, prefs) {
  const groups = new Map();
  for (const event of events) {
    const key = dayKey(event.airingAt * 1000, prefs.timezone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function relativeLabel(key, prefs) {
  if (!isTodayOrTomorrow(key, prefs.timezone)) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: prefs.timezone,
  }).format(new Date(`${key}T12:00:00Z`));
}

/* ------------------------------------------------------------
   Timeline
   ------------------------------------------------------------ */

function renderTimeline(events, state_, prefs, ctx) {
  const summary = scheduleSummary("upcoming");
  const groups = groupByDay(events, prefs);
  const todayKey = dayKey(Date.now(), prefs.timezone);
  const nowSeconds = Date.now() / 1000;
  const boundaryKey = state_.more && groups.length ? groups[groups.length - 1][0] : null;

  const groupsHtml = groups
    .map(([key, list]) => {
      const label = dayLabel(list[0].airingAt * 1000, prefs.timezone);
      const relative = relativeLabel(key, prefs);

      const cards = (subset) =>
        `<div class="card-grid${ctx.animate ? " stagger-in" : ""}">${subset
          .map((event) => eventCard(event, prefs))
          .join("")}</div>`;

      const leadCount = list.length >= 5 ? 2 : list.length >= 2 ? 1 : 0;
      let content;

      if (key === todayKey) {
        const past = list.filter((event) => event.airingAt < nowSeconds).reverse();
        const future = list.filter((event) => event.airingAt >= nowSeconds);
        const futureLeadCount = future.length >= 5 ? 2 : future.length >= 2 ? 1 : 0;
        const lead = future.length ? leadStrip(future.slice(0, futureLeadCount), prefs) : "";
        const rest = future.slice(futureLeadCount);
        const pastBlock = past.length
          ? `<div class="today-past">
               <p class="today-past__label">Aired earlier today</p>
               <div class="timeline__list">${past.map((event) => timelineRow(event, prefs)).join("")}</div>
             </div>
             <div class="now-divider" aria-hidden="true"><span>Now</span></div>`
          : "";
        content = `${pastBlock}${lead}${rest.length ? cards(rest) : ""}`;
        if (!future.length) {
          content = `${pastBlock}<p class="day-group__empty">Nothing else airs today.</p>`;
        }
      } else {
        const lead = leadCount ? leadStrip(list.slice(0, leadCount), prefs) : "";
        const rest = list.slice(leadCount);
        content = `${lead}${rest.length ? cards(rest) : ""}`;
      }

      return dayGroup({
        key,
        label,
        relative,
        count: list.length,
        content,
        partial: key === boundaryKey,
      });
    })
    .join("");

  const sentinel = state_.more
    ? `<div class="load-sentinel" id="load-sentinel" aria-hidden="true"></div>`
    : `<p class="loading-more">Full schedule window loaded — ${summary.label.replace(" loaded · full window", "")} episodes.</p>`;

  return `${groupsHtml}${sentinel}`;
}

/* ------------------------------------------------------------
   Calendar
   ------------------------------------------------------------ */

function filterEvents(events, filters) {
  return events.filter((event) => {
    const media = event.media;
    if (filters.mine && !watchlist.has(media.id)) return false;
    if (filters.format !== "all" && media.format !== filters.format) return false;
    if (filters.genre !== "all" && !(media.genres || []).includes(filters.genre)) return false;
    return true;
  });
}

function calendarFilters(allEvents) {
  const formats = [...new Set(allEvents.map((event) => event.media.format).filter(Boolean))].sort();
  const genreCounts = new Map();
  for (const event of allEvents) {
    for (const genre of event.media.genres || []) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }
  const genres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([genre]) => genre);

  const chip = (name, value, label, active) =>
    `<button class="chip${active ? " is-active" : ""}" data-action="cal-filter"
      data-filter="${name}" data-value="${esc(value)}" aria-pressed="${active}">${esc(label)}</button>`;

  return `<div class="cal-filters">
    <div class="chips" role="group" aria-label="Calendar filters">
      ${chip("mine", "1", "My shows", state.filters.mine)}
      <span class="chips__divider" aria-hidden="true"></span>
      ${chip("format", "all", "All formats", state.filters.format === "all")}
      ${formats.map((format) => chip("format", format, format.replace(/_/g, " "), state.filters.format === format)).join("")}
      ${
        genres.length
          ? `<span class="chips__divider" aria-hidden="true"></span>
             ${chip("genre", "all", "All genres", state.filters.genre === "all")}
             ${genres.map((genre) => chip("genre", genre, genre, state.filters.genre === genre)).join("")}`
          : ""
      }
    </div>
  </div>`;
}

function renderCalendar(events, state_, prefs, ctx) {
  const nowMs = Date.now();
  const weekStartsOn = Number.isInteger(prefs.weekStartsOn) ? prefs.weekStartsOn : 1;
  const thisWeek = startOfWeek(nowMs, prefs.timezone, weekStartsOn);
  const startKey = addDays(thisWeek, state.weekOffset * 7);
  const keys = weekKeys(startKey, 7);
  const endKey = keys[keys.length - 1];

  const filtered = filterEvents(events, state.filters);
  const buckets = bucketByDay(filtered, prefs.timezone);
  const nowMinutes = minutesIntoDay(nowMs, prefs.timezone);
  const todayKey = dayKey(nowMs, prefs.timezone);

  const nav = `<div class="cal-nav">
    <button class="icon-btn" data-action="cal-week" data-delta="-1" aria-label="Previous week"
      ${state.weekOffset <= 0 ? "disabled" : ""}>${icon("chevron-left")}</button>
    <p class="cal-nav__label">
      <span class="cal-nav__range">${esc(weekLabel(startKey, endKey))}</span>
      <span class="cal-nav__tz">${esc(prefs.timezone.replace(/_/g, " "))}</span>
    </p>
    <button class="icon-btn" data-action="cal-week" data-delta="1" aria-label="Next week"
      ${state.weekOffset >= 4 ? "disabled" : ""}>${icon("chevron-right")}</button>
    <button class="btn btn--ghost btn--sm" data-action="cal-today" ${state.weekOffset === 0 ? "disabled" : ""}>This week</button>
    <button class="btn btn--ghost btn--sm" data-action="export-week">
      ${icon("download")}<span>Export week</span>
    </button>
  </div>`;

  const columns = keys
    .map((key) => {
      const list = buckets.get(key) || [];
      const isToday = key === todayKey;
      let markerShown = false;

      const slots = list
        .map((event) => {
          const minutes = minutesIntoDay(event.airingAt * 1000, prefs.timezone);
          const time = new Intl.DateTimeFormat(undefined, {
            timeZone: prefs.timezone,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: prefs.hour12 ? "h12" : "h23",
          }).format(new Date(event.airingAt * 1000));
          const title = event.media.title?.english || event.media.title?.romaji || "Untitled";
          const poster = event.media.coverImage?.medium || event.media.coverImage?.large;
          let nowLine = "";
          if (isToday && !markerShown && minutes >= nowMinutes) {
            markerShown = true;
            nowLine = `<div class="cal-now" aria-hidden="true"><span>Now</span></div>`;
          }
          // No aria-label: the slot's own text is its accessible name, so
          // what a screen reader announces matches what is on screen.
          return `${nowLine}<button class="cal-slot" data-action="detail" data-id="${event.media.id}">
              <span class="cal-slot__time">${esc(time)}</span>
              ${
                poster
                  ? `<img class="cal-slot__poster" src="${esc(poster)}" alt="" width="34" height="48" loading="lazy" decoding="async" data-blur-up />`
                  : `<span class="cal-slot__poster cal-slot__poster--empty" aria-hidden="true"></span>`
              }
              <span class="cal-slot__body">
                <span class="cal-slot__title">${esc(title)}</span>
                <span class="cal-slot__meta">Episode ${event.episode}${
                  watchlist.has(event.media.id) ? ` · ${icon("check", "cal-slot__saved")}` : ""
                }</span>
              </span>
            </button>`;
        })
        .join("");


      return `<div class="cal-day${isToday ? " is-today" : ""}${list.length ? "" : " is-empty"}" data-day="${key}">
        <header class="cal-day__head">
          <span class="cal-day__name">${esc(weekdayLabel(key, prefs.timezone))}</span>
          <span class="cal-day__num">${dayNumber(key)}</span>
          ${list.length ? `<span class="cal-day__count">${list.length}</span>` : ""}
        </header>
        <div class="cal-day__slots">
          ${slots || `<p class="cal-day__empty">—</p>`}
          ${
            isToday && !markerShown
              ? `<div class="cal-now cal-now--end" aria-hidden="true"><span>Now</span></div>`
              : ""
          }
        </div>
      </div>`;
    })
    .join("");

  return `${nav}${calendarFilters(events)}<div class="cal">${columns}</div>`;
}

/* ------------------------------------------------------------
   Section
   ------------------------------------------------------------ */

export function render(ctx) {
  const app = document.getElementById("app");
  detachSentinel();
  const scheduled = getSchedule("upcoming");
  const prefs = ctx.prefs();
  const events = scheduled.events.slice().sort((a, b) => a.airingAt - b.airingAt);
  const summary = scheduleSummary("upcoming");

  const meta = [
    summary.label,
    scheduled.syncedAt ? `synced ${timeAgo(scheduled.syncedAt / 1000)}` : "not synced yet",
    scheduled.source === "cache" ? "from cache" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const head = sectionHead({
    eyebrow: "Schedule",
    title: "Up",
    tail: "coming",
    meta,
    aside: viewSwitch(),
  });

  if (scheduled.loading && !events.length) {
    app.innerHTML = `<div class="view-enter">${head}${skeletonGrid(8)}</div>`;
    return;
  }

  if (scheduled.error && !events.length) {
    app.innerHTML = `${head}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${notice(scheduled.error, "danger")}
        ${emptyState({
          icon: "calendar",
          title: "Couldn't load the schedule",
          text: "AniList is unreachable right now. Your saved shows are unaffected.",
          action: `<button class="btn btn--primary" data-action="retry">Try again</button>`,
        })}
      </div>`;
    return;
  }

  if (!events.length) {
    app.innerHTML = `${head}${notice(scheduled.warning, scheduled.warning ? "warning" : "")}
      <div class="${ctx.animate ? "view-enter" : ""}">${emptyState({
        icon: "calendar",
        title: "Nothing scheduled yet",
        text: "The schedule will appear as soon as AniList responds.",
        action: `<button class="btn btn--secondary" data-action="retry">Load schedule</button>`,
      })}</div>`;
    return;
  }

  const nextUp =
    events.find((event) => event.airingAt >= Date.now() / 1000 - 120) || events[0] || null;

  const body =
    state.view === "calendar"
      ? renderCalendar(events, scheduled, prefs, ctx)
      : renderTimeline(events, scheduled, prefs, ctx);

  app.innerHTML = `
    <div class="${ctx.animate ? "view-enter" : ""}">
      ${head}
      ${notice(scheduled.error, "danger")}
      ${notice(scheduled.warning, "warning")}
      ${
        state.view === "timeline" && nextUp
          ? spotlight(nextUp, prefs, { saved: watchlist.has(nextUp.media.id) })
          : ""
      }
      ${body}
    </div>`;

  const sentinelEl = document.getElementById("load-sentinel");
  if (sentinelEl) attachSentinel(sentinelEl, "upcoming");
}

/* ------------------------------------------------------------
   Actions
   ------------------------------------------------------------ */

/** Download an .ics for every known airing this week. */
function exportWeek(prefs) {
  const scheduled = getSchedule("upcoming");
  const weekStartsOn = Number.isInteger(prefs.weekStartsOn) ? prefs.weekStartsOn : 1;
  const startKey = addDays(startOfWeek(Date.now(), prefs.timezone, weekStartsOn), state.weekOffset * 7);
  const keys = new Set(weekKeys(startKey, 7));
  const events = filterEvents(scheduled.events, state.filters).filter((event) =>
    keys.has(dayKey(event.airingAt * 1000, prefs.timezone))
  );

  if (!events.length) {
    showToast("No episodes match this week's filters.");
    return;
  }

  const { content, count } = buildCalendar({
    events,
    reminderMinutes: prefs.reminder,
    calendarName: "Otaku Time — this week",
  });

  downloadFile(content, icsFileName("watchlist", "week"), "text/calendar");
  showToast(
    `Exported ${count} episode${count === 1 ? "" : "s"} from this week${
      state.filters.mine ? " (your shows only)" : ""
    }.`
  );
}

/** Shared blob download (used by ICS exports elsewhere too). */
export function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function handleAction(name, el, ctx) {
  if (name === "set-view") {
    setView(el.dataset.view);
    ctx.render();
    return true;
  }
  if (name === "cal-week") {
    const delta = Number(el.dataset.delta) || 0;
    state.weekOffset = Math.min(4, Math.max(0, state.weekOffset + delta));
    ctx.render();
    return true;
  }
  if (name === "cal-today") {
    state.weekOffset = 0;
    ctx.render();
    return true;
  }
  if (name === "cal-filter") {
    const filter = el.dataset.filter;
    const value = el.dataset.value;
    if (filter === "mine") state.filters.mine = !state.filters.mine;
    else if (filter === "format" || filter === "genre") state.filters[filter] = value;
    ctx.render();
    return true;
  }
  if (name === "export-week") {
    exportWeek(ctx.prefs());
    return true;
  }
  return false;
}

export function onActivate() {
  if (needsLoad("upcoming")) {
    loadSchedule("upcoming", { reset: getSchedule("upcoming").events.length > 0 }).catch(() => {});
  }
}
