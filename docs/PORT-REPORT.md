# Port report — recreating the reference application

Reference: `DarkSpirit006/otaku-time-example` (React 19 + Tailwind 4 + Vite, single-file build)
Production: `DarkSpirit006/otaku-time` (vanilla JS, native CSS, ES modules, zero build)
Written: 2026-11-06 · Local branch state: `main`, nothing pushed

The reference was not consulted in the abstract. It was cloned to `refcheck/example`, built with
`npm ci && npm run build`, served statically, and driven in a real browser. Both applications were
then captured side by side under a **frozen clock** (`2026-11-06T09:37:00Z`), with **replayed
AniList responses** from a sha1-keyed cache so neither side could drift with live data. Those 24
PNGs are the evidence behind every claim below; they live in `visual-matrix/` outside the repo
(`<row>-ref.png` / `<row>-prod.png`).

**What was actually compared:** twelve rows — Upcoming dark/light at 1440, Watchlist dark/light at
1440, Recently aired dark/light at 1440, Upcoming/Watchlist/Recently aired dark at 360, Calendar
dark/light at 768, Detail sheet dark at 768. Every row was opened and read, not just generated.

---

## 1. Ported visuals

**Palette and type.** Ink `#0e0d0b / #14120f / #1a1814 / #ece6d8`, signal `#ff4526`, deep
`#d62f14`, gold `#d8ab3c`; paper `#f0ebdf / #e7e1d1 / #ddd6c2 / #1b1813`, `#c2321b`, `#7d4d00`.
Both themes are first-class. Syne for display, IBM Plex Mono for metadata, labels, counters,
timestamps and nav indexes, Inter for body — all three already self-hosted, so `font-src 'self'`
stays intact and no Google Fonts request was added.

**Surface treatment.** Hairline rules instead of shadows, small radii, editorial margins, film
grain over the page, faint background column rulers behind the main column, uppercase mono labels,
large expressive headings with the second word outlined, tabular numerals, restrained red accents,
gold only for status, and hover states that change a hairline or a colour rather than lifting a card.

**Shell.** A fixed 240 px rail: monogram wordmark, three numbered nav entries with a moving active
indicator and the watchlist count, the single search field, a live local clock with its time-zone
selector, theme toggle, shortcut help, and the "no accounts, no cookies, no tracks" note. Below
1024 px that becomes a compact sticky bar (wordmark, clock, search, theme, settings) plus a fixed
three-tab bar with safe-area padding. **Only one of the two is ever in the DOM's flow** — the sweep
asserts exactly one visible shell and never more than one reachable search field.

**The three sections.** Oversized split masthead with section number and editorial filing line; a
broadcast wire (thin ticker) that merges the next airings and the recent ones; a cinematic feature
plate with real AniList banner artwork, a scrim that ends on the page colour, the title, episode,
airing time and a segmented countdown; day groups with a day index, a large heading, date metadata,
a broadcast count, one lead panel and smaller cards; a dense watchlist register; a chronological
rundown grouped Today / Yesterday / Older history; and a print-dossier detail sheet.

**Detail sheet.** Artwork with the cover's dominant colour behind it, title and alt title, status
chips, countdown block with ICS export, actions, then personal controls, synopsis, an "on record"
fact grid (format, episodes, runtime, status, studio, start, end, source), genres, trailer,
synonyms and streaming links — each rendered **only when the field exists**. A title with no
end date shows no end row; it never prints a dash pretending to be data.

**Motion.** CSS keyframes for entrance stagger, the Web Animations API for progress bars and the
nav indicator, View Transitions where the browser supports them, a quiet cross-fade for theme
changes, and a dialog that scales in from its trigger. Everything collapses to a still frame under
`prefers-reduced-motion`; the sweep asserts no infinite animation keeps running and no title is
left stranded mid-fade.

## 2. Interaction patterns

- **Save** is one tap from any surface (feature plate, card, lead panel, rundown row) and reports
  through a polite status region; the nav count updates in place without repainting the view.
