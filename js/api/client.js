/* ============================================================
   Otaku Time — AniList GraphQL client
   Caching, in-flight dedupe, rate-limit awareness, retries,
   timeouts and cancellation. Injectable for tests.
   ============================================================ */

export const DEFAULT_ENDPOINT = "https://graphql.anilist.co";

export class AniListError extends Error {
  constructor(message, code = "ANILIST_ERROR", status = 0, details = "") {
    super(message);
    this.name = "AniListError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const RETRYABLE_CODES = new Set(["NETWORK_ERROR", "HTTP_5XX"]);

function friendlyStatus(status) {
  if (status === 404) return "Anime not found on AniList.";
  if (status === 400) return "Bad request sent to AniList.";
  if (status === 403) return "AniList denied this request.";
  if (status >= 500) return "AniList is having a moment. Try again shortly.";
  return `AniList request failed (${status}).`;
}

function errorFor(data, status) {
  const errors = Array.isArray(data?.errors) ? data.errors.filter(Boolean) : [];
  if (!errors.length) return new AniListError(friendlyStatus(status), "ANILIST_ERROR", status);

  const first = errors[0];
  const status2 = Number(first.status) || status;
  let code = typeof first.extensions?.code === "string" ? first.extensions.code : "ANILIST_ERROR";
  if (typeof first.status === "number" && first.status >= 500 && status2 >= 500) code = "HTTP_5XX";

  const message =
    code === "RATE_LIMITED"
      ? "AniList's request limit is close. Try again in a few seconds."
      : friendlyStatus(status2);

  return new AniListError(message, code, status2, String(first.message || "").slice(0, 200));
}

function shouldRetry(error, attempt) {
  if (attempt >= 1) return false;
  if (RETRYABLE_CODES.has(error.code)) return true;
  return error.status >= 500;
}

/**
 * Create an AniList client.
 * @param {{endpoint?:string, fetchImpl?:Function, sleep?:Function, now?:Function}} [options]
 */
export function createClient(options = {}) {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  const fetchImpl = options.fetchImpl || ((...args) => globalThis.fetch(...args));
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || (() => Date.now());

  const cache = new Map();   // key -> {at, ttl, value}
  const pending = new Map(); // key -> Promise
  let blockedUntil = 0;
  const CACHE_LIMIT = 100;

  function remember(key, value, ttl) {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: now(), ttl, value });
  }

  function armBlock(resetMs) {
    blockedUntil = Math.min(Math.max(blockedUntil, resetMs), now() + 300_000);
  }

  function readResetMs(headers, fallbackMs) {
    const reset = headers.get("x-ratelimit-reset");
    const retryAfter = headers.get("retry-after");
    if (reset !== null && reset !== "" && Number.isFinite(Number(reset))) {
      return Number(reset) * 1000;
    }
    if (retryAfter !== null && retryAfter !== "" && Number.isFinite(Number(retryAfter)) && Number(retryAfter) > 0) {
      return now() + Number(retryAfter) * 1000;
    }
    return now() + fallbackMs;
  }

  /** Arm the gate when a response reports zero remaining budget. */
  function noteRateHeaders(headers) {
    if (!headers || typeof headers.get !== "function") return;
    const raw = headers.get("x-ratelimit-remaining");
    if (raw === null || raw === undefined || raw === "") return;
    const remaining = Number(raw);
    if (!Number.isFinite(remaining) || remaining > 0) return;
    armBlock(readResetMs(headers, 60_000));
  }

  /** Arm the gate for an explicit rate-limit error (honors retry-after). */
  function armFromError(headers) {
    if (!headers || typeof headers.get !== "function") {
      armBlock(now() + 60_000);
      return;
    }
    armBlock(readResetMs(headers, 60_000));
  }

  /**
   * Execute a GraphQL request.
   * Resolves with `data`; rejects with AniListError.
   */
  async function request(query, variables, opts = {}) {
    const ttl = opts.ttl ?? 300_000;
    const refresh = opts.refresh === true;
    const signal = opts.signal;

    const key = JSON.stringify([query, variables]);
    const hit = cache.get(key);
    if (!refresh && hit && now() - hit.at < ttl) return hit.value;

    if (pending.has(key)) return pending.get(key);

    const promise = (async () => {
      const started = now();
      let lastError = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) throw new AniListError("The request was cancelled.", "ABORTED", 0);
        if (!refresh && blockedUntil > now()) {
          const waitSeconds = Math.max(1, Math.ceil((blockedUntil - now()) / 1000));
          throw new AniListError(
            `Waiting for AniList's rate limit to reset (${waitSeconds}s).`,
            "RATE_LIMITED",
            429
          );
        }

        try {
          const response = await fetchImpl(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query, variables }),
            signal,
          });

          noteRateHeaders(response.headers);

          let data = null;
          try {
            data = await response.json();
          } catch {
            data = null;
          }

          if (!response.ok || (Array.isArray(data?.errors) && data.errors.length)) {
            const error = errorFor(data, response.status);
            if (error.code === "RATE_LIMITED" || response.status === 429) {
              armFromError(response.headers);
            }
            lastError = error;
          } else {
            const payload = data?.data ?? null;
            if (!payload || typeof payload !== "object") {
              lastError = new AniListError(
                "AniList sent an unexpected response.",
                "INVALID_RESPONSE",
                response.status
              );
            } else {
              if (ttl > 0) remember(key, payload, ttl);
              return payload;
            }
          }
        } catch (error) {
          if (error?.name === "AbortError" || error?.code === "ABORTED") {
            throw new AniListError("The request was cancelled.", "ABORTED", 0);
          }
          lastError = new AniListError(
            "Can't reach AniList. Check your connection.",
            "NETWORK_ERROR",
            0
          );
        }

        if (shouldRetry(lastError, attempt)) {
          await sleep(700 + Math.floor(now() - started) % 300);
          continue;
        }
        throw lastError;
      }
      throw lastError || new AniListError("AniList request failed.");
    })();

    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  }

  function clearCache() {
    cache.clear();
    blockedUntil = 0;
  }

  function isBlocked() {
    return blockedUntil > now();
  }

  return { request, clearCache, isBlocked };
}
