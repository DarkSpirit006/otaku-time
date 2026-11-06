/* ============================================================
   Otaku Time — edge cases
   Failure modes, storage hazards, offline, rate limits,
   migration, cross-tab sync, reduced motion.
   ============================================================ */

import { test, expect } from "@playwright/test";
import {
  mockAniList,
  standardSchedules,
  defaultEvents,
  makeMedia,
  makeEvent,
  schedulePayload,
} from "./helpers.js";

const WL_KEY = "otaku-time.watchlist.v1";
const LEGACY_WL_KEY = "okaeri.watchlist.v1";

test.describe("AniList API failures", () => {
  test("1. HTTP 400 → friendly error, retry recovers", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, {
      ...standardSchedules(events),
      fail: {
        status: 400,
        body: { errors: [{ message: "Syntax Error", status: 400 }] },
      },
    });
    await page.goto("/");

    await expect(page.locator(".notice")).toContainText("Bad request sent to AniList");
    await expect(page.locator(".empty h2")).toContainText("Couldn't load the schedule");

    // Recovery: the failure queue is drained, so retry succeeds
    await page.locator('[data-action="retry"]').click();
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator(".js-sync").first()).toHaveAttribute("data-state", "live");
  });

  test("2. persistent HTTP 500 → one retry then a friendly message", async ({ page }) => {
    await mockAniList(page, {
      schedule: () => ({
        status: 500,
        body: { errors: [{ message: "Internal", status: 500 }] },
      }),
    });
    await page.goto("/");

    await expect(page.locator(".notice")).toContainText("having a moment", { timeout: 20_000 });
    await expect(page.locator('[data-action="retry"]')).toBeVisible();
  });

  test("3. HTTP 429 → rate-limit message without hammering", async ({ page }) => {
    let requests = 0;
    await page.route("https://graphql.anilist.co/**", async (route) => {
      requests++;
      await route.fulfill({
        status: 429,
        headers: { "retry-after": "45" },
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "Too Many Requests", status: 429, extensions: { code: "RATE_LIMITED" } }],
        }),
      });
    });
    await page.goto("/");

    await expect(page.locator(".notice")).toContainText("request limit", { timeout: 20_000 });
    // page1 attempt + one retry = 2; the sentinel never fires without content
    expect(requests).toBeLessThanOrEqual(3);
  });

  test("4. network unreachable → 'Can't reach AniList' with data-free error state", async ({ page }) => {
    await mockAniList(page, { fail: "abort" });
    await page.goto("/");
    await expect(page.locator(".notice")).toContainText("Can't reach AniList", { timeout: 20_000 });
    await expect(page.locator(".empty h2")).toContainText("Couldn't load the schedule");
  });

  test("5. API returns an empty schedule → honest empty state", async ({ page }) => {
    await mockAniList(page, standardSchedules({ upcoming: [], recent: [] }));
    await page.goto("/");
    await expect(page.locator(".empty h2")).toHaveText("Nothing scheduled yet");
    await expect(page.locator(".empty p")).toContainText("AniList responds");
  });

  test("6. slow API → skeleton placeholders while loading", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, {
      schedule: (vars) => {
        const isRecent = Array.isArray(vars.sort) && vars.sort.includes("TIME_DESC");
        return {
          status: 200,
          // delay happens via handler below — simulate by returning a promise
          body: schedulePayload(isRecent ? events.recent : events.upcoming, { hasNextPage: false }),
        };
      },
    });
    // Re-route with an artificial delay for the first call
    await page.unroute("https://graphql.anilist.co/**");
    let first = true;
    await page.route("https://graphql.anilist.co/**", async (route) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 1200));
      }
      const payload = JSON.parse(route.request().postData() || "{}");
      const isRecent = String(payload.query).includes("TIME_DESC");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          schedulePayload(isRecent ? events.recent : events.upcoming, { hasNextPage: false })
        ),
      });
    });

    await page.goto("/");
    await expect(page.locator(".skeleton-card").first()).toBeVisible();
    await expect(page.locator(".skeleton-shimmer").first()).toBeVisible();
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3, { timeout: 20_000 });
    await expect(page.locator(".skeleton-card")).toHaveCount(0);
  });
});

