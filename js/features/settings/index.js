/* ============================================================
   Otaku Time — settings dialog
   Time · Reminders · Your data. Everything is local; every
   destructive action is undoable or explicitly explained.
   ============================================================ */

import { qs, qsa, esc } from "../../utils/dom.js";
import { icon } from "../../components/icons.js";
import { showToast } from "../../components/toast.js";
import { getPrefs, updatePrefs, prefsStore } from "../../services/prefs.js";
import { watchlist } from "../../storage/watchlist.js";
import { clearCaches, restoreFromCache, refreshLoaded } from "../../services/schedule.js";
import { snapshotAll, restoreAll } from "../../storage/cache.js";
import { notificationSupport, clearReminders, reminderCount } from "../../services/notifications.js";
import { offerUndo } from "../../services/undo.js";
import { detectedZone, validZone } from "../../utils/time.js";

const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

let dialog = null;
let content = null;
let ctxRef = null;
let fileInput = null;

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

export function initSettings(ctx) {
  ctxRef = ctx;
  dialog = qs("#settings-dialog");
  content = qs("#settings-content");
  if (!dialog || !dialog.showModal) return;

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

export function openSettings(opener) {
  if (!dialog || !dialog.showModal) return;
  renderSettings();
  if (!dialog.open) dialog.showModal();
  qs("#settings-title", content)?.focus?.();
  dialog.dataset.opener = opener ? "1" : "0";
}

export function closeSettings() {
  if (!dialog?.open) return;
  dialog.close();
}

function timezoneOptions(current) {
  const zones = new Set([detectedZone(), current, ...ZONES].filter((zone) => validZone(zone)));
  return [...zones]
    .sort()
    .map(
      (zone) =>
        `<option value="${esc(zone)}" ${zone === current ? "selected" : ""}>${esc(zone.replace(/_/g, " "))}</option>`
    )
    .join("");
}

function renderSettings() {
  const prefs = getPrefs();
  const problem = prefsStore.warning();
  const available = prefsStore.storageAvailable();
  const support = notificationSupport();
  const permissionLabel =
    support.permission === "granted"
      ? "Allowed"
      : support.permission === "denied"
        ? "Blocked in browser settings"
        : support.permission === "unsupported"
          ? "Not supported in this browser"
          : "Not requested yet";

  content.innerHTML = `
    <div class="settings-head">
      <div>
        <h2 id="settings-title" tabindex="-1">Settings</h2>
        <p>Preferences are stored in this browser only.</p>
      </div>
      <button class="dialog__close" data-settings-action="close" aria-label="Close settings">${icon("close")}</button>
    </div>
    <div class="settings-scroll" tabindex="0" role="region" aria-label="Preferences">
      ${problem ? `<div class="notice notice--warning" role="status">${esc(problem)}</div>` : ""}

      <section class="settings-group">
        <h3><span class="group-index">01</span> Time</h3>
        <div class="settings-field">
          <label class="field-label" for="setting-timezone">Timezone</label>
          <select id="setting-timezone" class="native-select" data-setting="timezone">
            ${timezoneOptions(prefs.timezone)}
          </select>
          <p class="settings-hint">Used for the header clock, the calendar and every airing time.</p>
        </div>
        <div class="settings-field">
          <label class="field-label" for="setting-hour12">Clock format</label>
          <select id="setting-hour12" class="native-select" data-setting="hour12">
            <option value="12"${prefs.hour12 ? " selected" : ""}>12-hour (2:30 PM)</option>
            <option value="24"${!prefs.hour12 ? " selected" : ""}>24-hour (14:30)</option>
          </select>
        </div>
        <div class="settings-field">
          <label class="field-label" for="setting-weekstart">Week starts on</label>
          <select id="setting-weekstart" class="native-select" data-setting="weekStartsOn">
            <option value="1"${prefs.weekStartsOn !== 0 ? " selected" : ""}>Monday</option>
            <option value="0"${prefs.weekStartsOn === 0 ? " selected" : ""}>Sunday</option>
          </select>
        </div>
      </section>

      <section class="settings-group">
        <h3><span class="group-index">02</span> Reminders</h3>
        <p>Local notifications for episodes of shows you track. No account, no server — your browser delivers them while Otaku Time is open.</p>
        <div class="settings-field">
          <label class="check-row">
            <input type="checkbox" id="setting-notifications" data-setting="notifications" ${prefs.notifications ? "checked" : ""} />
            <span>Remind me before tracked episodes air</span>
          </label>
          <p class="settings-hint">
            Permission: <strong>${esc(permissionLabel)}</strong>
            ${support.permission !== "granted" ? `<button class="link-btn" data-settings-action="request-permission">Request permission</button>` : ""}
          </p>
        </div>
        <div class="settings-field">
          <label class="field-label" for="setting-reminder">Reminder window</label>
          <div class="input-suffix">
            <input class="number-input" id="setting-reminder" data-setting="reminder" type="number" min="1" max="60"
              step="1" value="${prefs.reminder}" />
            <span class="input-suffix__label">minutes before</span>
          </div>
        </div>
        <div class="settings-field">
          <label class="check-row">
            <input type="checkbox" id="setting-quiet-enabled" data-setting="quiet-enabled" ${prefs.quietHours.enabled ? "checked" : ""} />
            <span>Quiet hours — don't remind between</span>
          </label>
          <div class="input-row">
            <input class="time-input" id="setting-quiet-start" data-setting="quiet-start" type="time" value="${esc(prefs.quietHours.start)}" aria-label="Quiet hours start" />
            <span aria-hidden="true">→</span>
            <input class="time-input" id="setting-quiet-end" data-setting="quiet-end" type="time" value="${esc(prefs.quietHours.end)}" aria-label="Quiet hours end" />
          </div>
          <p class="settings-hint">Quiet hours affect the browser reminders this app sends. Calendar apps importing an .ics file apply their own notification rules.</p>
        </div>
        <div class="settings-actions">
          <button class="btn btn--ghost btn--sm" data-settings-action="test-notification">Send a test reminder</button>
          <button class="btn btn--ghost btn--sm" data-settings-action="clear-reminders">
            Forget sent reminders (${reminderCount()})
          </button>
        </div>
        <p class="settings-hint">
          A browser cannot wake a closed page. While Otaku Time is open — or installed as an app — it checks each episode
          and notifies you. For reminders you can trust when the browser is closed, export episodes to your calendar.
        </p>
      </section>

      <section class="settings-group">
        <h3><span class="group-index">03</span> Your data</h3>
        <p>Everything lives in this browser's storage. Export a backup before switching devices or browsers.</p>
        <div class="settings-actions">
          <button class="btn btn--secondary" data-settings-action="export">${icon("download")} Export watchlist</button>
          <button class="btn btn--secondary" data-settings-action="import">${icon("upload")} Import backup</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden />
        </div>
        <div class="settings-field">
          <label class="field-label" for="import-mode">When importing</label>
          <select id="import-mode" class="native-select" data-setting="import-mode">
            <option value="merge">Merge — keep titles already saved</option>
            <option value="replace">Replace — use the import as the whole library</option>
          </select>
          <p class="settings-hint">Replacing is undoable for six seconds after it happens.</p>
        </div>
        <span id="import-result" role="status" aria-live="polite" class="settings-result"></span>
        <div class="settings-danger">
          <div class="settings-actions">
            <button class="btn btn--danger" data-settings-action="clear-cache">${icon("database")} Clear schedule cache</button>
          </div>
          <p>Cached schedules, media details and in-memory copies are removed; the next load refetches from AniList. Your watchlist is never touched. Undo restores the cache snapshot if your browser can write it back.</p>
        </div>
        <div class="settings-actions">
          <button class="btn btn--ghost btn--sm" data-settings-action="export-all">Export everything (watchlist + episodes)</button>
        </div>
        ${!available ? `<p class="settings-hint">Storage is unavailable — changes last only until you close this tab.</p>` : ""}
      </section>

      <p class="settings-footer">
        Otaku Time keeps no account and sends no analytics. Schedule data from AniList.
        ${navigator.serviceWorker ? "Installed as an app? Updates appear as a toast when a new version is ready." : ""}
      </p>
    </div>`;

  fileInput = qs("#import-file", content);
  fileInput?.addEventListener("change", onImportFile);
}

/* ------------------------------------------------------------ */
/* Actions                                                        */
/* ------------------------------------------------------------ */

function onClick(event) {
  const button = event.target.closest("[data-settings-action]");
  if (!button) return;
  const action = button.dataset.settingsAction;

  if (action === "close") {
    closeSettings();
    return;
  }
  if (action === "export") {
    exportWatchlist();
    return;
  }
  if (action === "export-all") {
    exportEverything();
    return;
  }
  if (action === "import") {
    fileInput?.click();
    return;
  }
  if (action === "clear-cache") {
    clearCache(button);
    return;
  }
  if (action === "request-permission") {
    requestPermission();
    return;
  }
  if (action === "test-notification") {
    testNotification();
    return;
  }
  if (action === "clear-reminders") {
    clearReminders();
    showToast("Reminder history cleared — future episodes will remind again.");
    renderSettings();
  }
}

function onChange(event) {
  const field = event.target.closest("[data-setting]");
  if (!field) return;
  const key = field.dataset.setting;

  if (key === "timezone") {
    if (validZone(field.value)) {
      updatePrefs({ timezone: field.value });
      showToast(`Times now shown in ${field.value.replace(/_/g, " ")}.`);
    }
    return;
  }
  if (key === "hour12") {
    updatePrefs({ hour12: field.value === "12" });
    return;
  }
  if (key === "weekStartsOn") {
    updatePrefs({ weekStartsOn: Number(field.value) });
    return;
  }
  if (key === "notifications") {
    toggleNotifications(field.checked, field);
    return;
  }
  if (key === "reminder") {
    updatePrefs({ reminder: Number(field.value) });
    return;
  }
  if (key === "quiet-enabled") {
    updatePrefs({ quietHours: { ...getPrefs().quietHours, enabled: field.checked } });
    return;
  }
  if (key === "quiet-start" || key === "quiet-end") {
    const quietHours = { ...getPrefs().quietHours };
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(field.value)) {
      quietHours[key === "quiet-start" ? "start" : "end"] = field.value;
      updatePrefs({ quietHours });
    }
    return;
  }
  if (key === "import-mode") {
    // Nothing to persist — read at import time.
    dialog.dataset.importMode = field.value;
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
    showToast("Reminders on — they fire while Otaku Time is open.");
    renderSettings();
  } else {
    updatePrefs({ notifications: false });
    field.checked = false;
    showToast("Notifications are blocked in your browser settings.");
  }
}

