import test from "node:test";
import assert from "node:assert/strict";

import {
  titleOf,
  formatLabel,
  statusLabel,
  cleanDescription,
  genreLine,
  durationLabel,
} from "../../js/utils/format.js";

test("titleOf prefers english, then romaji, then native", () => {
  const media = {
    title: { english: "English", romaji: "Romaji", native: "日本語" },
  };
  assert.equal(titleOf(media), "English");
  assert.equal(titleOf({ title: { romaji: "Romaji", native: "日本語" } }), "Romaji");
  assert.equal(titleOf({ title: { native: "日本語" } }), "日本語");
  assert.equal(titleOf(null), "Untitled anime");
  assert.equal(titleOf({}), "Untitled anime");
});

test("formatLabel maps AniList formats to display labels", () => {
  assert.equal(formatLabel("TV"), "TV");
  assert.equal(formatLabel("TV_SHORT"), "TV short");
  assert.equal(formatLabel("MOVIE"), "Movie");
  assert.equal(formatLabel("ONA"), "ONA");
  assert.equal(formatLabel(undefined), "Anime");
  assert.equal(formatLabel("SOMETHING_NEW"), "Anime");
});

test("statusLabel humanizes enums", () => {
  assert.equal(statusLabel("FINISHED"), "Finished");
  assert.equal(statusLabel("RELEASING"), "Releasing");
  assert.equal(statusLabel("NOT_YET_RELEASED"), "Not Yet Released");
  assert.equal(statusLabel(""), "");
});

test("cleanDescription strips HTML and decodes entities", () => {
  assert.equal(cleanDescription("Hello <br> world"), "Hello\nworld");
  assert.equal(cleanDescription("<p>One</p><p>Two</p>"), "One\nTwo");
  assert.equal(cleanDescription("Tom &amp; Jerry &lt;3"), "Tom & Jerry <3");
  assert.equal(cleanDescription("It&#39;s fine&nbsp;here"), "It's fine here");
  assert.equal(cleanDescription(""), "");
  assert.equal(cleanDescription(null), "");
});

test("cleanDescription collapses runaway whitespace", () => {
  assert.equal(cleanDescription("a   b\n\n\n\nc"), "a b\n\nc");
});

test("genreLine joins genres safely", () => {
  assert.equal(genreLine(["Action", "Drama"]), "Action · Drama");
  assert.equal(genreLine([]), "");
  assert.equal(genreLine(undefined), "");
  assert.equal(genreLine(["solo"]), "solo");
});

/* ------------------------------------------------------------
   Watch time on the shelf
   ------------------------------------------------------------ */

test("durationLabel reads as time, not as a minute count", () => {
  assert.equal(durationLabel(45), "45m");
  assert.equal(durationLabel(60), "1h");
  assert.equal(durationLabel(1120), "18h 40m");
  assert.equal(durationLabel(0), "0m");
  assert.equal(durationLabel(null), "0m");
});

test("durationLabel rounds fractional minutes instead of printing them raw", () => {
  assert.equal(durationLabel(59.6), "1h");
  assert.equal(durationLabel(90.4), "1h 30m");
});
