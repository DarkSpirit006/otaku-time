# Otaku Time — final report

Repository: `DarkSpirit006/otaku-time` · HEAD `6119b4e` · working tree clean
Report written: 2026-11-06

---

## 1. Implemented

**Product.** Three primary sections, exactly as specified, and no fourth:

- **Upcoming** — release discovery. A cinematic "next episode" feature with a live
  countdown, a quiet strip of titles already aired today, then per-day groups that
  open with editorial lead panels before the lineup grid. The **Calendar** is a view
  inside Upcoming (7 days, local time zone, current-time marker, filter chips for my
  shows / format / genre, agenda layout on phones), never a separate section.
- **Watchlist** — a curated collection: personal status kept separate from AniList's
  airing status, episode progress with `+1` and direct entry (optimistic with
  rollback), behind-count that only appears when the total is trustworthy, sort by
  recent / updated / title / airing / progress / manual, filters for status, format,
  genre, progress, status grouping, drag-and-drop reordering that also works from the
  keyboard, and score + notes carried through export and import.
- **Recently aired** — a hierarchical rundown: today, yesterday, then the full loaded
  history, newest first.

**Around them:** live search over the local pool merged with AniList results
(synonyms, adult filter, stable `SEARCH_MATCH` order, local fuzzy top-up, `<mark>`
highlighting), a detail sheet (banner + dominant colour, synopsis, genres, studios,
dates, synonyms, trailer, validated streaming links), deep links (`#show/N`) with
correct Back/Forward and close-restores-route behaviour, a command palette,
`g u` / `g w` / `g r` / `j` / `k` / `Ctrl-K` / `?` / `Escape` shortcuts that never
fire inside a field, per-title reminders with honest copy, ICS export (single episode
and whole watchlist, `VALARM`, stable UIDs, escaping, TZ), a PWA (manifest, 192/512/
maskable/apple-touch icons, app-shell precache, offline fallback, "Update ready"
toast, never a forced reload), stale-while-revalidate artwork caching, IndexedDB
schedule snapshots with an honest staleness note, and a strict CSP.

**Architecture.** Vanilla HTML/CSS/ES modules; no framework, no build step; AniList
GraphQL as the only network destination; `localStorage` for watchlist (schema v3,
idempotent migrations) and prefs; IndexedDB for cache; `node:test` for unit tests;
Playwright for e2e; deployable to GitHub Pages under a subpath.

---

## 2. Verified

Everything below was executed, not assumed.

| Check | Result |
| --- | --- |
| Unit tests (`npm test`, `node:test`) | **178 / 178 passing** (the original 83 plus new suites for migrations, import/undo/cache, search ranking, schedule state machine, notifications, DST and midnight edges) |
| Playwright (`npx playwright test`) | **124 / 124 passing** — 29 app, 16 edge-case, 41 axe, 32 visual, 6 offline, plus regression specs |
| axe-core, every primary view and dialog, dark + light, 3 widths, zero serious/critical | **41 / 41 passing** |
| Visual regression, 3 sections × dark/light × 360/768/1440 + detail + search | **32 / 32**, baselines reviewed by eye; verified stable over **four consecutive runs** |
| Offline suite against the real service worker | **6 / 6** (cold start offline, manifest + icons, deep link after reload, unknown id, corrupt route, offline bar) |
| Lighthouse, mobile, 3 runs | **79–85 performance**, 100 accessibility, 100 best practices, 100 SEO, CLS 0 |
| Lighthouse, mobile (earlier quieter machine state, same build family) | **85 / 85 / 84** with TBT 90 / 70 / 100 ms |
| Artwork transfer, measured per device profile | desktop 1× **893 KiB** (was 2014), phone 2× **661 KiB** (was 3089), phone 3× 1270 KiB |
| axe contrast in the light theme | accent text `#a51f06` and gold `#7d4d00`, 5.5:1 and ~6.1:1 on their tinted chips |
| A/B of the phone feature layout, 5 cold-cache runs each | poster-first median LCP **3092 ms**, text-first **2992 ms** (see §6 and `docs/experiments/`) |

