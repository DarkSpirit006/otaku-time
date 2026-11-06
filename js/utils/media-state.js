/* ============================================================
   Otaku Time — derived state about a saved title (pure)

   Turns AniList metadata + the user's progress into the labels
   the UI shows. Deliberately conservative: a countdown is only
   produced for a genuinely future airing time, and "episodes
   behind" only when both the aired count and the user's progress
   are known.
   ============================================================ */

import { progressCap } from "../storage/watchlist.js";

/**
 * @typedef {{kind:'countdown'|'airing'|'finished'|'break'|'upcoming'|'cancelled'|'unknown', text:string, epoch:number|null, episode:number|null}}
 */

/**
 * Label for the next airing of a saved title.
 * @param {object} item watchlist item (mediaStatus, nextAiringEpisode, duration)
 * @param {number} nowSeconds
 */
export function airingState(item, nowSeconds = Date.now() / 1000) {
  const next = item?.nextAiringEpisode;
  const episode = Number.isInteger(next?.episode) ? next.episode : null;
  const at = Number.isFinite(next?.airingAt) ? next.airingAt : null;

  if (at !== null && at > nowSeconds + 30) {
    return { kind: "countdown", text: "", epoch: at, episode };
  }
  if (at !== null && at <= nowSeconds + 30) {
    // The timestamp has passed: the episode is airing, not "soon".
    const elapsed = nowSeconds - at;
    const window = Math.min(Math.max(item?.duration || 24, 5), 180) * 60;
    return {
      kind: elapsed < window ? "airing" : "countdown",
      text: elapsed < window ? "Airing now" : "",
      epoch: null,
      episode,
    };
  }

  switch (item?.mediaStatus) {
    case "RELEASING":
      return { kind: "break", text: "On break", epoch: null, episode };
    case "FINISHED":
      return { kind: "finished", text: "Finished", epoch: null, episode };
    case "NOT_YET_RELEASED":
      return { kind: "upcoming", text: "Not yet airing", epoch: null, episode };
    case "CANCELLED":
      return { kind: "cancelled", text: "Cancelled", epoch: null, episode };
    default:
      return { kind: "unknown", text: "Schedule unavailable", epoch: null, episode };
  }
}

/**
 * Episodes that have aired but are not watched yet.
 * Returns null when either side is unknown — the UI then shows nothing.
 */
export function episodesBehind(item, nowSeconds = Date.now() / 1000) {
  if (!Number.isInteger(item?.watched)) return null;
  const next = item?.nextAiringEpisode;
  if (!Number.isInteger(next?.episode) || !Number.isFinite(next?.airingAt)) return null;
  const aired = Math.max(0, next.episode - 1);
  if (next.airingAt <= nowSeconds && Number.isInteger(next.episode)) {
    // The episode listed as "next" has itself aired.
    return Math.max(0, next.episode - item.watched);
  }
  return Math.max(0, aired - item.watched);
}

/** Highest reliable episode bound for the item ("unknown" when unbounded). */
export function reliableTotal(item) {
  const { cap, source } = progressCap(item);
  return { total: cap, source: source ?? "unknown" };
}

/** Whether a one-click "mark complete" is honest for this item. */
export function canComplete(item) {
  const { total } = reliableTotal(item);
  if (total === null) return false;
  return item?.mediaStatus === "FINISHED" || (Number.isInteger(item?.watched) && item.watched >= total);
}

/** Why progress cannot exceed the current value ('' when unbounded). */
export function progressHint(item) {
  const { total, source } = reliableTotal(item);
  if (total === null) return "";
  if (source === "aired") {
    return `AniList hasn't published a total episode count, so progress is capped at episode ${total} — the last one that has aired.`;
  }
  return "";
}

/** Completion percent, or null when the total is unknown. */
export function progressPercent(item) {
  const { total } = reliableTotal(item);
  if (!total || !Number.isInteger(item?.watched)) return null;
  return Math.min(100, Math.round((item.watched / total) * 100));
}
