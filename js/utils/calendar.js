/* ============================================================
   Otaku Time — weekly calendar model (pure)
   Timezone-aware week maths built on calendar-day keys, so DST
   transitions cannot drift the grid.
   ============================================================ */

import { dayKey } from "./time.js";

/** Add days to a YYYY-MM-DD key without touching local time. */
export function addDays(key, days) {
  const [year, month, day] = String(key).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** Weekday index (0 = Sunday) of a day key. */
export function weekdayOf(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * First day of the week containing `ms`.
 * @param {number} ms epoch milliseconds
 * @param {string} zone IANA timezone
 * @param {number} weekStartsOn 0 = Sunday, 1 = Monday
 */
export function startOfWeek(ms, zone, weekStartsOn = 1) {
  const key = dayKey(ms, zone);
  const offset = (weekdayOf(key) - weekStartsOn + 7) % 7;
  return addDays(key, -offset);
}

/** Seven (or N) consecutive day keys. */
export function weekKeys(startKey, count = 7) {
  return Array.from({ length: count }, (_, index) => addDays(startKey, index));
}

/** Minutes elapsed since local midnight for an instant in a zone. */
export function minutesIntoDay(ms, zone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    // "24:00" appears at midnight in some locales; normalise it.
    const hours = get("hour") % 24;
    return hours * 60 + get("minute");
  } catch {
    const date = new Date(ms);
    return date.getHours() * 60 + date.getMinutes();
  }
}

/** Short weekday label for a day key (Mon, Tue…). */
export function weekdayLabel(key, zone) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    timeZone: zone,
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** Day-of-month number for a day key. */
export function dayNumber(key) {
  return Number(String(key).split("-")[2]);
}

/** Group events into day-key buckets, chronological inside each bucket. */
export function bucketByDay(events, zone) {
  const buckets = new Map();
  for (const event of events || []) {
    if (!Number.isFinite(event?.airingAt)) continue;
    const key = dayKey(event.airingAt * 1000, zone);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(event);
  }
  for (const list of buckets.values()) list.sort((a, b) => a.airingAt - b.airingAt);
  return buckets;
}

/** Compact label for a week: "3–9 Nov 2026" (or across months). */
export function weekLabel(startKey, endKey) {
  const [y1, m1, d1] = startKey.split("-").map(Number);
  const [y2, m2, d2] = endKey.split("-").map(Number);
  const start = new Date(Date.UTC(y1, m1 - 1, d1));
  const end = new Date(Date.UTC(y2, m2 - 1, d2));
  const month = (date) => new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(date);
  if (y1 !== y2) {
    return `${d1} ${month(start)} ${y1} – ${d2} ${month(end)} ${y2}`;
  }
  if (m1 !== m2) return `${d1} ${month(start)} – ${d2} ${month(end)} ${y2}`;
  return `${d1}–${d2} ${month(start)} ${y1}`;
}
