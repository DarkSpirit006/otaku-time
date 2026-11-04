/* ============================================================
   Otaku Time — AniList API functions
   ============================================================ */

import { createClient } from "./client.js";
import { SCHEDULE_QUERY, SEARCH_QUERY, DETAILS_QUERY } from "./queries.js";
import { validEvents, validMediaList, normalizeMedia } from "./normalize.js";

const WEEK = 7 * 24 * 60 * 60;
const HOUR = 60 * 60;

/** Reusable client instance (app-wide singleton). */
export const client = createClient();

function pageOf(data) {
  return data?.Page || null;
}

/**
 * Fetch one page of airing schedules.
 * Upcoming covers anchor−3h → anchor+30d (TIME asc).
 * Recent covers anchor−30d → anchor (TIME_DESC).
 * @returns {Promise<{page:object|null, warning:string}>}
 */
export async function schedule(kind, page = 1, anchor = Math.floor(Date.now() / 1000), refresh = false, signal) {
  let from;
  let to;
  let sort;

  if (kind === "upcoming") {
    from = anchor - HOUR * 3;
    to = anchor + WEEK * 4;
    sort = ["TIME"];
  } else {
    from = anchor - WEEK * 4;
    to = anchor;
    sort = ["TIME_DESC"];
  }

  const data = await client.request(
    SCHEDULE_QUERY,
    { from, to, page, perPage: 50, sort },
    { ttl: 180_000, refresh, signal }
  );

  const result = pageOf(data);
  if (!result) {
    return {
      page: null,
      warning: "AniList sent an unexpected schedule response. Nothing was displayed.",
    };
  }

  return {
    page: {
      events: validEvents(result.airingSchedules),
      page: Number(result.pageInfo?.currentPage) || page,
      more: result.pageInfo?.hasNextPage === true,
      anchor,
    },
    warning: "",
  };
}

/** Fetch search results for a query (5-minute client cache). */
export async function search(query, signal) {
  const data = await client.request(
    SEARCH_QUERY,
    { search: query, page: 1, perPage: 20, type: "ANIME" },
    { ttl: 300_000, signal }
  );
  const result = pageOf(data);
  if (!result) return { items: [], warning: "AniList sent an unexpected search response." };
  return { items: validMediaList(result.media), warning: "" };
}

/** Fetch full details for one media id (1-hour client cache). */
export async function details(id, signal) {
  const data = await client.request(DETAILS_QUERY, { id }, { ttl: 3_600_000, signal });
  const media = normalizeMedia(data?.Media);
  if (!media) return { media: null, warning: "AniList sent unexpected details." };
  return { media, warning: "" };
}

/** Drop the client-side cache and any rate-limit block. */
export function clearApiCache() {
  client.clearCache();
}
