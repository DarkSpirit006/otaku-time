/* ============================================================
   Otaku Time — accessibility gate
   axe-core over every primary view and dialog, in both themes,
   at phone and desktop width. The bar is zero serious/critical
   violations; moderate/minor findings are reported as a list so
   regressions are visible in the log rather than silently kept.
   ============================================================ */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  mockAniList,
  standardSchedules,
  defaultEvents,
  makeMedia,
  detailsPayload,
  searchPayload,
  seedWatchlist,
  typeSearch,
} from "./helpers.js";

const RULES = {
  // Regional colour contrast is checked by the design review instead;
  // axe's contrast rule misreads our tinted poster plates.
  disabledRules: [],
};

const SEED = [
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
    genres: ["Action"],
    order: 1,
    createdAt: Date.now() - 5000,
    nextAiringEpisode: { episode: 6, airingAt: Math.floor(Date.now() / 1000) + 7200 },
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
    order: 2,
    createdAt: Date.now() - 9000,
  },
];

/** Wait until entrance animations have settled: axe samples computed
 *  colours, and a half-faded view reads as a contrast failure. */
async function settle(page) {
  await page.waitForFunction(
    () => document.getAnimations().every((animation) => animation.playState !== "running"),
    undefined,
    { timeout: 5000 }
  ).catch(() => {});
}

async function scan(page, label) {
  await settle(page);
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  const results = await builder.analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical"
  );
  const soft = results.violations.filter(
    (violation) => violation.impact !== "serious" && violation.impact !== "critical"
  );

  if (blocking.length) {
    const detail = blocking
      .map(
        (violation) =>
          `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes
            .slice(0, 3)
            .map((node) => node.html)
            .join("\n  ")}`
      )
      .join("\n");
    test.info().annotations.push({ type: "axe", description: `${label}: ${detail}` });
  }
  if (soft.length) {
    test.info().annotations.push({
      type: "axe-minor",
      description: `${label}: ${soft.map((v) => `${v.id}/${v.impact}`).join(", ")}`,
    });
  }

  expect(blocking, `serious/critical axe violations in ${label}`).toEqual([]);
}

/** Click the first element matching a selector that is actually shown
 *  (the shell renders some controls twice: sidebar and top bar). */
async function clickVisible(page, selector) {
  await page.locator(selector).filter({ visible: true }).first().click();
}

async function boot(page, { theme = "dark" } = {}) {
  await page.addInitScript(
    ({ seed, themeName }) => {
      localStorage.setItem("otaku-time.watchlist.v1", JSON.stringify({ version: 3, items: seed }));
      localStorage.setItem("otaku-time.theme.v1", themeName);
    },
    { seed: SEED, themeName: theme }
  );
  await mockAniList(page, {
    ...standardSchedules(defaultEvents()),
    details: (vars) => detailsPayload(makeMedia(vars.id, "Alpha Show")),
    search: () => searchPayload([makeMedia(909, "Attack on Titan", { synonyms: ["Shingeki no Kyojin"] })]),
  });
  await page.goto("/#upcoming");
  await expect(page.locator(".card").first()).toBeVisible();
}

for (const theme of ["dark", "light"]) {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ]) {
    test.describe(`${theme} · ${name}`, () => {
      test.use({ viewport, reducedMotion: "reduce" });

      test("upcoming timeline", async ({ page }) => {
        await boot(page, { theme });
        await scan(page, `${theme}/${name} upcoming`);
      });

      test("upcoming calendar", async ({ page }) => {
        await boot(page, { theme });
        await page.locator('[data-action="set-view"][data-view="calendar"]').click();
        await expect(page.locator(".cal-day").first()).toBeVisible();
        await scan(page, `${theme}/${name} calendar`);
      });

      test("watchlist", async ({ page }) => {
        await boot(page, { theme });
        await clickVisible(page, '[data-nav="watchlist"]');
        await expect(page.locator(".card").first()).toBeVisible();
        await scan(page, `${theme}/${name} watchlist`);
      });

      test("recently aired", async ({ page }) => {
        await boot(page, { theme });
        await clickVisible(page, '[data-nav="recent"]');
        await expect(page.locator(".row").first()).toBeVisible();
        await scan(page, `${theme}/${name} recent`);
      });

      test("search results", async ({ page }) => {
        await boot(page, { theme });
        await typeSearch(page, "aot");
        await expect(page.locator("#section-title")).toHaveText("Results");
        await expect(page.locator(".card").first()).toBeVisible();
        await scan(page, `${theme}/${name} search`);
      });

      test("detail dialog", async ({ page }) => {
        await boot(page, { theme });
        await page.locator('[data-action="detail"]').first().click();
        await expect(page.locator("#detail-dialog")).toBeVisible();
        await expect(page.locator("#detail-title")).toContainText("Alpha Show");
        await scan(page, `${theme}/${name} detail`);
        await page.keyboard.press("Escape");
      });

      test("settings dialog", async ({ page }) => {
        await boot(page, { theme });
        await clickVisible(page, ".js-settings-open");
        await expect(page.locator("#settings-dialog")).toBeVisible();
        await scan(page, `${theme}/${name} settings`);
        await page.keyboard.press("Escape");
      });

      test("command palette and shortcut help", async ({ page }) => {
        await boot(page, { theme });
        await page.keyboard.press("Control+k");
        await expect(page.locator("#palette-dialog")).toBeVisible();
        await scan(page, `${theme}/${name} palette`);
        await page.keyboard.press("Escape");

        await page.keyboard.press("?");
        await expect(page.locator("#help-dialog")).toBeVisible();
        await scan(page, `${theme}/${name} help`);
        await page.keyboard.press("Escape");
      });

      test("empty watchlist", async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem("otaku-time.watchlist.v1"));
        await mockAniList(page, standardSchedules(defaultEvents()));
        await page.goto("/#watchlist");
        await expect(page.locator(".empty h2")).toContainText("watchlist is empty");
        await scan(page, `${theme}/${name} empty state`);
      });

      test("offline notice", async ({ page }) => {
        await boot(page, { theme });
        await page.context().setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        await expect(page.locator("#offline-bar")).toBeVisible();
        await scan(page, `${theme}/${name} offline bar`);
        await page.context().setOffline(false);
      });
    });
  }
}

test("seeded storage helper stays in sync with the schema", async ({ page }) => {
  // Guard: if the schema version moves, this gate must be updated with it.
  await seedWatchlist(page, SEED.slice(0, 1));
  await mockAniList(page, standardSchedules(defaultEvents()));
  await page.goto("/#watchlist");
  const version = await page.evaluate(() => JSON.parse(localStorage.getItem("otaku-time.watchlist.v1")).version);
  expect([2, 3]).toContain(version);
});
