/* ============================================================
   Otaku Time — pagination copy

   A section that has loaded one page of a longer schedule must say
   how many episodes it is showing, not present that count as a total.
   The phrase "full window" is a claim, so it may only appear once the
   API has confirmed there is nothing after the last loaded page.
   ============================================================ */

import { test, expect } from "@playwright/test";

import {
  mockAniList,
  standardSchedules,
  defaultEvents,
  makeMedia,
  makeEvent,
  schedulePayload,
} from "./helpers.js";

const now = () => Math.floor(Date.now() / 1000);

/** Page 1 of 3: five upcoming episodes, two pages still to come. */
function threePageUpcoming() {
  const anchor = now();
  const pageOne = Array.from({ length: 5 }, (_, index) =>
    makeEvent({
      id: 8100 + index,
      episode: index + 1,
      airingAt: anchor + 3600 * (index + 1),
      media: makeMedia(300 + index, `Upcoming ${index + 1}`),
    })
  );
  const pageTwo = Array.from({ length: 5 }, (_, index) =>
    makeEvent({
      id: 8200 + index,
      episode: index + 6,
      airingAt: anchor + 86_400 + 3600 * index,
      media: makeMedia(310 + index, `Upcoming Later ${index + 1}`),
    })
  );
  return { pageOne, pageTwo };
}

function threePageRecent() {
  const anchor = now();
  // Long enough that the load sentinel starts below the fold — otherwise
  // the observer fires immediately and there is no "more pages" state left
  // to describe.
  const pageOne = Array.from({ length: 12 }, (_, index) =>
    makeEvent({
      id: 7100 + index,
      episode: 12 - index,
      airingAt: anchor - 7200 * (index + 1),
      media: makeMedia(200 + index, `Aired ${index + 1}`),
    })
  );
  const pageTwo = Array.from({ length: 4 }, (_, index) =>
    makeEvent({
      id: 7200 + index,
      episode: 6 - index,
      airingAt: anchor - 86_400 - 3600 * index,
      media: makeMedia(210 + index, `Aired Earlier ${index + 1}`),
    })
  );
  return { pageOne, pageTwo };
}

/** Scroll the sentinel through every page the fixture will serve. */
async function exhaust(page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const sentinel = page.locator(".load-sentinel");
    if (!(await sentinel.count())) return;
    try {
      await sentinel.first().scrollIntoViewIfNeeded({ timeout: 2_000 });
    } catch {
      // The list re-rendered mid-scroll; the next attempt lands on the new node.
    }
    await page.waitForTimeout(400);
  }
}

test.describe("pagination honesty", () => {
  test("upcoming states the loaded count while pages remain", async ({ page }) => {
    const { pageOne, pageTwo } = threePageUpcoming();
    await mockAniList(page, {
      schedule: (vars) => {
        const requested = vars.page || 1;
        return schedulePayload(requested === 1 ? pageOne : pageTwo, {
          page: requested,
          hasNextPage: requested < 3,
        });
      },
    });

    await page.goto("/#upcoming");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(5);

    const meta = page.locator("#section-meta");
    await expect(meta).toContainText("5 loaded");
    await expect(meta).not.toContainText("full window");
    // A bare "5 episodes" would read as the size of the schedule.
    await expect(meta).not.toContainText(/episodes/);
    await expect(page.locator(".load-sentinel")).toHaveCount(1);
  });

  test("upcoming claims a full window only once the API runs out", async ({ page }) => {
    const { pageOne, pageTwo } = threePageUpcoming();
    await mockAniList(page, {
      schedule: (vars) => {
        const requested = vars.page || 1;
        return schedulePayload(requested === 1 ? pageOne : pageTwo, {
          page: requested,
          hasNextPage: requested < 3,
        });
      },
    });

    await page.goto("/#upcoming");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(5);

    await exhaust(page);

    const meta = page.locator("#section-meta");
    await expect(meta).toContainText("10 loaded · full window", { timeout: 15_000 });
    await expect(page.locator(".load-sentinel")).toHaveCount(0);
    await expect(page.locator(".loading-more")).toContainText("Full schedule window loaded");
  });

  test("recently aired states the loaded count while pages remain", async ({ page }) => {
    const { pageOne, pageTwo } = threePageRecent();
    await mockAniList(page, {
      schedule: (vars) => {
        const requested = vars.page || 1;
        return schedulePayload(requested === 1 ? pageOne : pageTwo, {
          page: requested,
          hasNextPage: requested < 3,
        });
      },
    });

    await page.goto("/#recent");
    await expect(page.locator(".row").first()).toBeVisible();

    const meta = page.locator("#section-meta");
    await expect(meta).toContainText("loaded");
    await expect(meta).not.toContainText("full window");
    await expect(meta).not.toContainText(/episodes/);
    // The history is not finished, so it must not be described as finished.
    await expect(page.locator(".loading-more")).toHaveCount(0);
    await expect(page.locator(".load-sentinel")).toHaveCount(1);
  });

  test("recently aired stops hedging once the history is exhausted", async ({ page }) => {
    const { pageOne, pageTwo } = threePageRecent();
    await mockAniList(page, {
      schedule: (vars) => {
        const requested = vars.page || 1;
        return schedulePayload(requested === 1 ? pageOne : pageTwo, {
          page: requested,
          hasNextPage: requested < 3,
        });
      },
    });

    await page.goto("/#recent");
    await expect(page.locator(".row").first()).toBeVisible();

    await exhaust(page);

    await expect(page.locator("#section-meta")).toContainText("16 loaded · full window", {
      timeout: 15_000,
    });
    await expect(page.locator(".loading-more")).toContainText("End of the available history window");
  });

  test("a single exhausted page claims completeness immediately", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));

    await page.goto("/#recent");
    await expect(page.locator(".row").first()).toBeVisible();
    // Two past events, hasNextPage: false — this window really is all of it.
    await expect(page.locator("#section-meta")).toContainText("2 loaded · full window");
  });
});
