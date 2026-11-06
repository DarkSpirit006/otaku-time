# Otaku Time — final report

Repository: `DarkSpirit006/otaku-time` · HEAD `2fb047f` (local) · working tree clean
Report written: 2026-11-06 · Audit brief: code quality, static analysis and reliability

This pass did not redesign or reimplement anything. It audited the codebase against
its own claims, fixed what was broken, and measured the result. The distinction the
brief asks for — what was executed versus what was only reasoned about — is kept
throughout, and section 8 is deliberately blunt about the limits of a clean grade.

---

## 1. The audit source

CodeFactor, read from the live report with a real browser (the `/issues` page is an
Angular shell with no server-rendered data and there is no public JSON API — `curl`
returns markup, `api.codefactor.io` does not resolve, `/api/...` 404s).

| Property | Value |
| --- | --- |
| Overall grade | **A** |
| Total issues | **46** |
| Files analysed | 92 |
| Distribution | 1.1 % of files graded C, 5.4 % B, 93.5 % A |
| Hotspots | `js/app.js` (B), `css/components/cards.css` (C), `css/components/dialogs.css` (B), `css/layout.css` (B), `js/storage/watchlist.js` (B) |

**Staleness check, because a scan is only worth what its line numbers are worth.**
All 46 findings were matched against the working tree: `js/app.js:387` is
`updateSyncStatus`, `:749` is `onKeyDown`, `:1255` is `init`; `js/features/detail/index.js:362`
is `renderDetail`; `js/storage/watchlist.js:144` is `migrateItem`. The report
describes the code that was actually audited, not an older revision.

Issue mix: **21 complexity findings** (20 "Complex", 1 "Very Complex" —
`renderDetail` at 64) and **25 non-complexity findings** (18 duplicate CSS
selectors, 1 four-value `inset`, 3 unnecessary spreads, 2 empty-spread fallbacks,
1 erasing operation in a test).

---

## 2. Verified

Everything in this section was executed on this machine. Nothing is projected,
extrapolated from a different build, or copied from a previous report without saying so.

| Check | Result |
| --- | --- |
| Unit tests (`npm test`, `node:test`) | **205 / 205 passing** (was 178 before this pass) |
| Playwright (`npx playwright test`) | **133 / 133 passing** (was 124) — 31 app, 16 edge-case, 41 axe, 32 visual, 8 offline, 5 pagination |
| axe-core: every primary view and dialog, dark + light, three widths | **41 / 41**, zero serious or critical violations |
| Visual regression | **32 / 32**, and re-run twice more with identical results; all 32 baselines contain no `#FF00FF` artifacts (checked pixel by pixel) |
| Asset + precache integrity (`npm run check:assets`) | **42 modules** reachable from the entry points, **70** precache entries, **14** stylesheets — all present, all precached |
| CodeFactor | Grade A, 46 issues, 92 files (section 1) |

### 2.1 Bugs found and fixed in this pass

Each one has a regression test that was **demonstrated failing first**, then passing.

**a. The service worker deleted other applications' offline data.**
`activate` removed every cache on the origin whose name did not start with the
current version string. GitHub Pages serves every project from one host, so the
first Otaku Time visitor wiped the offline caches of any other app on it. It now
deletes only caches matching its own naming scheme (`otaku-time-v<n>-shell|art`)
and leaves everything else — including a cache belonging to a future build — alone.
*Test:* a `vm` harness runs the real `sw.js` with fake Cache Storage; a second
browser test seeds a foreign cache, re-registers the worker and proves the cache
and its contents survive while an old `otaku-time-v1-shell` is removed.

**b. Artwork was never cached, and the comment said it was.**
Poster `<img>` tags are cross-origin with no credentials, so the browser returns an
**opaque** response. Measured in Chromium against the live CDN: `type: "opaque"`,
`status: 0`, `ok: false`, `content-type: null`. The stale-while-revalidate helper
refused anything opaque, so `otaku-time-*-art` held **0 entries** after a full render.
Artwork now opts into opaque caching explicitly, same-origin assets still refuse it,
and the audit does not pretend opaque bodies are validated (see §5).
*Test:* the browser test loads real AniList posters, asserts the cache fills, goes
offline, reloads, and asserts a poster still decodes. Removing the one-word fix makes
it fail again — verified both directions.

