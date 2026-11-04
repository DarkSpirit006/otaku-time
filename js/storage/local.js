/* ============================================================
   Otaku Time — raw storage access with graceful failure
   localStorage can be absent (SSR, tests), full (QuotaExceeded),
   or blocked (Safari private mode). Every caller gets a tagged
   result instead of an exception.
   ============================================================ */

/**
 * Read a raw string value.
 * @returns {{status:'ok'|'unavailable', value:string|null, problem:string}}
 */
export function storageGet(key) {
  try {
    const value = globalThis.localStorage?.getItem(key) ?? null;
    return { status: "ok", value, problem: "" };
  } catch {
    return { status: "unavailable", value: null, problem: "Local storage is unavailable." };
  }
}

/**
 * Write a raw string value.
 * @returns {{status:'ok'|'unavailable'|'quota', problem:string}}
 */
export function storageSet(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
    return { status: "ok", problem: "" };
  } catch (error) {
    const quota =
      error instanceof Error &&
      (error.name === "QuotaExceededError" ||
        error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        error.code === 22);
    if (quota) {
      return {
        status: "quota",
        problem: "This browser's storage is full — changes stay in memory for now.",
      };
    }
    return { status: "unavailable", problem: "Local storage is unavailable." };
  }
}

/** Remove a raw value (ignores failures). */
export function storageRemove(key) {
  try {
    globalThis.localStorage?.removeItem(key);
    return { status: "ok", problem: "" };
  } catch {
    return { status: "unavailable", problem: "Local storage is unavailable." };
  }
}

/**
 * Parse JSON from storage safely.
 * @returns {{ok:boolean, data?:any, reason?:'empty'|'invalid'}}
 */
export function parseStoredJson(raw) {
  if (raw === null || raw === undefined || raw === "") return { ok: false, reason: "empty" };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
