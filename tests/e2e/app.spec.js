/* ============================================================
   Otaku Time — core application flows
   ============================================================ */

import { test, expect } from "@playwright/test";
import {
  mockAniList,
  standardSchedules,
  defaultEvents,
  makeMedia,
  searchPayload,
  detailsPayload,
  collectPageErrors,
  seedWatchlist,
} from "./helpers.js";

test.describe("boot & sections", () => {
  test("loads with branding, upcoming schedule and no page errors", async ({ page }) => {
    const errors = collectPageErrors(page);
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));

    await page.goto("/");
    await expect(page).toHaveTitle("Upcoming · Otaku Time");
    await expect(page.locator("#section-title")).toHaveText("Upcoming");

    // Three primary sections only
    const nav = page.locator(".nav__link");
    await expect(nav).toHaveCount(3);
    await expect(nav.nth(0)).toHaveAttribute("href", "#upcoming");
    await expect(nav.nth(1)).toHaveAttribute("href", "#watchlist");
    await expect(nav.nth(2)).toHaveAttribute("href", "#recent");

    // Schedule rendered from the API
    await expect(page.locator(".card")).toHaveCount(3);
    await expect(page.locator(".spotlight")).toBeVisible();
    await expect(page.locator(".spotlight__title")).toContainText("Alpha Show");
    await expect(page.locator(".day-group").first()).toBeVisible();
    await expect(page.locator(".js-sync").first()).toHaveAttribute("data-state", "live");

    expect(errors).toEqual([]);
  });

  test("navigates between all three sections via sidebar and hash", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);

    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page).toHaveURL(/#watchlist$/);
    await expect(page.locator("#section-title")).toHaveText("Watchlist");
    await expect(page.locator(".empty h2")).toHaveText("Your watchlist is empty");
    await expect(page.locator('.nav__link[data-nav="watchlist"]')).toHaveAttribute("aria-current", "page");

    await page.click('.nav__link[data-nav="recent"]');
    await expect(page).toHaveURL(/#recent$/);
    await expect(page.locator("#section-title")).toHaveText("Recently aired");
    await expect(page.locator(".row")).toHaveCount(2);

    // Deep link on a fresh load
    await page.goto("/#upcoming");
    await expect(page.locator("#section-title")).toHaveText("Upcoming");
    await expect(page.locator(".card")).toHaveCount(3);
  });

  test("filters update the visible schedule", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);

    await page.selectOption("#filter-format", "OVA");
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".card__title")).toContainText("Gamma Show");
    await expect(page.locator("#filter-count")).toContainText("1 episode");

    await page.selectOption("#filter-format", "all");
    await page.selectOption("#filter-sort", "title");
    await expect(page.locator(".card")).toHaveCount(3);
    await expect(page.locator(".card__title").first()).toContainText("Alpha Show");
  });

  test("empty schedule shows a friendly empty state", async ({ page }) => {
    await mockAniList(page, standardSchedules({ upcoming: [], recent: [] }));
    await page.goto("/");
    await expect(page.locator(".empty h2")).toHaveText("Nothing scheduled yet");
    await expect(page.locator(".empty")).toBeVisible();
  });
});

test.describe("search", () => {
  test("finds local pool titles instantly and merges remote results", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, {
      ...standardSchedules(events),
      search: (vars) =>
        searchPayload(
          String(vars.search || "").toLowerCase().includes("discovery")
            ? [makeMedia(555, "Remote Discovery", { averageScore: 95 })]
            : []
        ),
      details: (vars) => detailsPayload(makeMedia(vars.id, "Remote Discovery")),
    });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);

    // "/" focuses the search field
    await page.keyboard.press("/");
    await expect(page.locator("#search")).toBeFocused();

    await page.fill("#search", "alpha");
    await expect(page.locator("#section-title")).toHaveText("Results");
    await expect(page.locator(".search-count")).toHaveText("1");
    await expect(page.locator(".card__title")).toContainText("Alpha Show");
    await expect(page.locator("mark").first()).toBeVisible();

    // Remote merge adds the AniList-only result
    await page.fill("#search", "discovery");
    await expect(page.locator(".card")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(".card__title")).toContainText("Remote Discovery");

    // Escape clears the query and returns to the section
    await page.keyboard.press("Escape");
    await expect(page.locator("#section-title")).toHaveText("Upcoming");
    await expect(page.locator("#search")).toHaveValue("");
  });

  test("search with no matches shows guidance", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, {
      ...standardSchedules(events),
      search: () => searchPayload([]),
    });
    await page.goto("/");
    await page.fill("#search", "zzz-no-such-show");
    await expect(page.locator(".empty h2")).toContainText("No matches");
    await expect(page.locator(".empty p")).toContainText("spelling");
  });
});

