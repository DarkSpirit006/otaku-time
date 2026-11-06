/* ============================================================
   Otaku Time — visual regression
   Deterministic fixtures, a frozen clock and reduced motion, so a
   diff means the UI changed, not that the API answered differently.

   Baselines live next to this file. Regenerate deliberately:
     npx playwright test tests/e2e/visual.spec.js --update-snapshots
   and review the images before committing them.
   ============================================================ */

import { test, expect } from "@playwright/test";

import {
  mockAniList,
  standardSchedules,
  defaultEvents,
  makeMedia,
  detailsPayload,
  searchPayload,
  typeSearch,
} from "./helpers.js";

// A fixed instant so countdowns, "now" markers and day labels hold still.
const FROZEN = new Date("2026-11-05T18:00:00Z").getTime();

const WATCH = [
  {
    id: 101,
    title: { romaji: "Alpha Romaji", english: "Alpha Show", native: "アルファ" },
    coverImage: { medium: null, large: null, extraLarge: null, color: "#3b4a6b" },
    format: "TV",
    mediaStatus: "RELEASING",
    listStatus: "watching",
    episodes: 12,
    watched: 5,
    duration: 24,
    averageScore: 88,
    genres: ["Action", "Drama"],
    order: 1,
    createdAt: FROZEN - 86_400_000,
    nextAiringEpisode: { episode: 6, airingAt: Math.floor(FROZEN / 1000) + 7200 },
  },
  {
    id: 102,
    title: { romaji: "Beta Romaji", english: "Beta Show", native: "" },
    coverImage: { medium: null, large: null, extraLarge: null, color: "#7a4b3b" },
    format: "MOVIE",
    mediaStatus: "FINISHED",
    listStatus: "completed",
    episodes: 1,
    watched: 1,
    duration: 110,
    averageScore: 91,
    genres: ["Drama"],
    order: 2,
    createdAt: FROZEN - 172_800_000,
  },
  {
    id: 103,
    title: { romaji: "Gamma Romaji", english: "Gamma Show", native: "" },
    coverImage: { medium: null, large: null, extraLarge: null, color: "#2f6b4a" },
    format: "OVA",
    mediaStatus: "RELEASING",
    listStatus: "planned",
    episodes: null,
    watched: 0,
    duration: 24,
    averageScore: 0,
    genres: ["Mystery"],
    order: 3,
    createdAt: FROZEN - 259_200_000,
    nextAiringEpisode: { episode: 3, airingAt: Math.floor(FROZEN / 1000) + 86_400 },
  },
];

/**
 * Nothing is masked: Date is frozen, so the header clock and every
 * countdown render one fixed string.
 */
const MASK = [];

/**
 * Full-page screenshots pin `position: fixed` elements to the top viewport,
 * so the phone tab bar landed in the middle of the baseline, on top of the
 * content it is supposed to sit under. Dropping it into normal flow puts it
 * at the end of the document where it can be reviewed, not covered up.
 *
 * CSSOM assignment on purpose: the page ships `style-src 'self'`, so an
 * injected <style> tag or a style attribute would be blocked outright.
 */
/**
 * Wait until every image in the document has decoded (or failed).
 *
 * Only rendered images count: a lazy image inside a display:none subtree
 * (the agenda drops its thumbnails) is never requested, so `complete` stays
 * false forever and the wait times out on a page that is finished drawing.
 */
async function imagesSettled(page) {
  await page.waitForFunction(
    () => {
      const rendered = [...document.images].filter((img) => img.getClientRects().length > 0);
      return (
        rendered.every((img) => img.complete) &&
        rendered.every((img) => !img.dataset.blurUp || img.classList.contains("is-loaded"))
      );
    },
    null,
    { timeout: 10_000 }
  );
}

async function dockFixedChrome(page) {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll(".tabbar")) {
      element.style.position = "static";
    }
  });
}

