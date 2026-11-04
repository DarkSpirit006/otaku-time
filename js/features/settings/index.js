/* ============================================================
   Otaku Time — settings dialog
   Preferences, notifications, import/export, cache controls.
   ============================================================ */

import { getPrefs, updatePrefs, prefsStore } from "../../services/prefs.js";
import { clearCaches } from "../../services/schedule.js";
import { watchlist } from "../../storage/watchlist.js";
import { validZone, detectedZone } from "../../utils/time.js";
import { icon } from "../../components/icons.js";
import { esc, qs } from "../../utils/dom.js";
import { showToast } from "../../components/toast.js";

const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

let dialog = null;
let content = null;
let ctxRef = null;
let fileInput = null;

export function initSettings(ctx) {
  ctxRef = ctx;
  dialog = qs("#settings-dialog");
  content = qs("#settings-content");
  if (!dialog || !dialog.showModal) return;

  renderSettings();

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSettings();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSettings();
  });
  content.addEventListener("click", onClick);
  content.addEventListener("change", onChange);
}

/** Open the settings dialog. */
export function openSettings(opener) {
  if (!dialog || !dialog.showModal) return;
  renderSettings();
  if (!dialog.open) dialog.showModal();
  qs("#settings-title", content)?.focus?.();
}

/** Close with the shared animation. */
export function closeSettings() {
  if (!dialog?.open) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    dialog.close();
    return;
  }
  if (dialog.classList.contains("is-closing")) return;
  dialog.classList.add("is-closing");
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    dialog.classList.remove("is-closing");
    dialog.close();
  };
  dialog.addEventListener("transitionend", (event) => {
    if (event.target === dialog) finish();
  }, { once: true });
  setTimeout(finish, 450);
}

function timezoneOptions(current) {
  let zones = [];
  try {
    zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    zones = [];
  }
  const set = new Set(zones);
  if (current && validZone(current)) set.add(current);
  const detected = detectedZone();
  if (detected) set.add(detected);
  const list = Array.from(set).sort();
  return list
    .map(
      (zone) =>
        `<option value="${esc(zone)}"${zone === current ? " selected" : ""}>${esc(zone.replace(/_/g, " "))}</option>`
    )
    .join("");
}

function renderSettings() {
  const prefs = getPrefs();
  const problem = prefsStore.warning();
  const available = prefsStore.storageAvailable();

  content.innerHTML = `
    <div class="settings-head">
      <div>
        <h2 id="settings-title" tabindex="-1">Settings</h2>
        <p>Preferences are stored in this browser only.</p>
      </div>
      <button class="dialog__close" data-settings-action="close" aria-label="Close settings">${icon("close")}</button>
    </div>
    <div class="settings-scroll">
      ${problem ? `<div class="notice notice--warning" role="status">${esc(problem)}</div>` : ""}

      <section class="settings-group">
        <h3><span class="group-index">01</span> Time</h3>
        <div class="settings-field">
          <label class="field-label" for="setting-timezone">Timezone</label>
          <select id="setting-timezone" class="native-select" data-setting="timezone">
            ${timezoneOptions(prefs.timezone)}
          </select>
          <p class="settings-hint">Used for the header clock and every airing time.</p>
        </div>
        <div class="settings-field">
          <label class="field-label" for="setting-hour12">Clock format</label>
          <select id="setting-hour12" class="native-select" data-setting="hour12">
            <option value="12"${prefs.hour12 ? " selected" : ""}>12-hour (2:30 PM)</option>
            <option value="24"${!prefs.hour12 ? " selected" : ""}>24-hour (14:30)</option>
          </select>
        </div>
      </section>

      <section class="settings-group">
        <h3><span class="group-index">02</span> Notifications</h3>
        <p>Local reminders before episodes of shows you track. No account, no server — your browser does the reminding.</p>
        <div class="settings-field">
          <label class="check-row">
            <input type="checkbox" id="setting-notifications" data-setting="notifications" ${prefs.notifications ? "checked" : ""} />
            <span>Remind me before tracked episodes air</span>
          </label>
        </div>
        <div class="settings-field">
          <label class="field-label" for="setting-reminder">Reminder window</label>
          <div class="input-suffix">
            <input class="number-input" id="setting-reminder" data-setting="reminder" type="number" min="1" max="60"
              step="1" value="${prefs.reminder}" />
            <span class="input-suffix__label">minutes before</span>
          </div>
          <p class="settings-hint">Between 1 and 60 minutes.</p>
        </div>
      </section>

      <section class="settings-group">
        <h3><span class="group-index">03</span> Your data</h3>
        <p>Everything lives in this browser's storage. Export a backup before switching devices or browsers.</p>
        <div class="settings-actions">
          <button class="btn btn--secondary" data-settings-action="export">${icon("download")} Export watchlist</button>
          <button class="btn btn--secondary" data-settings-action="import">${icon("upload")} Import backup</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden />
          <span id="import-result" role="status" aria-live="polite"></span>
        </div>
        <div class="settings-danger">
          <div class="settings-actions">
            <button class="btn btn--danger" data-settings-action="clear-cache">${icon("database")} Clear schedule cache</button>
          </div>
          <p>Removes cached schedule data so the next visit refetches from AniList. Your watchlist is never touched.</p>
        </div>
        ${!available ? `<p class="settings-hint">Storage is unavailable — changes will last only until you close this tab.</p>` : ""}
      </section>
    </div>`;

  fileInput = qs("#import-file", content);
  fileInput?.addEventListener("change", onImportFile);
}

