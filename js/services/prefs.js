/* ============================================================
   Otaku Time — preferences facade
   ============================================================ */

import { preferences } from "../storage/preferences.js";
import { emit } from "./bus.js";

/** Read the current preferences object. */
export function getPrefs() {
  return preferences.get();
}

/** Patch preferences, persist, and notify listeners. */
export function updatePrefs(patch) {
  const prefs = preferences.set(patch);
  emit("prefs:changed", { prefs });
  return prefs;
}

/** Read-only access to the underlying store (warnings, availability). */
export const prefsStore = preferences;
