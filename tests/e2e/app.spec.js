/* ============================================================
   Otaku Time — core application flows
   ============================================================ */

import { test, expect } from "@playwright/test";
import {
  mockAniList,
  standardSchedules,
  defaultEvents,
  makeMedia,
  makeEvent,
  searchPayload,
  detailsPayload,
  collectPageErrors,
  seedWatchlist,
  openSearchField,
} from "./helpers.js";

/* ============================================================
   The topbar search field is an underline, not a form input:
   the generic input[type="search"] styling in components/forms.css
   used to leak into it (border + surface + 40px min-height inside a
   36px row), which pushed the field out of alignment on phones.
   ============================================================ */
test.describe("topbar composition", () => {
  const geometry = () =>
    async (page) =>
      page.evaluate(() => {
        const wrap = document.querySelector(".search");
        const input = wrap.querySelector('input[type="search"]');
        const cs = getComputedStyle(input);
        const w = wrap.getBoundingClientRect();
        const i = input.getBoundingClientRect();
        return {
          borderTop: cs.borderTopWidth,
          borderBottom: cs.borderBottomWidth,
          background: cs.backgroundColor,
          radius: cs.borderTopLeftRadius,
          bottomOverflow: Math.round(i.bottom - w.bottom),
          topOverflow: Math.round(w.top - i.top),
          rightOverflow: Math.round(i.right - w.right),
        };
      });

  test("stays an underline field with no stray border, background or overflow", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".search input[type='search']")).toBeVisible();

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(120);
      // On phones the field is collapsed behind the search button; measure
      // it in the state a user actually sees it in.
      await openSearchField(page);
      const g = await geometry()(page);
      expect(g, JSON.stringify(g)).toMatchObject({
        borderTop: "0px",
        borderBottom: "0px",
        background: "rgba(0, 0, 0, 0)",
        radius: "0px",
      });
      // The field must sit inside its own row, not spill over it.
      expect(g.bottomOverflow, `bottom overflow at ${viewport.width}px`).toBeLessThanOrEqual(0);
      expect(g.topOverflow, `top overflow at ${viewport.width}px`).toBeLessThanOrEqual(0);
      expect(g.rightOverflow, `right overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
    }
  });
});

/* ============================================================
   The compact bar is the phone shell: one search node, collapsed until
   the search button (or the "/" shortcut) reveals it. The desk rail is
   hidden at this width, so anything that only lived there — the settings
   trigger, for one — became unreachable.
   ============================================================ */
test.describe("compact bar", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps one search field, collapsed until the search button opens it", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel").first()).toBeVisible();

    // One node, one value — never a second input in the hidden chrome.
    await expect(page.locator("#search")).toHaveCount(1);
    await expect(page.locator("#search")).toBeHidden();
    await expect(page.locator(".rail")).toBeHidden();

    const toggle = page.locator(".js-search-toggle").filter({ visible: true }).first();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.locator("#search")).toBeVisible();
    await expect(page.locator("#search")).toBeFocused();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-label", "Close search");

    // The control that opened the bar also closes it, and the query
    // survives so reopening does not silently start over.
    await page.fill("#search", "alpha");
    await toggle.click();
    await expect(page.locator("#search")).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.locator("#search")).toHaveValue("alpha");

    // Escape collapses the bar *and* clears the query, returning the
    // section — the same contract as pressing Escape with the caret
    // anywhere else.
    await expect(page.locator("#section-title")).toHaveText("Results");
    await page.keyboard.press("Escape");
    await expect(page.locator("#search")).toBeHidden();
    await expect(page.locator("#search")).toHaveValue("");
    await expect(page.locator("#section-title")).toHaveText("Upcoming");
  });

  test("the \"/\" shortcut reveals the field instead of focusing it off-screen", async ({ page }) => {
    await mockAniList(page, {
      ...standardSchedules(defaultEvents()),
      search: () => searchPayload([makeMedia(909, "Attack on Titan")]),
    });
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel").first()).toBeVisible();

    await page.keyboard.press("/");
    await expect(page.locator("#search")).toBeVisible();
    await expect(page.locator("#search")).toBeFocused();

    await page.keyboard.type("aot");
    await expect(page.locator("#section-title")).toHaveText("Results");
    await expect(page.locator(".card__title")).toContainText("Attack on Titan");
  });

  test("settings are reachable from the bar, not only from the desk rail", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel").first()).toBeVisible();

    const trigger = page.locator(".js-settings-open").filter({ visible: true });
    await expect(trigger).toHaveCount(1);
    await trigger.click();
    await expect(page.locator("#settings-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#settings-dialog")).toBeHidden();
  });
});

/* ============================================================
   The feature's veil is what lets type sit over arbitrary artwork: the
   artwork plate fades to the page colour underneath the copy. It has to
   paint ABOVE the image and it has to end on --paper, in whichever theme
   is running — a translucent last stop leaves the headline legible only
   while the poster happens to be dark.
   ============================================================ */
test.describe("feature veil", () => {
  test("paints above the artwork and fades to the page colour", async ({ page }) => {
    for (const theme of ["dark", "light"]) {
      const events = defaultEvents();
      await mockAniList(page, standardSchedules(events));
      await page.addInitScript((name) => localStorage.setItem("otaku-time.theme.v1", name), theme);

      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        const where = `${theme}/${viewport.width}`;
        await page.setViewportSize(viewport);
        await page.goto("/");
        await expect(page.locator(".spotlight__media")).toBeVisible();

        const veil = await page.evaluate(() => {
          const spotlight = document.querySelector(".spotlight");
          const media = spotlight.querySelector(".spotlight__media");
          const image = media.querySelector("img");
          const overlay = spotlight.querySelector(".spotlight__veil");
          if (!overlay || !image) return { present: false };
          const probe = document.createElement("span");
          probe.style.background = "var(--paper)";
          document.body.appendChild(probe);
          const paper = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const box = media.getBoundingClientRect();
          const overlayBox = overlay.getBoundingClientRect();
          const copy = spotlight.querySelector(".spotlight__content").getBoundingClientRect();
          return {
            present: true,
            paper,
            positioned: getComputedStyle(overlay).position,
            covers: Math.round(overlayBox.width) === Math.round(box.width) && Math.round(overlayBox.height) === Math.round(box.height),
            // compareDocumentPosition: the veil must follow the image so it
            // paints on top inside the same stacking context.
            above: Boolean(image.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING),
            stops: getComputedStyle(overlay).backgroundImage.match(/rgba?\([^)]+\)(?:\s+\d+%)?/g) || [],
            // Copy lives on the plate, never outside it.
            copyInside: copy.top >= box.top - 1 && copy.bottom <= box.bottom + 1,
          };
        });

        expect(veil.present, `${where}: no veil or no artwork`).toBe(true);
        expect(veil.positioned, where).toBe("absolute");
        expect(veil.covers, `${where}: veil does not cover the plate`).toBe(true);
        expect(veil.above, `${where}: veil is behind the artwork`).toBe(true);
        expect(veil.stops.length, `${where}: veil has no gradient`).toBeGreaterThan(1);
        // The last stop is opaque page colour, not a tint over the art.
        expect(veil.stops.at(-1), `${where}: fade ends on ${veil.stops.at(-1)}, paper is ${veil.paper}`).toContain(veil.paper);
        expect(veil.copyInside, `${where}: copy spills outside the plate`).toBe(true);
      }
    }
  });
});

/* ============================================================
   The detail sheet on a phone is a two-column layout: a 92px poster and
   the text column beside it. Long titles and long button labels used to
   push past the dialog's right edge, where they were clipped to the
   viewport and unreachable (the sheet only scrolls vertically).
   ============================================================ */
test.describe("detail sheet on phones", () => {
  test("long titles and action labels stay inside the sheet", async ({ page }) => {
    const events = defaultEvents();
    const longTitle = "Steel Ball Run JoJo's Bizarre Adventure 2nd and 3rd Stage";
    await mockAniList(page, {
      ...standardSchedules(events),
      details: (vars) =>
        detailsPayload(
          makeMedia(vars.id, longTitle, {
            episodes: 11,
            genres: ["Action", "Adventure", "Drama", "Mystery", "Supernatural"],
          })
        ),
    });

    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 780 });
      await page.goto("/");
      await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
      await page.locator('[data-action="detail"]').first().click();
      await expect(page.locator("#detail-dialog")).toBeVisible();
      await expect(page.locator("#detail-title")).toContainText("Steel Ball Run");
      await page.waitForTimeout(250);

      const overflow = await page.evaluate(() => {
        const dialog = document.querySelector("#detail-dialog");
        const box = dialog.getBoundingClientRect();
        const offenders = [];
        for (const element of document.querySelectorAll("#detail-content *")) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0) continue;
          const spillsRight = rect.right > box.right + 1 || rect.left < box.left - 1;
          const clipsContent = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2;
          if (spillsRight || clipsContent) {
            offenders.push(
              `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 24)} ` +
                `right=${Math.round(rect.right)} vs ${Math.round(box.right)}, ` +
                `scroll=${element.scrollWidth}/${element.clientWidth}`
            );
          }
        }
        return offenders;
      });

      expect(overflow, `at ${width}px:\n${overflow.join("\n")}`).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator("#detail-dialog")).toBeHidden();
    }
  });
});

/* ============================================================
   The ticker rewrites countdown text every second. A countdown span that
   also holds the airing time ("in 2h · Thu, Nov 5, 8:00 PM UTC") lost it
   on the first tick, because textContent replacement drops child nodes:
   the exact air time vanished one second after every load.
   ============================================================ */
test.describe("live countdowns", () => {
  test("keep the airing time and its own value after ticking", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");

    const airing = page.locator(".card__airing").first();
    await expect(airing).toBeVisible();
    const before = (await airing.innerText()).replace(/\s+/g, " ");
    expect(before).toMatch(/·/); // countdown + separator + time

    // Two seconds of real ticks.
    await page.waitForTimeout(2400);

    const after = (await airing.innerText()).replace(/\s+/g, " ");
    expect(after).toMatch(/·/);
    expect(after).toMatch(/UTC|AM|PM/);

    // The exact air time is the half that must not move. The countdown
    // itself is allowed to cross an hour boundary while we wait.
    const timeOf = (text) => text.split("·").pop().trim();
    expect(timeOf(after)).toBe(timeOf(before));
    expect(after.split("·")[0].trim()).toMatch(/^in /i);
  });
});

/* ============================================================
   "Aired earlier today" rows carry five children (clock, poster, body,
   ago, actions) like every other row, but the compact variant declared
   only four grid tracks. Everything shifted one column left, so the
   poster landed in the 1fr track: a 100px thumbnail rendered 640px wide
   and 966px tall, taller than the feature above it.
   ============================================================ */
test.describe("today's already-aired rows", () => {
  test("keep the poster in its own column at its own size", async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    const events = defaultEvents();
    await mockAniList(
      page,
      standardSchedules({
        ...events,
        upcoming: [
          ...events.upcoming,
          // Already aired today, so it lands in the "aired earlier" list.
          makeEvent({
            id: 9009,
            episode: 3,
            airingAt: now - 3600,
            media: makeMedia(191, "Yesterday's News"),
          }),
        ],
      })
    );

    await page.goto("/");
    const row = page.locator(".today-past .row").first();
    await expect(row).toBeVisible();

    const sizes = await page.evaluate(() => {
      const row = document.querySelector(".today-past .row");
      const poster = row.querySelector(".row__poster");
      const rowBox = row.getBoundingClientRect();
      const box = poster.getBoundingClientRect();
      return {
        posterWidth: Math.round(box.width),
        posterHeight: Math.round(box.height),
        rowHeight: Math.round(rowBox.height),
      };
    });

    // A 54px thumbnail stays a 54px thumbnail (2:3, so ~81px tall) and
    // never outsizes the row that contains it.
    expect(sizes.posterWidth).toBeLessThanOrEqual(90);
    expect(sizes.posterHeight).toBeLessThanOrEqual(140);
    expect(sizes.rowHeight).toBeLessThan(200);
  });
});

/* ============================================================
   The rundown's first column is the air time ("23:30"), and the compact
   rule hid it outright below 900px. A row without its clock is a row
   missing one of the five things it promises — the time it aired — so on
   phones it moves under the title instead of disappearing.
   ============================================================ */
test.describe("recently aired rundown", () => {
  test("keeps the air time on phones instead of hiding the column", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/#recent");

    const row = page.locator(".row").first();
    await expect(row).toBeVisible();
    const clock = row.locator(".row__clock");
    await expect(clock).toBeVisible();

    const measured = await page.evaluate(() => {
      const row = document.querySelector(".row");
      const clock = row.querySelector(".row__clock");
      const text = clock.innerText.trim();
      const box = clock.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      return {
        text,
        width: Math.round(box.width),
        inside: box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(measured.text).toMatch(/^\d{1,2}:\d{2}\s*(AM|PM)?$/i);
    expect(measured.width).toBeGreaterThan(20);
    expect(measured.inside).toBe(true);
    expect(measured.overflow).toBeLessThanOrEqual(0);
  });
});

/* ============================================================
   Below 960px the timetable becomes an agenda: one day per block and the
   day's slots in a small grid. The "now" marker is a child of that same
   grid, so it took a whole cell as if it were a programme — pushing the
   first slot into the second column and leaving a third of the row empty.
   ============================================================ */
test.describe("calendar agenda", () => {
  for (const width of [768, 390]) {
    test(`the now marker spans the day row at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const events = defaultEvents();
      await mockAniList(page, standardSchedules(events));
      await page.goto("/#upcoming");
      await page.locator('[data-action="set-view"][data-view="calendar"]').click();
      await expect(page.locator(".cal-day").first()).toBeVisible();

      const measured = await page.evaluate(() => {
        const day = [...document.querySelectorAll(".cal-day")].find((d) =>
          d.querySelector(".cal-slot")
        );
        const slots = day.querySelector(".cal-day__slots");
        const slotsBox = slots.getBoundingClientRect();
        const first = slots.querySelector(".cal-slot").getBoundingClientRect();
        const marker = day.querySelector(".cal-now");
        return {
          slotsWidth: Math.round(slotsBox.width),
          slotsLeft: Math.round(slotsBox.left),
          firstLeft: Math.round(first.left),
          markerWidth: marker ? Math.round(marker.getBoundingClientRect().width) : 0,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      // The marker is an annotation across the row, not a programme.
      expect(measured.markerWidth).toBeGreaterThanOrEqual(measured.slotsWidth * 0.9);
      // And the first programme starts where the day starts.
      expect(Math.abs(measured.firstLeft - measured.slotsLeft)).toBeLessThanOrEqual(2);
      expect(measured.overflow).toBeLessThanOrEqual(0);
    });
  }
});

