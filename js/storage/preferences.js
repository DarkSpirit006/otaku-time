/* ============================================================
   Otaku Time — user preferences (timezone, clock format,
   notifications, reminder window). Versioned + validated.
   ============================================================ */

import { storageGet, storageSet, parseStoredJson } from "./local.js";
import { validZone, detectedZone } from "../utils/time.js";

export const PREFS_KEY = "otaku-time.preferences.v1";
export const LEGACY_PREFS_KEY = "okaeri.preferences.v1";
export const SCHEMA_VERSION = 2;

const DEFAULT_STORE = { getItem: (k) => storageGet(k).value, setItem: (k, v) => storageSet(k, v) };

function sanitize(prefs) {
  const data = prefs && typeof prefs === "object" ? prefs : {};
  const timezone =
    typeof data.timezone === "string" && validZone(data.timezone)
      ? data.timezone
      : detectedZone();
  const notifications = data.notifications === true;
  let reminder = Number(data.reminder);
  if (!Number.isFinite(reminder)) reminder = 15;
  reminder = Math.min(60, Math.max(1, Math.round(reminder)));

  const rawQuiet = data.quietHours && typeof data.quietHours === "object" ? data.quietHours : {};
  const clock = (value, fallback) =>
    typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
  const quietHours = {
    enabled: rawQuiet.enabled === true,
    start: clock(rawQuiet.start, "22:00"),
    end: clock(rawQuiet.end, "07:00"),
  };

  return {
    timezone,
    hour12: data.hour12 !== false,
    notifications,
    reminder,
    quietHours,
    weekStartsOn: data.weekStartsOn === 0 ? 0 : 1,
  };
}

/**
 * Create a preferences store.
 * @param {{getItem?:Function, setItem?:Function}} [storage]
 */
export function createPreferences(storage = DEFAULT_STORE) {
  let prefs = null;
  let warning = "";
  let available = true;
  let legacyHandled = false;

  function write() {
    let result;
    try {
      result =
        storage.setItem(PREFS_KEY, JSON.stringify({ version: SCHEMA_VERSION, ...prefs })) || {
          status: "ok",
          problem: "",
        };
    } catch {
      result = { status: "unavailable", problem: "Local storage is unavailable." };
    }
    available = result.status === "ok";
    warning = available ? "" : result.problem || "Local storage is unavailable.";
  }

  function read(force = false) {
    if (prefs && !force) return;
    let raw;
    try {
      raw = storage.getItem(PREFS_KEY);
      if ((raw === null || raw === undefined || raw === "") && !legacyHandled) {
        legacyHandled = true;
        const legacy = storage.getItem(LEGACY_PREFS_KEY);
        if (legacy !== null && legacy !== undefined && legacy !== "") {
          const result = storage.setItem(PREFS_KEY, legacy);
          if (!result || result.status === "ok") raw = storage.getItem(PREFS_KEY);
        }
      }
    } catch {
      raw = null;
      available = false;
      warning = "Local storage is unavailable.";
    }
    if (!available && warning === "Local storage is unavailable.") {
      prefs = sanitize(null);
      return;
    }

    if (raw === null || raw === undefined || raw === "") {
      prefs = sanitize(null);
      warning = "";
      available = true;
      return;
    }

    const parsed = parseStoredJson(raw);
    if (!parsed.ok) {
      warning =
        "Your saved settings could not be read. Defaults are in use and your copy was left untouched.";
      prefs = sanitize(null);
      available = true;
      return;
    }

    const data = parsed.data;
    const validShape = data && typeof data === "object" && !Array.isArray(data);
    if (!validShape || (data.version !== undefined && data.version !== SCHEMA_VERSION)) {
      warning =
        "Your saved settings used an unknown format. Defaults are in use and your copy was left untouched.";
      prefs = sanitize(null);
      available = true;
      return;
    }

    prefs = sanitize(data);
    warning = "";
    available = true;
  }

  function get() {
    read();
    return { ...prefs };
  }

  /** Force a re-read (cross-tab storage events). */
  function refresh() {
    read(true);
    return get();
  }

  function set(patch) {
    read();
    prefs = { ...prefs, ...sanitize({ ...prefs, ...(patch || {}) }) };
    write();
    return get();
  }

  function currentWarning() {
    read();
    return warning;
  }

  function storageAvailable() {
    read();
    return available;
  }

  return { key: PREFS_KEY, legacyKey: LEGACY_PREFS_KEY, get, set, refresh, warning: currentWarning, storageAvailable };
}

/** Default app-wide preferences store. */
export const preferences = createPreferences();