async function boot(page, { theme = "dark" } = {}) {
  // Freeze `Date` only, and leave timers real.
  //
  // page.clock.install() re-bases the clock but keeps it ticking, so two
  // runs a second apart rendered "in 59m 59s" and "in 59m 58s". Pausing
  // the clock instead freezes requestAnimationFrame and
  // requestIdleCallback with it, and the page then stops painting cards
  // half-way through its own render. Pinning Date.now() is the narrow
  // instrument that gets both: deterministic text, live rendering.
  await page.addInitScript(({ frozen }) => {
    const RealDate = globalThis.Date;
    const PINNED = frozen;
    class FrozenDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(PINNED);
        else super(...args);
      }
      static now() {
        return PINNED;
      }
    }
    globalThis.Date = FrozenDate;
  }, { frozen: FROZEN + 1000 });
  await page.addInitScript(
    ({ seed, themeName }) => {
      localStorage.setItem("otaku-time.watchlist.v1", JSON.stringify({ version: 3, items: seed }));
      localStorage.setItem("otaku-time.theme.v1", themeName);
    },
    { seed: WATCH, themeName: theme }
  );
  await mockAniList(page, {
    ...standardSchedules(defaultEvents(Math.floor(FROZEN / 1000))),
    details: (vars) =>
      detailsPayload({
        ...makeMedia(vars.id, "Alpha Show", { episodes: 12 }),
        coverImage: { medium: null, large: null, extraLarge: null, color: "#3b4a6b" },
        bannerImage: null,
        nextAiringEpisode: { episode: 6, airingAt: Math.floor(FROZEN / 1000) + 7200 },
      }),
    search: () =>
      searchPayload([
        makeMedia(909, "Attack on Titan", { synonyms: ["Shingeki no Kyojin"], averageScore: 95 }),
      ]),
  });
  await page.goto("/#upcoming");
  await expect(page.locator(".card").first()).toBeVisible();
}

const VIEWS = [
  ["upcoming", async () => {}, ".spotlight"],
  [
    "calendar",
    async (page) => page.locator('[data-action="set-view"][data-view="calendar"]').click(),
    ".cal-day",
  ],
  [
    "watchlist",
    async (page) => page.locator('[data-nav="watchlist"]').filter({ visible: true }).first().click(),
    ".card",
  ],
  [
    "recent",
    async (page) => page.locator('[data-nav="recent"]').filter({ visible: true }).first().click(),
    ".row",
  ],
];

const SIZES = [
  ["phone", { width: 360, height: 780 }],
  ["tablet", { width: 768, height: 1024 }],
  ["desktop", { width: 1440, height: 900 }],
];

for (const theme of ["dark", "light"]) {
  for (const [sizeName, viewport] of SIZES) {
    test.describe(`${theme} · ${sizeName}`, () => {
      test.use({ viewport, reducedMotion: "reduce" });

      for (const [viewName, open, ready] of VIEWS) {
        test(`${viewName}`, async ({ page }) => {
          await boot(page, { theme });
          await open(page);
          await expect(page.locator(ready).first()).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await imagesSettled(page);
          if (sizeName !== "desktop") await dockFixedChrome(page);
          await expect(page).toHaveScreenshot(`${viewName}-${theme}-${sizeName}.png`, {
            animations: "disabled",
            caret: "hide",
            mask: MASK.map((selector) => page.locator(selector)),
            maxDiffPixelRatio: 0.002,
            fullPage: sizeName !== "desktop",
          });
        });
      }
    });
  }
}

// Detail and search are the two dense surfaces; cover them at both widths.
for (const theme of ["dark", "light"]) {
  for (const [sizeName, viewport] of [
    ["phone", { width: 390, height: 844 }],
    ["desktop", { width: 1440, height: 900 }],
  ]) {
    test.describe(`${theme} · ${sizeName} overlays`, () => {
      test.use({ viewport, reducedMotion: "reduce" });

      test("detail", async ({ page }) => {
        await boot(page, { theme });
        await page.locator('[data-action="detail"]').first().click();
        await expect(page.locator("#detail-dialog")).toBeVisible();
        await expect(page.locator("#detail-title")).toContainText("Alpha Show");
        await page.evaluate(() => document.fonts.ready);
        await imagesSettled(page);
        await expect(page.locator("#detail-dialog")).toHaveScreenshot(
          `detail-${theme}-${sizeName}.png`,
          { animations: "disabled", maxDiffPixelRatio: 0.002 }
        );
      });

      test("search", async ({ page }) => {
        await boot(page, { theme });
        await typeSearch(page, "aot");
        await expect(page.locator(".card").first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`search-${theme}-${sizeName}.png`, {
          animations: "disabled",
          caret: "hide",
          mask: MASK.map((selector) => page.locator(selector)),
          maxDiffPixelRatio: 0.002,
        });
      });
    });
  }
}
