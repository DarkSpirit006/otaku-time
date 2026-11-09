import type { AiringEvent, Media, PageResult } from "./types";

const ENDPOINT = "https://graphql.anilist.co";
const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;

const MEDIA_FRAGMENT = `
  fragment MediaFields on Media {
    id
    title { romaji english native }
    coverImage { large extraLarge color }
    bannerImage
    format
    status
    seasonYear
    episodes
    duration
    genres
    averageScore
    description(asHtml: false)
    synonyms
    studios(isMain: true) { nodes { name } }
    trailer { id site thumbnail }
    externalLinks { site url color type }
    nextAiringEpisode { episode airingAt timeUntilAiring }
  }
`;

const SCHEDULE_QUERY = `
  ${MEDIA_FRAGMENT}
  query Airing($from: Int!, $to: Int!, $page: Int!, $perPage: Int!, $sort: [AiringSort]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage hasNextPage }
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: $sort) {
        id episode airingAt timeUntilAiring mediaId
        media { ...MediaFields }
      }
    }
  }
`;

const SEARCH_QUERY = `
  ${MEDIA_FRAGMENT}
  query Search($search: String!, $page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage hasNextPage }
      media(search: $search, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
        ...MediaFields
      }
    }
  }
`;

const DETAILS_QUERY = `
  ${MEDIA_FRAGMENT}
  query Details($id: Int!) {
    Media(id: $id, type: ANIME) { ...MediaFields }
  }
`;

const TRENDING_QUERY = `
  ${MEDIA_FRAGMENT}
  query Trending($page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, isAdult: false, sort: [TRENDING_DESC, POPULARITY_DESC]) {
        ...MediaFields
      }
    }
  }
`;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function request<T>(
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
  attempt = 0
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Network unreachable — check your connection.", 0);
  }

  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt * 1.5;
    await sleep(Math.min(Math.max(retryAfter, 0), 8) * 1000, signal);
    return request(query, variables, signal, attempt + 1);
  }
  if (res.status >= 500 && attempt < 2) {
    await sleep(900 * (attempt + 1), signal);
    return request(query, variables, signal, attempt + 1);
  }
  if (!res.ok) {
    throw new ApiError(`AniList returned ${res.status}. Please try again.`, res.status);
  }

  let json: { data?: T; errors?: { message: string }[] };
  try {
    json = await res.json();
  } catch {
    throw new ApiError("AniList returned an unreadable response. Please try again.", res.status);
  }
  if (json.errors?.length) throw new ApiError(json.errors[0].message || "AniList error", res.status);
  if (!json.data) throw new ApiError("AniList sent an empty response.", res.status);
  return json.data;
}

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function numberOr(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function stringList(v: unknown, limit: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, limit);
}

interface RawStudioNode {
  name?: string;
}
interface RawLink {
  site?: string;
  url?: string;
  type?: string;
}

/** Main studios only, preserving order. */
function normalizeStudios(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((n: RawStudioNode) => text(n?.name))
    .filter((n): n is string => n != null);
}

function normalizeLinks(raw: unknown): Media["externalLinks"] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((l: RawLink) => {
    if (typeof l?.url !== "string" || typeof l.site !== "string" || !l.site || (l.type !== "STREAMING" && l.type !== "INFO")) return false;
    try { return ["https:", "http:"].includes(new URL(l.url).protocol); }
    catch { return false; }
  }).slice(0, 6) as Media["externalLinks"];
}

function normalizeTitle(raw: {
  title?: { romaji?: unknown; english?: unknown; native?: unknown };
}): Media["title"] {
  return {
    romaji: text(raw.title?.romaji) ?? "",
    english: text(raw.title?.english),
    native: text(raw.title?.native),
  };
}

function normalizeCover(raw: {
  coverImage?: { large?: unknown; extraLarge?: unknown; color?: unknown };
}): Media["coverImage"] {
  return {
    large: text(raw.coverImage?.large),
    extraLarge: text(raw.coverImage?.extraLarge),
    color: text(raw.coverImage?.color),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMedia(raw: any): Media | null {
  if (!raw || typeof raw.id !== "number") return null;
  return {
    id: raw.id,
    title: normalizeTitle(raw),
    coverImage: normalizeCover(raw),
    bannerImage: text(raw.bannerImage),
    format: text(raw.format),
    status: text(raw.status),
    seasonYear: numberOr(raw.seasonYear),
    episodes: numberOr(raw.episodes),
    duration: numberOr(raw.duration),
    genres: stringList(raw.genres, 6),
    averageScore: numberOr(raw.averageScore),
    description: text(raw.description),
    synonyms: stringList(raw.synonyms, 6),
    studios: normalizeStudios(raw.studios?.nodes),
    trailer: raw.trailer?.id ? raw.trailer : null,
    externalLinks: normalizeLinks(raw.externalLinks),
    nextAiringEpisode: raw.nextAiringEpisode ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEvent(raw: any): AiringEvent | null {
  if (!raw || typeof raw.id !== "number" || typeof raw.airingAt !== "number") return null;
  const media = normalizeMedia(raw.media);
  if (!media) return null;
  return {
    id: raw.id,
    episode: raw.episode ?? 0,
    airingAt: raw.airingAt,
    mediaId: raw.mediaId ?? media.id,
    media,
  };
}

interface RawPage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Page?: { pageInfo?: { currentPage?: number; hasNextPage?: boolean }; airingSchedules?: any[] };
}

/** Upcoming airing windows: now−3h → +14 days. Recent: −14 days → now. */
export async function fetchSchedule(
  kind: "upcoming" | "recent",
  page = 1,
  signal?: AbortSignal
): Promise<PageResult<AiringEvent>> {
  const now = Math.floor(Date.now() / 1000);
  const [from, to, sort] =
    kind === "upcoming"
      ? [now - HOUR * 3, now + WEEK * 2, ["TIME"]]
      : [now - WEEK * 2, now, ["TIME_DESC"]];

  const data = await request<RawPage>(SCHEDULE_QUERY, { from, to, page, perPage: 50, sort }, signal);
  const items = (data.Page?.airingSchedules ?? []).map(normalizeEvent).filter(Boolean) as AiringEvent[];
  return {
    items,
    page: data.Page?.pageInfo?.currentPage ?? page,
    hasMore: data.Page?.pageInfo?.hasNextPage === true,
  };
}

interface RawMediaPage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Page?: { pageInfo?: { currentPage?: number; hasNextPage?: boolean }; media?: any[] };
}

export async function searchAnime(query: string, signal?: AbortSignal): Promise<Media[]> {
  const data = await request<RawMediaPage>(
    SEARCH_QUERY,
    { search: query, page: 1, perPage: 18 },
    signal
  );
  return (data.Page?.media ?? []).map(normalizeMedia).filter(Boolean) as Media[];
}

export async function fetchTrending(signal?: AbortSignal): Promise<Media[]> {
  const data = await request<RawMediaPage>(TRENDING_QUERY, { page: 1, perPage: 14 }, signal);
  return (data.Page?.media ?? []).map(normalizeMedia).filter(Boolean) as Media[];
}

export async function fetchDetails(id: number, signal?: AbortSignal): Promise<Media | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await request<{ Media?: any }>(DETAILS_QUERY, { id }, signal);
  return normalizeMedia(data.Media);
}
