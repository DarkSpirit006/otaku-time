/* ============================================================
   Otaku Time — theme service
   Reads/writes the stored preference (adopting the legacy
   key on first run), follows the OS when unset, updates the
   browser chrome color, and keeps toggle buttons in sync.
   ============================================================ */

import { storageSet } from "../storage/local.js";
import { migrateLegacyKey } from "../storage/migrate.js";
import { qsa } from "../utils/dom.js";
import { emit } from "./bus.js";

export const THEME_KEY = "otaku-time.theme.v1";
export const LEGACY_THEME_KEY = "okaeri.theme.v1";

const DARK_META = "#0b0d12";
const LIGHT_META = "#f6f6fa";

let initialized = false;
let preference = "auto"; // "auto" | "dark" | "light"
let mediaQuery = null;

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? LIGHT_META : DARK_META);

  const next = theme === "light" ? "dark" : "light";
  const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  for (const button of qsa(".js-theme-toggle")) {
    button.setAttribute("aria-pressed", String(theme === "light"));
    button.setAttribute("aria-label", label);
    button.title = label;
  }
}

function resolve(preference) {
  if (preference === "light" || preference === "dark") return preference;
  // "auto" follows the OS (legacy "system" values normalize to auto)
  return mediaQuery?.matches ? "light" : "dark";
}

function readStored() {
  try {
    if (localStorage.getItem(THEME_KEY) === null && localStorage.getItem(LEGACY_THEME_KEY) !== null) {
      migrateLegacyKey(LEGACY_THEME_KEY, THEME_KEY);
    }
    const value = localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark") return value;
    if (value === "auto" || value === "system") return "auto";
  } catch {
    /* storage unavailable — fall back to the dark default */
  }
  return "dark";
}

function store(value) {
  try {
    storageSet(THEME_KEY, value);
  } catch {
    /* ignore */
  }
}

/** Set and persist an explicit theme preference. */
export function setPreference(value) {
  preference = value === "light" || value === "dark" ? value : "auto";
  store(preference);
  const theme = resolve(preference);
  applyTheme(theme);
  emit("theme:changed", { theme });
}

/** Toggle between light and dark (sets an explicit preference). */
export function toggle() {
  const current = resolve(preference);
  setPreference(current === "light" ? "dark" : "light");
}

/** Current resolved theme: "dark" | "light". */
export function currentTheme() {
  return resolve(preference);
}

/** Current stored preference: "auto" | "dark" | "light". */
export function currentPreference() {
  return preference;
}

/** Initialize the service (idempotent). */
export function initTheme() {
  if (initialized) return;
  initialized = true;

  preference = readStored();
  mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
  applyTheme(resolve(preference));

  mediaQuery.addEventListener?.("change", () => {
    if (preference === "auto") applyTheme(resolve(preference));
  });

  for (const button of qsa(".js-theme-toggle")) {
    button.addEventListener("click", () => toggle());
  }

  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === THEME_KEY || event.key === LEGACY_THEME_KEY) {
      preference = readStored();
      applyTheme(resolve(preference));
      emit("theme:changed", { theme: resolve(preference) });
    }
  });
}