/* ============================================================
   Artwork sizing. AniList's field names sit one step below the folders
   they point at (medium → /cover/small/, large → /cover/medium/,
   extraLarge → /cover/large/), and those folders are ~100/230/660 px.
   The srcset descriptors have to describe the FILE: if they understate it,
   the browser escalates to the biggest artwork for every slot, and the app
   ships megabytes of images nobody can see.
   ============================================================ */
test.describe("artwork sources", () => {
  test("declare honest widths and a sizes hint on every poster", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();

    const posters = await page.evaluate(() =>
      [...document.querySelectorAll("img[srcset]")].map((img) => ({
        srcset: img.getAttribute("srcset"),
        sizes: img.getAttribute("sizes") || "",
        current: img.currentSrc,
        rendered: Math.round(img.getBoundingClientRect().width),
        natural: img.naturalWidth,
      }))
    );

    expect(posters.length).toBeGreaterThan(0);

    // Three ascending candidates: 100 / 230 / 660.
    for (const poster of posters) {
      const widths = [...poster.srcset.matchAll(/\s(\d+)w/g)].map(([, w]) => Number(w));
      expect(widths.length, poster.srcset).toBe(3);
      expect(widths).toEqual([...widths].sort((a, b) => a - b));
      expect(widths).toEqual([100, 230, 660]);
    }

    // Anything above the fold must say how wide it will be drawn, or the
    // browser assumes 100vw and picks the largest file.
    for (const poster of posters) {
      expect(poster.sizes, `${poster.current} has no sizes`).not.toBe("");
    }

    // And what it picked has to be at least as wide as it is drawn.
    const spotlight = posters.find((p) => p.current.includes("/large/"));
    if (spotlight) {
      expect(spotlight.natural).toBeGreaterThanOrEqual(Math.min(spotlight.rendered, 461));
    }
  });
});

