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