async function requestPermission() {
  if (typeof Notification === "undefined") {
    showToast("This browser doesn't support notifications.");
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    showToast(
      permission === "granted" ? "Permission granted." : "Permission was not granted — check browser settings."
    );
    renderSettings();
  } catch {
    showToast("Couldn't request permission.");
  }
}

async function testNotification() {
  const support = notificationSupport();
  if (support.permission !== "granted") {
    showToast("Allow notifications first.");
    return;
  }
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.showNotification) {
      await registration.showNotification("Otaku Time — test reminder", {
        body: "This is what an episode reminder looks like.",
        tag: "otaku-test",
        icon: "./assets/icons/icon-192.png",
        badge: "./assets/icons/badge-96.png",
      });
    } else {
      new Notification("Otaku Time — test reminder", {
        body: "This is what an episode reminder looks like.",
        tag: "otaku-test",
      });
    }
    showToast("Test reminder sent.");
  } catch {
    showToast("The browser refused to show it.");
  }
}

function exportWatchlist() {
  try {
    const payload = watchlist.exportData();
    download(JSON.stringify(payload, null, 2), "otaku-time-watchlist.json", "application/json");
    showToast("Backup downloaded.");
  } catch {
    showToast("Couldn't build the backup file.");
  }
}

async function exportEverything() {
  const payload = watchlist.exportData();
  payload.includes = "watchlist+episodes";
  download(JSON.stringify(payload, null, 2), "otaku-time-backup.json", "application/json");
  showToast(`${payload.items.length} titles exported.`);
}

