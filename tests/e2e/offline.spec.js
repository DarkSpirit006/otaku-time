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

test.describe("cache ownership", () => {
  test("activation deletes Otaku Time's old caches and nobody else's", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/#upcoming");
    await ready(page);

    // Seed the origin the way a second app and an older Otaku Time build would.
    await page.evaluate(async () => {
      const foreign = await caches.open("other-app-shell-v1");
      await foreign.put("/other-app-shell-v1", new Response("another app's data"));
      const old = await caches.open("otaku-time-v1-shell");
      await old.put("/otaku-time-v1-shell", new Response("an old build"));
    });

    // Unregistering leaves Cache Storage alone; the next registration runs
    // install → activate again, exactly like a real version upgrade.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.unregister();
    });
    // A real navigation, not a hash change: the document must drop its
    // old controller before the fresh registration can activate.
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.register("./sw.js", { scope: "./" }));
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });

    const names = await page.evaluate(() => caches.keys());
    expect(names).toContain("other-app-shell-v1");
    expect(names).not.toContain("otaku-time-v1-shell");
    expect(names).toContain("otaku-time-v4-shell");

    const foreign = await page.evaluate(async () => {
      const cache = await caches.open("other-app-shell-v1");
      const response = await cache.match("/other-app-shell-v1");
      return response ? response.text() : null;
    });
    expect(foreign).toBe("another app's data");
  });
});

test.describe("artwork cache", () => {
  test("real posters are stored and served with the network gone", async ({ page, context }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/#upcoming");
    await ready(page);
    // On a first visit the worker claims the page after the posters have
    // already gone out, so nothing is cached yet. Reloading with the
    // worker in control is the normal steady state.
    await page.reload();

    // The posters themselves come from the real AniList CDN — that is the
    // only way to prove opaque responses are cached, since a mocked
    // same-origin image would not be opaque.
    await page.waitForFunction(
      () => [...document.images].some((img) => img.currentSrc.includes("anilist") && img.naturalWidth > 0),
      undefined,
      { timeout: 30_000 }
    );

    const art = { name: null, count: 0 };
    await expect
      .poll(
        async () => {
          const state = await page.evaluate(async () => {
            const name = (await caches.keys()).find((key) => key.endsWith("-art"));
            if (!name) return { name: null, count: 0 };
            const cache = await caches.open(name);
            const keys = await cache.keys();
            return { name, count: keys.length };
          });
          art.name = state.name;
          art.count = state.count;
          return state.count;
        },
        { timeout: 20_000, message: "posters should land in the artwork cache" }
      )
      .toBeGreaterThan(0);

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator(".card, .lead-panel").first()).toBeVisible();
    const decoded = await page.evaluate(() => {
      const posters = [...document.images].filter((img) => img.currentSrc.includes("anilist"));
      return posters.filter((img) => img.complete && img.naturalWidth > 0).length;
    });
    expect(decoded, "at least one cached poster decodes offline").toBeGreaterThan(0);
  });
});
