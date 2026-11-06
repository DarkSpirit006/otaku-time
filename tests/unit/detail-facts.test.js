/* ============================================================
   Otaku Time — detail dialog data shaping

   These decisions used to live inside renderDetail(), where the only
   way to exercise them was to open a dialog in a browser. They decide
   what reaches the DOM (only https links) and which facts are shown
   (an unknown value is left out rather than printed as a blank).
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";

import { dateLabel, detailFacts, detailLinks, safeUrl } from "../../js/features/detail/facts.js";

test("only https links survive", () => {
  assert.equal(safeUrl("https://crunchyroll.com/x"), "https://crunchyroll.com/x");
  assert.equal(safeUrl("http://crunchyroll.com/x"), null, "plain http is refused");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,<script>"), null);
  assert.equal(safeUrl("not a url"), null);
  assert.equal(safeUrl(undefined), null);
});

test("links are split by kind and capped", () => {
  const many = Array.from({ length: 9 }, (_, index) => ({
    site: `Stream ${index}`,
    url: `https://example.com/${index}`,
    type: "STREAMING",
  }));

  const { streaming, others, trailer } = detailLinks({
    externalLinks: [
      ...many,
      { site: "Official", url: "https://example.com/site", type: "INFO" },
      { site: "Unsafe", url: "http://example.com", type: "INFO" },
    ],
  });

  assert.equal(streaming.length, 6, "a wall of chips is not a feature list");
  assert.equal(others.length, 1);
  assert.equal(others[0].site, "Official");
  assert.equal(trailer, null, "no trailer means no trailer block");
});

test("trailers are only built from youtube ids", () => {
  assert.deepEqual(detailLinks({ trailer: { site: "youtube", id: "abc123" } }).trailer, {
    site: "YouTube",
    url: "https://www.youtube.com/watch?v=abc123",
  });
  assert.equal(detailLinks({ trailer: { site: "dailymotion", id: "x" } }).trailer, null);
  assert.equal(detailLinks({ trailer: { site: "youtube" } }).trailer, null);
  assert.equal(detailLinks({}).trailer, null, "a missing media object is not a crash");
});

test("a trailer id cannot break out of the URL", () => {
  const { trailer } = detailLinks({ trailer: { site: "youtube", id: "a&b=c d" } });
  assert.equal(trailer.url, "https://www.youtube.com/watch?v=a%26b%3Dc%20d");
});

test("facts omit what AniList does not know", () => {
  const facts = detailFacts({ format: "TV", duration: 24, averageScore: 0, popularity: 0 }, null);
  assert.deepEqual(facts, [
    ["Format", "TV"],
    ["Runtime", "24 min"],
  ]);
});

test("facts render in a stable order with the known total", () => {
  const facts = detailFacts(
    {
      format: "TV",
      duration: 24,
      mediaStatus: "RELEASING",
      startDate: { year: 2026, month: 10, day: 1 },
      endDate: null,
      studios: [{ name: "Studio A", isAnimationStudio: true }, { name: "Studio B", isMain: true }, { name: "C", isAnimationStudio: false }],
      averageScore: 88,
      popularity: 123456,
    },
    24
  );

  assert.deepEqual(facts, [
    ["Format", "TV"],
    ["Episodes", "24"],
    ["Runtime", "24 min"],
    ["Status", "Releasing"],
    ["Started", "Oct 1 2026"],
    ["Studio", "Studio A, Studio B"],
    ["AniList score", "88%"],
    ["Popularity", "123,456 users"],
  ]);
});

test("dates degrade to the precision AniList gives", () => {
  assert.equal(dateLabel({ year: 2026 }), "2026");
  assert.equal(dateLabel({ year: 2026, month: 3 }), "Mar 2026");
  assert.equal(dateLabel({ year: 2026, month: 3, day: 9 }), "Mar 9 2026");
  assert.equal(dateLabel(null), "");
  assert.equal(dateLabel({}), "");
});

test("no media means no facts at all", () => {
  assert.deepEqual(detailFacts(null, 12), []);
});
