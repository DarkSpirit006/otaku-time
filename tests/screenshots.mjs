/* ============================================================
   Capture real-app images for README and social cards.

     npm run screenshots            # everything
     node tests/screenshots.mjs --no-gif

   Two modes:
   - live (default): talks to the real AniList API, so the pictures
     show the real schedule of the moment;
   - --fixtures: replays the recorded AniList responses in
     tests/fixtures/ so the output is reproducible offline.

   Nothing here is mocked-up: every pixel is the app running.
   ============================================================ */

import { chromium } from "@playwright/test";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";

const PORT = 8137;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "docs/screenshots";
const DOCS = "docs";

const args = new Set(process.argv.slice(2));
const useFixtures = args.has("--fixtures");
const withGif = !args.has("--no-gif");

mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ["tests/serve.mjs"], {
  stdio: "ignore",
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(900);

/** Replay a recorded AniList page response for the schedule queries. */
async function mockFromFixtures(page) {
  const root = "tests/fixtures";
  const upcoming = JSON.parse(readFileSync(`${root}/schedule-upcoming.json`, "utf8"));
  const recent = JSON.parse(readFileSync(`${root}/schedule-recent.json`, "utf8"));
  await page.route("https://graphql.anilist.co/**", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const query = String(body.query || "");
    const sort = body.variables?.sort || [];
    let payload = upcoming;
    if (query.includes("airingSchedules")) {
      payload = Array.isArray(sort) && sort.includes("TIME_DESC") ? recent : upcoming;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

async function openPage(browser, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  if (useFixtures) await mockFromFixtures(page);
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  // Wait for real content, not for the network to go quiet.
  await page.waitForSelector(".spotlight, .lead-panel, .card", { timeout: 30_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded");
  await page.waitForTimeout(1200);
  return { context, page };
}

/** Toasts linger ~6 s when they carry an Undo action: let them clear. */
async function clearToasts(page) {
  await page
    .waitForFunction(() => !document.querySelector(".toast, [data-toast], #toast-region .toast"), { timeout: 9000 })
    .catch(() => {});
  await page.waitForTimeout(350);
}

/**
 * Screenshots must not catch a blurred poster.
 *
 * Cards below the fold use loading="lazy", so they are still at the
 * blur-up stage when the frame is grabbed — a README image full of grey
 * smudges. Promotion to eager is a capture-time concern only: the app
 * itself keeps lazy loading for real visitors.
 */
async function imagesSettled(page) {
  await page.evaluate(() => {
    for (const img of document.images) {
      if (img.loading === "lazy") img.loading = "eager";
    }
  });
  await page
    .waitForFunction(
      () =>
        [...document.images].every((img) => img.complete && img.naturalWidth > 0) &&
        [...document.querySelectorAll("img[data-blur-up]")].every((img) =>
          img.classList.contains("is-loaded")
        ),
      null,
      { timeout: 20_000 }
    )
    .catch(() => {});
  // Let the blur-up transition finish on screen.
  await page.waitForTimeout(450);
}

/** Click the first element matching `selector` that is actually visible. */
async function clickVisible(page, selector) {
  await page.locator(selector).filter({ visible: true }).first().click();
}

const browser = await chromium.launch();
try {
  /* ---------- README screenshots ---------- */
  const { context, page } = await openPage(browser, { viewport: { width: 1440, height: 900 } });

  await imagesSettled(page);
  await page.screenshot({ path: `${OUT}/upcoming-dark.png` });

  // Save a few titles so the library screenshot is representative.
  // Select by state, not by index: the button toggles and re-renders.
  for (let i = 0; i < 3; i++) {
    const next = page.locator("[data-action='save'][aria-pressed='false']").first();
    if (!(await next.count())) break;
    await next.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(350);
  }

  await clickVisible(page, '[data-nav="watchlist"]');
  await clearToasts(page);
  await page.waitForTimeout(700);
  await imagesSettled(page);
  await page.screenshot({ path: `${OUT}/watchlist-dark.png` });

  await clickVisible(page, '[data-nav="recent"]');
  await page.waitForTimeout(2200);
  await imagesSettled(page);
  await page.screenshot({ path: `${OUT}/recent-dark.png` });

  await clickVisible(page, '[data-nav="upcoming"]');
  await page.waitForTimeout(900);

  await page.locator('[data-action="set-view"][data-view="calendar"]').click();
  await page.waitForTimeout(900);
  await imagesSettled(page);
  await page.screenshot({ path: `${OUT}/calendar-dark.png` });

  await page.locator('[data-action="set-view"][data-view="timeline"]').click();
  await page.waitForTimeout(500);

  await clickVisible(page, ".js-theme-toggle");
  await page.waitForTimeout(900);
  await imagesSettled(page);
  await page.screenshot({ path: `${OUT}/upcoming-light.png` });
  await clickVisible(page, ".js-theme-toggle");
  await page.waitForTimeout(500);

  // The detail sheet scrolls; a README shot should show every band of it
  // (banner, title, links, facts, synopsis) rather than a sliced one.
  await page.locator('[data-action="detail"]').first().click();
  await page.waitForSelector("#detail-dialog[open]");
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    // Let the sheet grow past the viewport so the whole panel can be
    // captured; CSSOM only, because the page ships style-src 'self'.
    const dialog = document.querySelector("#detail-dialog");
    const content = document.querySelector("#detail-content");
    dialog.style.maxHeight = "none";
    dialog.style.height = "auto";
    content.style.maxHeight = "none";
    content.style.overflow = "visible";
  });
  await page.mouse.move(0, 0); // no hover states in the shot
  await imagesSettled(page);
  await page.waitForTimeout(400);
  await page.locator("#detail-dialog").screenshot({ path: `${OUT}/detail-dialog.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  /* ---------- Social card (1200×630, og:image) ----------
     A 1200×630 viewport is too short for the feature (poster + headline +
     countdown + CTA), and a taller one resized to 1200×630 squeezes the
     type. So: shoot the feature at a wider viewport, clipped to the exact
     1.905:1 ratio, then scale that clip down. Same pixels, right crop. */
  const social = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const socialPage = await social.newPage();
  if (useFixtures) await mockFromFixtures(socialPage);
  await socialPage.goto(`${BASE}/index.html#upcoming`, { waitUntil: "networkidle" });
  await socialPage.waitForSelector(".spotlight", { timeout: 30_000 });
  await socialPage.evaluate(() => document.fonts.ready);
  await socialPage.waitForTimeout(900);
  await socialPage.evaluate(() => {
    // Sticky topbar stays in frame; put the feature right under it.
    const feature = document.querySelector(".spotlight");
    const bar = document.querySelector(".topbar");
    const offset = (bar?.getBoundingClientRect().height ?? 0) + 8;
    window.scrollTo(0, window.scrollY + feature.getBoundingClientRect().top - offset);
  });
  await socialPage.waitForTimeout(600);
  await socialPage.screenshot({
    path: `${DOCS}/social-preview.png`,
    clip: { x: 0, y: 0, width: 1400, height: Math.round((1400 * 630) / 1200) },
  });
  execFileSync("magick", [
    `${DOCS}/social-preview.png`,
    "-resize", "1200x630!",
    "-quality", "88",
    "-strip",
    `${DOCS}/social-preview.png`,
  ]);
  await social.close();

  /* ---------- Phone ---------- */
  const phone = await openPage(browser, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await imagesSettled(phone.page);
  await phone.page.screenshot({ path: `${OUT}/mobile-upcoming.png` });
  await phone.page.locator('[data-action="detail"]').first().click();
  await phone.page.waitForSelector("#detail-dialog[open]");
  await phone.page.waitForTimeout(1200);
  await imagesSettled(phone.page);
  await phone.page.screenshot({ path: `${OUT}/mobile-detail.png` });
  await phone.context.close();

  /* ---------- Demo GIF ---------- */
  if (withGif) {
    const hasMagick = (() => {
      try {
        execFileSync("magick", ["-version"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();

    if (!hasMagick) {
      console.log("ImageMagick not found — skipping demo.gif.");
    } else {
      const framesDir = `${DOCS}/.frames`;
      mkdirSync(framesDir, { recursive: true });
      const gif = await openPage(browser, { viewport: { width: 1180, height: 700 } });
      const gpage = gif.page;
      const shots = [];
      const shot = async (name) => {
        const file = `${framesDir}/f${String(shots.length).padStart(3, "0")}-${name}.png`;
        await imagesSettled(gpage);
        await gpage.screenshot({ path: file, animations: "disabled" });
        shots.push(file);
      };
      /** Scroll smoothly in steps so the GIF shows motion, not jumps. */
      const scrollTo = async (y, steps = 4) => {
        for (let i = 1; i <= steps; i++) {
          await gpage.evaluate((target) => window.scrollTo(0, target), Math.round((y * i) / steps));
          await gpage.waitForTimeout(90);
          await shot("scroll");
        }
      };

      await gpage.evaluate(() => window.scrollTo(0, 0));
      await gpage.waitForTimeout(300);
      await shot("upcoming");

      await scrollTo(560, 3);
      await scrollTo(0, 2);

      // This is a fresh browser context: fill the library so the
      // Watchlist frame shows a real collection, not the empty state.
      for (let i = 0; i < 4; i++) {
        const save = gpage.locator("[data-action='save'][aria-pressed='false']").first();
        if (!(await save.count())) break;
        await save.scrollIntoViewIfNeeded();
        await save.click({ timeout: 4000 }).catch(() => {});
        await gpage.waitForTimeout(260);
        await shot("save");
      }
      await gpage.evaluate(() => window.scrollTo(0, 0));
      await gpage.waitForTimeout(350);

      await clickVisible(gpage, '[data-nav="watchlist"]');
      await clearToasts(gpage);
      await gpage.waitForTimeout(500);
      await shot("watchlist");
      await scrollTo(380, 3);
      await gpage.evaluate(() => window.scrollTo(0, 0));
      await gpage.waitForTimeout(250);

      await clickVisible(gpage, '[data-nav="recent"]');
      await gpage.waitForTimeout(1000);
      await shot("recent");

      await clickVisible(gpage, '[data-nav="upcoming"]');
      await gpage.waitForTimeout(700);
      await gpage.locator('[data-action="set-view"][data-view="calendar"]').click();
      await gpage.waitForTimeout(900);
      await shot("calendar");
      await scrollTo(420, 3);

      await gpage.locator('[data-action="set-view"][data-view="timeline"]').click();
      await gpage.waitForTimeout(400);
      await gpage.evaluate(() => window.scrollTo(0, 0));
      await gpage.locator('[data-action="detail"]').first().click();
      await gpage.waitForSelector("#detail-dialog[open]");
      await gpage.waitForTimeout(1300);
      await shot("detail");
      await gpage.evaluate(() => {
        const scroller = document.querySelector("#detail-content .settings-scroll, #detail-content");
        if (scroller) scroller.scrollTop = 260;
      });
      await gpage.waitForTimeout(400);
      await shot("detail-scrolled");
      await gpage.keyboard.press("Escape");
      await gpage.waitForTimeout(500);

      await gpage.keyboard.press("Control+k");
      await gpage.waitForSelector("#palette-dialog[open]");
      await gpage.keyboard.type("watch", { delay: 70 });
      await gpage.waitForTimeout(450);
      await shot("palette");
      await gpage.keyboard.press("Escape");
      await gpage.waitForTimeout(400);
      await shot("back");

      await gif.context.close();

      // A shared palette across every frame: per-frame palettes are what
      // produce the white "holes" GIF encoders are famous for.
      const scale = "900x";
      execFileSync("magick", [
        ...shots,
        "-resize", scale,
        "-alpha", "remove",
        "-alpha", "off",
        "-background", "#08080a",
        `${framesDir}/flat-%03d.png`,
      ]);
      execFileSync("sh", [
        "-c",
        // No dithering: the grain is what makes a screen-recorded GIF
        // huge, and flat app UI quantises cleanly to 96 colours.
        `magick ${framesDir}/flat-*.png +dither -colors 96 -delay 60 -loop 0 ` +
          `-layers Optimize ${DOCS}/demo.gif`,
      ]);
      console.log(`Demo GIF written to ${DOCS}/demo.gif (${shots.length} frames)`);
    }
  }

  await context.close();
  console.log(`Screenshots written to ${OUT}/`);
} finally {
  await browser.close();
  server.kill();
}

if (!existsSync(`${DOCS}/social-preview.png`)) {
  console.error("social-preview.png was not written — check the run above.");
  process.exitCode = 1;
}
