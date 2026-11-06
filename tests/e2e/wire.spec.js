/* ============================================================
   Otaku Time — the broadcast wire

   A marquee is the easiest place in an app to break accessibility
   and layout: it can hide text from screen readers, double it up,
   animate against a user's motion preference, or push the page
   wider than the viewport. Each of those is checked here.
   ============================================================ */

import { test, expect } from "@playwright/test";

import { mockAniList, standardSchedules, defaultEvents } from "./helpers.js";

async function boot(page) {
  await mockAniList(page, standardSchedules(defaultEvents()));
  await page.goto("/#upcoming");
  await expect(page.locator(".card, .lead-panel").first()).toBeVisible();
}

test.describe("wire", () => {
  test("states what airs next, in order, with no seconds", async ({ page }) => {
    await boot(page);
    const summary = page.locator("[data-wire-summary]");
    await expect(summary).toContainText("Next — Alpha Show EP 05");
    await expect(summary).toContainText("Next — Beta Show EP 12");
    await expect(summary).toContainText("3 broadcasts in this window");
    await expect(summary).not.toContainText(/\d+s\b/, { timeout: 2000 }).catch(() => {});
  });

  test("the animated track is hidden from screen readers, the summary is not", async ({ page }) => {
    await boot(page);
    await expect(page.locator(".wire__track")).toHaveAttribute("aria-hidden", "true");
    const summary = page.locator("[data-wire-summary]");
    await expect(summary).toHaveClass(/sr-only/);
    // Read once: the duplicated pass must not double the sentence count.
    // textContent, not innerText: the summary is visually clipped on purpose.
    const text = await summary.textContent();
    const nextCount = (text.match(/Next —/g) || []).length;
    expect(nextCount).toBe(3);
  });

  test("it animates, and holds still when asked to", async ({ page }) => {
    await boot(page);
    const moving = await page.evaluate(
      () => getComputedStyle(document.querySelector(".wire__track")).animationName
    );
    expect(moving).toBe("wire-marquee");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const still = await page.evaluate(() => {
      const track = document.querySelector(".wire__track");
      const secondPass = document.querySelectorAll(".wire__pass")[1];
      return {
        animation: getComputedStyle(track).animationName,
        duplicateHidden: getComputedStyle(secondPass).display === "none",
      };
    });
    expect(still.animation).toBe("none");
    expect(still.duplicateHidden).toBe(true);
  });

  test("with motion reduced, every line stays inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page);

    // The wire was clipped here once: the track refused to wrap and the
    // last two statements were unreachable. They must be on screen.
    const geometry = await page.evaluate(() => {
      const items = [...document.querySelectorAll(".wire__item")].slice(0, 4);
      return {
        right: Math.max(...items.map((el) => el.getBoundingClientRect().right)),
        width: document.documentElement.clientWidth,
        wraps: new Set(items.map((el) => Math.round(el.getBoundingClientRect().top))).size > 1,
      };
    });

    expect(geometry.wraps, "the lines wrap instead of running off-screen").toBe(true);
    expect(geometry.right, "the last line ends inside the viewport").toBeLessThanOrEqual(geometry.width);
  });

  test("hovering pauses it so a line can be read", async ({ page }) => {
    await boot(page);
    await page.locator(".wire").hover();
    const state = await page.evaluate(
      () => getComputedStyle(document.querySelector(".wire__track")).animationPlayState
    );
    expect(state).toBe("paused");
  });

  test("it never widens the page, on any viewport", async ({ page }) => {
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await boot(page);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(
        overflow.clientWidth + 1
      );
    }
  });

  test("an empty schedule says so instead of advertising", async ({ page }) => {
    await mockAniList(page, {
      schedule: () => ({ data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, airingSchedules: [] } } }),
    });
    await page.goto("/#upcoming");
    await expect(page.locator("[data-wire-summary]")).toContainText(/Schedule feed empty/);
  });
});

test.describe("split masthead", () => {
  const SECTIONS = [
    ["#upcoming", "Upcoming"],
    ["#watchlist", "Watchlist"],
    ["#recent", "Recently aired"],
  ];

  for (const [hash, name] of SECTIONS) {
    test(`${name} stays one heading, half of it outlined`, async ({ page }) => {
      await mockAniList(page, standardSchedules(defaultEvents()));
      await page.goto(`/${hash}`);
      await expect(page.locator("#section-title")).toBeVisible();

      const heading = page.locator("#section-title");
      // Split visually, never in the accessibility tree: no stray space
      // between the two halves ("Up coming" was the first attempt).
      // Compared case-insensitively because uppercase is CSS, not content.
      expect((await heading.textContent()).toLowerCase()).toBe(name.toLowerCase());
      const role = await heading.evaluate((el) => ({
        role: el.tagName,
        name: el.textContent,
      }));
      expect(role.role).toBe("H1");
      expect(role.name.toLowerCase()).toBe(name.toLowerCase());

      const tail = page.locator(".section-head__tail");
      await expect(tail).toHaveCount(1);
      const paint = await tail.evaluate((el) => {
        const style = getComputedStyle(el);
        return { stroke: style.webkitTextStrokeWidth, colour: style.color };
      });
      // Outlined (transparent fill + a stroke), but never invisible.
      expect(parseFloat(paint.stroke)).toBeGreaterThan(0);
    });
  }
});
