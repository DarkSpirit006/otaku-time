# Visual reference checklist — Broadcast Almanac

Derived by reading `otaku-time-example` (`src/App.tsx`, `src/index.css`,
`src/components/{shell,cards,DetailSheet,palette}.tsx`, `src/views/{Upcoming,Watchlist,Recent}.tsx`,
`src/lib/*`) **and** by running the example (`vite build` + `vite preview` on `:4180`) and
inspecting it in Chromium at 360 × 800, 768 × 1024 and 1440 × 900 in both themes.

Screenshots taken for study (30 files): Upcoming / Watchlist / Recently aired at three widths in
both themes, plus Calendar and the detail dossier at all three widths.

This list is the acceptance sheet for the port. Production keeps its own functionality, data model
and architecture; everything below is about the *surface*: identity, composition, type, motion.

---

## 1. Identity

| # | Property | Reference | Production today |
|---|---|---|---|
| 1.1 | Ink paper | `#0e0d0b`, steps `#14120f`, `#1a1814` | `#08080a` neutral black |
| 1.2 | Ink text | `#ece6d8`, dim α.58, faint α.34 | `#f4f1e9` |
| 1.3 | Signal | `#ff4526`, deep `#d62f14`, text-tier `#ff6a4d`, gold `#d8ab3c` | `#ff3b1f`, gold `#ffb020` |
| 1.4 | Paper theme | `#f0ebdf`, `#e7e1d1`, `#ddd6c2`, text `#1b1813`, accent `#c2321b`, gold `#7d4d00` | `#f1ede4`, accent `#c42609`, gold `#a86a00` |
| 1.5 | Hairlines | α.14 normal / α.32 strong; paper α.16 / α.38 | similar, but on a cooler base |
| 1.6 | Film grain | SVG turbulence overlay α.05 ink / α.07 paper, `pointer-events:none` | present, inherited from earlier brief |
| 1.7 | Column rulers | 4 faint vertical rules across the main column, behind content | present but very low contrast |
| 1.8 | Radii | 0 for boxes/chips/inputs, 2 px maximum | 2/3/4 px |
| 1.9 | Shadows | none; depth comes from hairlines and tone | soft shadows on cards/dialogs |

## 2. Type

| # | Property | Reference |
|---|---|---|
| 2.1 | Display | Syne 700/800, tracking −.02em to −.03em, `leading: .9` |
| 2.2 | Body | Inter, 0.9–1rem, α.58–.66 dim |
| 2.3 | Mono | IBM Plex Mono 400/500, `.625rem`, `letter-spacing .14em`, uppercase — every label, counter, timestamp, nav index |
| 2.4 | Numbers | tabular everywhere (`font-variant-numeric: tabular-nums`) |
| 2.5 | Outline display | `.h-outline` = transparent fill + `-webkit-text-stroke: 1.5px` line-strong |
| 2.6 | Masthead | `clamp(2.6rem, 7vw, 5.5rem)`, weight 800, uppercase, one word solid + rest outlined |
| 2.7 | Section head | `SEC.0n / metadata sentence` in mono under the h1, hairline below |
| 2.8 | Sub-headings | `clamp(1.5rem, 3.4vw, 2.3rem)` extrabold uppercase |

## 3. Shell

| # | Element | Reference |
|---|---|---|
| 3.1 | Left rail | fixed 240 px, hairline right edge, only ≥1024 px; content column offset by exactly 240 px |
| 3.2 | Wordmark | 44 px bordered box with "OT" + two-line `OTAKU / TIME` display + `BROADCAST ALMANAC` micro |
| 3.3 | Nav | `INDEX` label, three numbered rows `01/02/03` + uppercase display label, active row has a 2 px accent left bar, saved count badge on Watchlist |
| 3.4 | Search | full-width bordered row `SEARCH THE ALMANAC` + `⌘K` key badge inside the rail |
| 3.5 | Clock block | `LOCAL TIME — UTC` label, live `HH:MM:SS` in 1.5 rem mono, timezone `<select>` below |
| 3.6 | Controls | theme toggle button with label (`PAPER THEME`) + keyboard-help square button |
| 3.7 | Footer | `LOCAL-FIRST — DATA FROM ANILIST.CO · NO ACCOUNTS · NO COOKIES · NO TRACKS` mono, α.34 |
| 3.8 | Mobile top bar | <1024 px only: OT box, `HH:MM`, search square, theme button; sticky, hairline bottom |
| 3.9 | Mobile tab bar | fixed bottom, 3 tabs with icon + uppercase mono label, moving indicator bar, `env(safe-area-inset-bottom)` padding |
| 3.10 | Never both | rail and mobile chrome are mutually exclusive via `display:none`; each control appears exactly once per breakpoint |
| 3.11 | Colophon | footer wordmark in outline display + mono line `VOL. 2026 — ISSUE XX · SCHEDULE DATA — ANILIST.CO · YOUR DATA NEVER LEAVES THIS BROWSER` |