/* ============================================================
   The lead panel is one big "open the dossier" button. Its save control
   used to live inside the art plate, which sits at z-index -1 — a stacking
   context, so the save button was painted behind the overlay and could not
   be clicked at all. It has to be the topmost thing at its own corner.
   ============================================================ */
test.describe("lead panel controls", () => {
  test("save stays clickable above the open overlay", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    const save = page.locator(".lead-panel .lead-panel__save").first();
    await expect(save).toHaveCount(1);

    const onTop = await save.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit === button || button.contains(hit);
    });
    expect(onTop, "another layer covers the lead panel's save button").toBe(true);

    await save.click();
    await expect(page.locator("#toast")).toHaveText(/Saved to watchlist/);
    await expect(save).toHaveClass(/is-saved/);
  });
});

/* ============================================================
   The feature panel is one column at every width. A tablet-era
   `grid-template-columns: 1.15fr .85fr` survived into the redesign and
   split the plate in two below 1180px: the copy got 57% of the panel, and
   the countdown — the panel's headline figure — was clipped to "T —" at
   360px.
   ============================================================ */
test.describe("feature composition", () => {
  test("copy keeps the full measure and the countdown stays whole", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));

    for (const viewport of [
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      const where = `${viewport.width}px`;
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator(".spotlight__count")).toBeVisible();

      const layout = await page.evaluate(() => {
        const panel = document.querySelector(".spotlight");
        const content = document.querySelector(".spotlight__content");
        const count = document.querySelector(".spotlight__count");
        const label = document.querySelector(".spotlight__count-label");
        const units = [...document.querySelectorAll(".spotlight__unit")];
        const panelBox = panel.getBoundingClientRect();
        const contentBox = content.getBoundingClientRect();
        const countBox = count.getBoundingClientRect();
        const available = panelBox.width - parseFloat(getComputedStyle(panel).paddingLeft) * 2;
        // The copy has a 46rem measure on purpose; on a wide panel it is
        // allowed to stop there. It is never allowed to shrink below it
        // while there is room.
        const measure = parseFloat(getComputedStyle(content).maxWidth) || Infinity;
        return {
          columns: getComputedStyle(panel).gridTemplateColumns.split(" ").length,
          share: contentBox.width / Math.min(available, measure),
          clipped: count.scrollWidth > count.clientWidth + 1,
          countWidth: Math.round(countBox.width),
          labelVisible: label.getBoundingClientRect().width > 0,
          units: units.map((unit) => getComputedStyle(unit).display !== "none"),
        };
      });

      expect(layout.columns, `${where}: the panel is split into columns`).toBe(1);
      expect(layout.share, `${where}: copy gets only ${Math.round(layout.share * 100)}% of its measure`).toBeGreaterThan(0.95);
      expect(layout.clipped, `${where}: countdown is clipped`).toBe(false);
      // The countdown keeps its unit labels — that is what makes it a
      // countdown rather than a clock.
      expect(layout.labelVisible, `${where}: "T—" prefix missing`).toBe(true);
      expect(layout.units, `${where}: hour/minute/second labels hidden`).toEqual([true, true, true]);
    }
  });
});

