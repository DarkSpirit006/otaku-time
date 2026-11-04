import test from "node:test";
import assert from "node:assert/strict";

import { createClient, AniListError } from "../../js/api/client.js";

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return data;
    },
  };
}

const QUERY = "query { Page { pageInfo { currentPage } } }";

test("caches successful responses within ttl", async () => {
  let calls = 0;
  const client = createClient({
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ data: { Page: { pageInfo: { currentPage: 1 } } } });
    },
    sleep: async () => {},
  });

  const first = await client.request(QUERY, { page: 1 }, { ttl: 60_000 });
  const second = await client.request(QUERY, { page: 1 }, { ttl: 60_000 });
  assert.equal(calls, 1, "second call served from cache");
  assert.deepEqual(first, second);
});

test("refresh bypasses the cache", async () => {
  let calls = 0;
  const client = createClient({
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ data: { n: calls } });
    },
    sleep: async () => {},
  });
  await client.request(QUERY, {}, { ttl: 60_000 });
  const fresh = await client.request(QUERY, {}, { ttl: 60_000, refresh: true });
  assert.equal(calls, 2);
  assert.equal(fresh.n, 2);
});

test("deduplicates concurrent identical requests", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const client = createClient({
    fetchImpl: async () => {
      calls++;
      await gate;
      return jsonResponse({ data: { ok: true } });
    },
    sleep: async () => {},
  });

  const a = client.request(QUERY, { x: 1 }, { ttl: 0 });
  const b = client.request(QUERY, { x: 1 }, { ttl: 0 });
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1, "single flight");
  assert.deepEqual(ra, rb);
});

test("retries once on 5xx then succeeds", async () => {
  let calls = 0;
  const client = createClient({
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return jsonResponse({ errors: [{ message: "boom", status: 503 }] }, { status: 503 });
      return jsonResponse({ data: { ok: true } });
    },
    sleep: async () => {},
  });
  const result = await client.request(QUERY, {}, { ttl: 0 });
  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: true });
});

test("gives up after one retry with a friendly error", async () => {
  let calls = 0;
  const client = createClient({
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ errors: [{ message: "down", status: 500 }] }, { status: 500 });
    },
    sleep: async () => {},
  });
  await assert.rejects(
    () => client.request(QUERY, {}, { ttl: 0 }),
    (error) => {
      assert.ok(error instanceof AniListError);
      assert.equal(error.code, "HTTP_5XX");
      assert.match(error.message, /moment/i);
      return true;
    }
  );
  assert.equal(calls, 2, "original + one retry");
});

test("does not retry 4xx client errors", async () => {
  let calls = 0;
  const client = createClient({
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ errors: [{ message: "Syntax Error", status: 400 }] }, { status: 400 });
    },
    sleep: async () => {},
  });
  await assert.rejects(() => client.request(QUERY, {}, { ttl: 0 }), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /Bad request/i);
    return true;
  });
  assert.equal(calls, 1);
});

test("rate-limit responses block later calls until reset", async () => {
  let nowValue = 1_000_000;
  const now = () => nowValue;
  let calls = 0;
  const client = createClient({
    now,
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      return jsonResponse(
        { errors: [{ message: "Too Many Requests", status: 429, extensions: { code: "RATE_LIMITED" } }] },
        { status: 429, headers: { "retry-after": "30" } }
      );
    },
  });

  await assert.rejects(() => client.request(QUERY, {}, { ttl: 0 }), (error) => {
    assert.equal(error.code, "RATE_LIMITED");
    assert.match(error.message, /request limit|rate limit/i);
    return true;
  });

  await assert.rejects(() => client.request(QUERY, {}, { ttl: 0 }), (error) => {
    assert.match(error.message, /reset/i);
    return true;
  });
  assert.equal(calls, 1, "blocked call never reaches the network");

  // After the window, requests flow again (and fail once more, but on the wire)
  nowValue += 31_000;
  await assert.rejects(() => client.request(QUERY, {}, { ttl: 0 }));
  assert.equal(calls, 2);
});

test("x-ratelimit-remaining 0 arms the gate from response headers", async () => {
  let nowValue = 5_000_000;
  let calls = 0;
  const client = createClient({
    now: () => nowValue,
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      return jsonResponse(
        { data: { ok: true } },
        { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(5_000_000 / 1000 + 60) } }
      );
    },
  });

  await client.request(QUERY, {}, { ttl: 0 });
  await assert.rejects(() => client.request(QUERY, {}, { ttl: 0 }), (error) => {
    assert.equal(error.code, "RATE_LIMITED");
    return true;
  });
  assert.equal(calls, 1);
});

test("network failures retry once then surface a friendly error", async () => {
  let calls = 0;
  const client = createClient({
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(() => client.request(QUERY, {}, { ttl: 0 }), (error) => {
    assert.equal(error.code, "NETWORK_ERROR");
    assert.match(error.message, /reach AniList/i);
    return true;
  });
  assert.equal(calls, 2);
});

test("aborts in-flight requests via AbortSignal", async () => {
  const controller = new AbortController();
  const client = createClient({
    sleep: async () => {},
    fetchImpl: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  });

  const promise = client.request(QUERY, {}, { ttl: 0, signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, "ABORTED");
    return true;
  });
});

test("unexpected payloads are rejected as invalid responses", async () => {
  const client = createClient({
    sleep: async () => {},
    fetchImpl: async () => jsonResponse({ data: null }),
  });
  await assert.rejects(() => client.request(QUERY, {}, { ttl: 0 }), (error) => {
    assert.equal(error.code, "INVALID_RESPONSE");
    return true;
  });
});

test("graphQL errors array wins even on HTTP 200", async () => {
  const client = createClient({
    sleep: async () => {},
    fetchImpl: async () =>
      jsonResponse({ errors: [{ message: "Variable $x missing", status: 400 }], data: null }),
  });
  await assert.rejects(() => client.request(QUERY, {}, { ttl: 0 }), (error) => {
    assert.equal(error.status, 400);
    return true;
  });
});

test("clearCache resets entries and rate-limit block", async () => {
  let calls = 0;
  const client = createClient({
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ data: { calls } });
    },
  });
  await client.request(QUERY, {}, { ttl: 60_000 });
  client.clearCache();
  await client.request(QUERY, {}, { ttl: 60_000 });
  assert.equal(calls, 2, "cache cleared → network again");
  assert.equal(client.isBlocked(), false);
});

test("cache is capped so memory stays bounded", async () => {
  let calls = 0;
  const client = createClient({
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ data: { calls } });
    },
  });
  for (let i = 0; i < 150; i++) {
    await client.request(QUERY, { i }, { ttl: 60_000 });
  }
  // oldest entries evicted: re-requesting #0 hits the network again
  await client.request(QUERY, { i: 0 }, { ttl: 60_000 });
  assert.equal(calls, 151, "entry 0 was evicted after the cap");
});
