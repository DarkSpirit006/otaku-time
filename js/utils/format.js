/* ============================================================
   Otaku Time — text formatting helpers (pure, testable)
   ============================================================ */

const FORMAT_LABELS = {
  TV: "TV",
  TV_SHORT: "TV short",
  MOVIE: "Movie",
  SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music",
};

const ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Preferred display title for a media object. */
export function titleOf(media) {
  return (
    media?.title?.english ||
    media?.title?.romaji ||
    media?.title?.native ||
    "Untitled anime"
  );
}

/** Human label for an AniList format enum. */
export function formatLabel(format) {
  return FORMAT_LABELS[format] || "Anime";
}

/** Human label for an AniList status enum. */
export function statusLabel(status) {
  if (!status) return "";
  return String(status)
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert an AniList HTML description into plain text:
 * tags stripped, common entities decoded, whitespace collapsed.
 * Works without a DOM (safe for unit tests and workers).
 */
export function cleanDescription(html) {
  if (!html) return "";
  let text = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  text = text.replace(/&(?:amp|lt|gt|quot|nbsp|apos|#39|#x27);/gi, (entity) => {
    const key = entity.toLowerCase();
    return ENTITY_MAP[key] ?? ENTITY_MAP[entity] ?? entity;
  });
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Join genres for display. */
export function genreLine(genres) {
  return Array.isArray(genres) && genres.length ? genres.join(" · ") : "";
}
