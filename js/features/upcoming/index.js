/* ============================================================
   Otaku Time — Upcoming section
   Spotlight (next episode) + date-grouped poster grid.
   The schedule ships unfiltered: everything the loaded window
   contains, in air-time order.
   ============================================================ */

import { getSchedule, loadSchedule, needsLoad, attachSentinel, detachSentinel } from "../../services/schedule.js";
import { dayKey, dayLabel, isTodayOrTomorrow, timeAgo } from "../../utils/time.js";
import { eventCard, dayGroup, spotlight, leadStrip, timelineRow } from "../../components/card.js";
import { skeletonGrid, emptyState, notice, sectionHead } from "../../components/states.js";
import { watchlist } from "../../storage/watchlist.js";
import { esc } from "../../utils/dom.js";

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
  // Chronological air order — the schedule as AniList returns it.
  const events = state.events.slice().sort((a, b) => a.airingAt - b.airingAt);

  const countLabel = `${events.length} episode${events.length === 1 ? "" : "s"}`;
  const head = sectionHead({
    eyebrow: "Schedule",
    title: "Upcoming",
    meta: state.syncedAt
      ? `${countLabel} · Synced ${esc(timeAgo(state.syncedAt / 1000))}${state.source === "cache" ? " · from cache" : ""}`
      : countLabel,
    aside: "",
  });

  // First paint: skeleton until we have something to show.
  if (state.loading && !events.length) {
    app.innerHTML = `${head}${notice(state.error || "", "danger")}${skeletonGrid(8)}`;
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

  const nowSeconds = Date.now() / 1000;

  if (!events.length) {
    app.innerHTML = `${head}${notice(state.error, state.error ? "danger" : "warning")}${state.warning ? notice(state.warning, "warning") : ""}
      <div class="${ctx.animate ? "view-enter" : ""}">${emptyState({
        icon: "calendar",
        title: "Nothing scheduled yet",
        text: "The schedule will appear as soon as AniList responds.",
      })}</div>`;
    return;
  }

  // Spotlight = the next episode at/after now (falls back to the most recent).
  const nextUp =
    events.find((event) => event.airingAt >= nowSeconds - 120) ||
    events.find((event) => event.airingAt >= nowSeconds - 3600) ||
    null;

  const spotlightHtml = nextUp
    ? spotlight(nextUp, prefs, { saved: watchlist.has(nextUp.media.id) })
    : "";

  const groups = groupByDay(events, prefs);
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

      // A day opens with an editorial lead (up to two wide panels),
      // then continues as a dense lineup grid.
      const leadCount = list.length >= 5 ? 2 : list.length >= 2 ? 1 : 0;
      const lead = leadCount ? leadStrip(list.slice(0, leadCount), prefs) : "";
      const rest = list.slice(leadCount);

      let content;
      if (key === todayKey) {
        // Already aired today = a quiet log; still to come = the day's
        // editorial lead plus the lineup. Never a sparse poster grid.
        const past = list.filter((event) => event.airingAt < nowSeconds).reverse();
        const future = list.filter((event) => event.airingAt >= nowSeconds);
        const futureLead = future.length ? leadStrip(future.slice(0, future.length >= 5 ? 2 : 1), prefs) : "";
        const futureRest = future.slice(future.length >= 5 ? 2 : 1);

        const pastBlock = past.length
          ? `<div class="today-past">
               <p class="today-past__label">Aired earlier today</p>
               <div class="timeline__list">${past
                 .map((event) => timelineRow(event, prefs))
                 .join("")}</div>
             </div>
             <div class="now-divider"><span>Now</span></div>`
          : "";

        content = `${pastBlock}${futureLead}${futureRest.length ? cards(futureRest) : ""}`;
      } else {
        content = `${lead}${rest.length ? cards(rest) : ""}`;
      }

      return dayGroup({ key, label, relative, count: list.length, content });
    })
    .join("");

  const sentinel = state.more
    ? `<div class="load-sentinel" id="load-sentinel" aria-hidden="true"></div>`
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

export function onActivate() {
  if (needsLoad("upcoming")) {
    loadSchedule("upcoming", { reset: getSchedule("upcoming").events.length > 0 }).catch(() => {});
  }
}
