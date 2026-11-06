import test from "node:test";
import assert from "node:assert/strict";

import { buildCalendar, escapeText, foldLine, formatUtc, eventUid, icsFileName } from "../../js/utils/ics.js";
import {
  addDays,
  weekdayOf,
  startOfWeek,
  weekKeys,
  minutesIntoDay,
  bucketByDay,
  weekLabel,
} from "../../js/utils/calendar.js";
import { matchRanges, highlightText } from "../../js/utils/search-rank.js";
import { parseRoute, buildRoute } from "../../js/utils/router.js";
import {
  checkNotifications,
  reminderKey,
  inQuietHours,
  parseClock,
} from "../../js/services/notifications.js";

const TITLE = { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End", native: "" };
const event = (id, airingAt, extra = {}) => ({
  id,
  airingAt,
  episode: extra.episode ?? 5,
  media: { id: 900 + id, title: TITLE, duration: 24, format: "TV" },
  ...extra,
});

/* ============================ ICS ============================ */

test("iCalendar output is CRLF-delimited and structurally complete", () => {
  const { content, count } = buildCalendar({
    events: [event(1, 1795000000)],
    now: 1794990000000,
    reminderMinutes: 15,
  });
  assert.equal(count, 1);
  assert.ok(content.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(content.endsWith("END:VCALENDAR\r\n"));
  assert.ok(content.includes("\r\nVERSION:2.0\r\n"));
  assert.ok(content.includes("BEGIN:VEVENT") && content.includes("END:VEVENT"));
  assert.ok(content.includes("BEGIN:VALARM") && content.includes("TRIGGER:-PT15M"));
  assert.ok(!content.includes("\n\n"), "no blank lines");
  const bare = content.split("\r\n").filter((line) => line && !line.startsWith(" "));
  assert.ok(bare.every((line) => /^[A-Z-]+[:;]/.test(line)), "every line is a valid content line");
});

test("DTSTART/DTEND are UTC basic format", () => {
  const { content } = buildCalendar({ events: [event(1, 1795000000)], now: 1794990000000 });
  const start = /DTSTART:(\d{8}T\d{6}Z)/.exec(content);
  const end = /DTEND:(\d{8}T\d{6}Z)/.exec(content);
  assert.ok(start && end);
  const toMs = (value) =>
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
      Number(value.slice(9, 11)),
      Number(value.slice(11, 13)),
      Number(value.slice(13, 15))
    );
  assert.equal(toMs(start[1]), 1795000000 * 1000);
  assert.equal(toMs(end[1]) - toMs(start[1]), 24 * 60 * 1000, "duration respected");
});

test("text values are escaped", () => {
  assert.equal(escapeText("A, B; C\\D\nE"), "A\\, B\\; C\\\\D\\nE");
  const { content } = buildCalendar({
    events: [{ ...event(1, 1795000000), media: { ...event(1, 1795000000).media, title: { english: "Ranma, Part 2; Final" } } }],
    now: 1794990000000,
  });
  assert.ok(content.includes("SUMMARY:Ranma\\, Part 2\\; Final — Episode 5"));
});

test("long lines fold at 75 octets and survive unfolding", () => {
  const long = "A".repeat(300);
  const folded = foldLine(`DESCRIPTION:${long}`);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line.length}`);
  }
  assert.equal(folded.replace(/\r\n /g, ""), `DESCRIPTION:${long}`);
});

test("folding never splits a multi-byte character", () => {
  const text = "葬".repeat(60);
  const folded = foldLine(`SUMMARY:${text}`);
  for (const line of folded.split("\r\n")) {
    assert.ok(!line.includes("\uFFFD"));
  }
  assert.equal(folded.replace(/\r\n /g, ""), `SUMMARY:${text}`);
});

test("UIDs are stable per airing and change when an episode moves", () => {
  const a = eventUid(event(7, 1795000000));
  assert.equal(a, eventUid(event(7, 1795000000)));
  assert.notEqual(a, eventUid(event(7, 1795000100)));
  assert.match(a, /^ep-7-1795000000@otaku-time\.local$/);
});

test("invalid events are skipped instead of emitting broken entries", () => {
  const { content, count } = buildCalendar({
    events: [event(1, 1795000000), { id: 2 }, null, { airingAt: 123 }],
    now: 1794990000000,
  });
  assert.equal(count, 1);
  assert.equal(content.match(/BEGIN:VEVENT/g).length, 1);
});

test("export file names are scoped", () => {
  assert.match(icsFileName("episode", 42), /^otaku-time-episode-42-\d{4}-\d{2}-\d{2}\.ics$/);
  assert.match(icsFileName("watchlist"), /^otaku-time-watchlist-\d{4}-\d{2}-\d{2}\.ics$/);
});

test("formatUtc pads every component", () => {
  assert.equal(formatUtc(Date.UTC(2026, 0, 2, 3, 4, 5)), "20260102T030405Z");
});

/* ========================== CALENDAR ========================== */

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29", "leap year");
});

test("startOfWeek respects Monday-first weeks in any zone", () => {
  const wed = Date.UTC(2026, 10, 4, 12);
  assert.equal(startOfWeek(wed, "UTC", 1), "2026-11-02");
  assert.equal(startOfWeek(wed, "UTC", 0), "2026-11-01");
  // 2026-11-04T20:00Z is already Thursday in Tokyo.
  const tokyo = startOfWeek(Date.UTC(2026, 10, 4, 20), "Asia/Tokyo", 1);
  assert.equal(tokyo, "2026-11-02");
});

test("weekKeys returns seven consecutive days", () => {
  assert.deepEqual(weekKeys("2026-11-02"), [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ]);
});

test("weekdayOf is stable for a known date", () => {
  assert.equal(weekdayOf("2026-11-05"), 4, "Thursday");
});

test("minutesIntoDay is timezone aware", () => {
  const instant = Date.UTC(2026, 10, 4, 15, 30);
  assert.equal(minutesIntoDay(instant, "UTC"), 15 * 60 + 30);
  assert.equal(minutesIntoDay(instant, "Asia/Tokyo"), 0 * 60 + 30, "midnight in Tokyo");
  assert.equal(minutesIntoDay(instant, "Asia/Kolkata"), 21 * 60);
});

test("events bucket by local day and sort inside the bucket", () => {
  const buckets = bucketByDay(
    [
      { id: 1, airingAt: Date.UTC(2026, 10, 4, 3) / 1000 },
      { id: 2, airingAt: Date.UTC(2026, 10, 4, 1) / 1000 },
      { id: 3, airingAt: Date.UTC(2026, 10, 5, 1) / 1000 },
    ],
    "UTC"
  );
  assert.deepEqual(buckets.get("2026-11-04").map((e) => e.id), [2, 1]);
  assert.equal(buckets.get("2026-11-05").length, 1);
});

test("weekLabel adapts to cross-month and cross-year weeks", () => {
  assert.match(weekLabel("2026-11-02", "2026-11-08"), /2.*8/);
  assert.match(weekLabel("2026-12-28", "2027-01-03"), /2026.*2027/s);
});

/* ========================== HIGHLIGHT ========================== */

test("highlight escapes markup-like input", () => {
  const output = highlightText('<img src=x onerror="alert(1)">', "img");
  assert.ok(!output.includes("<img"), "raw tag never survives");
  assert.ok(output.startsWith("&lt;"));
  assert.ok(output.includes("<mark>img</mark>"));
});

test("highlight escapes quotes and ampersands", () => {
  const output = highlightText(`Tom & Jerry's "Show"`, "tom");
  assert.ok(output.includes("&amp;"));
  assert.ok(output.includes("&#39;"));
  assert.ok(output.includes("&quot;"));
});

