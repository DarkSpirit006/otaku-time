/* ============================================================
   Otaku Time — broadcast wire

   The strip under the topbar is derived text, so it can be wrong in
   ways a screenshot would not show: stale countdowns, a "next" line
   for something already aired, the same broadcast listed twice.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";

import { wireLines, wireMarkup } from "../../js/components/wire.js";

const NOW = 1_800_000_000;

const event = (id, episode, airingAt, title = `Show ${id}`) => ({
  id,
  episode,
  airingAt,
  media: { title: { english: title, romaji: title, native: title }, duration: 24 },
});

test("the wire leads with what airs next, soonest first", () => {
  const lines = wireLines({
    now: NOW,
    upcoming: [
      event(1, 3, NOW + 7200, "Third"),
      event(2, 7, NOW + 600, "Sooner"),
      event(3, 1, NOW + 86_400, "Tomorrow"),
    ],
  });

  assert.match(lines[0], /^Next — Sooner EP 07/);
  assert.match(lines[1], /^Next — Third EP 03/);
  assert.match(lines[2], /^Next — Tomorrow EP 01/);
});

test("episodes get a two-digit stamp", () => {
  const [line] = wireLines({ now: NOW, upcoming: [event(1, 7, NOW + 60)] });
  assert.match(line, /EP 07/);
});

test("three ahead is the cap, however much is loaded", () => {
  const upcoming = Array.from({ length: 9 }, (_, i) => event(i, i + 1, NOW + 60 * (i + 1)));
  const lines = wireLines({ now: NOW, upcoming });
  assert.equal(lines.filter((line) => line.startsWith("Next")).length, 3);
});

test("nothing already aired is announced as next", () => {
  const lines = wireLines({
    now: NOW,
    upcoming: [event(1, 5, NOW - 60, "Gone"), event(2, 6, NOW + 60, "Soon")],
  });
  assert.equal(lines.filter((line) => line.startsWith("Next")).length, 1);
  assert.match(lines[0], /Soon/);
});

test("the record line names the most recent broadcasts, newest first", () => {
  const lines = wireLines({
    now: NOW,
    recent: [event(1, 9, NOW - 7200, "Older"), event(2, 4, NOW - 600, "Newest")],
  });
  assert.match(lines[0], /^On record — Newest EP 04/);
  assert.match(lines[1], /^On record — Older EP 09/);
});

test("a mixed window reads next, then record, then provenance", () => {
  const lines = wireLines({
    now: NOW,
    tracked: 4,
    upcoming: [event(1, 5, NOW + 3600)],
    recent: [event(2, 4, NOW - 3600)],
  });

  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Next/);
  assert.match(lines[1], /^On record/);
  assert.match(lines[2], /2 broadcasts in this window · 4 titles tracked/);
});

test("an empty window says so instead of advertising the app", () => {
  const lines = wireLines({ now: NOW });
  assert.deepEqual(lines, [], "no data means no claims");

  const { track, plain } = wireMarkup(lines);
  assert.match(track, /nothing loaded yet/);
  assert.match(plain, /Schedule feed empty/);
});

test("wire text is escaped before it reaches the DOM", () => {
  const lines = wireLines({
    now: NOW,
    upcoming: [event(1, 2, NOW + 60, `<img src=x onerror=alert(1)>`)],
  });
  const { track } = wireMarkup(lines);
  assert.ok(!track.includes("<img"), "markup from a title must not become markup");
  assert.match(track, /&lt;img/);
});

test("a missing episode number is left out, not printed as EP null", () => {
  const lines = wireLines({ now: NOW, upcoming: [{ ...event(1, null, NOW + 60), episode: null }] });
  assert.ok(!/EP (null|undefined|NaN)/.test(lines[0]), lines[0]);
});

test("ticker-scale time never says seconds", async () => {
  const { wireWhen } = await import("../../js/components/wire.js");
  const now = 1_000_000;
  assert.equal(wireWhen(now, now), "now");
  assert.equal(wireWhen(now + 30, now), "under a minute");
  assert.equal(wireWhen(now + 90, now), "1m");
  assert.equal(wireWhen(now + 2700, now), "45m");
  assert.equal(wireWhen(now + 3600, now), "1h");
  assert.equal(wireWhen(now + 5460, now), "1h 31m");
  assert.equal(wireWhen(now + 86_400, now), "a day");
  assert.equal(wireWhen(now + 3 * 86_400, now), "3 days");
  for (const delta of [0, 30, 90, 3600, 86_400, 259_200]) {
    assert.ok(!/s\b/.test(wireWhen(now + delta, now).replace("days", "")), "no seconds in a wire line");
  }
});

test("an empty watchlist is not announced as zero titles", () => {
  const lines = wireLines({
    now: NOW,
    tracked: 0,
    upcoming: [event(1, 5, NOW + 3600)],
    recent: [event(2, 4, NOW - 3600)],
  });
  assert.match(lines[2], /2 broadcasts in this window/);
  assert.ok(!/0 titles/.test(lines[2]), "counting nothing is not information");
});