**Bugs found and fixed in this pass, each with a regression test that failed first:**

1. **The ticker destroyed card content.** The 1 s countdown tick wrote
   `textContent` on `.card__airing`, which held the exact air time as a child
   element. One second after load, "in 2h 0m 0s · Thu, Nov 5, 8:00 PM UTC" became
   "in 2h 0m 0s". The ticker now refuses to write over any element with children.
2. **"Aired earlier today" posters were 640×966 px.** The compact row declared four
   grid tracks for five children, so every child shifted one column left and the
   54 px thumbnail landed in the `1fr` track — larger than the feature above it.
3. **The feature's scrim never painted.** `.spotlight__poster::after` sat at
   `z-index: auto` under a poster image at `z-index: 1`, so the "Next episode"
   eyebrow was red text straight on artwork.
4. **The topbar search field was a form box, not an underline.** It inherited
   `input[type="search"]` from `components/forms.css` (border, surface, radius,
   `min-height: 40px` inside a 38 px row), overflowing its row on phones.
5. **The detail sheet clipped its own actions on phones.** "Add episode to calendar"
   punched past the dialog's right edge, unreachable because the sheet only scrolls
   vertically; long titles broke mid-word.
6. **Artwork was downloaded at the wrong size.** No `sizes` hint meant a 100 vw
   assumption, and the srcset descriptors understated what AniList actually serves
   (`large` → `/cover/medium/` ≈ 230 px, `extraLarge` → `/cover/large/` ≈ 660 px).
7. **Two test-infrastructure defects that hid the above:** fixtures were anchored to
   the real clock while the browser clock was frozen (baselines rotted across day
   boundaries), and `page.clock.install()` keeps ticking while pausing it freezes
   `requestAnimationFrame` and stops the page painting mid-render. The visual suite
   now pins `Date.now()` only, and waits on font + image decode rather than timeouts.

---

## 3. Assumed / not verified

- **GitHub Pages deployment and the Actions workflows were not run here.** No push,
  no `gh` access in this environment. The workflow files, action versions and the
  artifact-lookup mitigation are as last committed; the *actual* deploy result after
  these commits is unknown to me.
- **No repo description, topics, or homepage were set** — I have no authenticated
  access to the GitHub repository settings.
- **Real-device testing was not performed.** Everything ran in headless Chromium.
  Safari/Firefox behaviour (View Transitions fallback, `dvh`, IndexedDB quirks) is
  reasoned about, not measured.
- **Service-worker update flows on a real installed PWA** (iOS Add-to-Home-Screen
  refresh cadence, Android install prompt) are untested; only the web-side logic is
  covered by the offline suite.
- **Lighthouse desktop numbers were not re-measured after the last commits.** The
  mobile figures above are current; earlier desktop runs swung between 70 and 96 on
  this shared, noisy sandbox (the same CPU throttling that made mobile TBT jump from
  90 ms to 250 ms between runs with *fewer* long tasks). Treat single-run desktop
  scores as unreliable here.
- **`prefers-reduced-motion`, `prefers-color-scheme` and DPR** are emulated by
  Playwright, not observed on hardware.
- **The screenshot and GIF set is real**, generated by `npm run screenshots` against
  the live AniList API on this machine at HEAD `da1893d`.

---

## 4. Data safety

- **Nothing leaves the device.** Watchlist in `localStorage`
  (`otaku-time.watchlist.v1`, schema v3), prefs in `otaku-time.preferences.v1`,
  schedules in IndexedDB (`otaku-time.cache.v1`). Requests go straight from the
  browser to `graphql.anilist.co`; no analytics, cookies, accounts or backend.