/* ============================================================
   Layout escape hatch. `?spotlight=text` is the documented low-bandwidth
   route: the feature keeps its composition and its copy but drops the
   artwork, so a slow connection never pays for a 1600px banner. It must be
   inert unless asked for, must not change reading order, and must not
   change what the panel says.
   ============================================================ */
test.describe("spotlight layout flag", () => {
  test("only drops the artwork when explicitly asked", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));

    await page.setViewportSize({ width: 390, height: 844 });

    const measure = () =>
      page.evaluate(() => {
        const spotlight = document.querySelector(".spotlight");
        const plate = spotlight.querySelector(".spotlight__plate");
        const media = spotlight.querySelector(".spotlight__media");
        const box = (plate || media).getBoundingClientRect();
        return {
          flag: document.documentElement.dataset.spotlight || "",
          images: spotlight.querySelectorAll("img").length,
          plate: Boolean(plate),
          media: Boolean(media),
          coversPanel: Math.round(box.width) === Math.round(spotlight.getBoundingClientRect().width) - 2,
          title: spotlight.querySelector(".spotlight__title").textContent.trim(),
          actions: spotlight.querySelectorAll(".spotlight__actions .btn").length,
          domOrder: [...spotlight.children].map((el) => el.className.split(" ")[0]),
        };
      });

    await page.goto("/");
    await expect(page.locator(".spotlight__title")).toBeVisible();
    const fallback = await measure();
    expect(fallback.flag).toBe("");
    expect(fallback.images, "default feature must show artwork").toBe(1);
    expect(fallback.media).toBe(true);
    expect(fallback.plate, "text plate is the escape hatch, not the default").toBe(false);

    await page.goto("/?spotlight=text");
    await expect(page.locator(".spotlight__title")).toBeVisible();
    const variant = await measure();
    expect(variant.flag).toBe("text");
    expect(variant.images, "text mode must not fetch a banner").toBe(0);
    expect(variant.plate).toBe(true);
    expect(variant.media).toBe(false);
    expect(variant.coversPanel, "the plate still fills the panel").toBe(true);

    // Same words, same actions, same reading order. The plate wrapper
    // differs (an img against a bare plate), the sequence does not.
    expect(variant.title).toBe(fallback.title);
    expect(variant.actions).toBe(fallback.actions);
    expect(variant.domOrder).toHaveLength(fallback.domOrder.length);
    expect(variant.domOrder[0]).toContain("spotlight__content");
    expect(fallback.domOrder[0]).toContain("spotlight__content");
    expect(variant.domOrder.at(-1)).toBe(fallback.domOrder.at(-1));
  });
});