function onClick(event) {
  const button = event.target.closest("[data-settings-action]");
  if (!button) return;
  const action = button.dataset.settingsAction;

  if (action === "close") closeSettings();
  else if (action === "export") exportWatchlist();
  else if (action === "import") fileInput?.click();
  else if (action === "clear-cache") clearCache();
}

function onChange(event) {
  const field = event.target.closest("[data-setting]");
  if (!field) return;
  const name = field.dataset.setting;

  if (name === "timezone") {
    const zone = field.value;
    if (!validZone(zone)) {
      showToast("That timezone isn't recognized.");
      renderSettings();
      return;
    }
    updatePrefs({ timezone: zone });
    showToast("Timezone updated.");
  } else if (name === "hour12") {
    updatePrefs({ hour12: field.value === "12" });
  } else if (name === "notifications") {
    toggleNotifications(field.checked, field);
  } else if (name === "reminder") {
    let value = Number.parseInt(field.value, 10);
    if (!Number.isFinite(value)) value = 15;
    value = Math.min(60, Math.max(1, value));
    field.value = String(value);
    updatePrefs({ reminder: value });
  }
}

async function toggleNotifications(enabled, field) {
  if (!enabled) {
    updatePrefs({ notifications: false });
    showToast("Reminders off.");
    return;
  }

  if (typeof Notification === "undefined") {
    updatePrefs({ notifications: false });
    field.checked = false;
    showToast("This browser doesn't support notifications.");
    return;
  }

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = "denied";
    }
  }

  if (permission === "granted") {
    updatePrefs({ notifications: true });
    showToast("Reminders on — watch this browser.");
  } else {
    updatePrefs({ notifications: false });
    field.checked = false;
    showToast("Notifications are blocked in your browser settings.");
  }
}

function exportWatchlist() {
  try {
    const payload = watchlist.exportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "otaku-time-watchlist.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Backup downloaded.");
  } catch {
    showToast("Couldn't build the backup file.");
  }
}

function onImportFile(event) {
  const input = event.target;
  const file = input?.files?.[0];
  // Query fresh on every call — renderSettings() may rebuild the DOM.
  const show = (message) => {
    const el = qs("#import-result", content);
    if (el) el.textContent = message;
  };

  if (!file) return;
  if (file.size > IMPORT_MAX_BYTES) {
    show("That file is too large (5 MB max).");
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => {
    show("Couldn't read that file.");
    input.value = "";
  };
  reader.onload = () => {
    input.value = "";
    let data;
    try {
      data = JSON.parse(String(reader.result));
    } catch {
      show("That file isn't valid JSON.");
      return;
    }

    const result = watchlist.importData(data);
    if (result.problem) {
      show(result.problem);
      return;
    }
    const parts = [`${result.added} added`, `${result.skipped} skipped`];
    if (result.invalid) parts.push(`${result.invalid} invalid`);
    parts.push(result.persisted ? "saved" : "kept in memory only");
    ctxRef?.watchlistChanged?.();
    renderSettings();
    show(`Import complete — ${parts.join(", ")}.`);
    showToast("Backup imported.");
  };
  reader.readAsText(file);
}

async function clearCache() {
  const button = content.querySelector('[data-settings-action="clear-cache"]');
  if (button) button.disabled = true;
  try {
    await clearCaches("upcoming");
    showToast("Schedule cache cleared.");
    ctxRef?.scheduleChanged?.();
  } catch {
    showToast("Couldn't clear the cache.");
  } finally {
    if (button) button.disabled = false;
  }
}
