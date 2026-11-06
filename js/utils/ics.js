/* ============================================================
   Otaku Time — iCalendar (RFC 5545) generation (pure)

   Timestamps are emitted in UTC so no VTIMEZONE block is needed
   and every calendar client agrees on the instant. Lines are
   folded at 75 octets, text is escaped, UIDs are stable for a
   given (episode id, airing time) pair — a rescheduled episode
   therefore becomes a *new* calendar entry instead of silently
   moving an existing one.
   ============================================================ */

const CRLF = "\r\n";
const MAX_OCTETS = 75;

/** Escape a TEXT value per RFC 5545 §3.3.11. */
export function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** Fold a content line at 75 octets without splitting UTF-8 sequences. */
export function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= MAX_OCTETS) return line;
  const parts = [];
  let start = 0;
  let limit = MAX_OCTETS;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never cut through a multi-byte character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
    limit = MAX_OCTETS - 1; // continuation lines lose one octet to the space
  }
  return parts.join(`${CRLF} `);
}

/** UTC timestamp in basic iCalendar form: 20261105T193000Z */
export function formatUtc(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function titleOf(media) {
  return media?.title?.english || media?.title?.romaji || media?.title?.native || "Untitled anime";
}

/** Stable UID for one airing of one episode. */
export function eventUid(event) {
  return `ep-${event.id}-${event.airingAt}@otaku-time.local`;
}

function eventLines(event, { now, reminderMinutes, alarms }) {
  const startMs = event.airingAt * 1000;
  const durationMs = Math.min(Math.max(Number(event.media?.duration) || 24, 5), 240) * 60 * 1000;
  const title = titleOf(event.media);
  const episode = Number.isInteger(event.episode) ? `Episode ${event.episode}` : "New episode";
  const summary = `${title} — ${episode}`;
  const description = [
    `${episode} of ${title}.`,
    event.media?.format ? `Format: ${event.media.format}.` : "",
    "Times shown are the scheduled air time from AniList; episodes can be delayed.",
  ]
    .filter(Boolean)
    .join(" ");

  const lines = [
    "BEGIN:VEVENT",
    `UID:${eventUid(event)}`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(startMs)}`,
    `DTEND:${formatUtc(startMs + durationMs)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    event.media?.id ? `URL:https://anilist.co/anime/${event.media.id}` : "",
    "TRANSP:TRANSPARENT",
    "STATUS:CONFIRMED",
  ];

  if (alarms && Number.isFinite(reminderMinutes)) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(summary)}`,
      `TRIGGER:-PT${Math.max(0, Math.round(reminderMinutes))}M`,
      "END:VALARM"
    );
  }

  lines.push("END:VEVENT");
  return lines.filter(Boolean);
}

/**
 * Build a complete VCALENDAR document.
 * @param {{events:Array, reminderMinutes?:number, now?:number, calendarName?:string, alarms?:boolean}} options
 * @returns {{content:string, count:number}}
 */
export function buildCalendar({
  events = [],
  reminderMinutes = 15,
  now = Date.now(),
  calendarName = "Otaku Time",
  alarms = true,
} = {}) {
  const usable = (Array.isArray(events) ? events : []).filter(
    (event) => event && Number.isFinite(event.airingAt) && Number.isFinite(event.id)
  );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Otaku Time//Episode schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    "X-WR-TIMEZONE:UTC",
  ];

  for (const event of usable) {
    lines.push(...eventLines(event, { now, reminderMinutes, alarms }));
  }
  lines.push("END:VCALENDAR");

  const content = lines.map(foldLine).join(CRLF) + CRLF;
  return { content, count: usable.length };
}

/** File name for a scoped export. */
export function icsFileName(scope, id) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (scope === "episode") return `otaku-time-episode-${id}-${stamp}.ics`;
  return `otaku-time-watchlist-${stamp}.ics`;
}