- **Progress** steps with − / +, and can be typed directly. Enter or blur commits; a number past
  the last episode is clamped and the field is corrected in place; when the ceiling came from
  AniList not having published a total yet, the toast says so.
- **Status** cycles through the five list states from the card or the dossier; the pill prints
  `Unset` rather than a lone em dash when nothing has been chosen.
- **Manual order** uses up/down controls with real labels ("Move X up"), so reordering works
  without a drag and without a pointer. The arrangement is stored data and survives reload; the
  sort *mode* deliberately does not persist, as before.
- **Undo on remove**, optimistic feedback everywhere, detail navigation, ICS export, calendar
  export, import/export, keyboard shortcuts, the command palette and the section history
  (back/forward walks it) all behave as they did.
- **Calendar** stays a secondary view of Upcoming — never a fourth section — with the week
  timetable on desktop and an agenda below 960 px, current-time marker, all/my-shows and
  format/genre filters, and clickable slots that open the dossier.

## 3. Preserved features

Everything the production app already did, now wearing the new surface: AniList GraphQL client with
cache, de-duplication, retries, rate-limit handling and cancellation; schedule pagination and
background refresh (loaded history is never collapsed by a refresh); search ranking merging local
pool hits with remote results; localStorage schema v1→v3 migrations, corruption handling, quota
handling, IndexedDB schedule snapshots; multi-tab sync; notifications and quiet hours; import /
export; undo; statuses, ratings, notes, reminders; progress caps; calendar and ICS; PWA install,
offline shell, deep links; the CSP and the privacy posture (no accounts, no backend, no trackers,
no analytics); and the zero-build static hosting model.

**Where the two applications disagreed, production won** — with two deliberate exceptions, both
argued from evidence:

1. **Watchlist stats.** The reference prints four cells. Production's fourth cell summed
   "episodes behind" across the shelf, which for three weekly shows produced `249` — a number that
   reads as fact and is not. The column now counts *shows* behind and says so. The other three
   cells match the reference (`Titles`, `Episodes logged`, `Time spent`, the last derived from
   watched × duration and printed as `2h 24m`).
2. **Calendar.** The reference shows a two-day agenda; production shows a seven-day timetable with
   filters and a now-marker, which is what the brief asks for. The timetable was kept at desktop
   width and the reference's agenda idea was adopted for narrow screens, where production's
   seven-column version had been unusable.

Three defects found *by* the comparison, each fixed with a failing test first:

- The schedule query never asked for `bannerImage` or `studios`, so every feature plate fell back
  to a cropped portrait cover and the meta line had a hole where the studio belonged.
- A stale `@media (max-width: 1180px)` rule split the feature plate into two columns; the copy got
  57 % of the panel and the countdown clipped to `T —` at 360 px, with the `HRS/MIN/SEC` labels
  switched off entirely.
- The recently-aired rundown hid its clock column below 900 px — a broadcast log that drops the
  broadcast time — and the calendar's "now" marker occupied a programme cell, pushing the first
  airing into the second column.

A fifth came from running the finished build against **live AniList data** rather than fixtures: a
shelf holding two long runners prints `458h 48m` as its time spent, and that figure wrapped onto a
second line beneath its own label. The stat cell is now a size container and the figure is capped
by the cell (`min(optical size, 12.5cqi)`), so an ordinary `2h 24m` keeps its full size while an
over-long figure steps down instead of breaking. Four figures also drop to two rows of two below
1100 px, where four cells in a 660 px column cannot hold them.

## 4. Implementation differences

| Reference | Production | Why |
| --- | --- | --- |
| React 19 + TypeScript | vanilla ES modules | brief constraint; no build step |
| Tailwind 4 | hand-written CSS with tokens | Tailwind needs a build; the app is served statically |
| Framer Motion | CSS keyframes + Web Animations + View Transitions | one dependency removed, same outcomes |
| Vite single-file bundle (479 kB) | unbundled modules, precached by the service worker | GH Pages serves files directly |
| Google Fonts | the three already self-hosted faces | CSP is `font-src 'self'`; a CDN font would be blocked |
| Client-side fetch straight to AniList | same endpoint, wrapped in the existing client with cache/retry/abort | reliability and offline behaviour |