## 4. Ticker

| # | Property | Reference |
|---|---|---|
| 4.1 | Shape | thin strip directly under the shell top, `WIRE` label in a bordered cell, marquee to the right |
| 4.2 | Content | `NEXT — <title> EP nn IN 01H 54M` and `ON RECORD — <title> EP nn, 19M AGO`, uppercase mono, `·` separated |
| 4.3 | Motion | 36 s linear loop, pauses on hover/focus, `prefers-reduced-motion` → static block |
| 4.4 | A11y | marquee `aria-hidden`, one `.sr-only` summary that is *not* re-announced on a timer |

## 5. Upcoming

| # | Element | Reference |
|---|---|---|
| 5.1 | Masthead | `UP` solid + `COMING` outlined, right side `125 BROADCASTS TRACKED` + segmented `LINEUP / CALENDAR` view control |
| 5.2 | Metadata line | `SEC.01 / SEVEN DAYS FORWARD · WEEK 45 · SYSTEM ZONE` |
| 5.3 | Lead label row | `THE NEXT EPISODE ANYWHERE` left, `LIVE COUNTDOWN` right, both micro |
| 5.4 | Feature | full-width panel, `min-height 24rem` (27rem ≥640), artwork α≈.45 with top gradient to paper and radial glow from the dominant cover colour, vertical `ALMANAC — LIVE FEED` rail on the right edge, chip `● NEXT BROADCAST` + date, segmented countdown `T— 02: 00: 32` at `clamp(2.2rem,6vw,4rem)`, title at `clamp(2.6rem…)`, metadata line, two actions (`OPEN DOSSIER ↗` primary bordered-tint, `+ SAVE` secondary) |
| 5.5 | Aired strip | `ALREADY AIRED TODAY — QUIET FILE` label + count, horizontal row of 176 px compact cards (44 × 59 cover, title, `EP nn · nh AGO`) |
| 5.6 | Day groups | `border-top 2px` rule, `D01` index, `clamp(1.5,3.4vw,2.3)` heading, date line, `N BROADCASTS` count on the right |
| 5.7 | Composition | first item of each day = wide **lead panel** (banner art, gradient to paper, title + meta + countdown), remaining items are smaller stacked cards in 1/2/3 columns — never an identical uniform grid |
| 5.8 | Calendar subview | 7-day timetable, same slot as the line-up (not a fourth section), day columns with hairline separators, `TODAY` column in accent, `HH:MM` mono times, clickable rows, `ALL SHOWS / MY SHOWS` toggle, `FORMAT` and `GENRE` selects, current-time indicator |

## 6. Watchlist

| # | Element | Reference |
|---|---|---|
| 6.1 | Masthead | `WATCH` solid + `LIST` outlined, `SEC.02 / N TITLES ON RECORD · STORED IN THIS BROWSER ONLY`, `+ ADD TITLES` action |
| 6.2 | Empty | dashed hairline panel, small bordered icon, display heading, mono body, two bordered actions |
| 6.3 | Stats | 4-cell strip divided by hairlines: TITLES / EPISODES LOGGED / TIME SPENT / BEHIND SCHEDULE, values in 2xl display |
| 6.4 | Rows | one hairline-separated list, columns: index + drag handle · 44 px cover · title + metadata · status · stepper · next airing · actions; `border-left 2px gold` when behind |
| 6.5 | Density | 12 px vertical padding, 0 gaps between rows, hover only lifts the hairline to line-strong |
| 6.6 | Mobile | two-line stack (cover + title + actions, then status/stepper/next), no horizontal scroll |

## 7. Recently aired

