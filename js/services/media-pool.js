/* ============================================================
   Otaku Time — in-memory media pool for instant local search
   Aggregates saved, scheduled and already-fetched media.
   ============================================================ */

import { search as searchAniList } from "../api/anilist.js";
import { rank } from "../utils/search-rank.js";

const pool = new Map();

function add(media) {
  if (!media || typeof media !== "object" || !Number.isInteger(media.id)) return;
  const existing = pool.get(media.id);
  if (existing) {
    // Keep whichever copy has more fields (usually the detailed one).
    const existingWeight = existing.description ? 2 : existing.genres?.length ? 1 : 0;
    const incomingWeight = media.description ? 2 : media.genres?.length ? 1 : 0;
    if (incomingWeight >= existingWeight) pool.set(media.id, media);
  } else {
    pool.set(media.id, media);
  }
}

/** Add one media object to the pool. */
export function addMedia(media) {
  add(media);
}

/** Add many media objects (or schedule events) to the pool. */
export function addAll(list) {
  if (!Array.isArray(list)) return;
  for (const entry of list) {
    if (entry?.media) add(entry.media);
    else add(entry);
  }
}

/** Current pool contents. */
export function poolItems() {
  return Array.from(pool.values());
}

/** Look up a media object by id. */
export function findById(id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) return null;
  return pool.get(numeric) ?? null;
}

/** Search the local pool immediately (fuzzy-ranked). */
export function localSearch(query) {
  return rank(query, poolItems());
}

/**
 * Remote search with graceful degradation.
 * @returns {Promise<{items:Array, warning:string}>}
 */
export async function remoteSearch(query, signal) {
  try {
    const { items, warning } = await searchAniList(query, signal);
    for (const item of items) add(item);
    return { items, warning };
  } catch (error) {
    if (error?.code === "ABORTED") throw error;
    return {
      items: [],
      warning:
        error?.name === "AniListError"
          ? error.message
          : "Search is unavailable right now. Try again shortly.",
    };
  }
}

/** Merge search results into ranked output (dedup by id). */
export function mergeResults(local, remote) {
  const seen = new Set();
  const merged = [];
  for (const item of [...local, ...remote]) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}