test.describe("boot & sections", () => {
  test("loads with branding, upcoming schedule and no page errors", async ({ page }) => {
    const errors = collectPageErrors(page);
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));

    await page.goto("/");
    await expect(page).toHaveTitle("Upcoming · Otaku Time");
    await expect(page.locator("#section-title")).toHaveText("Upcoming");

    // Three primary sections only
    const nav = page.locator(".nav__link");
    await expect(nav).toHaveCount(3);
    await expect(nav.nth(0)).toHaveAttribute("href", "#upcoming");
    await expect(nav.nth(1)).toHaveAttribute("href", "#watchlist");
    await expect(nav.nth(2)).toHaveAttribute("href", "#recent");

    // Schedule rendered from the API: the spotlight is the next episode,
    // the day opens with editorial lead panels, the lineup continues as cards.
    await expect(page.locator(".spotlight")).toBeVisible();
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
    await expect(page.locator(".spotlight__title")).toContainText("Alpha Show");
    await expect(page.locator(".day-group").first()).toBeVisible();
    await expect(page.locator(".js-sync").first()).toHaveAttribute("data-state", "live");

    expect(errors).toEqual([]);
  });

  test("navigates between all three sections via sidebar and hash", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page).toHaveURL(/#watchlist$/);
    await expect(page.locator("#section-title")).toHaveText("Watchlist");
    await expect(page.locator(".empty h2")).toHaveText("Your watchlist is empty");
    await expect(page.locator('.nav__link[data-nav="watchlist"]')).toHaveAttribute("aria-current", "page");

    await page.click('.nav__link[data-nav="recent"]');
    await expect(page).toHaveURL(/#recent$/);
    await expect(page.locator("#section-title")).toHaveText("Recently aired");
    await expect(page.locator(".row")).toHaveCount(2);

    // Deep link on a fresh load
    await page.goto("/#upcoming");
    await expect(page.locator("#section-title")).toHaveText("Upcoming");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
  });

  test("schedule ships unfiltered, in chronological order", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    // No filter UI anywhere
    await expect(page.locator(".filter-bar")).toHaveCount(0);
    await expect(page.locator("#app .select__trigger")).toHaveCount(0);

    // Air-time order: +1h, +2h, +3d (lead panels lead the lineup)
    await expect(
      page.locator(".lead-panel__title, .card__title")
    ).toHaveText(["Alpha Show", "Beta Show", "Gamma Show"]);

    // Meta carries the count instead of the old filter bar
    await expect(page.locator("#section-meta")).toContainText("3 loaded");
  });

  test("empty schedule shows a friendly empty state", async ({ page }) => {
    await mockAniList(page, standardSchedules({ upcoming: [], recent: [] }));
    await page.goto("/");
    await expect(page.locator(".empty h2")).toHaveText("Nothing scheduled yet");
    await expect(page.locator(".empty")).toBeVisible();
  });
});

test.describe("search", () => {
  test("finds local pool titles instantly and merges remote results", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, {
      ...standardSchedules(events),
      search: (vars) =>
        searchPayload(
          String(vars.search || "").toLowerCase().includes("discovery")
            ? [makeMedia(555, "Remote Discovery", { averageScore: 95 })]
            : []
        ),
      details: (vars) => detailsPayload(makeMedia(vars.id, "Remote Discovery")),
    });
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    // "/" focuses the search field
    await page.keyboard.press("/");
    await expect(page.locator("#search")).toBeFocused();

    await page.fill("#search", "alpha");
    await expect(page.locator("#section-title")).toHaveText("Results");
    await expect(page.locator(".search-count")).toHaveText("1");
    await expect(page.locator(".card__title")).toContainText("Alpha Show");
    await expect(page.locator("mark").first()).toBeVisible();

    // Remote merge adds the AniList-only result
    await page.fill("#search", "discovery");
    await expect(page.locator(".card")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(".card__title")).toContainText("Remote Discovery");

    // Escape clears the query and returns to the section
    await page.keyboard.press("Escape");
    await expect(page.locator("#section-title")).toHaveText("Upcoming");
    await expect(page.locator("#search")).toHaveValue("");
  });

  test("search with no matches shows guidance", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, {
      ...standardSchedules(events),
      search: () => searchPayload([]),
    });
    await page.goto("/");
    await page.fill("#search", "zzz-no-such-show");
    await expect(page.locator(".empty h2")).toContainText("No matches");
    await expect(page.locator(".empty p")).toContainText("spelling");
  });
});

test.describe("watchlist masthead", () => {
  test("\"+ Add titles\" routes to the one search field, on any width", async ({ page }) => {
    await mockAniList(page, {
      ...standardSchedules(defaultEvents()),
      search: () => searchPayload([makeMedia(909, "Attack on Titan")]),
    });

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/#watchlist");
      await expect(page.locator(".empty h2")).toBeVisible();

      const add = page.locator('[data-action="add-titles"]');
      await expect(add).toHaveCount(1);
      await add.click();

      // Same single field everywhere; on a phone the compact bar opens it.
      await expect(page.locator("#search")).toHaveCount(1);
      await expect(page.locator("#search")).toBeVisible();
      await expect(page.locator("#search")).toBeFocused();
    }
  });

  test("a saved title with no personal status says so instead of a dash", async ({ page }) => {
    await seedWatchlist(page, [
      {
        id: 501,
        title: { romaji: "Unfiled Show", english: "Unfiled Show" },
        coverImage: { large: null, color: "#445566" },
        format: "TV",
        mediaStatus: "FINISHED",
        listStatus: null,
        episodes: 12,
        watched: 0,
        duration: 24,
        order: 1,
        createdAt: Date.now(),
      },
    ]);
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/#watchlist");

    const pill = page.locator(".card--saved .status-pill--none").first();
    await expect(pill).toHaveText("Unset");
    // A lone em dash is not a status, it is a rendering accident.
    await expect(pill).not.toHaveText("—");
  });
});

