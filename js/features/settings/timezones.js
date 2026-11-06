/* ============================================================
   Otaku Time — time-zone list shared by the settings sheet and the
   rail's selector. Pure data + string building, no DOM access.
   ============================================================ */

import { esc } from "../../utils/dom.js";
import { detectedZone, validZone } from "../../utils/time.js";

const ZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Bangkok",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Warsaw",
  "Pacific/Auckland",
];

/**
 * Options for a zone <select>: the browser's zone, the current choice
 * and a curated list, deduplicated and sorted.
 * @param {string} current
 */
export function timezoneOptions(current) {
  const zones = new Set([detectedZone(), current, ...ZONES].filter((zone) => validZone(zone)));
  return [...zones]
    .sort()
    .map(
      (zone) =>
        `<option value="${esc(zone)}" ${zone === current ? "selected" : ""}>${esc(zone.replace(/_/g, " "))}</option>`
    )
    .join("");
}
