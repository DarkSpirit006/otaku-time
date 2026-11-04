/* ============================================================
   Otaku Time — local fuzzy search ranking (pure)
   Ranks an in-memory media pool instantly while the remote
   AniList search response is in flight.
   ============================================================ */

/** Normalize a string for matching: lowercase, NFKC, punctuation → spaces. */
export function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Damerau–Levenshtein distance with early exit for far-apart strings. */
export function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let prevPrev = null;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prevPrev[j - 2] + 1);
      }
    }
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length];
}

const TITLE_WEIGHTS = [
  ["english", 1.3],
  ["romaji", 1.1],
  ["native", 1],
];

/**
 * Rank `items` against `query`. Returns matches sorted by relevance.
 * Exact matches first, then score, then id for stable ordering.
 */
export function rank(query, items) {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(" ").slice(0, 8);

  return items
    .map((media) => {
      let best = 0;
      let exact = false;

      const candidates = [
        ...TITLE_WEIGHTS.map(([field, weight]) => [media.title?.[field], weight]),
        ...(media.synonyms || []).map((syn) => [syn, 0.9]),
      ];

      for (const [raw, weight] of candidates) {
        const candidate = normalize(raw);
        if (!candidate) continue;
        if (candidate === q) exact = true;

        let score =
          candidate === q ? 1000 : candidate.startsWith(q) ? 500 : candidate.includes(q) ? 300 : 0;
        let matches = 0;
        const words = candidate.split(" ").slice(0, 30);

        for (const token of tokens) {
          if (words.some((w) => w === token)) {
            score += 90;
            matches++;
          } else if (words.some((w) => w.startsWith(token))) {
            score += 50;
            matches++;
          } else if (
            token.length >= 4 &&
            token.length < 40 &&
            words.some((w) => w.length < 40 && distance(token, w) <= (token.length <= 6 ? 1 : 2))
          ) {
            score += 20;
            matches++;
          }
        }

        if (matches !== tokens.length) continue;
        score += 150;
        best = Math.max(best, score * weight);
      }

      return { media, score: best, exact };
    })
    .filter((entry) => entry.score > 25)
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        b.score - a.score ||
        a.media.id - b.media.id
    )
    .map((entry) => entry.media);
}