test.describe("watchlist lifecycle", () => {
  test("save, count, progress and persistence across reload", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, {
      ...standardSchedules(events),
      details: (vars) =>
        detailsPayload(
          makeMedia(vars.id, vars.id === 101 ? "Alpha Show" : "Beta Show", { episodes: 12 })
        ),
    });
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    // Save the first entry (a lead panel carries the save control too)
    await page.locator("[data-action='save']").first().click();
    await expect(page.locator("#toast")).toHaveText(/Saved to watchlist/);
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
    await expect(page.locator('.nav__count[data-nav-count]')).toBeVisible();

    // Watchlist shows the card with progress controls
    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".stat__value").first()).toHaveText("1");
    await expect(page.locator(".step-btn").first()).toBeVisible();

    // +1 progress persists
    await page.locator(".step-btn[data-delta='1']").first().click();
    await expect(page.locator(".card__progress-text")).toContainText("1/12");

    // Reload → still there
    await page.reload();
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator(".card__progress-text")).toContainText("1/12");

    // Unsave from the card
    await page.locator(".card__save").click();
    await expect(page.locator("#toast")).toHaveText(/Removed/);
    await expect(page.locator(".empty h2")).toHaveText("Your watchlist is empty");
  });

  test("seeded watchlist renders stats immediately", async ({ page }) => {
    const now = Date.now();
    await seedWatchlist(page, [
      {
        id: 7001,
        title: { romaji: "Seeded", english: "Seeded Show", native: "" },
        coverImage: { medium: null, large: null, extraLarge: null },
        format: "TV",
        mediaStatus: "RELEASING",
        listStatus: "watching",
        episodes: 24,
        duration: 24,
        averageScore: 88,
        season: "SUMMER",
        seasonYear: 2026,
        genres: ["Comedy"],
        nextAiringEpisode: { airingAt: Math.floor(now / 1000) + 86400 },
        watched: 5,
        createdAt: now,
      },
      {
        id: 7002,
        title: { romaji: "Done", english: "Finished Show", native: "" },
        coverImage: { medium: null, large: null, extraLarge: null },
        format: "TV",
        mediaStatus: "FINISHED",
        listStatus: "completed",
        episodes: 12,
        duration: 24,
        averageScore: 80,
        season: "WINTER",
        seasonYear: 2025,
        genres: ["Drama"],
        nextAiringEpisode: null,
        watched: 12,
        createdAt: now - 1000,
      },
    ]);
    await mockAniList(page, standardSchedules(defaultEvents()));

    await page.goto("/#watchlist");
    await expect(page.locator(".card")).toHaveCount(2);
    // Four printed columns. "Behind schedule" counts shows, not episodes:
    // summing episodes across a shelf where AniList has not published a
    // total produces a number that reads as fact and is not.
    const stats = page.locator(".stat");
    await expect(stats).toHaveCount(4);
    await expect(stats.nth(0).locator(".stat__label")).toHaveText("Titles");
    await expect(stats.nth(0).locator(".stat__value")).toHaveText("2");
    await expect(stats.nth(1).locator(".stat__label")).toHaveText("Episodes logged");
    await expect(stats.nth(1).locator(".stat__value")).toHaveText("17");
    await expect(stats.nth(2).locator(".stat__label")).toHaveText("Time spent");
    await expect(stats.nth(2).locator(".stat__value")).toHaveText("6h 48m"); // 17 × 24 min
    await expect(stats.nth(3).locator(".stat__label")).toHaveText("Behind schedule");
    await expect(stats.nth(3).locator(".stat__value")).toHaveText("0");
    await expect(page.locator(".card.is-complete")).toHaveCount(1);
    await expect(page.locator(".card.is-tracked")).toHaveCount(1);
  });
});