test.describe("watchlist lifecycle", () => {
  test("save, count, progress and persistence across reload", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, {
      ...standardSchedules(events),
      details: (vars) =>
        detailsPayload(
          makeMedia(vars.id, vars.id === 101 ? "Alpha Show" : "Beta Show", { episodes: 12 })
        ),
    });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);

    // Save the first card
    await page.locator(".card__save").first().click();
    await expect(page.locator("#toast")).toHaveText(/Saved to watchlist/);
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
    await expect(page.locator('.nav__count[data-nav-count]')).toBeVisible();

    // Watchlist shows the card with progress controls
    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".stat__value").first()).toHaveText("1");
    await expect(page.locator(".bump-btn")).toBeVisible();

    // +1 progress persists
    await page.locator(".bump-btn[data-delta='1']").click();
    await expect(page.locator(".card__progress-text")).toContainText("1/12");

    // Reload → still there
    await page.reload();
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".card__progress-text")).toContainText("1/12");

    // Unsave from the card
    await page.locator(".card__save").click();
    await expect(page.locator("#toast")).toHaveText(/Removed from watchlist/);
    await expect(page.locator(".empty h2")).toHaveText("Your watchlist is empty");
  });

  test("seeded watchlist renders stats immediately", async ({ page }) => {
    const now = Date.now();
    await seedWatchlist(page, [
      {
        id: 7001,
        title: { romaji: "Seeded", english: "Seeded Show", native: "" },
        coverImage: { medium: null, large: null, extraLarge: null },
        format: "TV",
        status: "RELEASING",
        episodes: 24,
        duration: 24,
        averageScore: 88,
        season: "SUMMER",
        seasonYear: 2026,
        genres: ["Comedy"],
        nextAiringEpisode: { airingAt: Math.floor(now / 1000) + 86400 },
        watched: 5,
        createdAt: now,
      },
      {
        id: 7002,
        title: { romaji: "Done", english: "Finished Show", native: "" },
        coverImage: { medium: null, large: null, extraLarge: null },
        format: "TV",
        status: "FINISHED",
        episodes: 12,
        duration: 24,
        averageScore: 80,
        season: "WINTER",
        seasonYear: 2025,
        genres: ["Drama"],
        nextAiringEpisode: null,
        watched: 12,
        createdAt: now - 1000,
      },
    ]);
    await mockAniList(page, standardSchedules(defaultEvents()));

    await page.goto("/#watchlist");
    await expect(page.locator(".card")).toHaveCount(2);
    const stats = page.locator(".stat__value");
    await expect(stats.nth(0)).toHaveText("2");
    await expect(stats.nth(1)).toHaveText("1"); // in progress
    await expect(stats.nth(2)).toHaveText("1"); // completed
    await expect(stats.nth(3)).toHaveText("17"); // episodes watched
    await expect(page.locator(".card.is-complete")).toHaveCount(1);
    await expect(page.locator(".card.is-tracked")).toHaveCount(1);
  });
});

