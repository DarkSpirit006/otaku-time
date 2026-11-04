import test from "node:test";
import assert from "node:assert/strict";

import { storageGet, storageSet, storageRemove, parseStoredJson } from "../../js/storage/local.js";
import { migrateLegacyKey, migrateAll } from "../../js/storage/migrate.js";

function withFakeStorage(fn) {
  const map = new Map();
  const original = globalThis.localStorage;
  let mode = "ok";
  globalThis.localStorage = {
    getItem: (k) => {
      if (mode === "throw") throw new Error("SecurityError");
      return map.has(k) ? map.get(k) : null;
    },
    setItem: (k, v) => {
      if (mode === "throw") throw new Error("SecurityError");
      if (mode === "quota") {
        const err = new Error("full");
        err.name = "QuotaExceededError";
        throw err;
      }
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
  try {
    fn({
      setMode: (m) => (mode = m),
      map,
    });
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
}

test("storageGet returns values and tagged failures", () => {
  withFakeStorage(({ setMode }) => {
    assert.deepEqual(storageGet("missing"), { status: "ok", value: null, problem: "" });
    localStorage.setItem("k", "v");
    assert.deepEqual(storageGet("k"), { status: "ok", value: "v", problem: "" });

    setMode("throw");
    const failed = storageGet("k");
    assert.equal(failed.status, "unavailable");
    assert.match(failed.problem, /unavailable/i);
  });
});

test("storageSet distinguishes quota from unavailable", () => {
  withFakeStorage(({ setMode }) => {
    assert.equal(storageSet("a", "1").status, "ok");

    setMode("quota");
    const quota = storageSet("a", "2");
    assert.equal(quota.status, "quota");
    assert.match(quota.problem, /full/i);

    setMode("throw");
    const blocked = storageSet("a", "3");
    assert.equal(blocked.status, "unavailable");

    setMode("ok");
    assert.equal(storageGet("a").value, "1", "failed writes never clobber");
  });
});

test("storageRemove never throws", () => {
  withFakeStorage(({ setMode }) => {
    localStorage.setItem("x", "1");
    assert.equal(storageRemove("x").status, "ok");
    setMode("throw");
    assert.doesNotThrow(() => storageRemove("x"));
  });
});

test("parseStoredJson handles empty and invalid payloads", () => {
  assert.deepEqual(parseStoredJson(null), { ok: false, reason: "empty" });
  assert.deepEqual(parseStoredJson(""), { ok: false, reason: "empty" });
  assert.deepEqual(parseStoredJson("{oops"), { ok: false, reason: "invalid" });
  const good = parseStoredJson('{"a":1}');
  assert.equal(good.ok, true);
  assert.deepEqual(good.data, { a: 1 });
});

test("migrateLegacyKey copies once and prefers the canonical key", () => {
  withFakeStorage(() => {
    localStorage.setItem("legacy.key", "legacy-value");

    assert.equal(migrateLegacyKey("legacy.key", "canonical.key"), "migrated");
    assert.equal(localStorage.getItem("canonical.key"), "legacy-value");
    assert.equal(localStorage.getItem("legacy.key"), "legacy-value", "legacy preserved");

    // Canonical now exists → skip
    localStorage.setItem("canonical.key", "canon");
    assert.equal(migrateLegacyKey("legacy.key", "canonical.key"), "skipped");
    assert.equal(localStorage.getItem("canonical.key"), "canon");

    // Nothing to copy
    assert.equal(migrateLegacyKey("ghost", "canonical2"), "skipped");
  });
});

test("migrateLegacyKey fails safely when storage is blocked", () => {
  withFakeStorage(({ setMode }) => {
    localStorage.setItem("legacy", "v");
    setMode("throw");
    assert.equal(migrateLegacyKey("legacy", "canonical"), "failed");
  });
});

test("migrateAll runs a batch of key pairs", () => {
  withFakeStorage(() => {
    localStorage.setItem("l1", "a");
    localStorage.setItem("l2", "b");
    const results = migrateAll([
      ["l1", "c1"],
      ["l2", "c2"],
      ["l3", "c3"],
    ]);
    assert.deepEqual(results, {
      c1: "migrated",
      c2: "migrated",
      c3: "skipped",
    });
    assert.equal(localStorage.getItem("c1"), "a");
    assert.equal(localStorage.getItem("c2"), "b");
  });
});
