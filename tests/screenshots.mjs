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
await wait(800);

const browser = await chromium.launch();
try {
  // Desktop dark — upcoming
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await desktop.waitForTimeout(3500);
  await desktop.screenshot({ path: `${OUT}/upcoming-dark.png` });

  // Desktop dark — watchlist (with the demo-free real saved state: empty)
  await desktop.click('.nav__link[data-nav="watchlist"]');
  await desktop.waitForTimeout(700);
  await desktop.screenshot({ path: `${OUT}/watchlist-dark.png` });

  // Desktop dark — recently aired
  await desktop.click('.nav__link[data-nav="recent"]');
  await desktop.waitForTimeout(3500);
  await desktop.screenshot({ path: `${OUT}/recent-dark.png` });

  // Desktop light — upcoming
  await desktop.click('.nav__link[data-nav="upcoming"]');
  await desktop.waitForTimeout(1000);
  await desktop.locator(".js-theme-toggle").first().click();
  await desktop.waitForTimeout(700);
  await desktop.screenshot({ path: `${OUT}/upcoming-light.png` });

  // Detail dialog
  await desktop.locator(".js-theme-toggle").first().click();
  await desktop.waitForTimeout(400);
  await desktop.locator(".card__open").first().click();
  await desktop.waitForTimeout(3000);
  await desktop.screenshot({ path: `${OUT}/detail-dialog.png` });
  await desktop.close();

  // Mobile
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(3500);
  await mobile.screenshot({ path: `${OUT}/mobile-upcoming.png` });
  await mobile.close();

  console.log(`Screenshots written to ${OUT}/`);
} finally {
  await browser.close();
  server.kill();
}
