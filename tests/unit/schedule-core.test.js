import test from "node:test";
import assert from "node:assert/strict";

import {
  sortEvents,
  dedupeEvents,
  mergeEvents,
  signatureOf,
  paginationSummary,
  incompleteGroups,
  pagesToRefresh,
} from "../../js/utils/schedule-core.js";

const ev = (id, airingAt, mediaId = id) => ({ id, airingAt, media: { id: mediaId } });

test("sortEvents is chronological with an id tie-breaker", () => {
  const sorted = sortEvents([ev(3, 200), ev(1, 100), ev(2, 100)]);
  assert.deepEqual(sorted.map((e) => e.id), [1, 2, 3]);
});

test("dedupeEvents keeps the freshest copy and drops repeats", () => {
  const out = dedupeEvents([ev(1, 100), ev(2, 150), { ...ev(1, 100), episode: 9 }]);
  assert.equal(out.length, 2);
  assert.equal(out.find((e) => e.id === 1).episode, 9);
});

test("mergeEvents replaces by id and sorts", () => {
  const merged = mergeEvents([ev(1, 100), ev(2, 200)], [ev(2, 250), ev(3, 300)], { keepMissing: true });
  assert.deepEqual(merged.map((e) => [e.id, e.airingAt]), [
    [1, 100],
    [2, 250],
    [3, 300],
  ]);
});

test("mergeEvents defaults to the refreshed set being authoritative", () => {
  const merged = mergeEvents([ev(1, 100), ev(2, 200)], [ev(2, 250)]);
  assert.deepEqual(merged.map((e) => e.id), [2]);
});

test("mergeEvents can keep entries a partial refresh did not return", () => {
  const merged = mergeEvents([ev(1, 100), ev(2, 200)], [ev(2, 250)], { keepMissing: true });
  assert.deepEqual(merged.map((e) => e.id), [1, 2]);
});

/* ---------------- render signature ---------------- */

test("identical event arrays hash identically", () => {
  const a = [ev(1, 100), ev(2, 200)];
  assert.equal(signatureOf(a), signatureOf([ev(1, 100), ev(2, 200)]));
});

test("same count but different ids invalidates the render", () => {
  assert.notEqual(signatureOf([ev(1, 100)]), signatureOf([ev(9, 100)]));
});

test("same ids with changed airing times invalidate the render", () => {
  assert.notEqual(signatureOf([ev(1, 100)]), signatureOf([ev(1, 101)]));
});

test("empty lists hash to a stable constant", () => {
  assert.equal(signatureOf([]), signatureOf([]));
  assert.notEqual(signatureOf([]), signatureOf([ev(1, 100)]));
});

test("reordering sorts to the same signature once normalised", () => {
  const a = sortEvents([ev(1, 100), ev(2, 200)]);
  const b = sortEvents([ev(2, 200), ev(1, 100)]);
  assert.equal(signatureOf(a), signatureOf(b));
  assert.notEqual(signatureOf([ev(1, 100), ev(2, 200)]), signatureOf([ev(2, 200), ev(1, 100)]));
});

/* ---------------- pagination honesty ---------------- */

test("pagination label never claims a total while more pages exist", () => {
  assert.deepEqual(paginationSummary({ loaded: 100, more: true, page: 1 }), {
    label: "100 loaded",
    complete: false,
    pages: 1,
  });
});

test("a fully loaded window is stated as such", () => {
  const summary = paginationSummary({ loaded: 240, more: false, page: 3 });
  assert.equal(summary.complete, true);
  assert.match(summary.label, /full window/);
});

test("empty schedules stay honest", () => {
  assert.equal(paginationSummary({ loaded: 0, more: false }).complete, true);
  assert.equal(paginationSummary({ loaded: 0, more: true }).complete, false);
});

test("only the final visible group is marked incomplete at a boundary", () => {
  const groups = [
    ["2026-11-05", [ev(1, 100)]],
    ["2026-11-06", [ev(2, 200)]],
  ];
  assert.deepEqual([...incompleteGroups(groups, { more: true })], ["2026-11-06"]);
  assert.equal(incompleteGroups(groups, { more: false }).size, 0);
});

test("pagesToRefresh lists every loaded page", () => {
  assert.deepEqual(pagesToRefresh(0), []);
  assert.deepEqual(pagesToRefresh(1), [1]);
  assert.deepEqual(pagesToRefresh(3), [1, 2, 3]);
});