| # | Element | Reference |
|---|---|---|
| 7.1 | Masthead | `RECENT` solid + `AIRED` outlined (wraps to two lines at 1440) |
| 7.2 | Groups | `R.01 TODAY <date>`, `R.02 YESTERDAY`, `R.03 THE ANNALS`; earlier days get sticky mono day headers with counts |
| 7.3 | Today/Yesterday | 3-column cards: 64 px cover, `FORMAT · YEAR` micro, gold rating, title display, native title mono, `FRI NOV 06, 09:55 · EP 156 · 4M AGO` |
| 7.4 | Annals | dense single-line rows: `HH:MM · title · FORMAT · EP nn` + relative time + compact save |

## 8. Detail dossier

| # | Element | Reference |
|---|---|---|
| 8.1 | Frame | right-hand sheet, `max-width 36rem`, hairline left edge, sticky `FILE #id — DOSSIER` header + square close |
| 8.2 | Banner | banner art, gradient to paper, title display over it, 2 px dominant-colour rule under |
| 8.3 | Titles | native/synonym line in mono micro |
| 8.4 | Chips | bordered mono chips: format, release status (accent when airing), episodes, season, score with gold star |
| 8.5 | Countdown | accent-tinted panel: `NEXT EPISODE — EP nn`, `ADD .ICS`, big `IN 01H 57M`, absolute date |
| 8.6 | Actions | full-width `+ SAVE TO WATCHLIST`; personal controls once saved |
| 8.7 | Sections | `SYNOPSIS` with read-more, `ON RECORD` 3-column fact grid (format/status/studio/…), only fields that exist |
| 8.8 | Mobile | full-screen sheet, same header |

## 9. Motion

| # | Property | Reference |
|---|---|---|
| 9.1 | Entrance | opacity 0→1 + y 18→0, 0.6 s `cubic-bezier(.22,.9,.24,1)`, stagger `min(i × .045s, .5s)` |
| 9.2 | Scope | section heads, lead panel, card grids, list rows (once, on view) |
| 9.3 | Transitions | View Transitions API 240 ms for section switches and theme change |
| 9.4 | Reduced motion | every animation off, no marquee, no stagger |

---

## Production decisions (where production wins)

1. **Palette values change; token *names* stay** (`--paper`, `--text`, `--accent`, `--border`…).
   4 200 lines of CSS and every component already speak those names, and swapping names would be a
   cosmetic refactor with no behavioural gain. New names are added only where the reference needs a
   semantic production lacks (`--paper-2/3` already exist as `--paper-2`, `--surface-*`).
2. **Contrast is re-derived, not copied.** The reference's α.34/α.58 text tiers fail 4.5:1 for small
   mono labels on paper. Production keeps its measured `--text-dim`/`--text-faint` ramp, applied to
   the new hues, and the accent-text tiers stay tuned (`--accent-text`, `--gold-text`) so chips clear
   WCAG AA. Colour tokens are *hues* from the reference; *alpha* is production's, because production
   has axe scans in CI and the example does not.
3. **Reference bugs are not ported:** the reference clips its masthead and calendar horizontally at
   768/360 (`scrollWidth > clientWidth`, verified: programmatic click on `CALENDAR` scrolled the
   document sideways). Production clamps the masthead and fits the calendar, and a regression test
   asserts `scrollWidth === clientWidth` at 360/768/1440.
4. **Calendar gets a real narrow layout.** At <900 px the 7-column timetable becomes a day selector +
   vertical day list; a horizontally scrolling grid would either overflow or need a focusable scroll
   region. Production's schedule, pagination, timezone and click targets are preserved.
5. **Production-only affordances stay** — settings/import/export, refresh, notification prefs,
   offline banner, sync status — but re-skinned into the rail's mono/button language and rendered
   once per breakpoint.
6. **No new dependencies.** Syne/Inter/Plex Mono are already self-hosted (`css/variables.css`,
   `assets/fonts/`), matching the reference's trio; no Google Fonts, no Tailwind, no Framer Motion.
   Motion is CSS keyframes + Web Animations + View Transitions, exactly as production already does.
7. **Interaction details are kept from production** where they are more reliable: real `<dialog>`
   element with focus trap, undo-on-remove, optimistic progress updates with rollback, ICS export,
   manual reorder with keyboard arrows.