test("highlight matches case-insensitively and marks every occurrence", () => {
  const output = highlightText("Frieren frieren FRIEREN", "frieren");
  assert.equal(output.match(/<mark>/g).length, 3);
});

test("fuzzy queries highlight the matched word", () => {
  const output = highlightText("Attack on Titan", "atack");
  assert.equal(output, "<mark>Attack</mark> on Titan");
});

test("no query leaves text untouched (but escaped)", () => {
  assert.equal(highlightText("A & B", ""), "A &amp; B");
  assert.deepEqual(matchRanges("A & B", ""), []);
});

test("match ranges are merged and sorted", () => {
  assert.deepEqual(matchRanges("abcabc", "abc"), [[0, 6]]);
  assert.deepEqual(matchRanges("xx abc yy abc", "abc"), [
    [3, 6],
    [10, 13],
  ]);
});

/* ============================ ROUTER ============================ */

test("section routes parse", () => {
  assert.equal(parseRoute("#upcoming").section, "upcoming");
  assert.equal(parseRoute("#watchlist").section, "watchlist");
  assert.equal(parseRoute("#recent").section, "recent");
  assert.equal(parseRoute("").section, null);
});

test("calendar is a secondary view of Upcoming", () => {
  const route = parseRoute("#calendar");
  assert.equal(route.section, "upcoming");
  assert.equal(route.view, "calendar");
});

test("detail routes validate media ids", () => {
  assert.equal(parseRoute("#show/123").mediaId, 123);
  assert.equal(parseRoute("#show/0").invalid, true);
  assert.equal(parseRoute("#show/-2").invalid, true);
  assert.equal(parseRoute("#show/abc").invalid, true);
  assert.equal(parseRoute("#show/").invalid, true);
  assert.equal(parseRoute("#show/99999999999").invalid, true);
});

test("unknown routes are reported, not guessed", () => {
  assert.equal(parseRoute("#nonsense").unknown, true);
});

test("buildRoute round-trips", () => {
  assert.equal(buildRoute({ section: "watchlist" }), "#watchlist");
  assert.equal(buildRoute({ section: "upcoming", view: "calendar" }), "#calendar");
  assert.equal(buildRoute({ mediaId: 42 }), "#show/42");
  assert.equal(buildRoute({}), "#upcoming");
});

/* ========================= NOTIFICATIONS ========================= */

function prefsBase(overrides = {}) {
  return {
    notifications: true,
    reminder: 15,
    timezone: "UTC",
    quietHours: { enabled: false, start: "22:00", end: "07:00" },
    ...overrides,
  };
}

