/* ============================================================
   Otaku Time — clock ticker
   Runs one interval for the header clock, live countdowns and
   the notification check. All consumers read fresh prefs.
   ============================================================ */

import { clockText, compactDate, countdown, countdownParts } from "../utils/time.js";
import { qsa } from "../utils/dom.js";
import { getPrefs } from "./prefs.js";

const TICK_MS = 1000;
const NOTIFY_EVERY_TICKS = 10; // notification check at most every 10s

let timer = null;
let onTick = () => {};

function updateClock(now) {
  const prefs = getPrefs();
  const time = clockText(now, prefs.timezone, prefs.hour12);
  const date = compactDate(now, prefs.timezone);
  for (const el of qsa("#clock")) el.textContent = time;
  for (const el of qsa("#clock-date")) el.textContent = date;
  // Compact readouts (the phone top bar) drop the seconds: the full
  // clock is one line below in the rail on desktop and there is no room
  // for a ticking second counter beside the search button.
  for (const el of qsa("[data-clock]")) {
    const next = el.dataset.clock === "hm" ? time.replace(/:\d{2}(\s?[AP]M)?$/i, "$1") : time;
    if (el.textContent !== next) el.textContent = next;
  }
}

function updateCountdowns(now) {
  const nowSeconds = now.getTime() / 1000;

  // Segmented plate (feature panel): each cell is its own node so the
  // numerals can be set in the display face with a colon between them.
  for (const el of qsa("[data-countdown-segments]")) {
    const epoch = Number(el.dataset.epoch);
    const parts = countdownParts(epoch, nowSeconds);
    for (const cell of el.querySelectorAll("[data-seg]")) {
      const key = cell.dataset.seg;
      if (!(key in parts)) continue;
      const next = String(parts[key]);
      if (cell.textContent !== next) cell.textContent = next;
    }
  }

  for (const el of qsa("[data-countdown]")) {
    const epoch = Number(el.dataset.epoch);
    const duration = el.dataset.duration ? Number(el.dataset.duration) : 0;
    const prefix = el.dataset.prefix || "";
    const next = `${prefix}${countdown(epoch, duration, nowSeconds)}`;
    // Never write over an element that carries markup: textContent
    // replacement deletes child nodes (this cost the card's air time).
    if (el.firstElementChild) continue;
    if (el.textContent !== next) el.textContent = next;
  }
}

/** Start the ticker (idempotent). */
export function startClock(callback) {
  if (typeof callback === "function") onTick = callback;
  if (timer !== null) return;
  let ticks = 0;
  const run = () => {
    const now = new Date();
    updateClock(now);
    updateCountdowns(now);
    ticks++;
    if (ticks % NOTIFY_EVERY_TICKS === 0) onTick(now);
  };
  run();
  timer = setInterval(run, TICK_MS);
}

/** Stop the ticker. */
export function stopClock() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Re-render clock values immediately (e.g. after prefs change). */
export function tickNow() {
  const now = new Date();
  updateClock(now);
  updateCountdowns(now);
}
