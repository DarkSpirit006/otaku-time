/* ============================================================
   Otaku Time — offline behaviour and service worker

   These run against the real service worker, so they are the only
   checks that prove the app shell and the artwork cache behave.
   ============================================================ */

import { test, expect } from "@playwright/test";

import {
  mockAniList,
  standardSchedules,
  defaultEvents,
  makeMedia,
  detailsPayload,
} from "./helpers.js";

async function ready(page) {
  await expect(page.locator(".card, .lead-panel").first()).toBeVisible();
  // Wait for the worker to take control, otherwise "offline" is just a
  // network error rather than a cache hit.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 15_000,
  });
}

test.describe("service worker", () => {
  test("a reload with the network gone still boots the shell", async ({ page, context }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/#upcoming");
    await ready(page);

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator("#section-title")).toHaveText("Upcoming");
    await expect(page.locator("#offline-bar")).toBeVisible();
    // The schedule came from the cached copy, not the network.
    await expect(page.locator(".card, .lead-panel").first()).toBeVisible();
  });

  test("the offline bar disappears when the connection returns", async ({ page, context }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/#upcoming");
    await ready(page);

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.locator("#offline-bar")).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("#offline-bar")).toBeHidden();
  });

  test("the manifest and icons are served and installable", async ({ page, request }) => {
    await page.goto("/#upcoming");
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return null;
      const response = await fetch(link.href);
      return { status: response.status, body: await response.json() };
    });
    expect(manifest?.status).toBe(200);
    expect(manifest.body.name).toBe("Otaku Time");
    expect(manifest.body.display).toBe("standalone");
    expect(manifest.body.start_url).toBeTruthy();

    const sizes = (manifest.body.icons || []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((manifest.body.icons || []).some((icon) => String(icon.purpose || "").includes("maskable"))).toBe(true);

    for (const icon of manifest.body.icons) {
      const response = await request.get(new URL(icon.src, page.url()).toString());
      expect(response.status(), `${icon.src} should exist`).toBe(200);
    }
  });

  test("a deep link to a show survives a reload", async ({ page }) => {
    await mockAniList(page, {
      ...standardSchedules(defaultEvents()),
      details: (vars) => detailsPayload(makeMedia(vars.id, "Alpha Show")),
    });
    await page.goto("/#upcoming");
    await ready(page);

    await page.locator('[data-action="detail"]').first().click();
    await expect(page.locator("#detail-dialog")).toBeVisible();
    await expect(page).toHaveURL(/#show\/\d+$/);

    await page.reload();
    await expect(page.locator("#detail-dialog")).toBeVisible();
    await expect(page.locator("#detail-title")).toContainText("Alpha Show");

    await page.goBack();
    await expect(page.locator("#detail-dialog")).toBeHidden();
  });

  test("a bad show id is explained, not crashed on", async ({ page }) => {
    await mockAniList(page, {
      ...standardSchedules(defaultEvents()),
      details: () => ({ data: { Media: null } }),
    });
    await page.goto("/#upcoming");
    await ready(page);
    await page.goto("/#show/999999");
    await expect(page.locator("#toast")).toContainText(/isn't on AniList/);
  });

  test("a corrupt show route falls back to the section", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/#show/abc");
    await expect(page.locator("#section-title")).toHaveText("Upcoming");
    await expect(page.locator("#toast")).toContainText(/doesn't point to a title/);
  });
});
