/* ============================================================
   Otaku Time — delivery sweep

   The brief asks for a specific matrix rather than a general "it looks
   fine": three sections, both themes, three widths, both navigation
   shells, no CSP violations, no console errors, no horizontal overflow,
   reduced motion honoured, and the app booting from a repository
   subpath the way GitHub Pages serves it.

   These are contracts, not screenshots — the visual suite owns pixels.
   Each case boots a deterministic schedule so a failure means the
   product broke, not that AniList answered differently.
   ============================================================ */

import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  mockAniList,
  standardSchedules,
  defaultEvents,
  defaultEvents as events,
  makeMedia,
  detailsPayload,
  searchPayload,
  typeSearch,
} from "./helpers.js";

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
    createdAt: Date.now() - 86_400_000,
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
    createdAt: Date.now() - 172_800_000,
  },
  {
    id: 103,
    title: { romaji: "Gamma Romaji", english: "Gamma Show", native: "" },
    coverImage: { medium: null, large: null, extraLarge: null, color: "#4b3b6b" },
    format: "TV",
    mediaStatus: "RELEASING",
    listStatus: "planned",
    episodes: 24,
    watched: 0,
    duration: 24,
    order: 3,
    createdAt: Date.now() - 259_200_000,
  },
];

const SECTIONS = [
  ["upcoming", "#upcoming", ".card, .spotlight"],
  ["watchlist", "#watchlist", ".card"],
  ["recent", "#recent", ".row"],
];

const WIDTHS = [
  ["phone", { width: 360, height: 780 }],
  ["tablet", { width: 768, height: 1024 }],
  ["desktop", { width: 1440, height: 900 }],
];

/**
 * Boot with a seeded shelf, a mocked schedule and every console message
 * captured. The returned `problems` array also collects CSP violations,
 * which arrive as events rather than console messages when a resource is
 * blocked at parse time.
 */
async function boot(page, { theme = "dark" } = {}) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    // Poster CDN requests are expected to fail (the fixtures carry no
    // artwork); anything same-origin must not.
    const url = request.url();
    if (url.startsWith("http://127.0.0.1:4173")) {
      problems.push(`requestfailed: ${url} (${request.failure()?.errorText})`);
    }
  });

  await page.addInitScript(
    ({ seed, themeName }) => {
      // Seed once, not on every navigation: an init script runs again after
      // reload, and overwriting storage there would erase whatever the app
      // just saved — turning every "does it persist?" case into a tautology.
      if (!localStorage.getItem("otaku-time.watchlist.v1")) {
        localStorage.setItem("otaku-time.watchlist.v1", JSON.stringify({ version: 3, items: seed }));
      }
      localStorage.setItem("otaku-time.theme.v1", themeName);
      document.addEventListener("securitypolicyviolation", (event) => {
        const list = JSON.parse(sessionStorage.getItem("csp-violations") || "[]");
        list.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
        sessionStorage.setItem("csp-violations", JSON.stringify(list));
      });
    },
    { seed: SEED, themeName: theme }
  );

  await mockAniList(page, {
    ...standardSchedules(defaultEvents()),
    details: (vars) => detailsPayload(makeMedia(vars.id, "Alpha Show")),
    search: () => searchPayload([makeMedia(909, "Attack on Titan")]),
  });

  return problems;
}

const cspViolations = (page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("csp-violations") || "[]"));

/* ============================================================
   D. The matrix: every section, both themes, three widths.
   ============================================================ */

