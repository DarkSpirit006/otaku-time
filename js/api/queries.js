/* ============================================================
   Otaku Time — AniList GraphQL queries
   Read-only requests. Only whitelisted variables are sent.
   ============================================================ */

export const SCHEDULE_FIELDS = `
  id episode airingAt
  media {
    id type isAdult format status episodes duration averageScore
    season seasonYear genres
    title { romaji english native }
    coverImage { medium large extraLarge }
    nextAiringEpisode { id episode airingAt }
  }
`;

export const DETAILS_FIELDS = `
  id type isAdult format status episodes duration averageScore
  season seasonYear genres synonyms description trailer { id site }
  startDate { year month day } endDate { year month day }
  title { romaji english native }
  coverImage { medium large extraLarge }
  bannerImage studios { nodes { name isAnimationStudio } }
  nextAiringEpisode { id episode airingAt }
  externalLinks { site url }
`;

export const SCHEDULE_QUERY = `
  query ($from: Int, $to: Int, $page: Int, $perPage: Int, $sort: [AiringSort]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage hasNextPage }
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: $sort) {
        ${SCHEDULE_FIELDS}
      }
    }
  }
`;

export const SEARCH_QUERY = `
  query ($page: Int, $perPage: Int, $search: String, $type: MediaType) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage hasNextPage }
      media(search: $search, type: $type, sort: [SEARCH_MATCH, SCORE]) {
        id type isAdult format status episodes duration averageScore
        season seasonYear genres
        title { romaji english native }
        coverImage { medium large extraLarge }
        nextAiringEpisode { id episode airingAt }
      }
    }
  }
`;

export const DETAILS_QUERY = `
  query ($id: Int) {
    Media(id: $id) {
      ${DETAILS_FIELDS}
    }
  }
`;