test.describe("dialogs", () => {
  test("detail dialog lazy-loads details and restores focus", async ({ page }) => {
    const events = defaultEvents();
    let detailRequests = 0;
    await mockAniList(page, {
      ...standardSchedules(events),
      details: (vars) => {
        detailRequests++;
        return detailsPayload(
          makeMedia(vars.id, "Alpha Show", {
            description: "Full rich synopsis from AniList.",
            genres: ["Action", "Adventure", "Fantasy"],
            externalLinks: [{ site: "Crunchyroll", url: "https://crunchyroll.com" }],
          })
        );
      },
    });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);

    const opener = page.locator(".card__open").first();
    await opener.click();
    const dialog = page.locator("#detail-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#detail-title")).toContainText("Alpha Show");
    await expect(dialog.locator(".detail-synopsis")).toContainText("Full rich synopsis", { timeout: 15_000 });
    await expect(dialog.locator(".detail-tags .badge")).toHaveCount(3);
    expect(detailRequests).toBe(1);

    // Save from inside the dialog
    await dialog.locator('[data-detail-action="toggle-save"]').click();
    await expect(dialog.locator('[data-detail-action="toggle-save"]')).toContainText("In watchlist");
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");

    // Esc closes with animation and focus returns to the opener
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("backdrop click closes the settings dialog", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    const dialog = page.locator("#settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".settings-group")).toHaveCount(3);

    // Click the backdrop (the dialog element itself, outside its box)
    await page.mouse.click(20, 450);
    await expect(dialog).toBeHidden();
  });

  test("settings change theme, clock format and timezone", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);

    await page.locator(".js-settings-open").first().click();
    const dialog = page.locator("#settings-dialog");

    // Timezone → card airing times re-render in the new zone
    const timeBefore = await page.locator(".card__time").first().textContent();
    await page.selectOption("#setting-timezone", "America/New_York");
    await expect(page.locator(".card__time").first()).not.toHaveText(timeBefore);

    // Clock format → 24h
    await page.selectOption("#setting-hour12", "24");
    await expect(page.locator("#clock")).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Theme toggle from the chrome
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.locator(".js-theme-toggle").first().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .not.toBe(before);
  });

  test("export downloads a versioned backup", async ({ page }) => {
    await seedWatchlist(page, [
      {
        id: 42,
        title: { romaji: "Exported", english: "", native: "" },
        coverImage: { medium: null, large: null, extraLarge: null },
        format: "TV",
        status: "FINISHED",
        episodes: 1,
        duration: 24,
        averageScore: 70,
        season: "SPRING",
        seasonYear: 2024,
        genres: [],
        nextAiringEpisode: null,
        watched: 1,
        createdAt: Date.now(),
      },
    ]);
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();

    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-settings-action="export"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("otaku-time-watchlist.json");
  });

  test("import validates payloads and reports results", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();

    // Invalid JSON
    await page.setInputFiles("#import-file", {
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{not json"),
    });
    await expect(page.locator("#import-result")).toHaveText(/valid JSON/);

    // Wrong schema version
    await page.setInputFiles("#import-file", {
      name: "wrong-version.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ app: "Otaku Time", schemaVersion: 99, items: [] })),
    });
    await expect(page.locator("#import-result")).toHaveText(/Unknown backup version/);

    // Valid backup
    await page.setInputFiles("#import-file", {
      name: "good.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        app: "Otaku Time",
        schemaVersion: 2,
        items: [
          {
            id: 8001,
            title: { romaji: "Imported", english: "Imported Show", native: "" },
            coverImage: { medium: null, large: null, extraLarge: null },
            format: "TV",
            status: "RELEASING",
            episodes: 10,
            duration: 24,
            averageScore: 77,
            season: "FALL",
            seasonYear: 2026,
            genres: ["Mystery"],
            nextAiringEpisode: null,
            watched: 2,
            createdAt: Date.now(),
          },
          { id: 8001, title: { romaji: "dupe" }, watched: 0 }, // duplicate → skipped
          { id: -5, title: { romaji: "bad" } }, // invalid id
        ],
      })),
    });
    await expect(page.locator("#import-result")).toHaveText(/1 added, 1 skipped, 1 invalid/);
    await expect(page.locator("#import-result")).toHaveText(/saved/);
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
  });
});

test.describe("keyboard & accessibility", () => {
  test("skip link is the first tab stop and moves focus to content", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("nav exposes current section to assistive tech", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator('.nav__link[data-nav="upcoming"]')).toHaveAttribute("aria-current", "page");
    await page.click('.nav__link[data-nav="recent"]');
    await expect(page.locator('.nav__link[data-nav="recent"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator('.nav__link[data-nav="upcoming"]')).not.toHaveAttribute("aria-current", "page");
  });

  test("toast is a polite live region", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator("#toast")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("#toast")).toHaveAttribute("role", "status");
  });

  test("dialogs are modal and labelled", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    const dialog = page.locator("#settings-dialog");
    await expect(dialog).toBeVisible();
    const labelId = await dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    await expect(dialog.locator(`#${labelId}`)).toBeVisible();
    // Focus starts inside the dialog
    await expect.poll(() => page.evaluate(() => document.querySelector("#settings-dialog")?.contains(document.activeElement))).toBe(true);
  });
});

