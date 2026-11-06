/* ============================================================
   Otaku Time — episode reminders

   Honest by construction:
     · a reminder is only recorded once the browser has actually
       accepted the notification;
     · the dedupe key is `eventId:airingAt`, so a rescheduled
       episode is a new reminder rather than a suppressed one;
     · concurrent checks share one in-flight run, so two ticks
       can never double-fire;
     · the returned count reports what was really created.

   Without a push backend a closed page cannot wake itself; the
   page (or installed PWA) checks due episodes while it runs.
   ============================================================ */

import { storageGet, storageSet, parseStoredJson } from "../storage/local.js";
import { migrateLegacyKey } from "../storage/migrate.js";
import { getPrefs } from "./prefs.js";
import { titleOf } from "../utils/format.js";

const STORAGE_KEY = "otaku-time.reminders.v1";
const LEGACY_KEY = "okaeri.reminders.v1";
const RETENTION_SECONDS = 30 * 24 * 60 * 60;

let reminderStore = null;
let running = null;

function readStore() {
  if (reminderStore) return reminderStore;
  let raw = storageGet(STORAGE_KEY).value;
  if (raw === null || raw === undefined || raw === "") {
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

/** `${eventId}:${airingAt}` — a reschedule creates a new key. */
export function reminderKey(event) {
  return `${event?.id ?? "?"}:${event?.airingAt ?? "?"}`;
}

function prune(store, nowSeconds) {
  let changed = false;
  for (const key of Object.keys(store)) {
    const recorded = Number(store[key]);
    if (!Number.isFinite(recorded) || recorded < nowSeconds - RETENTION_SECONDS) {
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

/** How many reminders are currently recorded. */
export function reminderCount() {
  return Object.keys(readStore()).length;
}

/** Forget every recorded reminder (Settings → clear). */
export function clearReminders() {
  writeStore({});
}

/** Capability probe used by Settings to describe what will happen. */
export function notificationSupport() {
  const hasApi = typeof globalThis.Notification !== "undefined";
  const hasSw = Boolean(globalThis.navigator?.serviceWorker);
  return {
    api: hasApi,
    serviceWorker: hasSw,
    permission: hasApi ? Notification.permission : "unsupported",
  };
}

/** Parse "22:30" into minutes since midnight; null when invalid. */
export function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** True when `minutesNow` falls inside [start, end) with midnight wrap. */
export function inQuietHours(minutesNow, startText, endText) {
  const start = parseClock(startText);
  const end = parseClock(endText);
  if (start === null || end === null || start === end) return false;
  if (start < end) return minutesNow >= start && minutesNow < end;
  return minutesNow >= start || minutesNow < end;
}

function minutesOfDay(zone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return get("hour") * 60 + get("minute");
  } catch {
    return new Date().getHours() * 60 + new Date().getMinutes();
  }
}

/** Deliver one notification, preferring the service worker. */
async function deliver({ title, body, tag, mediaId }) {
  const options = {
    body,
    tag,
    data: { mediaId, url: `./#show/${mediaId}` },
    icon: "./assets/icons/icon-192.png",
    badge: "./assets/icons/badge-96.png",
  };

  if (globalThis.navigator?.serviceWorker) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.showNotification) {
        await registration.showNotification(title, options);
        return true;
      }
    } catch {
      /* fall through to the page-level API */
    }
  }

  if (typeof globalThis.Notification === "function") {
    try {
      const notification = new Notification(title, options);
      notification.onclick = () => {
        try {
          globalThis.focus();
        } catch {
          /* not focusable (e.g. worker context) */
        }
        if (globalThis.location) globalThis.location.hash = `#show/${mediaId}`;
      };
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Fire due reminders.
 * @param {{schedules?:Record<string,Array>, watchlistItems?:()=>Array}} input
 * @param {{now?:number, prefs?:object, permission?:string, deliver?:Function, store?:object}} [deps]
 * @returns {Promise<{sent:number, failed:number, reason:string}>}
 */
export function checkNotifications(input = {}, deps = {}) {
  // One run at a time: a second timer tick joins the first.
  if (running) return running;

  running = (async () => {
    const permission =
      deps.permission ?? (typeof globalThis.Notification !== "undefined" ? Notification.permission : "denied");
    if (permission !== "granted") return { sent: 0, failed: 0, reason: "permission" };

    const prefs = deps.prefs || getPrefs();
    if (!prefs.notifications) return { sent: 0, failed: 0, reason: "disabled" };

    const { schedules, watchlistItems } = input;
    if (typeof schedules !== "object" || !schedules || typeof watchlistItems !== "function") {
      return { sent: 0, failed: 0, reason: "no-data" };
    }

    if (
      prefs.quietHours?.enabled &&
      inQuietHours(minutesOfDay(prefs.timezone), prefs.quietHours.start, prefs.quietHours.end)
    ) {
      return { sent: 0, failed: 0, reason: "quiet-hours" };
    }

    const nowMs = deps.now ?? Date.now();
    const nowSeconds = nowMs / 1000;
    const store = deps.store || readStore();
    if (prune(store, nowSeconds)) writeStore(store);

    const tracked = new Set(watchlistItems().map((item) => item.id));
    const leadMinutes = Number.isFinite(prefs.reminder) ? prefs.reminder : 15;
    const deliverFn = deps.deliver || deliver;

    let sent = 0;
    let failed = 0;
    const seen = new Set();

    for (const events of Object.values(schedules)) {
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        if (!event || !tracked.has(event.media?.id)) continue;
        const airingAt = Number(event.airingAt);
        if (!Number.isFinite(airingAt)) continue;
        if (airingAt < nowSeconds || airingAt > nowSeconds + leadMinutes * 60) continue;

        const key = reminderKey(event);
        if (store[key] || seen.has(key)) continue;
        seen.add(key);

        const minutes = Math.max(1, Math.round((airingAt - nowSeconds) / 60));
        const episodeText = Number.isInteger(event.episode) ? `Episode ${event.episode}` : "New episode";
        const title = `Otaku Time — ${episodeText}`;
        const body = `${titleOf(event.media)} airs in ${minutes} minute${minutes === 1 ? "" : "s"}.`;

        const accepted = await deliverFn({ title, body, tag: key, mediaId: event.media.id });
        if (!accepted) {
          failed++;
          continue; // never record a notification that did not happen
        }

        store[key] = airingAt;
        writeStore(store);
        sent++;
      }
    }

    return { sent, failed, reason: "ok" };
  })().finally(() => {
    running = null;
  });

  return running;
}
