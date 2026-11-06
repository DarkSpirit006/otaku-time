/* ============================================================
   Otaku Time — the broadcast wire

   A single line of live schedule state under the topbar, borrowed
   from newsroom tickers and from the reference build's "WIRE" strip.

   The text is derived, never authored: the next few broadcasts, the
   last couple already aired, and one line of provenance. Nothing is
   claimed that the loaded window cannot support — if no schedule has
   arrived, the wire says so instead of advertising the app.
   ============================================================ */

import { timeAgo } from "../utils/time.js";
import { esc } from "../utils/dom.js";

const NEXT_COUNT = 3;
const RECORD_COUNT = 2;

/**
 * Ticker-scale time: a wire line has no room for "in 3d 0h 0m 0s",
 * and seconds are noise when the unit is hours or days.
 */
export function wireWhen(airingAt, now) {
  const delta = airingAt - now;
  if (delta <= 0) return "now";
  const minutes = Math.floor(delta / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "a day" : `${days} days`;
}

/** "EP 07" — two digits is how a broadcast log is written. */
function episodeStamp(episode) {
  if (!Number.isInteger(episode) || episode <= 0) return "";
  return `EP ${String(episode).padStart(2, "0")}`;
}

function titleOf(media) {
  return media?.title?.english || media?.title?.romaji || media?.title?.native || "Untitled";
}

/**
 * The wire's content, as plain strings.
 *
 * @param {object} state
 * @param {Array} state.upcoming   loaded upcoming events
 * @param {Array} state.recent     loaded recently-aired events
 * @param {number} state.now       epoch seconds
 * @param {number} [state.tracked] watchlist size, used for the tail line
 * @returns {string[]}
 */
export function wireLines({ upcoming = [], recent = [], now, tracked = 0 } = {}) {
  const stamp = Number.isFinite(now) ? now : Math.floor(Date.now() / 1000);
  const lines = [];

  const ahead = upcoming
    .filter((event) => event?.airingAt > stamp)
    .sort((a, b) => a.airingAt - b.airingAt)
    .slice(0, NEXT_COUNT);

  for (const event of ahead) {
    const ep = episodeStamp(event.episode);
    lines.push(`Next — ${titleOf(event.media)}${ep ? ` ${ep}` : ""} · in ${wireWhen(event.airingAt, stamp)}`);
  }

  const behind = recent
    .filter((event) => event?.airingAt && event.airingAt <= stamp)
    .sort((a, b) => b.airingAt - a.airingAt)
    .slice(0, RECORD_COUNT);

  for (const event of behind) {
    const ep = episodeStamp(event.episode);
    lines.push(
      `On record — ${titleOf(event.media)}${ep ? ` ${ep}` : ""} · ${timeAgo(event.airingAt).toLowerCase()}`
    );
  }

  const total = upcoming.length + recent.length;
  if (total) {
    const parts = [`${total} broadcasts in this window`];
    if (tracked > 0) parts.push(tracked === 1 ? "1 title tracked" : `${tracked} titles tracked`);
    lines.push(parts.join(" · "));
  }

  return lines;
}

/** Markup for one pass of the wire. Empty windows get an honest status line. */
export function wireMarkup(lines) {
  if (!lines.length) {
    return { track: `<span class="wire__item">Schedule feed empty — nothing loaded yet</span>`, plain: "Schedule feed empty." };
  }
  const items = lines.map((line) => `<span class="wire__item">${esc(line)}</span>`).join("");
  return { track: items, plain: lines.join(". ") };
}

/**
 * Render the wire into its container.
 *
 * The visible track is duplicated so the loop has no seam, and the
 * whole track is aria-hidden: the same sentences sit in a visually
 * hidden list, so a screen reader hears the wire once, in order,
 * instead of twice through a duplicated marquee.
 */
export function renderWire(container, lines) {
  if (!container) return;
  const { track, plain } = wireMarkup(lines);
  container.innerHTML = `
    <span class="wire__label" aria-hidden="true">Wire</span>
    <div class="wire__viewport">
      <div class="wire__track" aria-hidden="true">
        <span class="wire__pass">${track}</span>
        <span class="wire__pass">${track}</span>
      </div>
    </div>
    <p class="sr-only" data-wire-summary>${esc(plain)}</p>`;
}
