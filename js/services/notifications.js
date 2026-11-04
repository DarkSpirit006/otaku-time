/* ============================================================
   Otaku Time — episode reminders
   Local notifications only (Notification API). Preferences,
   upcoming schedules and the watchlist feed the check; the
   reminders store tracks what has already fired.
   ============================================================ */

import { storageGet, storageSet, parseStoredJson } from "../storage/local.js";
import { migrateLegacyKey } from "../storage/migrate.js";
import { getPrefs } from "./prefs.js";
import { titleOf } from "../utils/format.js";

const STORAGE_KEY = "otaku-time.reminders.v1";
const LEGACY_KEY = "okaeri.reminders.v1";

let reminderStore = null;

function readStore() {
  if (reminderStore) return reminderStore;
  let raw = storageGet(STORAGE_KEY).value;
  if ((raw === null || raw === undefined || raw === "") ) {
    migrateLegacyKey(LEGACY_KEY, STORAGE_KEY);
    raw = storageGet(STORAGE_KEY).value;
  }
  const parsed = parseStoredJson(raw);
  reminderStore =
    parsed.ok && parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
      ? parsed.data
      : {};
  return reminderStore;
}

function writeStore(store) {
  reminderStore = store;
  storageSet(STORAGE_KEY, JSON.stringify(store));
}

function prune(store, nowSeconds) {
  let changed = false;
  for (const key of Object.keys(store)) {
    const recorded = Number(store[key]);
    if (!Number.isFinite(recorded) || recorded < nowSeconds - 30 * 24 * 60 * 60) {
      delete store[key];
      changed = true;
    }
  }
  return changed;
}

/** Merge reminders written by other tabs (cross-tab sync). */
export function mergeReminders() {
  const external = storageGet(STORAGE_KEY).value;
  const parsed = parseStoredJson(external);
  if (!parsed.ok || !parsed.data || typeof parsed.data !== "object") return;
  const store = readStore();
  let changed = false;
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!(key in store) || store[key] !== value) {
      store[key] = value;
      changed = true;
    }
  }
  if (changed) writeStore(store);
}

/**
 * Fire due notifications. Returns the number sent.
 * Safe to call on a timer: cheap when notifications are off.
 */
export function checkNotifications({ schedules, watchlistItems } = {}) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return 0;
  const prefs = getPrefs();
  if (!prefs.notifications) return 0;
  if (typeof schedules !== "object" || typeof watchlistItems !== "function") return 0;

  const nowSeconds = Date.now() / 1000;
  const cutoff = nowSeconds + prefs.reminder * 60;
  const tracked = new Set(watchlistItems().map((item) => item.id));
  const store = readStore();
  if (prune(store, nowSeconds)) writeStore(store);

  let sent = 0;
  for (const [key, recorded] of Object.entries(store)) {
    const airingAt = Number(recorded);
    if (Number.isFinite(airingAt) && airingAt >= nowSeconds && airingAt <= cutoff) sent++;
  }

  for (const events of Object.values(schedules)) {
    if (!Array.isArray(events)) continue;
    for (const event of events) {
      if (!tracked.has(event.media?.id)) continue;
      const key = String(event.id);
      const airingAt = Number(event.airingAt);
      if (store[key] || !Number.isFinite(airingAt)) continue;
      if (airingAt < nowSeconds || airingAt > cutoff) continue;

      store[key] = airingAt;
      writeStore(store);
      sent++;

      try {
        const episodeText = Number.isInteger(event.episode) ? `Episode ${event.episode}` : "New episode";
        new Notification(`Otaku Time: ${episodeText} soon`, {
          body: `${titleOf(event.media)} airs in about ${Math.max(0, Math.round((airingAt - nowSeconds) / 60))} minutes.`,
          tag: key,
        });
      } catch {
        /* notification construction failed — already recorded, move on */
      }
    }
  }
  return sent;
}