test.describe("storage hazards", () => {
  test("7. corrupt watchlist is preserved, reported, and repairable", async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, "{definitely not json");
    }, WL_KEY);
    await mockAniList(page, standardSchedules(defaultEvents()));

    await page.goto("/#watchlist");
    await expect(page.locator(".notice")).toContainText("could not be read");
    await expect(page.locator(".empty h2")).toContainText("needs attention");

    // Original file untouched
    const raw = await page.evaluate((key) => localStorage.getItem(key), WL_KEY);
    expect(raw).toBe("{definitely not json");

    // Saving from Upcoming repairs storage with valid data
    await page.click('.nav__link[data-nav="upcoming"]');
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
    await page.locator("[data-action='save']").first().click();
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
    const repaired = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).version === 3,
      WL_KEY
    );
    expect(repaired).toBe(true);
  });

  test("8. quota-exceeded storage keeps the session alive with a warning", async ({ page }) => {
    await page.addInitScript((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, value) {
        if (k === key) {
          const error = new Error("quota");
          error.name = "QuotaExceededError";
          throw error;
        }
        return original.call(this, k, value);
      };
    }, WL_KEY);
    await mockAniList(page, standardSchedules(defaultEvents()));

    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
    await page.locator("[data-action='save']").first().click();

    // In-memory save still works and the user is told it's session-only
    await expect(page.locator("#toast")).toHaveText(/storage is full|session only/i);
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");

    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".notice")).toContainText("storage is full");
  });

  test("9. legacy Okaeri keys migrate on first run", async ({ page }) => {
    await page.addInitScript((legacyKey) => {
      localStorage.setItem(
        legacyKey,
        JSON.stringify({
          version: 2,
          items: [
            {
              id: 6001,
              title: { romaji: "Legacy Show", english: "Legacy Show", native: "" },
              coverImage: { medium: null, large: null, extraLarge: null },
              format: "TV",
              status: "FINISHED",
              episodes: 13,
              duration: 24,
              averageScore: 85,
              season: "SPRING",
              seasonYear: 2019,
              genres: ["Action"],
              nextAiringEpisode: null,
              watched: 6,
              createdAt: 1560000000000,
            },
          ],
        })
      );
      localStorage.setItem("okaeri.theme.v1", "light");
      localStorage.setItem(
        "okaeri.preferences.v1",
        JSON.stringify({ version: 2, timezone: "Asia/Tokyo", hour12: false, reminder: 20 })
      );
    }, LEGACY_WL_KEY);
    await mockAniList(page, standardSchedules(defaultEvents()));

    await page.goto("/#watchlist");
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".card__title")).toContainText("Legacy Show");
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");

    // Canonical keys written, legacy preserved
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toContain(WL_KEY);
    expect(keys).toContain(LEGACY_WL_KEY);
    expect(keys).toContain("otaku-time.theme.v1");
  });

  test("10. corrupt preferences fall back to defaults without breaking the app", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("otaku-time.preferences.v1", "}broken{");
    });
    await mockAniList(page, standardSchedules(defaultEvents()));

    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
    await expect(page.locator("#toast")).toContainText("settings could not be read", { timeout: 10_000 });

    // Original untouched
    const raw = await page.evaluate(() => localStorage.getItem("otaku-time.preferences.v1"));
    expect(raw).toBe("}broken{");
  });
});

