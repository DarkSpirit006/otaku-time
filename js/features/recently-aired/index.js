/* ============================================================
   Otaku Time — Recently aired section
   Reverse-chronological timeline grouped by day.
   Shows the full loaded history window, newest first.
   ============================================================ */

import { getSchedule, loadSchedule, needsLoad, attachSentinel, detachSentinel } from "../../services/schedule.js";
import { dayKey, dayLabel, isTodayOrTomorrow, timeAgo } from "../../utils/time.js";
import { timelineRow, dayGroup } from "../../components/card.js";
import { skeletonGrid, emptyState, notice, sectionHead } from "../../components/states.js";
import { paginationSummary } from "../../utils/schedule-core.js";
import { esc } from "../../utils/dom.js";

export function render(ctx) {
  const app = document.getElementById("app");
  detachSentinel();
  const state = getSchedule("recent");
  const prefs = ctx.prefs();
  // Newest first — the order AniList's TIME_DESC window arrives in.
  // Guard against clock skew: anything still in the future belongs to Upcoming.
  const horizon = Date.now() / 1000 + 90;
  const events = state.events
    .filter((event) => event.airingAt <= horizon)
    .sort((a, b) => b.airingAt - a.airingAt);

  // "8 episodes" reads as "there are eight", which is only true once the
  // history window is exhausted. Until then this is a loaded count.
  const summary = paginationSummary({
    loaded: state.events.length,
    more: state.more,
    page: state.page,
  });
  const head = sectionHead({
    eyebrow: "Schedule",
    title: "Recently aired",
    meta: state.syncedAt
      ? `${summary.label} · Synced ${esc(timeAgo(state.syncedAt / 1000))}`
      : summary.label,
    aside: "",
  });

  if (state.loading && !events.length) {
    app.innerHTML = `${head}${skeletonGrid(6)}`;
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

  if (!events.length) {
    app.innerHTML = `${head}${notice(state.error, state.error ? "danger" : "warning")}\n      <div class="${
      ctx.animate ? "view-enter" : ""
    }">${emptyState({
      icon: "clock",
      title: "Nothing aired recently",
      text: "The timeline fills in as episodes air.",
    })}</div>`;
    return;
  }

  // Group newest-first by day; keep reverse-chron order inside.
  const groups = new Map();
  for (const event of events) {
    const key = dayKey(event.airingAt * 1000, prefs.timezone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  const ordered = Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));

  const html = ordered
    .map(([key, list], groupIndex) => {
      const label = dayLabel(list[0].airingAt * 1000, prefs.timezone);
      const relative = isTodayOrTomorrow(key, prefs.timezone)
        ? new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            timeZone: prefs.timezone,
          }).format(new Date(list[0].airingAt * 1000))
        : "";
      // The newest episode of the newest day leads the rundown.
      const lede = groupIndex === 0;
      const rows = list
        .map((event, index) =>
          timelineRow(event, prefs, { index, lede: lede && index === 0 })
        )
        .join("");
      return dayGroup({
        key,
        label,
        relative,
        count: list.length,
        content: `<div class="timeline__list">${rows}</div>`,
        partial: state.loading && state.more,
      });
    })
    .join("");

  const sentinel = state.more
    ? `<div class="load-sentinel" id="load-sentinel" aria-hidden="true"></div>`
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

export function onActivate() {
  if (needsLoad("recent")) {
    loadSchedule("recent", { reset: getSchedule("recent").events.length > 0 }).catch(() => {});
  }
}
