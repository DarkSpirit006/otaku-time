/* ============================================================
   Otaku Time — e2e helpers
   Synthetic AniList payloads + GraphQL interception. All data
   here is test-only; production always talks to the real API.
   ============================================================ */

const HOST = "https://graphql.anilist.co/**";

// Real AniList CDN files (ONE PIECE, id 21) at their true sizes: ~13 KB,
// ~54 KB and ~158 KB. The suite loads actual posters so srcset selection,
// decode and the service-worker artwork cache are exercised for real;
// tests/e2e/assets.spec.js re-checks that these URLs still answer 200.
const COVER_SMALL = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx21-ELSYx3yMPcKM.jpg";
const COVER_MEDIUM = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg";
const COVER_LARGE = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-ELSYx3yMPcKM.jpg";
const BANNER = "https://s4.anilist.co/file/anilistcdn/media/anime/banner/21-wf37VakJmZqs.jpg";

/** Build a normalized-looking AniList Media object. */
export function makeMedia(id, title, overrides = {}) {
  return {
    id,
    type: "ANIME",
    isAdult: false,
    format: "TV",
    status: "RELEASING",
    episodes: 12,
    duration: 24,
    averageScore: 80,
    season: "FALL",
    seasonYear: 2026,
    genres: ["Action", "Drama"],
    synonyms: [],
    description: `Synopsis for ${title}.`,
    trailer: null,
    startDate: { year: 2026, month: 10, day: 1 },
    endDate: null,
    title: { romaji: `${title} Romaji`, english: title, native: `${title} JP` },
    coverImage: { medium: COVER_SMALL, large: COVER_MEDIUM, extraLarge: COVER_LARGE },
    bannerImage: BANNER,
    studios: { nodes: [{ name: "Test Studio", isAnimationStudio: true }] },
    nextAiringEpisode: null,
    externalLinks: [{ site: "Example", url: "https://example.com" }],
    ...overrides,
  };
}

/** Build an airingSchedule entry. */
export function makeEvent({ id, episode, airingAt, media }) {
  return { id, episode, airingAt, media };
}

/** Wrap entries as an AniList Page response. */
export function schedulePayload(events, { page = 1, hasNextPage = false } = {}) {
  return {
    data: {
      Page: {
        pageInfo: { currentPage: page, hasNextPage },
        airingSchedules: events,
      },
    },
  };
}

/** Wrap media as a search Page response. */
export function searchPayload(mediaList, { page = 1, hasNextPage = false } = {}) {
  return {
    data: {
      Page: {
        pageInfo: { currentPage: page, hasNextPage },
        media: mediaList,
      },
    },
  };
}

/** Wrap a single media as a Media response. */
export function detailsPayload(media) {
  return { data: { Media: media } };
}

function bodyJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function kindOf(query = "") {
  if (query.includes("airingSchedules")) return "schedule";
  if (query.includes("media(search")) return "search";
  if (query.includes("Media(id")) return "details";
  return "unknown";
}

/**
 * Intercept the AniList endpoint.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} handlers
 * @param {(vars:any, query:string) => any} [handlers.schedule]
 * @param {(vars:any) => any} [handlers.search]
 * @param {(vars:any) => any} [handlers.details]
 * @param {{status?:number, body?:any, delayMs?:number}|'abort'} [handlers.fail]
 *   one-shot failure applied before handlers (e.g. 400/429 responses)
 */
export async function mockAniList(page, handlers = {}) {
  const failures = [];
  if (handlers.fail && handlers.fail !== "abort") failures.push(handlers.fail);

  await page.route(HOST, async (route) => {
    const request = route.request();
    const payload = bodyJson(request.postData() || "{}");
    const kind = kindOf(payload?.query || "");

    // Persistent network failure (every attempt)
    if (handlers.fail === "abort") {
      await route.abort("failed");
      return;
    }

    // One-shot failures consumed in order
    if (failures.length) {
      const failure = failures.shift();
      if (failure.delayMs) await new Promise((r) => setTimeout(r, failure.delayMs));
      await route.fulfill({
        status: failure.status ?? 400,
        contentType: "application/json",
        body: JSON.stringify(failure.body ?? { errors: [{ message: "Error", status: failure.status ?? 400 }] }),
      });
      return;
    }

    if (kind === "schedule" && handlers.schedule) {
      const result = handlers.schedule(payload.variables || {}, payload.query);
      if (result && typeof result === "object" && "status" in result) {
        await route.fulfill({
          status: result.status,
          contentType: "application/json",
          body: JSON.stringify(result.body ?? {}),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
      return;
    }

    if (kind === "search" && handlers.search) {
      const result = handlers.search(payload.variables || {});
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
      return;
    }

    if (kind === "details" && handlers.details) {
      const result = handlers.details(payload.variables || {});
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
      return;
    }

    // Default: empty page so nothing surprises the test.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(schedulePayload([])),
    });
  });
}

/** Standard schedule handler with upcoming/recent windows. */
export function standardSchedules({ upcoming = [], recent = [], more = false } = {}) {
  return {
    schedule: (vars) => {
      const isRecent = Array.isArray(vars.sort) && vars.sort.includes("TIME_DESC");
      const events = isRecent ? recent : upcoming;
      return schedulePayload(events, { page: vars.page || 1, hasNextPage: more && (vars.page || 1) < 3 });
    },
  };
}

/** A small deterministic set of events around "now". */
/**
 * Default schedule fixture.
 *
 * `anchor` pins the event times instead of following the real clock. The
 * visual suite freezes the browser at a fixed instant, so fixtures that
 * drifted with wall time silently moved events into other days and other
 * minutes — the baselines rotted on their own. Behavioural suites keep
 * the default: they assert relative things ("in about an hour").
 */
export function defaultEvents(anchor = Math.floor(Date.now() / 1000)) {
  const now = anchor;
  // Schedule responses carry no description (matches the real query),
  // so opening details always triggers the lazy details fetch.
  const sched = (media) => ({ ...media, description: "" });
  return {
    upcoming: [
      makeEvent({ id: 9001, episode: 5, airingAt: now + 3600, media: sched(makeMedia(101, "Alpha Show")) }),
      makeEvent({ id: 9002, episode: 12, airingAt: now + 7200, media: sched(makeMedia(102, "Beta Show", { format: "MOVIE", averageScore: 91 })) }),
      makeEvent({ id: 9003, episode: 1, airingAt: now + 3 * 86400, media: sched(makeMedia(103, "Gamma Show", { format: "OVA" })) }),
    ],
    recent: [
      makeEvent({ id: 9101, episode: 4, airingAt: now - 7200, media: sched(makeMedia(104, "Delta Show")) }),
      makeEvent({ id: 9102, episode: 9, airingAt: now - 86400, media: sched(makeMedia(105, "Epsilon Show", { averageScore: 74 })) }),
    ],
  };
}

/** Save an item directly through the UI-independent storage layer. */
export async function seedWatchlist(page, items) {
  await page.addInitScript((seed) => {
    localStorage.setItem(
      "otaku-time.watchlist.v1",
      JSON.stringify({ version: 2, items: seed })
    );
  }, items);
}

/** Normalize errors collected from the page. */
export function collectPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
