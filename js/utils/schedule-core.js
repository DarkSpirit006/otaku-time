/* ============================================================
   Otaku Time — pure schedule maths
   Sorting, de-duplication, merge-by-id, render signatures and
   honest pagination labels. No DOM, no network, no side effects.
   ============================================================ */

/** Stable identity of an airing event. */
export function eventKey(event) {
  return `${event?.id ?? ""}:${event?.airingAt ?? ""}`;
}

/** Chronological order with a deterministic tie-breaker. */
export function sortEvents(events) {
  return events
    .slice()
    .sort((a, b) => (a.airingAt ?? 0) - (b.airingAt ?? 0) || (a.id ?? 0) - (b.id ?? 0));
}

/** Remove duplicate event ids, keeping the last occurrence (freshest copy). */
export function dedupeEvents(events) {
  const byId = new Map();
  for (const event of events) {
    if (!event || event.id === undefined || event.id === null) continue;
    byId.set(event.id, event);
  }
  return sortEvents(Array.from(byId.values()));
}

/**
 * Merge a refreshed set into the current one by stable event id.
 * Entries the refresh did not return are dropped only when the refresh
 * covered the whole loaded window — callers pass `keepMissing` for
 * partial refreshes so nothing silently disappears.
 */
export function mergeEvents(current, incoming, { keepMissing = false } = {}) {
  const merged = new Map();
  if (keepMissing) {
    for (const event of current) if (event?.id != null) merged.set(event.id, event);
  }
  for (const event of incoming) if (event?.id != null) merged.set(event.id, event);
  return sortEvents(Array.from(merged.values()));
}

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/**
 * Cheap deterministic rolling hash of a schedule's contents.
 * Identity (event id) and timing (airingAt) both participate, so a
 * re-scheduled episode invalidates the render even at equal counts.
 */
export function signatureOf(events) {
  let hash = FNV_OFFSET;
  if (!Array.isArray(events) || events.length === 0) return String(hash >>> 0);
  for (const event of events) {
    const token = `${event?.id ?? "?"}:${event?.airingAt ?? "?"};`;
    for (let index = 0; index < token.length; index++) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
  }
  // Length is folded in so a trailing duplicate cannot hash identically.
  hash ^= events.length;
  return String(Math.imul(hash, FNV_PRIME) >>> 0);
}

/**
 * Honest pagination copy. A total is only ever stated when the window
 * is demonstrably exhausted; otherwise the loaded count is all we know.
 */
export function paginationSummary({ loaded = 0, more = false, page = 0 } = {}) {
  if (!loaded) return { label: "No episodes loaded", complete: !more, pages: page };
  if (more) return { label: `${loaded} loaded`, complete: false, pages: page };
  return { label: `${loaded} loaded · full window`, complete: true, pages: page };
}

/**
 * Which day groups may continue past the pagination boundary.
 * Returns the set of group keys that should be marked incomplete.
 */
export function incompleteGroups(groups, { more = false } = {}) {
  if (!more || !Array.isArray(groups) || !groups.length) return new Set();
  const last = groups[groups.length - 1];
  const key = Array.isArray(last) ? last[0] : last?.key;
  return new Set(key === undefined ? [] : [key]);
}

/** Page ranges to refetch when refreshing N loaded pages. */
export function pagesToRefresh(page) {
  const total = Math.max(0, Math.floor(page) || 0);
  return Array.from({ length: total }, (_, index) => index + 1);
}