test.describe("dialogs", () => {
  test("detail dialog lazy-loads details and restores focus", async ({ page }) => {
    const events = defaultEvents();
    let detailRequests = 0;
    await mockAniList(page, {
      ...standardSchedules(events),
      details: (vars) => {
        detailRequests++;
        return detailsPayload(
          makeMedia(vars.id, "Alpha Show", {
            description: "Full rich synopsis from AniList.",
            genres: ["Action", "Adventure", "Fantasy"],
            externalLinks: [{ site: "Crunchyroll", url: "https://crunchyroll.com" }],
          })
        );
      },
    });
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    const opener = page.locator(".card__open, .lead-panel__open").first();
    await opener.click();
    const dialog = page.locator("#detail-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#detail-title")).toContainText("Alpha Show");
    await expect(dialog.locator(".detail-synopsis")).toContainText("Full rich synopsis", { timeout: 15_000 });
    await expect(dialog.locator(".detail-tags .badge")).toHaveCount(3);
    expect(detailRequests).toBe(1);

    // Save from inside the dialog
    await dialog.locator('[data-detail-action="toggle-save"]').click();
    await expect(dialog.locator('[data-detail-action="toggle-save"]')).toContainText("In watchlist");
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");

    // Esc closes with animation and focus returns to the opener
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("backdrop click closes the settings dialog", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    const dialog = page.locator("#settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".settings-group")).toHaveCount(3);

    // Click the backdrop (the dialog element itself, outside its box)
    await page.mouse.click(20, 450);
    await expect(dialog).toBeHidden();
  });

  test("settings change theme, clock format and timezone", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    await page.locator(".js-settings-open").first().click();
    const dialog = page.locator("#settings-dialog");

    // Timezone → airing times re-render in the new zone
    const timeBefore = await page.locator(".card__time").first().textContent();
    await page.selectOption("#setting-timezone", "America/New_York");
    await expect(page.locator(".card__time").first()).not.toHaveText(timeBefore);

    // Clock format → 24h
    await page.selectOption("#setting-hour12", "24");
    await expect(page.locator("#clock")).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Theme toggle from the chrome
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.locator(".js-theme-toggle").first().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .not.toBe(before);
  });

  test("export downloads a versioned backup", async ({ page }) => {
    await seedWatchlist(page, [
      {
        id: 42,
        title: { romaji: "Exported", english: "", native: "" },
        coverImage: { medium: null, large: null, extraLarge: null },
        format: "TV",
        status: "FINISHED",
        episodes: 1,
        duration: 24,
        averageScore: 70,
        season: "SPRING",
        seasonYear: 2024,
        genres: [],
        nextAiringEpisode: null,
        watched: 1,
        createdAt: Date.now(),
      },
    ]);
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();

    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-settings-action="export"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("otaku-time-watchlist.json");
  });

  test("import validates payloads and reports results", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();

    // Invalid JSON
    await page.setInputFiles("#import-file", {
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{not json"),
    });
    await expect(page.locator("#import-result")).toHaveText(/valid JSON/);

    // Wrong schema version
    await page.setInputFiles("#import-file", {
      name: "wrong-version.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ app: "Otaku Time", schemaVersion: 99, items: [] })),
    });
    await expect(page.locator("#import-result")).toHaveText(/Unknown backup version/);

    // Valid backup
    await page.setInputFiles("#import-file", {
      name: "good.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        app: "Otaku Time",
        schemaVersion: 2,
        items: [
          {
            id: 8001,
            title: { romaji: "Imported", english: "Imported Show", native: "" },
            coverImage: { medium: null, large: null, extraLarge: null },
            format: "TV",
            status: "RELEASING",
            episodes: 10,
            duration: 24,
            averageScore: 77,
            season: "FALL",
            seasonYear: 2026,
            genres: ["Mystery"],
            nextAiringEpisode: null,
            watched: 2,
            createdAt: Date.now(),
          },
          { id: 8001, title: { romaji: "dupe" }, watched: 0 }, // duplicate → skipped
          { id: -5, title: { romaji: "bad" } }, // invalid id
        ],
      })),
    });
    await expect(page.locator("#import-result")).toHaveText(/1 added, 1 skipped, 1 invalid/);
    await expect(page.locator("#import-result")).toHaveText(/saved/);
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");
  });
});

test.describe("keyboard & accessibility", () => {
  test("skip link is the first tab stop and moves focus to content", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("nav exposes current section to assistive tech", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator('.nav__link[data-nav="upcoming"]')).toHaveAttribute("aria-current", "page");
    await page.click('.nav__link[data-nav="recent"]');
    await expect(page.locator('.nav__link[data-nav="recent"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator('.nav__link[data-nav="upcoming"]')).not.toHaveAttribute("aria-current", "page");
  });

  test("toast is a polite live region", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator("#toast")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("#toast")).toHaveAttribute("role", "status");
  });

  test("dialogs are modal and labelled", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    const dialog = page.locator("#settings-dialog");
    await expect(dialog).toBeVisible();
    const labelId = await dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    await expect(dialog.locator(`#${labelId}`)).toBeVisible();
    // Focus starts inside the dialog
    await expect.poll(() => page.evaluate(() => document.querySelector("#settings-dialog")?.contains(document.activeElement))).toBe(true);
  });
});

test.describe("performance basics", () => {
  test("schedules come from cache on repeat visits (IndexedDB snapshot)", async ({ page }) => {
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);

    // Second visit: snapshot restores instantly (source: cache until network settles)
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
    // The IndexedDB cache now holds the snapshot
    const cached = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("otaku-time.cache.v1", 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const value = await new Promise((resolve) => {
        const tx = db.transaction("snapshots", "readonly");
        const get = tx.objectStore("snapshots").get("upcoming");
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => resolve(null);
      });
      db.close();
      return Boolean(value?.events?.length);
    });
    expect(cached).toBe(true);
  });
});

