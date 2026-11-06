import test from "node:test";
import assert from "node:assert/strict";

import { imageUrl, normalizeMedia, validEvents, validMediaList } from "../../js/api/normalize.js";

test("imageUrl accepts AniList CDN https URLs only", () => {
  const ok = imageUrl("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx123.jpg");
  assert.ok(ok);
  assert.ok(ok.startsWith("https://s4.anilist.co/"));

  assert.equal(imageUrl("http://s4.anilist.co/x.jpg"), null, "no plain http");
  assert.equal(imageUrl("https://evil.example/x.jpg"), null, "foreign host");
  assert.equal(imageUrl("https://s4.anilist.co.evil.com/x.jpg"), null, "suffix spoof");
  assert.equal(imageUrl("javascript:alert(1)"), null);
  assert.equal(imageUrl(""), null);
  assert.equal(imageUrl(null), null);
  assert.equal(imageUrl("https://s4.anilist.co/" + "a".repeat(600)), null, "too long");
});

const rawMedia = {
  id: 16498,
  type: "ANIME",
  isAdult: false,
  format: "TV",
  status: "FINISHED",
  episodes: 25,
  duration: 24,
  averageScore: 90,
  season: "FALL",
  seasonYear: 2013,
  genres: ["Action", "Drama"],
  synonyms: ["SnK"],
  description: "Humanity fights.",
  title: { romaji: "Shingeki no Kyojin", english: "Attack on Titan", native: "進撃の巨人" },
  coverImage: {
    medium: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498.jpg",
    large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498.jpg",
    extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498.jpg",
  },
  bannerImage: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498.jpg",
  nextAiringEpisode: { id: 1, episode: 26, airingAt: 1794000000 },
};

test("normalizeMedia keeps a valid record", () => {
  const media = normalizeMedia(rawMedia);
  assert.equal(media.id, 16498);
  assert.equal(media.title.english, "Attack on Titan");
  assert.ok(media.coverImage.large.startsWith("https://"));
  assert.equal(media.nextAiringEpisode.episode, 26);
  assert.deepEqual(media.genres, ["Action", "Drama"]);
});

test("normalizeMedia rejects invalid ids", () => {
  assert.equal(normalizeMedia(null), null);
  assert.equal(normalizeMedia({}), null);
  assert.equal(normalizeMedia({ id: -5 }), null);
  assert.equal(normalizeMedia({ id: 1.5 }), null);
  assert.equal(normalizeMedia({ id: "16498" }), null);
  assert.equal(normalizeMedia({ id: 2 ** 32 }), null);
});

test("normalizeMedia sanitizes hostile field values", () => {
  const media = normalizeMedia({
    id: 1,
    type: "MANGA",
    isAdult: true,
    title: { romaji: "X".repeat(500), english: 42, native: null },
    coverImage: { large: "https://attacker.test/pwn.png" },
    genres: ["ok", 42, null, "fine"],
    description: 12345,
    nextAiringEpisode: { id: "bad", episode: null, airingAt: "soon" },
    externalLinks: [{ site: "X", url: "javascript:alert(1)" }, { site: "Y", url: "https://y.test" }],
  });
  assert.equal(media.type, "MANGA");
  assert.equal(media.isAdult, true);
  assert.equal(media.title.romaji.length, 300, "title truncated");
  assert.equal(media.title.english, "", "non-strings dropped");
  assert.equal(media.coverImage.large, null, "foreign image dropped");
  assert.deepEqual(media.genres, ["ok", "fine"], "non-string genres dropped");
  assert.equal(media.description, "");
  assert.equal(media.nextAiringEpisode, null, "invalid next-episode dropped");
  assert.deepEqual(media.externalLinks, [{ site: "Y", url: "https://y.test" }]);
});

test("validEvents keeps only integer-id anime schedule entries", () => {
  const events = validEvents([
    { id: 1, episode: 3, airingAt: 1794000000, media: { ...rawMedia } },
    { id: 1, episode: 3, airingAt: 1794000000, media: { ...rawMedia } }, // duplicate id
    { id: 2, episode: 0, airingAt: 1794000001, media: { ...rawMedia } }, // episode 0 allowed
    { id: "3", episode: 1, airingAt: 1794000002, media: { ...rawMedia } }, // string id
    { id: 4, episode: 1, airingAt: 1794000003, media: { ...rawMedia, isAdult: true } }, // adult
    { id: 5, episode: 1, airingAt: 1794000004, media: { ...rawMedia, type: "MANGA" } },
    { id: 6, episode: -1, airingAt: 1794000005, media: { ...rawMedia } },
    { id: 7, episode: 1, airingAt: 0, media: { ...rawMedia } },
    null,
    "junk",
    { id: 8, episode: 1, airingAt: 1794000006 }, // missing media
  ]);
  assert.deepEqual(
    events.map((e) => e.id),
    [1, 2]
  );
  assert.equal(events[0].media.title.english, "Attack on Titan");
});

test("validEvents tolerates garbage input", () => {
  assert.deepEqual(validEvents(null), []);
  assert.deepEqual(validEvents(undefined), []);
  assert.deepEqual(validEvents({}), []);
  assert.deepEqual(validEvents("nope"), []);
});

test("validMediaList drops invalid and adult entries", () => {
  const list = validMediaList([
    rawMedia,
    { ...rawMedia, id: 9, isAdult: true },
    { id: null },
    null,
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 16498);
});

test("cover colours are only accepted in hex form", () => {
  assert.equal(normalizeMedia({ id: 1, coverImage: { color: "#3b4A6b" } }).coverImage.color, "#3b4a6b");
  assert.equal(normalizeMedia({ id: 1, coverImage: { color: "#abc" } }).coverImage.color, "#abc");
  assert.equal(normalizeMedia({ id: 1, coverImage: { color: "red" } }).coverImage.color, null);
  assert.equal(normalizeMedia({ id: 1, coverImage: { color: "url(javascript:1)" } }).coverImage.color, null);
});

test("streaming links keep their type and language", () => {
  const media = normalizeMedia({
    id: 1,
    externalLinks: [
      { site: "Crunchyroll", url: "https://crunchyroll.com/x", type: "STREAMING", language: "English" },
      { site: "Official Site", url: "https://example.com" },
    ],
  });
  assert.equal(media.externalLinks[0].type, "STREAMING");
  assert.equal(media.externalLinks[0].language, "English");
  assert.equal("type" in media.externalLinks[1], false);
});
