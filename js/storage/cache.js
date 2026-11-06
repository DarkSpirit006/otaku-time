/* ============================================================
   Otaku Time — IndexedDB schedule cache
   Saves the last good schedules so reloads render instantly
   and failures fall back to the previous data (with an
   honest "may be out of date" note).
   ============================================================ */

export const DB_NAME = "otaku-time.cache.v1";
export const LEGACY_DB_NAME = "okaeri.cache.v1";
export const STORE = "snapshots";

function openDb(name, { deleteExisting = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    let request;
    try {
      request = indexedDB.open(name, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
    if (deleteExisting) {
      // handled by caller via deleteDatabase before opening
    }
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

/** Delete the legacy Okaeri cache database (one-time cleanup). */
export async function dropLegacyCache() {
  try {
    if (globalThis.indexedDB?.deleteDatabase) {
      await requestToPromise(indexedDB.deleteDatabase(LEGACY_DB_NAME));
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Read a cached snapshot ({events,page,more,anchor,syncedAt}) by kind. */
export async function readSnapshot(kind) {
  try {
    const db = await openDb(DB_NAME);
    try {
      const tx = db.transaction(STORE, "readonly");
      const result = await requestToPromise(tx.objectStore(STORE).get(kind));
      return result?.events ? result : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Persist a snapshot for a kind. Resolves false on failure (never throws). */
export async function writeSnapshot(kind, snapshot) {
  try {
    const db = await openDb(DB_NAME);
    try {
      const tx = db.transaction(STORE, "readwrite");
      await requestToPromise(
        tx.objectStore(STORE).put({ id: kind, ...snapshot })
      );
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** Remove one cached snapshot. */
export async function clearSnapshot(kind) {
  try {
    const db = await openDb(DB_NAME);
    try {
      const tx = db.transaction(STORE, "readwrite");
      await requestToPromise(tx.objectStore(STORE).delete(kind));
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** Remove all cached snapshots. */
export async function clearAllSnapshots() {
  let ok = true;
  await clearSnapshot("upcoming").then((r) => (ok = ok && r));
  await clearSnapshot("recent").then((r) => (ok = ok && r));
  return ok;
}

/** Read every stored snapshot for undo purposes. */
export async function snapshotAll() {
  const out = [];
  for (const kind of ["upcoming", "recent"]) {
    const snapshot = await readSnapshot(kind);
    if (snapshot) out.push({ kind, snapshot });
  }
  return out;
}

/** Restore snapshots captured by snapshotAll(). Returns false on any failure. */
export async function restoreAll(entries) {
  if (!Array.isArray(entries) || !entries.length) return false;
  let ok = true;
  for (const entry of entries) {
    const written = await writeSnapshot(entry.kind, entry.snapshot);
    ok = ok && written;
  }
  return ok;
}
