/* ============================================================
   Otaku Time — derived watchlist state
   These are the labels the UI is allowed to print. Every case
   here is a promise: no countdown for an episode that already
   aired, no "N behind" without both numbers, no completion
   claim without a finished show or a real total.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";

import {
  airingState,
  episodesBehind,
  reliableTotal,
  canComplete,
  progressHint,
  progressPercent,
} from "../../js/utils/media-state.js";

const NOW = 1_800_000_000; // fixed instant, seconds
const HOUR = 3600;

function item(overrides = {}) {
  return {
    id: 1,
    mediaStatus: "RELEASING",
    episodes: 12,
    duration: 24,
    watched: 0,
    nextAiringEpisode: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------
   Airing state
   ------------------------------------------------------------ */

test("a future airing yields a countdown with its episode", () => {
  const state = airingState(
    item({ nextAiringEpisode: { episode: 7, airingAt: NOW + 2 * HOUR } }),
    NOW
  );
  assert.equal(state.kind, "countdown");
  assert.equal(state.epoch, NOW + 2 * HOUR);
  assert.equal(state.episode, 7);
});

test("an episode that has started is 'airing', never a countdown", () => {
  const state = airingState(
    item({ nextAiringEpisode: { episode: 7, airingAt: NOW - 60 } }),
    NOW
  );
  assert.equal(state.kind, "airing");
  assert.equal(state.text, "Airing now");
  assert.equal(state.epoch, null);
});

test("a passed episode outside its runtime drops the countdown entirely", () => {
  const state = airingState(
    item({ nextAiringEpisode: { episode: 7, airingAt: NOW - 6 * HOUR } }),
    NOW
  );
  assert.equal(state.kind, "countdown");
  assert.equal(state.epoch, null);
  assert.equal(state.text, "");
});

test("releasing without a next episode reads 'On break'", () => {
  assert.equal(airingState(item(), NOW).text, "On break");
});

test("finished, unreleased and cancelled are named honestly", () => {
  assert.equal(airingState(item({ mediaStatus: "FINISHED" }), NOW).text, "Finished");
  assert.equal(
    airingState(item({ mediaStatus: "NOT_YET_RELEASED" }), NOW).text,
    "Not yet airing"
  );
  assert.equal(airingState(item({ mediaStatus: "CANCELLED" }), NOW).text, "Cancelled");
});

test("unknown metadata says the schedule is unavailable", () => {
  const state = airingState(item({ mediaStatus: "WHATEVER" }), NOW);
  assert.equal(state.kind, "unknown");
  assert.equal(state.text, "Schedule unavailable");
});

/* ------------------------------------------------------------
   Episodes behind
   ------------------------------------------------------------ */

test("episodes behind uses the next episode as the aired count", () => {
  const behind = episodesBehind(
    item({ watched: 3, nextAiringEpisode: { episode: 5, airingAt: NOW + HOUR } }),
    NOW
  );
  assert.equal(behind, 1);
});

test("an episode that just aired counts as aired", () => {
  const behind = episodesBehind(
    item({ watched: 3, nextAiringEpisode: { episode: 5, airingAt: NOW - 60 } }),
    NOW
  );
  assert.equal(behind, 2);
});

test("behind is null when either side is unknown", () => {
  assert.equal(episodesBehind(item({ watched: null, nextAiringEpisode: { episode: 5, airingAt: NOW } }), NOW), null);
  assert.equal(episodesBehind(item({ watched: 3 }), NOW), null);
});

test("behind never goes negative", () => {
  assert.equal(
    episodesBehind(item({ watched: 12, nextAiringEpisode: { episode: 5, airingAt: NOW + HOUR } }), NOW),
    0
  );
});

/* ------------------------------------------------------------
   Totals, completion, hints
   ------------------------------------------------------------ */

test("the reliable total prefers the published episode count", () => {
  assert.deepEqual(reliableTotal(item({ episodes: 24 })), { total: 24, source: "total" });
});

test("without a published count the total is the last aired episode", () => {
  const result = reliableTotal(
    item({ episodes: null, nextAiringEpisode: { episode: 4, airingAt: NOW } })
  );
  assert.equal(result.total, 3);
  assert.equal(result.source, "aired");
});

test("an unknown total stays unknown", () => {
  assert.deepEqual(reliableTotal(item({ episodes: null })), { total: null, source: "unknown" });
});

test("completion needs a finished show or an explicit real total", () => {
  assert.equal(canComplete(item({ mediaStatus: "FINISHED", episodes: 12, watched: 5 })), true);
  assert.equal(canComplete(item({ mediaStatus: "RELEASING", episodes: 12, watched: 12 })), true);
  assert.equal(canComplete(item({ mediaStatus: "RELEASING", episodes: null, watched: 3 })), false);
});

test("a cap explained only when the total was inferred", () => {
  const inferred = progressHint(item({ episodes: null, nextAiringEpisode: { episode: 4, airingAt: NOW } }));
  assert.match(inferred, /capped at episode 3/);
  assert.equal(progressHint(item({ episodes: 12 })), "");
});

test("percent is null without a total and clamped at 100", () => {
  assert.equal(progressPercent(item({ episodes: null })), null);
  assert.equal(progressPercent(item({ episodes: 10, watched: 5 })), 50);
  assert.equal(progressPercent(item({ episodes: 10, watched: 99 })), 100);
});
