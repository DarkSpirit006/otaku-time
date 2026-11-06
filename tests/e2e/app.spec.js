/* ============================================================
   Otaku Time — core application flows
   ============================================================ */

import { test, expect } from "@playwright/test";
import {
  mockAniList,
  standardSchedules,
  defaultEvents,
  makeMedia,
  makeEvent,
  searchPayload,
  detailsPayload,
  collectPageErrors,
  seedWatchlist,
} from "./helpers.js";

/* ============================================================
   The topbar search field is an underline, not a form input:
   the generic input[type="search"] styling in components/forms.css
   used to leak into it (border + surface + 40px min-height inside a
   36px row), which pushed the field out of alignment on phones.
   ============================================================ */
test.describe("topbar composition", () => {
  const geometry = () =>
    async (page) =>
      page.evaluate(() => {
        const wrap = document.querySelector(".search");
        const input = wrap.querySelector('input[type="search"]');
        const cs = getComputedStyle(input);
        const w = wrap.getBoundingClientRect();
        const i = input.getBoundingClientRect();
        return {
          borderTop: cs.borderTopWidth,
          borderBottom: cs.borderBottomWidth,
          background: cs.backgroundColor,
          radius: cs.borderTopLeftRadius,
          bottomOverflow: Math.round(i.bottom - w.bottom),
          topOverflow: Math.round(w.top - i.top),
          rightOverflow: Math.round(i.right - w.right),
        };
      });

  test("stays an underline field with no stray border, background or overflow", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".search input[type='search']")).toBeVisible();

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(120);
      const g = await geometry()(page);
      expect(g, JSON.stringify(g)).toMatchObject({
        borderTop: "0px",
        borderBottom: "0px",
        background: "rgba(0, 0, 0, 0)",
        radius: "0px",
      });
      // The field must sit inside its own row, not spill over it.
      expect(g.bottomOverflow, `bottom overflow at ${viewport.width}px`).toBeLessThanOrEqual(0);
      expect(g.topOverflow, `top overflow at ${viewport.width}px`).toBeLessThanOrEqual(0);
      expect(g.rightOverflow, `right overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
    }
  });
});

/* ============================================================
   The feature's bottom scrim is what lets the eyebrow label sit over
   arbitrary artwork. It has to paint ABOVE the poster image (z-index 1),
   otherwise the fade silently does nothing and red text lands on
   whatever colour the poster happens to be.
   ============================================================ */
test.describe("feature scrim", () => {
  test("paints above the poster and fades to the page colour on phones", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".spotlight__poster")).toBeVisible();

    const scrim = await page.evaluate(() => {
      const poster = document.querySelector(".spotlight__poster");
      const img = poster.querySelector("img");
      const after = getComputedStyle(poster, "::after");
      return {
        content: after.content,
        position: after.position,
        scrimZ: after.zIndex === "auto" ? 0 : Number(after.zIndex),
        imageZ: img ? Number(getComputedStyle(img).zIndex || 0) : 0,
        background: after.backgroundImage,
      };
    });

    expect(scrim.content).not.toBe("none");
    expect(scrim.position).toBe("absolute");
    expect(scrim.background).toContain("linear-gradient");
    expect(scrim.scrimZ, `scrim z ${scrim.scrimZ} vs image z ${scrim.imageZ}`).toBeGreaterThan(scrim.imageZ);
  });
});

/* ============================================================
   The detail sheet on a phone is a two-column layout: a 92px poster and
   the text column beside it. Long titles and long button labels used to
   push past the dialog's right edge, where they were clipped to the
   viewport and unreachable (the sheet only scrolls vertically).
   ============================================================ */
test.describe("detail sheet on phones", () => {
  test("long titles and action labels stay inside the sheet", async ({ page }) => {
    const events = defaultEvents();
    const longTitle = "Steel Ball Run JoJo's Bizarre Adventure 2nd and 3rd Stage";
    await mockAniList(page, {
      ...standardSchedules(events),
      details: (vars) =>
        detailsPayload(
          makeMedia(vars.id, longTitle, {
            episodes: 11,
            genres: ["Action", "Adventure", "Drama", "Mystery", "Supernatural"],
          })
        ),
    });

    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 780 });
      await page.goto("/");
      await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
      await page.locator('[data-action="detail"]').first().click();
      await expect(page.locator("#detail-dialog")).toBeVisible();
      await expect(page.locator("#detail-title")).toContainText("Steel Ball Run");
      await page.waitForTimeout(250);

      const overflow = await page.evaluate(() => {
        const dialog = document.querySelector("#detail-dialog");
        const box = dialog.getBoundingClientRect();
        const offenders = [];
        for (const element of document.querySelectorAll("#detail-content *")) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0) continue;
          const spillsRight = rect.right > box.right + 1 || rect.left < box.left - 1;
          const clipsContent = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2;
          if (spillsRight || clipsContent) {
            offenders.push(
              `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 24)} ` +
                `right=${Math.round(rect.right)} vs ${Math.round(box.right)}, ` +
                `scroll=${element.scrollWidth}/${element.clientWidth}`
            );
          }
        }
        return offenders;
      });

      expect(overflow, `at ${width}px:\n${overflow.join("\n")}`).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator("#detail-dialog")).toBeHidden();
    }
  });
});

/* ============================================================
   The ticker rewrites countdown text every second. A countdown span that
   also holds the airing time ("in 2h · Thu, Nov 5, 8:00 PM UTC") lost it
   on the first tick, because textContent replacement drops child nodes:
   the exact air time vanished one second after every load.
   ============================================================ */
test.describe("live countdowns", () => {
  test("keep the airing time and its own value after ticking", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");

    const airing = page.locator(".card__airing").first();
    await expect(airing).toBeVisible();
    const before = (await airing.innerText()).replace(/\s+/g, " ");
    expect(before).toMatch(/·/); // countdown + separator + time

    // Two seconds of real ticks.
    await page.waitForTimeout(2400);

    const after = (await airing.innerText()).replace(/\s+/g, " ");
    expect(after).toMatch(/·/);
    expect(after).toMatch(/UTC|AM|PM/);

    // The exact air time is the half that must not move. The countdown
    // itself is allowed to cross an hour boundary while we wait.
    const timeOf = (text) => text.split("·").pop().trim();
    expect(timeOf(after)).toBe(timeOf(before));
    expect(after.split("·")[0].trim()).toMatch(/^in /);
  });
});

/* ============================================================
   "Aired earlier today" rows carry five children (clock, poster, body,
   ago, actions) like every other row, but the compact variant declared
   only four grid tracks. Everything shifted one column left, so the
   poster landed in the 1fr track: a 100px thumbnail rendered 640px wide
   and 966px tall, taller than the feature above it.
   ============================================================ */
test.describe("today's already-aired rows", () => {
  test("keep the poster in its own column at its own size", async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    const events = defaultEvents();
    await mockAniList(
      page,
      standardSchedules({
        ...events,
        upcoming: [
          ...events.upcoming,
          // Already aired today, so it lands in the "aired earlier" list.
          makeEvent({
            id: 9009,
            episode: 3,
            airingAt: now - 3600,
            media: makeMedia(191, "Yesterday's News"),
          }),
        ],
      })
    );

    await page.goto("/");
    const row = page.locator(".today-past .row").first();
    await expect(row).toBeVisible();

    const sizes = await page.evaluate(() => {
      const row = document.querySelector(".today-past .row");
      const poster = row.querySelector(".row__poster");
      const rowBox = row.getBoundingClientRect();
      const box = poster.getBoundingClientRect();
      return {
        posterWidth: Math.round(box.width),
        posterHeight: Math.round(box.height),
        rowHeight: Math.round(rowBox.height),
      };
    });

    // A 54px thumbnail stays a 54px thumbnail (2:3, so ~81px tall) and
    // never outsizes the row that contains it.
    expect(sizes.posterWidth).toBeLessThanOrEqual(90);
    expect(sizes.posterHeight).toBeLessThanOrEqual(140);
    expect(sizes.rowHeight).toBeLessThan(200);
  });
});

/* ============================================================
   Artwork sizing. AniList's field names sit one step below the folders
   they point at (medium → /cover/small/, large → /cover/medium/,
   extraLarge → /cover/large/), and those folders are ~100/230/660 px.
   The srcset descriptors have to describe the FILE: if they understate it,
   the browser escalates to the biggest artwork for every slot, and the app
   ships megabytes of images nobody can see.
   ============================================================ */
test.describe("artwork sources", () => {
  test("declare honest widths and a sizes hint on every poster", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();

    const posters = await page.evaluate(() =>
      [...document.querySelectorAll("img[srcset]")].map((img) => ({
        srcset: img.getAttribute("srcset"),
        sizes: img.getAttribute("sizes") || "",
        current: img.currentSrc,
        rendered: Math.round(img.getBoundingClientRect().width),
        natural: img.naturalWidth,
      }))
    );

    expect(posters.length).toBeGreaterThan(0);

    // Three ascending candidates: 100 / 230 / 660.
    for (const poster of posters) {
      const widths = [...poster.srcset.matchAll(/\s(\d+)w/g)].map(([, w]) => Number(w));
      expect(widths.length, poster.srcset).toBe(3);
      expect(widths).toEqual([...widths].sort((a, b) => a - b));
      expect(widths).toEqual([100, 230, 660]);
    }

    // Anything above the fold must say how wide it will be drawn, or the
    // browser assumes 100vw and picks the largest file.
    for (const poster of posters) {
      expect(poster.sizes, `${poster.current} has no sizes`).not.toBe("");
    }

    // And what it picked has to be at least as wide as it is drawn.
    const spotlight = posters.find((p) => p.current.includes("/large/"));
    if (spotlight) {
      expect(spotlight.natural).toBeGreaterThanOrEqual(Math.min(spotlight.rendered, 461));
    }
  });
});

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

    // Schedule rendered from the API: the spotlight is the next episode,
    // the day opens with editorial lead panels, the lineup continues as cards.
    await expect(page.locator(".spotlight")).toBeVisible();
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
    await expect(page.locator(".spotlight__title")).toContainText("Alpha Show");
    await expect(page.locator(".day-group").first()).toBeVisible();
    await expect(page.locator(".js-sync").first()).toHaveAttribute("data-state", "live");

    expect(errors).toEqual([]);
  });

  test("navigates between all three sections via sidebar and hash", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

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
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
  });

  test("schedule ships unfiltered, in chronological order", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    // No filter UI anywhere
    await expect(page.locator(".filter-bar")).toHaveCount(0);
    await expect(page.locator("#app .select__trigger")).toHaveCount(0);

    // Air-time order: +1h, +2h, +3d (lead panels lead the lineup)
    await expect(
      page.locator(".lead-panel__title, .card__title")
    ).toHaveText(["Alpha Show", "Beta Show", "Gamma Show"]);

    // Meta carries the count instead of the old filter bar
    await expect(page.locator("#section-meta")).toContainText("3 loaded");
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
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

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
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    // Save the first entry (a lead panel carries the save control too)
    await page.locator("[data-action='save']").first().click();
    await expect(page.locator("#toast")).toHaveText(/Saved to watchlist/);
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
    await expect(page.locator('.nav__count[data-nav-count]')).toBeVisible();

    // Watchlist shows the card with progress controls
    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".stat__value").first()).toHaveText("1");
    await expect(page.locator(".step-btn").first()).toBeVisible();

    // +1 progress persists
    await page.locator(".step-btn[data-delta='1']").first().click();
    await expect(page.locator(".card__progress-text")).toContainText("1/12");

    // Reload → still there
    await page.reload();
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".card__progress-text")).toContainText("1/12");

    // Unsave from the card
    await page.locator(".card__save").click();
    await expect(page.locator("#toast")).toHaveText(/Removed/);
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
        mediaStatus: "RELEASING",
        listStatus: "watching",
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
        mediaStatus: "FINISHED",
        listStatus: "completed",
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
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    const opener = page.locator(".card__open, .lead-panel__open").first();
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
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    await page.locator(".js-settings-open").first().click();
    const dialog = page.locator("#settings-dialog");

    // Timezone → airing times re-render in the new zone
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
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    // Second visit: snapshot restores instantly (source: cache until network settles)
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
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
  test("settings select opens, commits, and closes every way", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    await expect(page.locator("#settings-dialog")).toBeVisible();

    // Open: listbox visible with options, aria-expanded flips
    const trigger = page.locator("#setting-timezone-trigger");
    await trigger.click();
    const menu = page.locator("#setting-timezone-listbox");
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(menu.locator(".select__option").first()).toBeVisible();

    // Commit a different zone
    const original = await page.locator("#setting-timezone").inputValue();
    await menu.locator('.select__option[data-value="Asia/Tokyo"]').click();
    await expect(page.locator("#setting-timezone")).toHaveValue("Asia/Tokyo");
    await expect(trigger.locator(".select__value")).toContainText("Asia/Tokyo");
    expect(original).not.toBe("Asia/Tokyo");
    await expect(menu).toBeHidden();

    // Escape closes without committing
    const clockTrigger = page.locator("#setting-hour12-trigger");
    await clockTrigger.click();
    const clockMenu = page.locator("#setting-hour12-listbox");
    await expect(clockMenu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(clockMenu).toBeHidden();
    await expect(page.locator("#setting-hour12")).toHaveValue("12");

    // Clicking outside closes the menu
    await clockTrigger.click();
    await expect(clockMenu).toBeVisible();
    await page.mouse.click(40, 400);
    await expect(clockMenu).toBeHidden();
  });

  test("keyboard: arrows navigate options and Enter commits", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    const clockTrigger = page.locator("#setting-hour12-trigger");
    await clockTrigger.focus();
    await page.keyboard.press("Enter"); // opens
    const clockMenu = page.locator("#setting-hour12-listbox");
    await expect(clockMenu).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter"); // commits the active option
    await expect(clockMenu).toBeHidden();
    await expect(page.locator("#setting-hour12")).toHaveValue("24");
    await expect(clockTrigger).toHaveAttribute("aria-expanded", "false");
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
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
    await expect(page.locator("#app .view-enter")).toBeVisible(); // entrance played

    // Remember the exact entrance node so we can prove it is never recreated.
    await page.evaluate(() => {
      window.__entrance = document.querySelector("#app .view-enter");
      window.__paints = 0;
    });
    const firstSave = page.locator(".card__save, .lead-panel__save").first();
    await firstSave.click();
    await expect(page.locator("#toast")).toHaveText(/Saved to watchlist/);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__paints)).toBe(0);
    expect(
      await page.evaluate(() => document.querySelector("#app .view-enter") === window.__entrance)
    ).toBe(true);
    // Both the clicked entry and the nav count reflect the save
    await expect(firstSave).toHaveClass(/is-saved/);
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
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
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
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
  });
});
