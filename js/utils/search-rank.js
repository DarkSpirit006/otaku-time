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

/* ------------------------------------------------------------
   Match ranges + safe highlighting

   Ranges are computed against the original string, so callers can
   escape first and wrap second. Fuzzy matches highlight the word
   that was close enough to match, never the whole string.
   ------------------------------------------------------------ */

const WORD_SPAN = /[\p{L}\p{N}]+/gu;

/** Character ranges in `text` that match `query`, merged and sorted. */
export function matchRanges(text, query) {
  const source = String(text ?? "");
  const tokens = normalize(query).split(" ").filter(Boolean).slice(0, 8);
  if (!source || !tokens.length) return [];

  const ranges = [];
  const lower = source.toLocaleLowerCase();
  const lowered = tokens.map((token) => token.toLocaleLowerCase());

  for (const token of lowered) {
    let from = 0;
    while (token.length && from <= lower.length - token.length) {
      const index = lower.indexOf(token, from);
      if (index < 0) break;
      ranges.push([index, index + token.length]);
      from = index + token.length;
    }
  }

  if (ranges.length) return merge(ranges);

  // No direct substring: fall back to fuzzy word matching.
  for (const match of source.matchAll(WORD_SPAN)) {
    const word = normalize(match[0]);
    if (!word) continue;
    for (const token of tokens) {
      if (token.length < 3) continue;
      const limit = token.length <= 6 ? 1 : 2;
      if (word.startsWith(token) || distance(token, word) <= limit) {
        ranges.push([match.index, match.index + match[0].length]);
        break;
      }
    }
  }
  return merge(ranges);
}

function merge(ranges) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else out.push([range[0], range[1]]);
  }
  return out;
}

const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPE_MAP[character]);
}

/**
 * Escape `text` and wrap the matching parts in <mark>.
 * User/API text can never inject markup: every segment is escaped
 * before it becomes HTML.
 */
export function highlightText(text, query) {
  const source = String(text ?? "");
  const ranges = matchRanges(source, query);
  if (!ranges.length) return escapeHtml(source);

  let html = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    html += escapeHtml(source.slice(cursor, start));
    html += `<mark>${escapeHtml(source.slice(start, end))}</mark>`;
    cursor = end;
  }
  html += escapeHtml(source.slice(cursor));
  return html;
}