test.describe("custom select UI", () => {
  test("settings select opens, commits, and closes every way", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    await expect(page.locator("#settings-dialog")).toBeVisible();

    // Open: listbox visible with options, aria-expanded flips
    const trigger = page.locator("#setting-timezone-trigger");
    await trigger.click();
    const menu = page.locator("#setting-timezone-listbox");
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(menu.locator(".select__option").first()).toBeVisible();

    // Commit a different zone
    const original = await page.locator("#setting-timezone").inputValue();
    await menu.locator('.select__option[data-value="Asia/Tokyo"]').click();
    await expect(page.locator("#setting-timezone")).toHaveValue("Asia/Tokyo");
    await expect(trigger.locator(".select__value")).toContainText("Asia/Tokyo");
    expect(original).not.toBe("Asia/Tokyo");
    await expect(menu).toBeHidden();

    // Escape closes without committing
    const clockTrigger = page.locator("#setting-hour12-trigger");
    await clockTrigger.click();
    const clockMenu = page.locator("#setting-hour12-listbox");
    await expect(clockMenu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(clockMenu).toBeHidden();
    await expect(page.locator("#setting-hour12")).toHaveValue("12");

    // Clicking outside closes the menu
    await clockTrigger.click();
    await expect(clockMenu).toBeVisible();
    await page.mouse.click(40, 400);
    await expect(clockMenu).toBeHidden();
  });

  test("keyboard: arrows navigate options and Enter commits", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    const clockTrigger = page.locator("#setting-hour12-trigger");
    await clockTrigger.focus();
    await page.keyboard.press("Enter"); // opens
    const clockMenu = page.locator("#setting-hour12-listbox");
    await expect(clockMenu).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter"); // commits the active option
    await expect(clockMenu).toBeHidden();
    await expect(page.locator("#setting-hour12")).toHaveValue("24");
    await expect(clockTrigger).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("render discipline (no flashing)", () => {
  test("saving patches controls in place without repainting the view", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.addInitScript(() => {
      window.__paints = 0;
      const hook = new MutationObserver(() => {
        const app = document.getElementById("app");
        if (app && !app.__hooked) {
          app.__hooked = true;
          new MutationObserver(() => {
            window.__paints++;
          }).observe(app, { childList: true });
        }
      });
      hook.observe(document, { childList: true, subtree: true });
    });
    const events = defaultEvents();
    await mockAniList(page, standardSchedules(events));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
    await expect(page.locator("#app .view-enter")).toBeVisible(); // entrance played

    // Remember the exact entrance node so we can prove it is never recreated.
    await page.evaluate(() => {
      window.__entrance = document.querySelector("#app .view-enter");
      window.__paints = 0;
    });
    const firstSave = page.locator(".card__save, .lead-panel__save").first();
    await firstSave.click();
    await expect(page.locator("#toast")).toHaveText(/Saved to watchlist/);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__paints)).toBe(0);
    expect(
      await page.evaluate(() => document.querySelector("#app .view-enter") === window.__entrance)
    ).toBe(true);
    // Both the clicked entry and the nav count reflect the save
    await expect(firstSave).toHaveClass(/is-saved/);
    await expect(page.locator('.nav__count[data-nav-count]')).toHaveText("1");

    // Section switch → repaint happens exactly once and animates in
    await page.evaluate(() => {
      window.__paints = 0;
    });
    await page.click('.nav__link[data-nav="watchlist"]');
    await expect(page.locator("#section-title")).toHaveText("Watchlist");
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__paints)).toBe(1);
    expect(
      await page.evaluate(() => {
        const el = document.querySelector("#app .view-enter");
        return Boolean(el) && el !== window.__entrance; // a fresh animated node
      })
    ).toBe(true);

    expect(errors).toEqual([]);
  });

  test("schedule sync after load does not replay entrance animations", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
    await expect(page.locator("#app .view-enter")).toBeVisible();

    // A manual refresh brings identical schedule data: nothing should be
    // repainted at all (repaint + animation replay was the visible flashing).
    await page.evaluate(() => {
      window.__entrance = document.querySelector("#app .view-enter");
      window.__paints = 0;
    });
    await page.locator(".js-refresh").first().click();
    await expect(page.locator(".js-sync").first()).toHaveAttribute("data-state", "live", {
      timeout: 15_000,
    });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__paints)).toBe(0);
    expect(
      await page.evaluate(() => document.querySelector("#app .view-enter") === window.__entrance)
    ).toBe(true);
    await expect(page.locator(".card, .lead-panel")).toHaveCount(3);
  });
});

test.describe("install prompt", () => {
  test("no install offer appears when the browser has not offered one", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".js-settings-open").first().click();
    await expect(page.locator("#settings-dialog")).toBeVisible();

    // Headless Chromium never fires beforeinstallprompt, so this is the
    // real "no offer" state: the app must stay quiet about installing.
    await expect(page.locator('[data-settings-action="install-app"]')).toHaveCount(0);
    await expect(page.locator("#settings-dialog")).not.toContainText(/Add to this device/);
  });

  test("an offered install is surfaced in settings and reports its outcome", async ({ page }) => {
    await mockAniList(page, standardSchedules(defaultEvents()));
    await page.goto("/");
    await page.locator(".card, .lead-panel").first().waitFor();

    // The browser's install criteria cannot be met in a headless run, so the
    // event is synthesised with the same shape Chromium uses. The module's
    // handling of it is covered separately in tests/unit/pwa.test.js.
    await page.evaluate(() => {
      window.__installCalls = 0;
      const event = new Event("beforeinstallprompt");
      event.prompt = () => {
        window.__installCalls += 1;
      };
      event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
      window.dispatchEvent(event);
    });

    await page.locator(".js-settings-open").first().click();
    const button = page.locator('[data-settings-action="install-app"]');
    await expect(button).toBeVisible();
    await expect(page.locator("#settings-dialog")).toContainText("Add to this device");

    await button.click();
    await expect(page.locator("#toast")).toContainText(/Installing Otaku Time/);
    await expect(page.locator("#settings-dialog")).toBeHidden();
    expect(await page.evaluate(() => window.__installCalls)).toBe(1);

    // The offer is spent: reopening settings must not show it again.
    await page.locator(".js-settings-open").first().click();
    await expect(page.locator("#settings-dialog")).toBeVisible();
    await expect(page.locator('[data-settings-action="install-app"]')).toHaveCount(0);
  });
});
