/* ============================================================
   Otaku Time — AniList response normalization (pure)
   Every field that reaches the UI goes through here.
   ============================================================ */

const POSTER_HOSTS = new Set([
  "s4.anilist.co",
  "s4.anilist.co." // defensive trailing-dot form
]);

const ALLOWED_IMAGE_HOSTS = ["s4.anilist.co"];

/**
 * Resolve an AniList image URL, or null when the URL is
 * missing/invalid/points at an unexpected host.
 */
export function imageUrl(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 500) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!ALLOWED_IMAGE_HOSTS.includes(parsed.hostname) && !POSTER_HOSTS.has(parsed.hostname)) {
    return null;
  }
  return parsed.toString();
}

function int(value) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function str(value, max = 300) {
  return typeof value === "string" && value.trim() ? value.slice(0, max).trim() : "";
}

function strArray(value, max = 24, itemMax = 80) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string" && v.trim())
    .slice(0, max)
    .map((v) => v.slice(0, itemMax));
}

/**
 * Normalize a Media object from AniList. Returns null when the id is
 * invalid. Unknown or malformed optional fields degrade to null/[].
 */
export function normalizeMedia(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = int(raw.id);
  if (id === null || id <= 0 || id > 2 ** 31) return null;

  const title = raw.title && typeof raw.title === "object" ? raw.title : {};
  const cover = raw.coverImage && typeof raw.coverImage === "object" ? raw.coverImage : {};

  const next = raw.nextAiringEpisode && typeof raw.nextAiringEpisode === "object"
    ? raw.nextAiringEpisode
    : null;

  return {
    id,
    type: raw.type === "ANIME" ? "ANIME" : "MANGA",
    isAdult: raw.isAdult === true,
    format: str(raw.format, 24),
    status: str(raw.status, 24),
    episodes: int(raw.episodes),
    duration: int(raw.duration),
    averageScore: int(raw.averageScore),
    season: str(raw.season, 12),
    seasonYear: int(raw.seasonYear),
    genres: strArray(raw.genres),
    synonyms: strArray(raw.synonyms, 24, 120),
    description: str(raw.description, 6000),
    trailer:
      raw.trailer && typeof raw.trailer === "object" && typeof raw.trailer.id === "string"
        ? { id: str(raw.trailer.id, 64), site: str(raw.trailer.site, 24) }
        : null,
    startDate: sanitizeDate(raw.startDate),
    endDate: sanitizeDate(raw.endDate),
    title: {
      romaji: str(title.romaji, 300),
      english: str(title.english, 300),
      native: str(title.native, 300),
    },
    coverImage: {
      medium: imageUrl(cover.medium),
      large: imageUrl(cover.large),
      extraLarge: imageUrl(cover.extraLarge),
      color: hexColor(cover.color),
    },
    bannerImage: imageUrl(raw.bannerImage),
    studios:
      raw.studios && Array.isArray(raw.studios.nodes)
        ? raw.studios.nodes
            .filter((s) => s && typeof s.name === "string")
            .slice(0, 10)
            .map((s) => ({ name: str(s.name, 120), isMain: s.isAnimationStudio === true }))
        : [],
    nextAiringEpisode:
      next && int(next.id) !== null && int(next.episode) !== null && int(next.airingAt) !== null
        ? { id: int(next.id), episode: int(next.episode), airingAt: int(next.airingAt) }
        : null,
    externalLinks: sanitizeLinks(raw.externalLinks),
  };
}

/** Only #rgb/#rrggbb survive — the value is used for palette tinting. */
export function hexColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function sanitizeDate(value) {
  if (!value || typeof value !== "object") return null;
  const year = int(value.year);
  const month = int(value.month);
  const day = int(value.day);
  if (year === null) return null;
  return { year, month, day };
}

function sanitizeLinks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((l) => l && typeof l.site === "string" && typeof l.url === "string")
    .slice(0, 12)
    .map((l) => {
      const link = { site: str(l.site, 60), url: str(l.url, 400) };
      const type = str(l.type, 24);
      const language = str(l.language, 24);
      if (type) link.type = type;
      if (language) link.language = language;
      return link;
    })
    .filter((l) => {
      try {
        return new URL(l.url).protocol === "https:";
      } catch {
        return false;
      }
    });
}

/**
 * Validate and deduplicate an airingSchedules array.
 * Accepts plain objects (parsed JSON) — integers come back as numbers.
 */
export function validEvents(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const events = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = item.id;
    const episode = item.episode;
    const airingAt = item.airingAt;
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!Number.isInteger(episode) || episode < 0) continue;
    if (!Number.isInteger(airingAt) || airingAt <= 0) continue;
    if (item.media?.type !== "ANIME") continue;
    if (item.media?.isAdult === true) continue;
    if (seen.has(id)) continue;
    const media = normalizeMedia(item.media);
    if (!media) continue;
    seen.add(id);
    events.push({ id, episode, airingAt, media });
  }
  return events;
}

/** Validate a parsed search/details payload's media list. */
export function validMediaList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeMedia).filter((m) => m && m.type === "ANIME" && !m.isAdult);
}