const soon = (minutes = 10) => Math.floor(Date.now() / 1000) + minutes * 60;

test("no reminders without permission", async () => {
  const result = await checkNotifications(
    { schedules: { upcoming: [event(1, soon())] }, watchlistItems: () => [{ id: 901 }] },
    { permission: "denied", prefs: prefsBase(), store: {}, now: Date.now() }
  );
  assert.equal(result.sent, 0);
  assert.equal(result.reason, "permission");
});

test("reminders are off by preference", async () => {
  const result = await checkNotifications(
    { schedules: { upcoming: [event(1, soon())] }, watchlistItems: () => [{ id: 901 }] },
    { permission: "granted", prefs: prefsBase({ notifications: false }), store: {}, now: Date.now() }
  );
  assert.equal(result.reason, "disabled");
});

test("a delivered reminder is recorded and counted once", async () => {
  const store = {};
  const delivered = [];
  const input = { schedules: { upcoming: [event(2, soon())] }, watchlistItems: () => [{ id: 902 }] };
  const deps = {
    permission: "granted",
    prefs: prefsBase(),
    store,
    now: Date.now(),
    deliver: async (message) => {
      delivered.push(message);
      return true;
    },
  };

  const first = await checkNotifications(input, deps);
  assert.equal(first.sent, 1);
  assert.equal(delivered.length, 1);
  assert.equal(store[reminderKey(event(2, soon()))] !== undefined, true);

  const second = await checkNotifications(input, deps);
  assert.equal(second.sent, 0, "already recorded");
  assert.equal(delivered.length, 1);
});

test("failed delivery is not recorded and is not counted", async () => {
  const store = {};
  const input = { schedules: { upcoming: [event(3, soon())] }, watchlistItems: () => [{ id: 903 }] };
  const result = await checkNotifications(input, {
    permission: "granted",
    prefs: prefsBase(),
    store,
    now: Date.now(),
    deliver: async () => false,
  });
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(store, {});
});

test("a rescheduled episode is a new reminder", async () => {
  const store = {};
  const delivered = [];
  const deps = {
    permission: "granted",
    prefs: prefsBase(),
    store,
    now: Date.now(),
    deliver: async (message) => {
      delivered.push(message);
      return true;
    },
  };
  const first = await checkNotifications(
    { schedules: { upcoming: [event(4, soon())] }, watchlistItems: () => [{ id: 904 }] },
    deps
  );
  const second = await checkNotifications(
    { schedules: { upcoming: [event(4, soon(12))] }, watchlistItems: () => [{ id: 904 }] },
    deps
  );
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 1);
  assert.equal(Object.keys(store).length, 2);
});

test("concurrent checks never double-fire", async () => {
  const store = {};
  let calls = 0;
  const deps = {
    permission: "granted",
    prefs: prefsBase(),
    store,
    now: Date.now(),
    deliver: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return true;
    },
  };
  const input = { schedules: { upcoming: [event(5, soon())] }, watchlistItems: () => [{ id: 905 }] };
  const first = checkNotifications(input, deps);
  const second = checkNotifications(input, deps);
  assert.equal(first, second, "the second tick joins the running check");
  const result = await first;
  assert.equal(calls, 1);
  assert.equal(result.sent, 1);
});

test("only titles on the watchlist remind", async () => {
  const result = await checkNotifications(
    { schedules: { upcoming: [event(6, soon())] }, watchlistItems: () => [{ id: 1 }] },
    { permission: "granted", prefs: prefsBase(), store: {}, now: Date.now(), deliver: async () => true }
  );
  assert.equal(result.sent, 0);
});

test("episodes outside the lead window are ignored", async () => {
  const result = await checkNotifications(
    { schedules: { upcoming: [event(7, soon(120))] }, watchlistItems: () => [{ id: 907 }] },
    { permission: "granted", prefs: prefsBase(), store: {}, now: Date.now(), deliver: async () => true }
  );
  assert.equal(result.sent, 0);
});

test("quiet hours suppress reminders", async () => {
  const result = await checkNotifications(
    { schedules: { upcoming: [event(8, soon())] }, watchlistItems: () => [{ id: 908 }] },
    {
      permission: "granted",
      prefs: prefsBase({ quietHours: { enabled: true, start: "00:00", end: "23:59" } }),
      store: {},
      now: Date.now(),
      deliver: async () => true,
    }
  );
  assert.equal(result.reason, "quiet-hours");
  assert.equal(result.sent, 0);
});

test("quiet hours handle midnight wrap", () => {
  assert.equal(inQuietHours(23 * 60, "22:00", "07:00"), true);
  assert.equal(inQuietHours(6 * 60, "22:00", "07:00"), true);
  assert.equal(inQuietHours(12 * 60, "22:00", "07:00"), false);
  assert.equal(inQuietHours(9 * 60, "08:00", "17:00"), true);
  assert.equal(parseClock("24:00"), null);
  assert.equal(parseClock("7:5"), null);
  assert.equal(parseClock("07:05"), 425);
});
