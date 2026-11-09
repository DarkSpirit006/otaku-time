export interface MediaTitle {
  romaji: string;
  english?: string;
  native?: string;
}

export interface CoverImage {
  large?: string;
  extraLarge?: string;
  color?: string;
}

export interface Trailer {
  id: string;
  site: string;
  thumbnail?: string;
}

export interface StreamingLink {
  site: string;
  url: string;
  color?: string;
}

export interface Media {
  id: number;
  title: MediaTitle;
  coverImage: CoverImage;
  bannerImage?: string;
  format?: string;
  status?: string;
  seasonYear?: number;
  episodes?: number;
  duration?: number;
  genres: string[];
  averageScore?: number;
  description?: string;
  synonyms: string[];
  studios: string[];
  trailer?: Trailer | null;
  externalLinks: StreamingLink[];
  nextAiringEpisode?: {
    episode: number;
    airingAt: number;
    timeUntilAiring: number;
  } | null;
}

export interface AiringEvent {
  id: number;
  episode: number;
  airingAt: number; // unix seconds
  mediaId: number;
  media: Media;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  hasMore: boolean;
}

export interface WatchEntry {
  mediaId: number;
  title: string;
  cover?: string;
  color?: string;
  format?: string;
  /** AniList release status at save time (FINISHED enables full caps). */
  mediaStatus?: string;
  totalEpisodes?: number;
  progress: number;
  status: "watching" | "planned" | "paused" | "completed" | "dropped";
  addedAt: number;
  updatedAt: number;
  nextAiringAt?: number;
  nextEpisode?: number;
}

export type Section = "upcoming" | "watchlist" | "recent";

export function displayTitle(m: Media | { title: MediaTitle }): string {
  return m.title.english || m.title.romaji || m.title.native || "Untitled";
}
