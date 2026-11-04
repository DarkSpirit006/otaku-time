/* ============================================================
   Otaku Time — versioned key migration
   Legacy `okaeri.*` keys are adopted into `otaku-time.*` on
   first read. The legacy key is left untouched so nothing is
   destroyed; readers validate whatever they receive.
   ============================================================ */

/**
 * Copy a legacy key into the canonical key when the canonical key
 * is absent. The raw value is copied as-is; callers validate it.
 *
 * @returns {'migrated'|'skipped'|'failed'}
 */
export function migrateLegacyKey(legacyKey, canonicalKey) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return "failed";
    if (storage.getItem(canonicalKey) !== null) return "skipped";
    const legacy = storage.getItem(legacyKey);
    if (legacy === null) return "skipped";
    storage.setItem(canonicalKey, legacy);
    return "migrated";
  } catch {
    return "failed";
  }
}

/** Run migrations for a set of [legacy, canonical] key pairs. */
export function migrateAll(pairs) {
  const results = {};
  for (const [legacyKey, canonicalKey] of pairs) {
    results[canonicalKey] = migrateLegacyKey(legacyKey, canonicalKey);
  }
  return results;
}