function download(text, filename, type) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onImportFile(event) {
  const input = event.target;
  const file = input?.files?.[0];
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

    // Validate the whole file before touching a single record.
    const checked = watchlist.validateImport(data);
    if (!checked.ok) {
      show(checked.problem || "That backup couldn't be read.");
      return;
    }

    const mode = qs("#import-mode", content)?.value === "replace" ? "replace" : "merge";
    const before = mode === "replace" ? watchlist.snapshot() : null;
    const result = watchlist.importData(data, { mode });

    if (result.problem) {
      show(result.problem);
      return;
    }

    ctxRef?.watchlistChanged?.();

    // The dialog's panels (counts, titles) are refreshed first so the
    // confirmation survives the repaint instead of being wiped by it.
    renderSettings();

    if (mode === "replace") {
      offerUndo({
        message: `Replaced library with ${result.added} title${result.added === 1 ? "" : "s"}`,
        restore: () => watchlist.restoreSnapshot(before),
      });
      show(`Replaced ${result.replaced} titles with ${result.added}. Undo is available for six seconds.`);
    } else {
      const parts = [`${result.added} added`, `${result.skipped} skipped`];
      if (result.invalid) parts.push(`${result.invalid} invalid`);
      parts.push(result.persisted ? "saved" : "kept in memory only");
      show(`Import complete — ${parts.join(", ")}.`);
      showToast("Backup imported.");
    }
  };
  reader.readAsText(file);
}

async function clearCache(button) {
  if (button) button.disabled = true;

  // Capture a restorable snapshot before deleting anything.
  let snapshot = [];
  try {
    snapshot = await snapshotAll();
  } catch {
    snapshot = [];
  }

  try {
    await clearCaches();
    ctxRef?.scheduleChanged?.();

    if (!snapshot.length) {
      showToast("Schedule cache cleared.");
      return;
    }

    offerUndo({
      message: "Schedule cache cleared",
      restore: async () => {
        const restored = await restoreAll(snapshot);
        if (!restored) return false;
        await Promise.all([restoreFromCache("upcoming"), restoreFromCache("recent")]);
        await Promise.all([refreshLoaded("upcoming"), refreshLoaded("recent")]);
        ctxRef?.scheduleChanged?.();
        return true;
      },
    });
  } catch {
    showToast("Couldn't clear the cache.");
  } finally {
    if (button) button.disabled = false;
  }
}

export { renderSettings };
