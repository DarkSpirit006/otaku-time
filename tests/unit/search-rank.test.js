import test from "node:test";
import assert from "node:assert/strict";

import { normalize, distance, rank } from "../../js/utils/search-rank.js";

const media = (id, titles, extra = {}) => ({
  id,
  title: {
    english: titles.english || "",
    romaji: titles.romaji || "",
    native: titles.native || "",
  },
  synonyms: extra.synonyms || [],
  averageScore: extra.score ?? 80,
  ...extra,
});

const CATALOG = [
  media(1, { english: "Frieren: Beyond Journey's End", romaji: "Sousou no Frieren" }),
  media(2, { english: "Fullmetal Alchemist: Brotherhood", romaji: "Hagane no Renkinjutsu" }),
  media(3, { romaji: "Shingeki no Kyojin", english: "Attack on Titan", native: "進撃の巨人" }),
  media(4, { romaji: "Sousou no Frieren", english: "Frieren" }),
  media(5, { romaji: "One Piece" }, { score: 90 }),
  media(6, { romaji: "Detective is Already Dead" }, { synonyms: ["Tantei wa Mou, Shindeiru"] }),
];

test("normalize lowercases, strips punctuation and collapses spaces", () => {
  assert.equal(normalize("  Frieren:  Beyond!! "), "frieren beyond");
  assert.equal(normalize("SHINGEKI no KYOJIN"), "shingeki no kyojin");
  assert.equal(normalize(null), "");
  assert.equal(normalize("Spéciál—Náme"), "spéciál náme");
});

test("distance handles small edits and early-exits far strings", () => {
  assert.equal(distance("frieren", "frieren"), 0);
  assert.equal(distance("frieren", "frierem"), 1);
  assert.ok(distance("abc", "completely-different-string") >= 3);
});

test("rank finds exact english title first", () => {
  const results = rank("Frieren", CATALOG);
  assert.ok(results.length >= 2);
  assert.equal(results[0].id, 4); // exact "Frieren"
});

test("rank matches romaji and synonyms", () => {
  const romaji = rank("sousou no frieren", CATALOG);
  assert.ok(romaji.some((m) => m.id === 1 || m.id === 4));

  const syn = rank("tantei wa mou", CATALOG);
  assert.ok(syn.some((m) => m.id === 6), "synonym should match");
});

test("rank tolerates small typos", () => {
  const results = rank("frierem", CATALOG);
  assert.ok(results.length > 0, "fuzzy match should return results");
});

test("rank filters weak matches below threshold", () => {
  assert.deepEqual(rank("zzzznotpresent", CATALOG), []);
  assert.deepEqual(rank("", CATALOG), []);
  assert.deepEqual(rank("   ", CATALOG), []);
});

test("rank orders by relevance with exact match first", () => {
  const results = rank("one piece", CATALOG);
  assert.equal(results[0].id, 5);
});

test("rank is stable for equal scores (by id)", () => {
  const items = [
    media(9, { romaji: "Same Title" }),
    media(3, { romaji: "Same Title" }),
    media(7, { romaji: "Same Title" }),
  ];
  const results = rank("same title", items);
  assert.deepEqual(
    results.map((m) => m.id),
    [3, 7, 9]
  );
});