- **Never overwrite what the user owns.** Metadata sync only refreshes AniList facts —
  `watched`, `listStatus`, `score`, `notes`, manual order and `createdAt` are never
  touched by a sync. `mediaStatus` (AniList's airing state) and `listStatus` (the
  user's status) are separate fields.
- **Corrupt data is preserved, not destroyed.** Unparseable storage is copied aside
  and reported rather than replaced; migrations are idempotent and tested per version.
- **Import is atomic and honest.** Every record is validated before anything is
  written, unknown fields are carried through rather than dropped, and a status is
  never invented for an entry that lacks one.
- **Destructive actions are undoable.** Import-replace and clear-cache offer a 6 s
  undo; removal from the watchlist offers undo; both restore the exact prior state.
- **Clear cache resets everything** it claims to: both schedule caches, the media
  pool, the IndexedDB store and in-memory state.
- **CSP:** `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, no
  `unsafe-inline`, no `unsafe-eval`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-src 'none'`. `frame-ancestors` **cannot** be expressed
  from a `<meta>` tag — a static host without custom headers cannot set it, and that
  limitation is documented rather than papered over.

---

## 5. Dependencies

Runtime: **none**. No framework, no bundler, no package shipped to the browser. Fonts
(self-hosted Syne, Inter, IBM Plex Mono `woff2`) and icons are in-repo.

Development only:

| Package | Version | Why |
| --- | --- | --- |
| `@playwright/test` | ^1.64.1 | e2e, visual regression, offline and deep-link coverage. MIT, the standard for this job. |
| `@axe-core/playwright` | ^4.14.0 | accessibility gate (41 scans, zero serious/critical). MPL-2.0, maintained by Deque. |

Both are `devDependencies`; `npm ci` installs them and the app still serves as plain
static files if you never run them. No other dependency was added in this pass, and
none was added for the build, the design or the tests.

---

## 6. Decisions and open items

Both decisions this report was waiting on are now made; what remains open needs
credentials or hardware, not judgement.

### Decided

**License — PolyForm Noncommercial 1.0.0.** Shipped as `LICENSE`, with
the `Required Notice` line the license mandates, a README section that says plainly
what is and is not permitted, and `package.json` pointing at the file rather than
guessing an SPDX id (there is no OSI SPDX identifier for this license).

Practical consequences worth keeping in mind: anyone may use, modify and share
Otaku Time for noncommercial purposes, including forks and noncommercial
open-source distributions; anyone passing a copy on must include the license text
and the notice line; commercial use requires separate terms. It is source-available,
not OSI open source — a distinction stated in the README so nobody assumes
MIT-style rights.

### Still open, none blocking

1. **Mobile performance against the ≥ 98 target is not met** — measured 79–85. The
   honest cause: TBT is 70–290 ms (i.e. not the bottleneck), CLS is 0, and 2.3–2.5 s
   of the 3.5–4.0 s LCP is *resource load delay* for the feature poster on AniList's
   CDN, third-party bytes this app cannot compress, subset or self-host. I reduced
   the downloadable artwork substantially (see §2) without moving this ceiling.

   **The alternative was built and measured, not argued about.** `?spotlight=text`
   reorders the phone feature text-first with the artwork as a strip underneath —
   same content, same DOM order, CSS `order` only. Over five cold-cache runs at 4×
   CPU throttle and 1.6 Mbps / 150 ms RTT, median LCP moved from **3092 ms to
   2992 ms**: 100 ms, or 3%, and the best Lighthouse run reached 80 performance with
   LCP 3.4 s. FCP is 2.2–2.3 s and is app shell, not artwork, so removing every
   image still leaves the score in the low-to-mid 80s. Reaching 98 means deleting the
   art — the thing the brief asked for. Full method, both screenshots and the
   numbers are in [`docs/experiments/spotlight-layout.md`](docs/experiments/spotlight-layout.md).
   **Decided: option 1 — ship variant A (poster-first) and document the ceiling.**
   The flag stays as a tested, supported escape hatch and the hook a future "data
   saver" setting would use. The decision, the options weighed and their costs are
   recorded in `docs/experiments/spotlight-layout.md`; switching the default later
   remains a one-line change plus regenerated baselines.
2. **Deploy verification** — pushing and watching the Pages run is the last unchecked
   step, and needs your credentials.
3. **Reminders when the app is closed** remain impossible in a static, account-less
   PWA. The UI says so and points at ICS export, which does work with the phone's
   calendar app.
4. **Repo metadata** (description, topics, homepage URL) if you want it set.