for (const theme of ["dark", "light"]) {
  for (const [widthName, viewport] of WIDTHS) {
    test.describe(`sweep · ${theme} · ${widthName}`, () => {
      test.use({ viewport });

      for (const [section, hash, ready] of SECTIONS) {
        test(`${section} paints inside the viewport with no errors`, async ({ page }) => {
          const problems = await boot(page, { theme });
          await page.goto(hash);
          await expect(page.locator(ready).first()).toBeVisible();
          await page.waitForTimeout(400);

          const measured = await page.evaluate(() => {
            const de = document.documentElement;
            // The widest element that actually paints, ignoring nodes that
            // are deliberately off-canvas (the wire's scrolling track).
            const offenders = [...document.querySelectorAll("body *")]
              .filter((el) => {
                const style = getComputedStyle(el);
                if (style.display === "none" || style.visibility === "hidden") return false;
                if (el.closest('[aria-hidden="true"]')) return false;
                const box = el.getBoundingClientRect();
                return box.width > 0 && box.right > de.clientWidth + 1.5;
              })
              .slice(0, 4)
              .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`);
            return {
              scrollWidth: de.scrollWidth,
              clientWidth: de.clientWidth,
              offenders,
              theme: de.dataset.theme,
            };
          });

          expect(measured.scrollWidth, "horizontal overflow").toBeLessThanOrEqual(
            measured.clientWidth + 1
          );
          expect(measured.offenders, "elements past the right edge").toEqual([]);
          expect(measured.theme).toBe(theme);
          expect(problems).toEqual([]);
          expect(await cspViolations(page)).toEqual([]);
        });
      }

      test("renders exactly one navigation shell", async ({ page }) => {
        await boot(page, { theme });
        await page.goto("#upcoming");
        await expect(page.locator(".card, .spotlight").first()).toBeVisible();

        const shells = await page.evaluate(() => {
          const visible = (selector) =>
            [...document.querySelectorAll(selector)].filter(
              (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"
            ).length;
          return {
            rail: visible(".rail, .sidebar, [data-chrome='rail']"),
            tabbar: visible(".tabbar, .bottom-nav, [data-chrome='tabbar']"),
            // One search field, one theme toggle, however the shell is built.
            searchFields: [...document.querySelectorAll("input[type='search'], .search input")].filter(
              (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"
            ).length,
          };
        });

        if (widthName === "desktop") {
          expect(shells.rail, "the desk rail").toBe(1);
          expect(shells.tabbar, "no phone tab bar on desktop").toBe(0);
        } else {
          expect(shells.tabbar, "the phone tab bar").toBe(1);
          expect(shells.rail, "no desk rail below 1024").toBe(0);
        }
        // Never two search inputs reachable at once: the bar opens the same
        // field the rail uses, it does not add a second one.
        expect(shells.searchFields).toBeLessThanOrEqual(1);
      });
    });
  }
}

/* ============================================================
   Watchlist stats carry real numbers: 1,147 episodes logged is "458h 48m"
   on the shelf of a long runner. A figure that wraps onto a second line
   drops below the label it belongs to and reads as two figures.
   ============================================================ */

test.describe("watchlist stats", () => {
  for (const [widthName, viewport] of WIDTHS) {
    test.use({ viewport });

    test(`a long time-spent figure stays on one line at ${widthName}`, async ({ page }) => {
      const heavy = [
        {
          id: 21,
          title: { romaji: "One Piece", english: "One Piece" },
          coverImage: {},
          format: "TV",
          mediaStatus: "RELEASING",
          listStatus: "watching",
          episodes: null,
          watched: 1147,
          duration: 24,
          order: 1,
          createdAt: Date.now() - 1000,
        },
        {
          id: 269,
          title: { romaji: "Bleach", english: "Bleach" },
          coverImage: {},
          format: "TV",
          mediaStatus: "FINISHED",
          listStatus: "completed",
          episodes: 366,
          watched: 366,
          duration: 24,
          order: 3,
          createdAt: Date.now() - 3000,
        },
        {
          id: 16498,
          title: { romaji: "Shingeki no Kyojin", english: "Attack on Titan" },
          coverImage: {},
          format: "TV",
          mediaStatus: "FINISHED",
          listStatus: "completed",
          episodes: 25,
          watched: 25,
          duration: 24,
          order: 2,
          createdAt: Date.now() - 2000,
        },
      ];
      await page.addInitScript((seed) => {
        localStorage.setItem("otaku-time.watchlist.v1", JSON.stringify({ version: 3, items: seed }));
        localStorage.setItem("otaku-time.theme.v1", "dark");
      }, heavy);
      await page.goto("/#watchlist");
      await expect(page.locator(".stat__value").first()).toBeVisible();

      const cells = await page.$$eval(".stat", (nodes) =>
        nodes.map((node) => {
          const value = node.querySelector(".stat__value");
          const label = node.querySelector(".stat__label, .stat__name");
          const valueBox = value.getBoundingClientRect();
          // The glyphs' own width: a nowrap figure can stay on one line and
          // still run out of its cell, so both have to be measured.
          const range = document.createRange();
          range.selectNodeContents(value);
          return {
            text: value.textContent.trim(),
            textWidth: Math.round(range.getBoundingClientRect().width),
            available: value.clientWidth,
            lines: Math.round(valueBox.height / parseFloat(getComputedStyle(value).lineHeight)),
            // The figure must sit above its own label, not beside or under it.
            aboveLabel: label ? valueBox.bottom <= label.getBoundingClientRect().top + 2 : true,
          };
        })
      );

      const timeSpent = cells.find((cell) => /\d/.test(cell.text) && /[hm]/.test(cell.text));
      expect(timeSpent, "a time-spent cell").toBeTruthy();
      for (const cell of cells) {
        expect(cell.lines, `"${cell.text}" wraps onto ${cell.lines} lines`).toBe(1);
        expect(
          cell.textWidth,
          `"${cell.text}" is ${cell.textWidth - cell.available}px wider than its cell`
        ).toBeLessThanOrEqual(cell.available + 1);
        expect(cell.aboveLabel, `"${cell.text}" collides with its label`).toBe(true);
      }
    });
  }
});

/* ============================================================
   E. Reduced motion: the same layout, without the movement.
   ============================================================ */

for (const [widthName, viewport] of WIDTHS) {
  test.describe(`reduced motion · ${widthName}`, () => {
    test.use({ viewport, reducedMotion: "reduce" });

    test("settles, stays inside the viewport and keeps the copy on screen", async ({ page }) => {
      const problems = await boot(page);
      await page.goto("#upcoming");
      await expect(page.locator(".spotlight, .card").first()).toBeVisible();
      await page.waitForTimeout(500);

      const state = await page.evaluate(() => {
        const running = document
          .getAnimations()
          .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity);
        const spotlight = document.querySelector(".spotlight");
        const title = spotlight?.querySelector("h2, .spotlight__title, .lead-title");
        const visible = title ? getComputedStyle(title).opacity : "1";
        return {
          infiniteRunning: running.length,
          titleOpacity: Number(visible),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      // No perpetual marquee/pulse keeps running when motion is reduced.
      expect(state.infiniteRunning).toBe(0);
      // Entrance animations must end at full opacity, not stall mid-fade.
      expect(state.titleOpacity).toBe(1);
      expect(state.overflow).toBeLessThanOrEqual(1);
      expect(problems).toEqual([]);
    });
  });
}

/* ============================================================
   F. Navigation, deep links and preference persistence.
   ============================================================ */

test.describe("navigation contracts", () => {
  test("back and forward walk the section history", async ({ page }) => {
    await boot(page);
    await page.goto("#upcoming");
    await expect(page.locator(".spotlight, .card").first()).toBeVisible();

    await page.locator('.nav__link[data-nav="watchlist"], [data-nav="watchlist"]').first().click();
    await expect(page.locator(".card").first()).toBeVisible();
    await expect(page).toHaveURL(/#watchlist$/);

    await page.locator('.nav__link[data-nav="recent"], [data-nav="recent"]').first().click();
    await expect(page.locator(".row").first()).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/#watchlist$/);
    await expect(page.locator(".card").first()).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/#recent$/);
    await expect(page.locator(".row").first()).toBeVisible();
  });

  test("a deep link boots straight into that section", async ({ page }) => {
    await boot(page);
    await page.goto("/#recent");
    await expect(page.locator(".row").first()).toBeVisible();
    await expect(page.locator('[aria-current="page"]').first()).toHaveAttribute(
      "href",
      /#recent$/
    );
  });

  for (const theme of ["dark", "light"]) {
    test(`the ${theme} theme survives a reload`, async ({ page }) => {
      const problems = await boot(page, { theme });
      await page.goto("#upcoming");
      await expect(page.locator(".spotlight, .card").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);

      await page.reload();
      await expect(page.locator(".spotlight, .card").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      expect(problems).toEqual([]);
    });
  }
});

/* ============================================================
   G. Watchlist interactions the brief names explicitly:
   direct episode edit, and manual reordering without a drag.
   ============================================================ */

test.describe("watchlist interactions", () => {
  test("manual order moves a title with the keyboard and persists", async ({ page }) => {
    await boot(page);
    await page.goto("#watchlist");
    await expect(page.locator(".card")).toHaveCount(3);

    const orderOf = () =>
      page.$$eval(".card__title, .card h3", (nodes) => nodes.map((n) => n.textContent.trim()));

    // Manual sort exposes the up/down controls; other sorts do not.
    await page.selectOption("#sort, [data-control='sort'] select, select[name='sort']", "manual");
    await expect(page.locator(".manual-bar").first()).toBeVisible();
    await expect.poll(orderOf).toEqual(["Alpha Show", "Beta Show", "Gamma Show"]);

    // Move the third title up one place, through the control a keyboard
    // user reaches, not through a pointer-only drag.
    const moveUp = page.locator('.step-btn[data-action="move"][data-delta="-1"]').nth(2);
    await moveUp.focus();
    expect(await moveUp.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press("Enter");

    // The re-render is the feedback: no toast, the row is simply in its new
    // place. Polled, because the read can otherwise land mid-render.
    await expect.poll(orderOf).toEqual(["Alpha Show", "Gamma Show", "Beta Show"]);

    await page.reload();
    await expect(page.locator(".card")).toHaveCount(3);
    await expect(page.locator("#sort")).toHaveValue("added");
    // The arrangement is data, so it survives; the sort *mode* is view state
    // and intentionally resets to Recently added (as it always has). Choosing
    // Manual again must show the arrangement that was saved, not a reshuffle.
    await page.selectOption("#sort", "manual");
    await expect.poll(orderOf).toEqual(["Alpha Show", "Gamma Show", "Beta Show"]);
  });

  test("episode progress can be typed directly, not only stepped", async ({ page }) => {
    await boot(page);
    await page.goto("#watchlist");
    const field = page.locator("[data-progress-input]").first();
    await expect(field).toBeVisible();

    // Enter commits the number that was typed. Until now the field was
    // painted but never read: handleChange only knew about [data-filter],
    // so a typed episode count was discarded without a word.
    await field.fill("9");
    await field.press("Enter");
    await expect(page.locator(".card__progress-text").first()).toContainText("9/12");

    // Blur commits too, for anyone who taps elsewhere instead.
    const again = page.locator("[data-progress-input]").first();
    await again.fill("4");
    await page.locator("#section-title").click();
    await expect(page.locator(".card__progress-text").first()).toContainText("4/12");

    // And a value past the last episode is capped at it, not stored raw.
    const capped = page.locator("[data-progress-input]").first();
    await capped.fill("99");
    await capped.press("Enter");
    await expect(page.locator(".card__progress-text").first()).toContainText("12/12");

    await page.reload();
    await expect(page.locator(".card__progress-text").first()).toContainText("12/12");
  });
});

/* ============================================================
   H. GitHub Pages serves the project from /<repo>/, not the domain
   root. Every path in the app is relative precisely so this works, and
   it is the one deployment shape the local root server never exercises.
   ============================================================ */

test.describe("subpath deployment", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const parent = resolve(repoRoot, "..");
  const repoName = repoRoot.split("/").pop();
  let server;
  let port;

  test.beforeAll(async () => {
    port = await new Promise((done) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address();
        probe.close(() => done(free));
      });
    });
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
      cwd: parent,
      stdio: "ignore",
    });
    // Wait for the first successful response rather than sleeping blind.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/${repoName}/index.html`);
        if (response.ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`subpath server never answered on ${port}`);
  });

  test.afterAll(() => {
    server?.kill();
  });

  test("boots from a repository subpath with no blocked resources", async ({ page }) => {
    const problems = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });

    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto(`http://127.0.0.1:${port}/${repoName}/#upcoming`);
    await expect(page.locator(".spotlight, .card").first()).toBeVisible();

    const state = await page.evaluate(() => ({
      styles: document.styleSheets.length,
      // A stylesheet that parsed has rules; one that 404'd has none.
      rules: [...document.styleSheets].reduce((sum, sheet) => {
        try {
          return sum + sheet.cssRules.length;
        } catch {
          return sum;
        }
      }, 0),
      fonts: document.fonts.size,
      manifest: document.querySelector('link[rel="manifest"]')?.href || "",
      swScope: navigator.serviceWorker?.controller?.scriptURL || "",
    }));

    expect(state.styles).toBeGreaterThanOrEqual(10);
    expect(state.rules).toBeGreaterThan(500);
    expect(state.fonts).toBeGreaterThan(0);
    expect(state.manifest).toContain(`/${repoName}/`);
    // The worker's scope follows the document, not the domain root.
    if (state.swScope) expect(state.swScope).toContain(`/${repoName}/`);
    expect(problems).toEqual([]);
  });

  test("the wire and the empty states survive a subpath boot", async ({ page }) => {
    await mockAniList(page, standardSchedules({ upcoming: [], recent: [] }));
    await page.goto(`http://127.0.0.1:${port}/${repoName}/#upcoming`);
    await expect(page.locator(".empty h2, .empty__title").first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/* ============================================================
   Search: one field, whichever shell is on screen, and results that
   never widen the page.
   ============================================================ */

test.describe("search sweep", () => {
  for (const [widthName, viewport] of WIDTHS) {
    test.use({ viewport });

    test(`finds a title and stays inside the viewport at ${widthName}`, async ({ page }) => {
      const problems = await boot(page);
      await page.goto("#upcoming");
      await expect(page.locator(".spotlight, .card").first()).toBeVisible();

      await typeSearch(page, "attack");
      // Search replaces the section body; the status line is the thing that
      // says the query resolved, and a result card proves it drew.
      await expect(page.locator(".search-status").first()).toBeVisible();
      await expect(page.locator(".card").first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
      expect(problems).toEqual([]);
    });
  }
});
