/* Capture real-app screenshots for the README: `npm run screenshots` */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

const PORT = 8137;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "docs/screenshots";

mkdirSync(OUT, { recursive: true });

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  stdio: "ignore",
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(900);

const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await desktop.waitForSelector(".lead-panel", { timeout: 25000 });
  await desktop.waitForTimeout(2500);
  await desktop.screenshot({ path: `${OUT}/upcoming-dark.png` });

  // Save a few titles so the watchlist screenshot is representative
  for (const i of [0, 2, 4]) {
    await desktop.locator(".card__save, .lead-panel__save").nth(i).click().catch(() => {});
    await desktop.waitForTimeout(350);
  }
  await desktop.click('.nav__link[data-nav="watchlist"]');
  await desktop.waitForTimeout(900);
  await desktop.screenshot({ path: `${OUT}/watchlist-dark.png` });

  await desktop.click('.nav__link[data-nav="recent"]');
  await desktop.waitForTimeout(3000);
  await desktop.screenshot({ path: `${OUT}/recent-dark.png` });

  await desktop.click('.nav__link[data-nav="upcoming"]');
  await desktop.waitForTimeout(900);
  await desktop.locator(".js-theme-toggle").first().click();
  await desktop.waitForTimeout(800);
  await desktop.screenshot({ path: `${OUT}/upcoming-light.png` });

  await desktop.locator(".js-theme-toggle").first().click();
  await desktop.waitForTimeout(500);
  await desktop.locator(".lead-panel__open").first().click();
  await desktop.waitForTimeout(3200);
  await desktop.screenshot({ path: `${OUT}/detail-dialog.png` });
  await desktop.close();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await mobile.waitForSelector(".lead-panel", { timeout: 25000 });
  await mobile.waitForTimeout(2500);
  await mobile.screenshot({ path: `${OUT}/mobile-upcoming.png` });
  await mobile.close();

  console.log(`Screenshots written to ${OUT}/`);
} finally {
  await browser.close();
  server.kill();
}