Nothing in the reference's stack was copied in: no React, no Vite, no Tailwind, no TypeScript, no
Framer Motion, no component framework. The visual language was matched with the tools production
already had.

## 5. Tests actually run

Run in this session, on this machine, after the last change:

| Command | Result |
| --- | --- |
| `npm test` | **223 / 223 pass** |
| `playwright test` (full suite) | **194 / 194 pass** (3.9 min) |
| `npm run check:assets` | pass — every referenced asset exists and is precached |
| `npm run test:e2e -- tests/e2e/sweep.spec.js` | **41 / 41** (also part of the 194 above) |

Suite composition: unit 223 · `app.spec` 41 · `edge-cases.spec` 16 · `a11y.spec` 41 · `visual.spec`
32 · `offline.spec` 8 · `pagination.spec` 5 · `wire.spec` 10 · `sweep.spec` 41.

Every bug fixed this round landed with a **test that failed first** and was then made to pass: the
query fields, the feature-panel composition, the four-column stats, the rundown clock, the calendar
marker, the unread episode field, and the ledger figure that had to fit its cell. Two test-side defects were also found and fixed, both of
which had been hiding failures rather than causing them:

- `imagesSettled()` waited on every `<img>`, including lazy images inside a `display:none` subtree
  that the agenda hides — they never load, so the wait timed out on four calendar baselines that
  were in fact finished rendering.
- The new sweep's init script re-seeded localStorage on every navigation, so any "survives a
  reload" assertion was a tautology. It seeds once now.

## 6. Viewports and themes actually inspected

Rendered, opened and read — not just produced:

- **1440 × 900** — Upcoming, Watchlist, Recently aired, Calendar, Detail sheet, search, both
  themes.
- **768 × 1024** — Upcoming, Calendar (light and dark), Detail sheet, Watchlist.
- **390 × 844 / 360 × 780** — Upcoming, Watchlist, Recently aired, Calendar agenda, compact bar,
  tab bar, detail sheet, both themes.

Automated across the matrix (not eyeballed): `sweep.spec` checks all three sections at 360/768/1440
in both themes for horizontal overflow, console errors, CSP violations and shell exclusivity;
`a11y.spec` runs axe over every primary view and dialog in both themes at phone and desktop width
(zero serious or critical violations); `visual.spec` pins 32 screenshots.

## 7. Remaining differences and limitations

- **Calendar shape.** Desktop keeps production's seven-day timetable; the reference's two-day
  agenda informed the narrow-screen agenda but was not adopted at width. A deliberate divergence,
  argued in §3.
- **Sort mode resets.** The watchlist opens on "Recently added" every time; a manual arrangement
  survives as data but the mode does not persist. That is pre-existing production behaviour, kept
  rather than changed silently — it is the most likely thing a returning user would want
  different.
- **Empty calendar days** print "No airings" rather than a bare em dash, which differs from the
  reference's placeholder styling.
- **Ledger figures shrink to fit.** A genuinely extreme shelf (two 1000-episode runs) makes the
  time-spent figure step down to about 18 px at 360 px wide. It stays legible and on one line, but
  it is smaller than its neighbours — the alternative was a figure that wraps or overruns.
- **Screenshot regeneration** (`npm run screenshots`) needs network access to AniList; the
  committed screenshots were generated in session and are current for this build.
- **Browser support** is the production baseline, not the reference's: no View Transitions in
  Safari yet, so section changes fall back to a plain swap there. Reduced motion is honoured in
  every engine.
- **Nothing is pushed.** All work sits on the local `main`; the branch has never been force-pushed
  and no user commits were rewritten.
