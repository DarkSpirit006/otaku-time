/* ============================================================
   Otaku Time — detail dialog data shaping

   The facts table and the link chips are pure decisions: which links
   are safe to render, which are streaming, which facts exist at all.
   They lived inside a 200-line template function, where the only way
   to test them was to open a dialog in a browser. Kept here so they
   can be checked directly.
   ============================================================ */

import { formatLabel, statusLabel } from "../../utils/format.js";

/** Only https survives: anything else is dropped before it reaches the DOM. */
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** At most six chips per group: a wall of links is not a feature list. */
const LINKS_PER_GROUP = 6;

/**
 * Split a title's external links into streaming and everything else,
 * dropping any URL that is not https, and pick up a YouTube trailer.
 */
export function detailLinks(media) {
  const links = (media?.externalLinks || [])
    .map((link) => ({ ...link, safe: safeUrl(link.url) }))
    .filter((link) => link.safe);

  return {
    streaming: links.filter((link) => link.type === "STREAMING").slice(0, LINKS_PER_GROUP),
    others: links.filter((link) => link.type !== "STREAMING").slice(0, LINKS_PER_GROUP),
    trailer:
      media?.trailer?.site === "youtube" && media?.trailer?.id
        ? {
            site: "YouTube",
            url: `https://www.youtube.com/watch?v=${encodeURIComponent(media.trailer.id)}`,
          }
        : null,
  };
}

/**
 * The fact list, in reading order. An unknown value is omitted rather
 * than shown as "—": a row that says nothing is worse than no row.
 */
export function detailFacts(media, total) {
  if (!media) return [];

  const studios = (media.studios?.nodes || media.studios || [])
    .filter((studio) => studio.isMain || studio.isAnimationStudio)
    .map((studio) => studio.name)
    .filter(Boolean);

  const rows = [
    media.format ? ["Format", formatLabel(media.format)] : null,
    total !== null && total !== undefined ? ["Episodes", String(total)] : null,
    media.duration ? ["Runtime", `${media.duration} min`] : null,
    media.mediaStatus || media.status
      ? ["Status", statusLabel(media.mediaStatus || media.status)]
      : null,
    dateLabel(media.startDate) ? ["Started", dateLabel(media.startDate)] : null,
    dateLabel(media.endDate) ? ["Ended", dateLabel(media.endDate)] : null,
    studios.length ? ["Studio", studios.slice(0, 2).join(", ")] : null,
    Number.isInteger(media.averageScore) && media.averageScore > 0
      ? ["AniList score", `${media.averageScore}%`]
      : null,
    Number.isInteger(media.popularity) && media.popularity > 0
      ? ["Popularity", `${media.popularity.toLocaleString("en-US")} users`]
      : null,
  ];

  return rows.filter(Boolean);
}

/** "Oct 2026" or "Oct 1 2026" — granularity follows what AniList knows. */
export function dateLabel(date) {
  if (!date?.year) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = date.month ? months[date.month - 1] : "";
  return [month, date.day, date.year].filter(Boolean).join(" ");
}
