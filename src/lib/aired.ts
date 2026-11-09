/* Derives "what actually aired" per tracked show and, from that, the
   honest progress cap and the behind count.

   Three evidence sources, merged:
   • the recent log — episodes already observed in the past window
   • the upcoming window — a future "next" implies episode−1 aired;
     a past one (3h lookback) is itself the latest aired
   • finished shows with a trustworthy episode total

   With no evidence at all, cap falls back to the series total so
   legacy entries still work; behind stays unknown and says nothing. */

import type { AiringEvent, WatchEntry } from "./types";

export interface AiredInfo {
  /** Highest episode number we can prove has aired. */
  latestAired?: number;
  /** Hard ceiling for the progress stepper: min(total, latestAired). */
  cap?: number;
  /** Episodes the viewer still owes: latestAired − clampedProgress. */
  behind?: number;
  nextAiringAt?: number;
  nextEpisode?: number;
  /** True when the cap comes from the airing evidence, not the total. */
  cappedByAired: boolean;
}

export function airedInfo(
  entry: WatchEntry,
  liveNext: AiringEvent | undefined,
  recentLatest: number | undefined,
  nowMs: number
): AiredInfo {
  const nextAiringAt = liveNext?.airingAt ?? entry.nextAiringAt;
  const nextEpisode = liveNext?.episode ?? entry.nextEpisode;

  let fromNext: number | undefined;
  if (typeof nextEpisode === "number" && nextEpisode > 0) {
    fromNext =
      typeof nextAiringAt === "number" && nextAiringAt * 1000 <= nowMs
        ? nextEpisode
        : nextEpisode - 1;
  }

  const fromFinished =
    entry.mediaStatus === "FINISHED" && typeof entry.totalEpisodes === "number"
      ? entry.totalEpisodes
      : undefined;

  const evidence = [recentLatest, fromNext, fromFinished].filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n)
  );
  const latestAired = evidence.length ? Math.max(...evidence) : undefined;

  const ceilings = [entry.totalEpisodes, latestAired].filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n)
  );
  const cap = ceilings.length ? Math.min(...ceilings) : undefined;
  const cappedByAired =
    typeof latestAired === "number" &&
    (typeof entry.totalEpisodes !== "number" || latestAired < entry.totalEpisodes);

  const effectiveProgress = cap != null ? Math.min(entry.progress, cap) : entry.progress;
  const behind =
    typeof latestAired === "number" ? Math.max(0, latestAired - effectiveProgress) : undefined;

  return { latestAired, cap, behind, nextAiringAt, nextEpisode, cappedByAired };
}
