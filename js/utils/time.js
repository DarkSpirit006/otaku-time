/* ============================================================
   Otaku Time — date, timezone and countdown helpers (pure)
   ============================================================ */

/** Detect the browser's IANA timezone. */
export function detectedZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** True when `zone` is a valid IANA timezone identifier. */
export function validZone(zone) {
  if (typeof zone !== "string" || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Format the wall clock for a zone: "14:03:22" or "2:03:22 PM". */
export function clockText(date, zone, hour12) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: hour12 ? "h12" : "h23",
  }).format(date);
}

/** Compact wall time for a zone: "14:03" or "2:03 PM" (rundown gutter). */
export function shortTime(date, zone, hour12) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: hour12 ? "h12" : "h23",
  }).format(date);
}

/** Format a long date for a zone: "Wednesday, November 4, 2026". */
export function longDate(date, zone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** Compact date line for the rail: "Fri 06 Nov". */
export function compactDate(date, zone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** Format an airing instant for a zone, with weekday + timezone name. */
export function airingTime(epoch, zone, hour12) {
  if (!Number.isFinite(epoch)) return "Schedule TBA";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: hour12 ? "h12" : "h23",
    timeZoneName: "short",
  }).format(new Date(epoch * 1000));
}

/** Calendar-day key (YYYY-MM-DD) for an instant in a zone. */
export function dayKey(ms, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const part = (type) => parts.find((p) => p.type === type)?.value ?? "01";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Calendar-day key of the following day (pure date arithmetic on the key). */
export function nextDayKey(ms, zone) {
  const [y, m, d] = dayKey(ms, zone).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Calendar-day key of the previous day. */
export function prevDayKey(ms, zone) {
  const [y, m, d] = dayKey(ms, zone).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Human countdown / elapsed text for an airing instant.
 * Returns e.g. "in 2h 14m", "AIRING NOW · estimated", "Aired 3h ago".
 */
export function countdown(epoch, duration, now = Date.now() / 1000) {
  if (!Number.isFinite(epoch)) return "Schedule TBA";
  let diff = Math.ceil(epoch - now);
  if (diff <= 0) {
    const elapsed = -diff;
    if (duration && elapsed < Math.min(duration, 180) * 60) return "AIRING NOW · estimated";
    if (!duration && elapsed < 1800) return "Recently started";
    const minutes = Math.floor(elapsed / 60);
    if (minutes < 60) return `Aired ${Math.max(1, minutes)}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Aired ${hours}h ago`;
    return `Aired ${Math.floor(hours / 24)}d ago`;
  }
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;
  if (days) return `in ${days}d ${hours}h ${mins}m`;
  if (hours) return `in ${hours}h ${mins}m ${secs}s`;
  return `in ${mins}m ${secs}s`;
}

/**
 * Split a countdown into display segments for the feature panel.
 * Hours are capped at 99 so the plate never jumps width; beyond that the
 * panel shows days in the same cell (still two digits up to 99 days).
 * @returns {{h:string,m:string,s:string,negative:boolean}}
 */
export function countdownParts(epoch, now = Date.now() / 1000) {
  const pad = (value) => String(Math.max(0, value)).padStart(2, "0");
  if (!Number.isFinite(epoch)) return { h: "--", m: "--", s: "--", negative: false };
  let diff = Math.ceil(epoch - now);
  const negative = diff <= 0;
  if (negative) diff = 0;
  const hours = Math.floor(diff / 3600);
  return {
    h: pad(hours),
    m: pad(Math.floor((diff % 3600) / 60)),
    s: pad(diff % 60),
    negative,
  };
}

/** Short "time ago" label used by the Recently aired timeline. */
export function timeAgo(epoch, now = Date.now() / 1000) {
  if (!Number.isFinite(epoch)) return "";
  const diff = now - epoch;
  if (diff < 60) return "just now";
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(epoch * 1000).toLocaleDateString();
}

/**
 * Friendly label for a day group header:
 * "Today" / "Tomorrow" / "Yesterday" / "Fri, Nov 7".
 */
export function dayLabel(ms, zone, nowMs = Date.now()) {
  const key = dayKey(ms, zone);
  if (key === dayKey(nowMs, zone)) return "Today";
  if (key === nextDayKey(nowMs, zone)) return "Tomorrow";
  if (key === prevDayKey(nowMs, zone)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: zone,
  }).format(new Date(ms));
}

/** True when a day key is today or tomorrow in the zone. */
export function isTodayOrTomorrow(key, zone, nowMs = Date.now()) {
  return key === dayKey(nowMs, zone) || key === nextDayKey(nowMs, zone);
}

/** ISO-8601 week number (Monday-based, week 1 holds the first Thursday).
 *  Used by the printed filing line: `Vol. 2026 — Issue 45`. */
export function isoWeek(date = new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
}
