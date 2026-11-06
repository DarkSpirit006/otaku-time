import test from "node:test";
import assert from "node:assert/strict";

import { createPreferences, PREFS_KEY, LEGACY_PREFS_KEY } from "../../js/storage/preferences.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
      return { status: "ok", problem: "" };
    },
    dump() {
      return Object.fromEntries(map);
    },
  };
}

test("defaults are applied when nothing is stored", () => {
  const prefs = createPreferences(fakeStorage());
  const values = prefs.get();
  assert.ok(values.timezone, "timezone falls back to a valid zone");
  assert.equal(typeof values.hour12, "boolean");
  assert.equal(values.notifications, false);
  assert.equal(values.reminder, 15);
});

test("valid stored values are preserved", () => {
  const storage = fakeStorage({
    [PREFS_KEY]: JSON.stringify({
      version: 2,
      timezone: "Asia/Tokyo",
      hour12: false,
      notifications: true,
      reminder: 30,
    }),
  });
  const prefs = createPreferences(storage);
  const values = prefs.get();
  assert.equal(values.timezone, "Asia/Tokyo");
  assert.equal(values.hour12, false);
  assert.equal(values.notifications, true);
  assert.equal(values.reminder, 30);
  assert.deepEqual(values.quietHours, { enabled: false, start: "22:00", end: "07:00" });
});

test("invalid timezone falls back to the detected zone", () => {
  const storage = fakeStorage({
    [PREFS_KEY]: JSON.stringify({ version: 2, timezone: "Not/AZone" }),
  });
  const prefs = createPreferences(storage);
  assert.notEqual(prefs.get().timezone, "Not/AZone");
});

test("reminder is clamped to 1..60 and coerced to an integer", () => {
  const read = (reminder) => {
    const storage = fakeStorage({
      [PREFS_KEY]: JSON.stringify({ version: 2, timezone: "UTC", reminder }),
    });
    return createPreferences(storage).get().reminder;
  };
  assert.equal(read(0), 1);
  assert.equal(read(-9), 1);
  assert.equal(read(900), 60);
  assert.equal(read(17.6), 18);
  assert.equal(read("not a number"), 15);
  assert.equal(read(undefined), 15);
});

test("set() patches, clamps and persists", () => {
  const storage = fakeStorage();
  const prefs = createPreferences(storage);
  prefs.set({ reminder: 45, hour12: false, timezone: "America/New_York" });
  const values = prefs.get();
  assert.equal(values.timezone, "America/New_York");
  assert.equal(values.hour12, false);
  assert.equal(values.notifications, false);
  assert.equal(values.reminder, 45);
  const stored = JSON.parse(storage.dump()[PREFS_KEY]);
  assert.equal(stored.version, 2);
  assert.equal(stored.reminder, 45);

  prefs.set({ reminder: 999 });
  assert.equal(prefs.get().reminder, 60);
});

test("corrupt JSON keeps defaults and warns without overwriting", () => {
  const storage = fakeStorage({ [PREFS_KEY]: "{broken" });
  const prefs = createPreferences(storage);
  assert.match(prefs.warning(), /could not be read/i);
  assert.equal(storage.dump()[PREFS_KEY], "{broken", "file untouched");
  assert.equal(prefs.get().reminder, 15, "defaults in use");
});

test("unknown schema versions warn and keep the original file", () => {
  const original = JSON.stringify({ version: 99, timezone: "UTC" });
  const storage = fakeStorage({ [PREFS_KEY]: original });
  const prefs = createPreferences(storage);
  assert.match(prefs.warning(), /unknown format/i);
  assert.equal(storage.dump()[PREFS_KEY], original);
});

test("adopts legacy preferences on first read", () => {
  const storage = fakeStorage({
    [LEGACY_PREFS_KEY]: JSON.stringify({ version: 2, timezone: "Europe/Paris", hour12: false }),
  });
  const prefs = createPreferences(storage);
  assert.equal(prefs.get().timezone, "Europe/Paris");
  assert.equal(prefs.get().hour12, false);
  assert.ok(storage.dump()[PREFS_KEY], "canonical key written");
  assert.ok(storage.dump()[LEGACY_PREFS_KEY], "legacy key preserved");
});

test("refresh() picks up external changes (cross-tab)", () => {
  const storage = fakeStorage();
  const prefs = createPreferences(storage);
  assert.equal(prefs.get().reminder, 15);

  // Another tab writes the key directly.
  storage.setItem(PREFS_KEY, JSON.stringify({ version: 2, timezone: "UTC", reminder: 5 }));
  assert.equal(prefs.get().reminder, 15, "cached until refreshed");
  assert.equal(prefs.refresh().reminder, 5, "refresh sees the new value");
});

test("unavailable storage degrades to defaults without throwing", () => {
  const storage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  const prefs = createPreferences(storage);
  assert.doesNotThrow(() => prefs.get());
  assert.doesNotThrow(() => prefs.set({ reminder: 20 }));
  assert.equal(prefs.storageAvailable(), false);
});
