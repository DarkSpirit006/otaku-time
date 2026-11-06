/* ============================================================
   Otaku Time — metadata synchronisation
   The single path by which AniList data reaches saved items.

   Every schedule page, search result and detail response funnels
   through here; nothing else may write API fields onto a saved
   item. User-owned fields (progress, personal status, score,
   notes, ordering, saved timestamp) are never touched.
   ============================================================ */

import { watchlist } from "../storage/watchlist.js";

/**
 * Sync one media object into the watchlist if it is saved.
 * @returns {{changed:boolean, scheduleChange:object|null}|null}
 */
export function syncFromMedia(media) {
  if (!media || !Number.isInteger(media.id)) return null;
  if (!watchlist.has(media.id)) return null;
  return watchlist.syncMeta(media);
}

/**
 * Sync a batch of schedule events / media objects.
 * Saved ids are collected once so the pass stays O(events).
 * @returns {{updated:number, rescheduled:number}}
 */
export function syncFromEvents(events) {
  if (!Array.isArray(events)) return { updated: 0, rescheduled: 0 };
  const saved = new Set(watchlist.all().map((item) => item.id));
  let updated = 0;
  let rescheduled = 0;
  for (const entry of events) {
    const media = entry?.media ?? entry;
    if (!media || !saved.has(media.id)) continue;
    // Schedule events carry the airing time the API is reporting right now.
    const payload = entry?.media
      ? { ...media, nextAiringEpisode: entry.airingAt ? { episode: entry.episode, airingAt: entry.airingAt } : media.nextAiringEpisode }
      : media;
    const result = watchlist.syncMeta(payload);
    if (result.changed) updated++;
    if (result.scheduleChange) rescheduled++;
  }
  return { updated, rescheduled };
}

/** Sync a flat list of media objects (search results, pool dumps). */
export function syncFromList(list) {
  if (!Array.isArray(list)) return { updated: 0, rescheduled: 0 };
  let updated = 0;
  let rescheduled = 0;
  for (const media of list) {
    const result = syncFromMedia(media);
    if (result?.changed) updated++;
    if (result?.scheduleChange) rescheduled++;
  }
  return { updated, rescheduled };
}
