import test from "node:test";
import assert from "node:assert/strict";

import {
  validZone,
  detectedZone,
  dayKey,
  nextDayKey,
  prevDayKey,
  countdown,
  timeAgo,
  dayLabel,
  isTodayOrTomorrow,
  clockText,
} from "../../js/utils/time.js";

test("validZone accepts real IANA zones and rejects junk", () => {
  assert.equal(validZone("Asia/Kolkata"), true);
  assert.equal(validZone("UTC"), true);
  assert.equal(validZone("Mars/Olympus"), false);
  assert.equal(validZone(""), false);
  assert.equal(validZone(null), false);
  assert.equal(validZone(42), false);
});

test("detectedZone returns a usable zone", () => {
  const zone = detectedZone();
  assert.equal(validZone(zone), true);
});

test("dayKey computes calendar days per zone", () => {
  // 2026-11-04 23:30 UTC is already Nov 5 in Kolkata (+05:30)
  const ms = Date.UTC(2026, 10, 4, 23, 30);
  assert.equal(dayKey(ms, "UTC"), "2026-11-04");
  assert.equal(dayKey(ms, "Asia/Kolkata"), "2026-11-05");
});

test("nextDayKey and prevDayKey cross month boundaries", () => {
  const ms = Date.UTC(2026, 11, 31, 12, 0);
  assert.equal(nextDayKey(ms, "UTC"), "2027-01-01");
  const ms2 = Date.UTC(2026, 0, 1, 12, 0);
  assert.equal(prevDayKey(ms2, "UTC"), "2025-12-31");
});

test("countdown formats future times", () => {
  const now = 1_000_000;
  assert.equal(countdown(now + 7200 + 840 + 5, 24, now), "in 2h 14m 5s");
  assert.equal(countdown(now + 90 * 86400 + 3600, 24, now), "in 90d 1h 0m");
  assert.equal(countdown(now + 125, 24, now), "in 2m 5s");
});

test("countdown reports airing-now for in-progress episodes", () => {
  const now = 1_000_000;
  // Episode started 10 minutes ago, duration 24 min
  assert.equal(countdown(now - 600, 24, now), "AIRING NOW · estimated");
});

test("countdown reports elapsed time after airing", () => {
  const now = 1_000_000;
  // Past the 24-minute "airing" window → counted as aired
  assert.equal(countdown(now - 1500, 24, now), "Aired 25m ago");
  assert.equal(countdown(now - 7200, 24, now), "Aired 2h ago");
  assert.equal(countdown(now - 3 * 86400, 24, now), "Aired 3d ago");
  // Unknown duration: anything under 30 minutes reads as "recently started"
  assert.equal(countdown(now - 300, 0, now), "Recently started");
  assert.equal(countdown(now - 3000, 0, now), "Aired 50m ago");
});

test("countdown handles missing schedules", () => {
  assert.equal(countdown(NaN, 0, 0), "Schedule TBA");
  assert.equal(countdown(undefined, 0, 0), "Schedule TBA");
});

test("timeAgo buckets", () => {
  const now = 1_000_000;
  assert.equal(timeAgo(now - 10, now), "just now");
  assert.equal(timeAgo(now - 300, now), "5m ago");
  assert.equal(timeAgo(now - 7200, now), "2h ago");
  assert.equal(timeAgo(now - 5 * 86400, now), "5d ago");
});

test("dayLabel resolves Today/Tomorrow/Yesterday and dates", () => {
  const now = Date.UTC(2026, 10, 4, 12, 0);
  assert.equal(dayLabel(now + 3600_000, "UTC", now), "Today");
  assert.equal(dayLabel(now + 86400_000, "UTC", now), "Tomorrow");
  assert.equal(dayLabel(now - 86400_000, "UTC", now), "Yesterday");
  const far = dayLabel(now + 5 * 86400_000, "UTC", now);
  assert.match(far, /\w{3}, \w{3} \d+/); // "Sat, Nov 9"
});

test("isTodayOrTomorrow checks day keys", () => {
  const now = Date.UTC(2026, 10, 4, 12, 0);
  assert.equal(isTodayOrTomorrow(dayKey(now, "UTC"), "UTC", now), true);
  assert.equal(isTodayOrTomorrow(nextDayKey(now, "UTC"), "UTC", now), true);
  assert.equal(isTodayOrTomorrow("2020-01-01", "UTC", now), false);
});

test("clockText honours hour12 preference", () => {
  const date = new Date("2026-11-04T14:05:09Z");
  assert.equal(clockText(date, "UTC", false), "14:05:09");
  const h12 = clockText(date, "UTC", true);
  assert.match(h12, /02:05:09\s?PM/i);
});