test.describe("performance basics", () => {
  test("schedules come from cache on repeat visits (IndexedDB snapshot)", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);

    // Second visit: snapshot restores instantly (source: cache until network settles)
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);
    // The IndexedDB cache now holds the snapshot
    const cached = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("otaku-time.cache.v1", 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const value = await new Promise((resolve) => {
        const tx = db.transaction("snapshots", "readonly");
        const get = tx.objectStore("snapshots").get("upcoming");
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => resolve(null);
      });
      db.close();
      return Boolean(value?.events?.length);
    });
    expect(cached).toBe(true);
  });
});

test.describe("custom select UI", () => {
  test("filter select opens on click and commits an option", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);

    // Open the custom menu (regression: trigger used to crash with a
    // "contains of undefined" error and never show the listbox)
    const trigger = page.locator("#filter-format-trigger");
    await trigger.click();
    const menu = page.locator("#filter-format-listbox");
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(menu.locator(".select__option")).toHaveCount(8);

    // Pick "OVA"
    await menu.locator('.select__option[data-value="OVA"]').click();
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger.locator(".select__value")).toHaveText("OVA");
    await expect(page.locator("#filter-format")).toHaveValue("OVA");
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".card__title")).toContainText("Gamma Show");

    // Escape path
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("settings selects use the same interactive menu", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    await expect(page.locator("#settings-dialog")).toBeVisible();

    const trigger = page.locator("#setting-timezone-trigger");
    await trigger.click();
    const menu = page.locator("#setting-timezone-listbox");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".select__option").first()).toBeVisible();

    const original = await page.locator("#setting-timezone").inputValue();
    // Choose a different zone than the one currently selected
    await menu.locator('.select__option[data-value="Asia/Tokyo"]').click();
    await expect(page.locator("#setting-timezone")).toHaveValue("Asia/Tokyo");
    await expect(trigger.locator(".select__value")).toContainText("Asia/Tokyo");
    expect(original).not.toBe("Asia/Tokyo");
  });

  test("clicking outside closes the menu", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator("#filter-date-trigger").click();
    await expect(page.locator("#filter-date-listbox")).toBeVisible();
    await page.mouse.click(700, 700);
    await expect(page.locator("#filter-date-listbox")).toBeHidden();
  });
});

test.describe("render discipline (no flashing)", () => {
  test("saving patches controls in place without repainting the view", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.addInitScript(() => {
      window.__paints = 0;
      const hook = new MutationObserver(() => {
        const app = document.getElementById("app");
        if (app && !app.__hooked) {
          app.__hooked = true;
          new MutationObserver(() => {
            window.__paints++;
          }).observe(app, { childList: true });
        }
      });
      hook.observe(document, { childList: true, subtree: true });
    });
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);
    await expect(page.locator("#app .view-enter")).toBeVisible(); // entrance played

    // Remember the exact entrance node so we can prove it is never recreated.
    await page.evaluate(() => {
      window.__entrance = document.querySelector("#app .view-enter");
      window.__paints = 0;
    });
    await page.locator(".card__save").first().click();
    await expect(page.locator("#toast")).toHaveText(/Saved to watchlist/);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__paints)).toBe(0);
    expect(
      await page.evaluate(() => document.querySelector("#app .view-enter") === window.__entrance)
    ).toBe(true);
    // Both the clicked card and the nav count reflect the save
    await expect(page.locator(".card__save").first()).toHaveClass(/is-saved/);
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");

    // Section switch → repaint happens exactly once and animates in
    await page.evaluate(() => {
      window.__paints = 0;
    });
    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator("#section-title")).toHaveText("Watchlist");
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__paints)).toBe(1);
    expect(
      await page.evaluate(() => {
        const el = document.querySelector("#app .view-enter");
        return Boolean(el) && el !== window.__entrance; // a fresh animated node
      })
    ).toBe(true);

    expect(errors).toEqual([]);
  });

  test("schedule sync after load does not replay entrance animations", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(3);
    await expect(page.locator("#app .view-enter")).toBeVisible();

    // A manual refresh brings identical schedule data: nothing should be
    // repainted at all (repaint + animation replay was the visible flashing).
    await page.evaluate(() => {
      window.__entrance = document.querySelector("#app .view-enter");
      window.__paints = 0;
    });
    await page.locator(".js-refresh").first().click();
    await expect(page.locator(".js-sync").first()).toHaveAttribute("data-state", "live", {
      timeout: 15_000,
    });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__paints)).toBe(0);
    expect(
      await page.evaluate(() => document.querySelector("#app .view-enter") === window.__entrance)
    ).toBe(true);
    await expect(page.locator(".card")).toHaveCount(3);
  });
});