test.describe("multi-tab & environment", () => {
  test("11. cross-tab: saving in one tab updates the other", async ({ context, page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    const second = await context.newPage();
    await mockAniList(second, standardSchedules(defaultEvents()));
    await second.goto("/#watchlist");
    await expect(second.locator(".empty h2")).toHaveText("Your watchlist is empty");

    // Save in tab A → tab B's storage event updates counts and view
    await page.locator("[data-action='save']").first().click();
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
    await expect(second.locator('.nav__count[data-nav-count]')).toHaveText("1");
    await expect(second.locator(".card")).toHaveCount(1);

    await second.close();
  });

  test("12. reduced motion disables animations", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    const durations = await page.evaluate(() => {
      const card = document.querySelector(".card");
      const dialog = document.querySelector("#detail-dialog");
      return {
        mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        cardAnimation: card ? getComputedStyle(card).animationDuration : "",
        cardTransition: card ? getComputedStyle(card).transitionDuration : "",
        dialogTransition: dialog ? getComputedStyle(dialog).transitionDuration : "",
      };
    });
    expect(durations.mediaMatches).toBe(true);
    const toSeconds = (v) =>
      v.split(",").map((part) => {
        const n = parseFloat(part);
        if (part.includes("ms")) return n / 1000;
        return n;
      });
    expect(Math.max(...toSeconds(durations.cardAnimation))).toBeLessThan(0.01);
    expect(Math.max(...toSeconds(durations.cardTransition))).toBeLessThan(0.01);
    expect(Math.max(...toSeconds(durations.dialogTransition))).toBeLessThan(0.01);
    await context.close();
  });

  test("13. going offline surfaces a notice and keeps saved data usable", async ({ page, context }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    await context.setOffline(true);
    await expect(page.locator("#toast")).toHaveText(/offline/i, { timeout: 10_000 });

    // Existing content remains on screen
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    // Refresh while offline → error state, data preserved
    await page.unroute("https://graphql.anilist.co/**");
    await page.locator(".js-refresh").first().click();
    await expect(page.locator(".notice")).toContainText("Can't reach AniList", { timeout: 25_000 });
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3, "stale data stays visible");

    await context.setOffline(false);
  });

  test("14. missing poster art degrades to a title fallback", async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    const noArt = makeMedia(303, "No Art Show", {
      coverImage: { medium: null, large: null, extraLarge: null },
      bannerImage: null,
    });
    await mockAniList(page, standardSchedules({
      upcoming: [makeEvent({ id: 9201, episode: 2, airingAt: now + 5000, media: noArt })],
      recent: [],
    }));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(1);
    // No art anywhere → titled placeholder instead of a broken image
    await expect(page.locator(".card__poster-fallback")).toBeVisible();
    await expect(page.locator(".card__poster-title")).toContainText("No Art Show");
    // No broken <img>
    expect(await page.locator(".card img, .lead-panel img").count()).toBe(0);
  });

  test("15. sentinel auto-loads the next schedule page", async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    const page1 = Array.from({ length: 6 }, (_, i) =>
      makeEvent({
        id: 9300 + i,
        episode: i + 1,
        airingAt: now + 3600 * (i + 1),
        media: makeMedia(400 + i, `Page One Show ${i + 1}`),
      })
    );
    const page2 = Array.from({ length: 4 }, (_, i) =>
      makeEvent({
        id: 9400 + i,
        episode: i + 1,
        airingAt: now + 86400 * (i + 2),
        media: makeMedia(500 + i, `Page Two Show ${i + 1}`),
      })
    );

    await mockAniList(page, {
      schedule: (vars) => {
        const requested = vars.page || 1;
        return schedulePayload(requested === 1 ? page1 : page2, {
          page: requested,
          hasNextPage: requested < 2,
        });
      },
    });
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(6);

    // Scroll the sentinel into range → IntersectionObserver auto-loads page 2
    await page.locator(".load-sentinel").scrollIntoViewIfNeeded();
    await expect(page.locator(".card, .lead-panel")).toHaveCount(10, { timeout: 20_000 });
    await expect(page.locator(".card").last()).toContainText("Page Two Show 4");
  });
});

test.describe("data portability", () => {
  test("imported backup renders and survives reload", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    await page.setInputFiles("#import-file", {
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        app: "Okaeri",
        schemaVersion: 1,
        items: [
          {
            id: 5001,
            title: { romaji: "Portable", english: "Portable Show", native: "" },
            coverImage: { medium: null, large: null, extraLarge: null },
            format: "TV",
            status: "RELEASING",
            episodes: 24,
            duration: 24,
            averageScore: 90,
            season: "FALL",
            seasonYear: 2026,
            genres: ["Sci-Fi"],
            nextAiringEpisode: null,
            watched: 8,
            createdAt: Date.now(),
          },
        ],
      })),
    });
    await expect(page.locator("#import-result")).toHaveText(/1 added, 0 skipped/);
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator("#section-title")).toHaveText("Watchlist");
    await expect(page.locator(".card__title")).toContainText("Portable Show");
    await expect(page.locator(".card__progress-text")).toContainText("8/24");
  });
});
