/* ============================================================
   Otaku Time — AniList API functions

   The search request must ask AniList to exclude adult titles. The
   filter lives in the variables and in the query document; if either
   half is dropped, AniList returns adult results regardless.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const QUERY_PATH = fileURLToPath(new URL("../../js/api/queries.js", import.meta.url));

/** Minimal successful GraphQL response for a search. */
function searchResponse(items) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data: { Page: { pageInfo: { hasNextPage: false }, media: items } } }),
  };
}

const ITEM = {
  id: 1,
  type: "ANIME",
  title: { romaji: "Test", english: "Test", native: "" },
  coverImage: { medium: null, large: null, extraLarge: null },
  format: "TV",
  status: "RELEASING",
  episodes: 12,
  duration: 24,
  averageScore: 80,
  genres: [],
  synonyms: [],
  description: "",
  startDate: { year: 2026, month: 1, day: 1 },
  endDate: null,
  season: "WINTER",
  seasonYear: 2026,
  studios: { nodes: [] },
  bannerImage: null,
  nextAiringEpisode: null,
  externalLinks: [],
  isAdult: false,
};

/** Capture the request body the module sends, then answer it. */
async function captureSearch(run) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return searchResponse([ITEM]);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

test("search asks AniList to exclude adult results", async () => {
  const { search, clearApiCache } = await import("../../js/api/anilist.js");
  clearApiCache();

  const calls = await captureSearch(async () => {
    const result = await search("one piece");
    assert.equal(result.items.length, 1, "the request resolves normally");
  });

  assert.equal(calls.length, 1, "one request per search");
  const [call] = calls;
  assert.equal(call.body.variables.isAdult, false, "variables must send isAdult: false");
  assert.equal(call.body.variables.search, "one piece");
  assert.equal(call.body.variables.type, "ANIME");
  assert.equal(call.body.variables.page, 1);
});

test("the search document declares and forwards the isAdult variable", () => {
  const source = readFileSync(QUERY_PATH, "utf8");
  // A variable that is sent but never declared is silently ignored by
  // GraphQL, which would quietly bring adult results back.
  assert.match(source, /\$isAdult:\s*Boolean/);
  assert.match(source, /isAdult:\s*\$isAdult/);
});

test("a search that returns nothing still reports honestly", async () => {
  const { search, clearApiCache } = await import("../../js/api/anilist.js");
  clearApiCache();
  const original = globalThis.fetch;
  globalThis.fetch = async () => searchResponse([]);
  try {
    const result = await search("zzzz-no-match");
    assert.deepEqual(result.items, []);
    assert.equal(result.warning, "");
  } finally {
    globalThis.fetch = original;
  }
});

/* ------------------------------------------------------------
   The schedule payload feeds the feature panel and the lead panels,
   not just the compact cards. Those surfaces want the landscape banner
   and the studio line; if the query does not ask for them the panel
   silently falls back to a cropped portrait cover and prints a meta
   line with a hole in it.
   ------------------------------------------------------------ */

test("the schedule query asks for the fields the feature panel renders", () => {
  const source = readFileSync(QUERY_PATH, "utf8");
  const start = source.indexOf("export const SCHEDULE_FIELDS");
  // Stop at the closing backtick of that one template — DETAILS_FIELDS below
  // already declares both fields and would mask the gap.
  const fields = source.slice(start, source.indexOf("`;", start));

  assert.match(fields, /bannerImage/, "no bannerImage → the hero uses a cropped cover");
  assert.match(fields, /studios\s*\{\s*nodes\s*\{\s*name/, "no studios → the meta line loses its studio");
});

test("normalized schedule media keeps the banner and the studio", async () => {
  const { normalizeMedia } = await import("../../js/api/normalize.js");
  const media = normalizeMedia({
    id: 1,
    type: "ANIME",
    bannerImage: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/1-x.jpg",
    studios: { nodes: [{ name: "Shin-Ei Animation", isAnimationStudio: true }] },
    title: { romaji: "Test" },
  });
  assert.equal(media.bannerImage, "https://s4.anilist.co/file/anilistcdn/media/anime/banner/1-x.jpg");
  assert.deepEqual(media.studios, [{ name: "Shin-Ei Animation", isMain: true }]);
});
