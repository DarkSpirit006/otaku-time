import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validEvents, normalizeMedia } from "../../js/api/normalize.js";
import { titleOf, cleanDescription } from "../../js/utils/format.js";
import { dayKey, countdown } from "../../js/utils/time.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function load(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

test("captured upcoming fixture is a real AniList Page payload", () => {
  const payload = load("schedule-upcoming.json");
  assert.ok(payload.data?.Page?.airingSchedules?.length > 0, "has events");
  assert.ok(payload.data.Page.pageInfo.hasNextPage !== undefined, "has pageInfo");

  const events = validEvents(payload.data.Page.airingSchedules);
  assert.ok(events.length > 0, "events survive validation");
  assert.equal(events.length, payload.data.Page.airingSchedules.length, "nothing valid was dropped");

  for (const event of events) {
    assert.ok(Number.isInteger(event.id));
    assert.ok(Number.isInteger(event.episode));
    assert.ok(event.airingAt > 1_700_000_000, "airing time is a modern epoch");
    assert.equal(event.media.type, "ANIME");
    assert.notEqual(event.media.isAdult, true);
    const title = titleOf(event.media);
    assert.ok(title.length > 0);
    // Cover art must live on the AniList CDN
    if (event.media.coverImage.large) {
      assert.ok(event.media.coverImage.large.startsWith("https://s4.anilist.co/"));
    }
    // Formatting helpers must not throw on real data
    assert.equal(typeof countdown(event.airingAt, event.media.duration), "string");
    assert.equal(typeof dayKey(event.airingAt * 1000, "UTC"), "string");
  }
});

test("captured recent fixture is reverse-chronological and valid", () => {
  const payload = load("schedule-recent.json");
  const raw = payload.data.Page.airingSchedules;
  const events = validEvents(raw);
  assert.ok(events.length > 0);

  // TIME_DESC ordering preserved by validation
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i - 1].airingAt >= events[i].airingAt, "sorted newest first");
  }

  // Recent window: everything aired within the last ~35 days of capture
  const newest = events[0].airingAt;
  for (const event of events) {
    assert.ok(newest - event.airingAt <= 35 * 86400, "inside the recent window");
  }
});

test("real descriptions sanitize to readable text", () => {
  const payload = load("schedule-upcoming.json");
  for (const raw of payload.data.Page.airingSchedules.slice(0, 10)) {
    const media = normalizeMedia(raw.media);
    if (!media) continue;
    const text = cleanDescription(media.description);
    assert.equal(text.includes("<"), false, "no tags survive");
    assert.equal(text.includes("&amp;"), false, "entities decoded");
  }
});

test("normalizeMedia accepts every fixture record", () => {
  for (const name of ["schedule-upcoming.json", "schedule-recent.json"]) {
    const payload = load(name);
    for (const raw of payload.data.Page.airingSchedules) {
      const media = normalizeMedia(raw.media);
      assert.ok(media, `${name}: media ${raw.media?.id} normalized`);
      assert.ok(media.id > 0);
      assert.ok(media.title.romaji || media.title.english || media.title.native);
    }
  }
});
