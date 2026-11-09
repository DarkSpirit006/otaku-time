import type { WatchEntry } from "./types";

function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function utc(tsMs: number): string {
  const d = new Date(tsMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// RFC 5545 folds lines at 75 UTF-8 octets, without splitting characters.
function foldLine(line: string): string[] {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const length = encoder.encode(character).length;
    if (bytes + length > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += length;
  }
  lines.push(current);
  return lines;
}

export function buildICS(entries: WatchEntry[]): { content: string; count: number } {
  const now = utc(Date.now());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Otaku Time//Watchlist//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  let count = 0;

  for (const e of entries) {
    if (!e.nextAiringAt || e.nextAiringAt * 1000 <= Date.now() - 60_000) continue;
    const start = e.nextAiringAt * 1000;
    const end = start + 24 * 60_000;
    const title = e.nextEpisode ? `${e.title} — Ep ${e.nextEpisode}` : e.title;
    count++;
    lines.push(
      "BEGIN:VEVENT",
      `UID:otaku-time-${e.mediaId}@otaku-time.local`,
      `DTSTAMP:${now}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${esc(title)}`,
      `DESCRIPTION:${esc(`Next episode airs — track it on Otaku Time · https://anilist.co/anime/${e.mediaId}`)}`,
      `URL:https://anilist.co/anime/${e.mediaId}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(title)}`,
      "END:VALARM",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return { content: lines.flatMap(foldLine).join("\r\n") + "\r\n", count };
}

export function buildWatchlistExport(entries: WatchEntry[]): string {
  return JSON.stringify(
    {
      app: "otaku-time",
      kind: "watchlist",
      version: 2,
      exportedAt: new Date().toISOString(),
      entries,
    },
    null,
    2
  );
}

/** Cross-browser download (Safari needs the revoke deferred). */
export function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
