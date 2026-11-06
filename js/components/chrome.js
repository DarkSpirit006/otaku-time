/* ============================================================
   Otaku Time — browser chrome
   The pieces of the shell that are not the app's business: which
   container the single search field lives in, the theme button label,
   the rail's time-zone selector and the printed colophon line.
   ============================================================ */

import { qs, qsa } from "../utils/dom.js";
import { getPrefs, updatePrefs } from "../services/prefs.js";
import { validZone, detectedZone, isoWeek } from "../utils/time.js";
import { timezoneOptions } from "../features/settings/timezones.js";
import { showToast } from "./toast.js";

const RAIL_QUERY = "(min-width: 1024px)";

/** Module-scope handles so the "/" shortcut and the palette can ask for
 *  the field by name instead of reaching into the bar. */
let searchBar = null;
let searchChrome = null;

/**
 * The search field exists once. On desktop it lives under the rail's INDEX
 * block, on phones it lives in the compact bar where the search button
 * expands it over the row. Moving the node keeps one value, one set of
 * listeners and one element in the accessibility tree — a second input
 * would mean two sources of truth for the query.
 */
function mountSearch() {
  const field = qs(".search");
  const railSlot = qs('[data-search-slot="rail"]');
  const barSlot = qs('[data-search-slot="bar"]');
  if (!field || !railSlot || !barSlot) return;

  const place = () => {
    const target = window.matchMedia(RAIL_QUERY).matches ? railSlot : barSlot;
    if (field.parentElement !== target) target.appendChild(field);
  };
  place();

  const media = window.matchMedia(RAIL_QUERY);
  media.addEventListener?.("change", place);
}

/** Theme button label + pressed state follow the live theme. */
function syncThemeLabel() {
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  for (const button of qsa(".js-theme-toggle")) {
    button.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
    const label = button.querySelector("[data-theme-label]");
    if (label) label.textContent = theme === "light" ? "Ink theme" : "Paper theme";
    button.setAttribute(
      "aria-label",
      theme === "light" ? "Switch to the ink theme" : "Switch to the paper theme"
    );
  }
}

/** A single clock element can opt into hours+minutes with `data-clock="hm"`. */
function labelZone(zone) {
  for (const el of qsa("[data-tz-name]")) {
    el.textContent = zone === detectedZone() ? "local" : zone.split("/").pop().replace(/_/g, " ");
  }
}

function buildZoneSelect() {
  const select = qs("[data-tz-select]");
  if (!select) return;
  const prefs = getPrefs();
  select.innerHTML = timezoneOptions(prefs.timezone);
  select.value = prefs.timezone;
  select.addEventListener("change", () => {
    if (!validZone(select.value)) return;
    updatePrefs({ timezone: select.value });
    labelZone(select.value);
    showToast(`Times now shown in ${select.value.replace(/_/g, " ")}.`);
  });
  labelZone(prefs.timezone);
}

/** The colophon names the volume and the ISO week of the almanac. */
function renderColophon() {
  const el = qs("[data-colophon-vol]");
  if (!el) return;
  const now = new Date();
  const week = isoWeek(now);
  el.textContent = `Vol. ${now.getFullYear()} — Issue ${String(week).padStart(2, "0")}`;
}


/** The search button expands the field over the compact bar. */
function bindSearchToggle() {
  const bar = qs(".topbar");
  const field = qs(".search");
  const toggle = qs(".js-search-toggle");
  const input = qs("#search");
  if (!bar || !toggle || !input) return;
  searchBar = bar;
  searchChrome = { toggle, input };

  const setOpen = (open) => {
    if (open) bar.dataset.searchOpen = "true";
    else delete bar.dataset.searchOpen;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close search" : "Search the almanac");
    toggle.title = open ? "Close search" : "Search";
  };

  toggle.addEventListener("click", () => {
    const open = bar.dataset.searchOpen === "true";
    setOpen(!open);
    if (!open) {
      input.focus();
      input.select?.();
    } else {
      toggle.focus();
    }
  });

  // Escape collapses the bar and then travels on, so the app's global
  // handler can clear the query and put the section back — the same as it
  // does when the caret is outside the field.
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || bar.dataset.searchOpen !== "true") return;
    setOpen(false);
    toggle.focus();
  });

  // Leaving the field empty collapses the bar again; a live query keeps it
  // open so the results underneath stay reachable.
  input.addEventListener("blur", () => {
    if (!input.value.trim()) setOpen(false);
  });

  // Desktop has no toggle: the rail always shows the field.
  window.matchMedia(RAIL_QUERY).addEventListener?.("change", () => setOpen(false));

  void field;
}

/**
 * Put the caret in the search field from anywhere.
 *
 * A collapsed field cannot take focus, so the compact bar has to be opened
 * first — calling `input.focus()` on a `display:none` node is a silent no-op
 * and the "/" shortcut would appear to do nothing on a phone.
 */
export function revealSearch() {
  if (!searchChrome) return;
  const { input, toggle } = searchChrome;
  if (searchBar && searchBar.dataset.searchOpen !== "true" && !window.matchMedia(RAIL_QUERY).matches) {
    searchBar.dataset.searchOpen = "true";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close search");
  }
  input.focus();
  input.select?.();
}

export function initChrome() {
  mountSearch();
  syncThemeLabel();
  buildZoneSelect();
  renderColophon();
  bindSearchToggle();
}

/** Re-run the parts that depend on preferences. */
export function refreshChrome() {
  syncThemeLabel();
  const select = qs("[data-tz-select]");
  const zone = getPrefs().timezone;
  if (select && select.value !== zone) select.value = zone;
  labelZone(zone);
}