**c. Recently aired presented a partial window as a total.**
The header read "8 episodes" while two more pages were pending. It now uses the same
rule as Upcoming — "8 loaded" until AniList confirms there is nothing after the last
page, then "8 loaded · full window" — and the footer's "end of history" line only
appears in that second state.
*Test:* five browser tests across both sections in both states, including that a bare
episode count never appears.

**d. `promptInstall()` was a stub that always said "unavailable".**
Nothing called it, so the app advertised an install path it did not have. The module
now captures `beforeinstallprompt` (suppressing the browser's competing mini-infobar),
exposes `canInstall()`, and resolves `promptInstall()` to
`accepted` / `dismissed` / `unavailable` from the real `userChoice`. The captured event
is single-use, so it is dropped before prompting; `appinstalled` clears it. Settings
renders the install group only when the browser has actually offered one.
*Test:* six unit tests through a fake window (no offer, accept, dismiss, replay,
throwing prompt, `appinstalled`) and two browser tests (no invented offer; an offered
install reaches the dialog and is not shown again afterwards).

**e. The search filter is sent — and now provably so.**
`isAdult: false` was already correct in `js/api/anilist.js`; the brief listed it as a
defect, and the audit finding was that nothing tested it. Rather than "fix" working
code, the gap is closed: one test asserts the variable goes out with the request,
another asserts the query document declares `$isAdult`. Removing either half fails the
suite — verified by temporarily deleting the variable.

**f. The test fixtures pointed at a 404.**
Every poster in every browser test used `.../cover/large/bx1.jpg`, which returns 404,
so 31 of 32 visual baselines encoded a broken image. Fixtures now use real CDN files
at their true sizes (≈13 / 54 / 158 KB), which also makes srcset selection and decode
testable. Baselines regenerated and reviewed. The desktop baselines additionally
contained a stale `#FF00FF` block over the clock — a diff-colour artifact, not app
pixels — now gone.

### 2.2 Static findings closed

All behaviour-neutral, and proved so rather than asserted:

- **17 duplicate selectors** merged at their original cascade position. Verified by the
  32 visual baselines passing **untouched** afterwards — not by regenerating them.
- **`inset: auto 0 0 0` → `auto 0 0`**, three unnecessary `[...set]` copies (with the
  invariant that makes them unnecessary written down), two `...(patch || {})` spreads
  replaced by a default parameter, and one `0 * 60 + 30` in a test.
- **`renderDetail` (complexity 64)**: the two blocks that are not rendering — which
  links are safe and streaming, which facts exist — moved to a pure module with
  8 unit tests. The dialog's markup is **byte-identical** before and after: 3898
  characters of `#detail-content` captured from a real dialog and diffed.

### 2.3 CI and delivery

- `check:assets` replaces the old `grep index.html` step. It walks the real import
  graph, every `url()` in every stylesheet, the manifest icons and the `SHELL` list,
  and cross-checks both directions. Three faults were injected deliberately (module
  dropped from `SHELL`, font renamed, bogus precache entry) and each fails with a
  precise message; it also caught a real omission during this pass (the newly created
  `facts.js`) before the module was precached.
- CI cost: ~150 ms, no browser, no network.
- Five commits, each self-contained and green: `65b1aa6`, `9ee720b`, `5cf9ea8`,
  `2fb047f`, plus the recovery checkpoint `17fa8b8`. No force-push, no history rewrite,
  no user changes overwritten.

### 2.4 Performance

Unchanged by this pass, and **not re-measured after it**. The numbers below were
measured on this build family earlier: mobile Lighthouse 79–85 performance with 100
accessibility / best-practices / SEO and CLS 0; the LCP element is the feature poster
served from AniList's CDN, ~2.3–2.5 s of which is third-party resource delay. The
poster-first versus text-first A/B (5 cold-cache runs each: 3092 ms versus 2992 ms
median) stands as recorded in `docs/experiments/spotlight-layout.md`. Single-run
Lighthouse numbers on this sandbox are noisy (83 → 76 on the same build), so nothing
here rests on one run.

---

## 3. Remaining — not done

### 3.1 Findings reviewed but deliberately not acted on

**Twenty other methods still exceed the complexity threshold.** The top of the list:
`onKeyDown` (35), `watchlist.js` progress update (32), `migrateItem` (33),
`notifications.check` (27), `card.js` lead panel (26), `schedule.js` loader (24),
`client.js` request (21), detail dialog click and change handlers (19/20), app `init`
(17). All are covered by behaviour, so splitting them is churn with regression risk
and no user-visible gain — the fourth-ranked category in this brief's own priority
order. `renderDetail` was the exception because a real seam existed. The next honest
step, if this is picked up: `onKeyDown` into a key→command map, and `migrateItem` into
one function per schema version, each with the same "capture the output, diff it"
verification used for `renderDetail`.

**`renderDetail` is smaller but still the largest function.** CodeFactor will not
re-score it, because it only scans pushed commits and nothing was pushed (below).

**The artwork cache cannot validate what it stores.** An opaque response exposes no
status and no headers, so a CDN error page returned as an image would be cached as if
it were art. The mitigation is bounded: the cache holds 220 entries, is keyed by URL,
and a fresh network response replaces an entry. Making this airtight would need a
`crossorigin` + CORS-enabled CDN, which AniList does not provide.

**First-visit artwork is not cached.** On a brand-new visit the worker claims the page
after the first posters have already been requested, so those few images bypass it
until the next navigation. Measured, and left as the honest behaviour; the test
reloads before asserting to reflect it.

### 3.2 Not performed

- **Nothing was pushed.** No credentials in this environment: no `gh`, no token. The
  commits exist locally only, so the remote `main`, the deployed Pages site and
  CodeFactor all still describe the previous code. **An improved grade would not be
  evidence of quality even if it appeared** — the fixes above are evidenced by tests
  and measurements, not by a scanner.
- **Repository metadata (description, topics, homepage) was not changed** — that needs
  authenticated repository settings access I do not have. Not invented, not guessed.
- **Lighthouse was not re-run after these commits.** The numbers in §2.4 predate them.
- **No real-device testing.** Everything ran in headless Chromium; Safari and Firefox
  behaviour (install prompt availability, `dvh`, IndexedDB quirks) is reasoned about,
  not measured. Notably, `beforeinstallprompt` does not exist in Firefox or Safari —
  the UI correctly stays silent there rather than offering a dead button.
- **The GitHub Actions workflows were not executed here.** The new `check:assets` step
  runs locally in ~150 ms; its behaviour inside a checkout with a clean `npm ci` is
  expected to be identical, but was not observed.

### 3.3 Known trap for whoever continues

`npx playwright test --update-snapshots` **does not rewrite a baseline that still
passes within `maxDiffPixelRatio`**. A stale image can therefore survive regeneration
and keep passing forever; that is how a `#FF00FF` diff artifact sat inside the desktop
baselines. Delete the file before regenerating when the image must reflect reality.

---

## 4. Data safety

- Nothing leaves the device. Watchlist in `localStorage`, preferences separately,
  schedule snapshots in IndexedDB, no account, no analytics, no third-party script.
- Migrations preserved: v1 → v2 → v3 on watchlist and preferences, with corruption and
  quota paths covered by unit tests.
- The only network destinations remain `graphql.anilist.co` (POST) and
  `s4.anilist.co` (images). The service worker intercepts nothing else — asserted in
  the new worker tests, not assumed.
- Import / export / undo unchanged and still covered end to end.

## 5. Dependencies

`@playwright/test` and `@axe-core/playwright`, both dev-only. No runtime dependency was
added in this pass; `check:assets` uses `node:fs` and `node:path`. The app remains
zero-build vanilla ES modules.

## 6. Decisions carried forward

- **License**: PolyForm Noncommercial 1.0.0, already in `LICENSE`. Not touched.
- **Poster-first layout** stays the default, with the measured ceiling documented and
  `?spotlight=text` as a tested escape hatch. Not revisited in this pass.
- **Three primary sections**, Calendar as a view inside Upcoming. Unchanged.
