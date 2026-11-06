# Experiment: phone feature layout, poster-first vs text-first

**Question.** The feature's poster is the Largest Contentful Paint element on
phones, and it comes from AniList's CDN — about 2.3–2.5 s of the LCP is
third-party resource delay. Does leading with the headline instead, and
demoting the artwork to a strip under it, buy enough to reach the ≥ 98
Lighthouse target?

**Answer: no. It buys one element and not enough time, and it costs the
composition that makes the section work.**

## How it was built

A switch, not a rewrite: `?spotlight=text` sets `data-spotlight="text"` on the
document element and a block in `css/responsive.css` (inside the ≤ 960 px
breakpoint) swaps the order and reflows the artwork into a 21:9 strip. The DOM
order is untouched — CSS `order` only — so reading order and tab order are
identical in both variants, and there is a test for that. With no parameter the
app behaves exactly as before.

Both screenshots are the same app, same session, same anime, 390×844 @2×:
[`spotlight-a-poster-first.png`](spotlight-a-poster-first.png) and
[`spotlight-b-text-first.png`](spotlight-b-text-first.png), side by side in
[`spotlight-comparison.png`](spotlight-comparison.png).

## Measurements

Cold cache, every run a fresh browser context, CPU throttled 4×, network
emulated at 150 ms RTT / 1.6 Mbps — five runs per variant:

| Variant | LCP runs (ms) | Median | LCP element |
| --- | --- | --- | --- |
| A — poster first (current) | 3092, 3348, 3004, 3064, 5372 | **3092** | `IMG.card__poster` |
| B — text first | 2980, 3004, 2900, 3028, 2992 | **2992** | `BUTTON.spotlight__title` |

100 ms, or 3%. And B's spread is tighter, which is the one real benefit: the
LCP element is now our own text, so it no longer depends on how fast
`s4.anilist.co` answers. Remove that variance and you remove the ability of a
slow CDN to make the page look slow — but you do not get 98.

Lighthouse, same build, two runs each (this sandbox is noisy: TBT for the same
build swung 170 → 380 ms between runs):

| Variant | Performance | FCP | LCP | a11y / BP / SEO |
| --- | --- | --- | --- | --- |
| A — poster first | 83, 76 | 2.3 s / 2.2 s | 4.0 s / 4.0 s | 100 / 100 / 100 |
| B — text first | 80, 77 | 2.2 s / 2.3 s | **3.4 s** / 3.9 s | 100 / 100 / 100 |

The best single run for B (3.4 s LCP, 80 performance) is the ceiling this
direction offers. Not 98.

## Why it cannot reach 98

FCP is 2.2–2.3 s and is not dominated by artwork — it is the app shell, and
that has already been optimised: no build step means no per-route bundles to
split, the CSS is 14 small files, fonts are self-hosted and subset. LCP sits
about a second after FCP in the best case and 1.7 s after it in the worst, so
even eliminating every image on the page leaves the score in the low-to-mid
80s.

The remaining lever is the one thing the brief explicitly wants: this is an
anime tracker, and the art is the product. Making the poster disappear or
defer below the fold to chase a number would be gaming the metric, not
improving the page.

## Decision — option 1: ship A, document the ceiling

Decided 2026-11-06. Variant A (poster-first) stays the default on every width.
The ≥ 98 mobile target is not met, and the reason is measured rather than
asserted: FCP is 2.2–2.3 s of app shell, so no arrangement of artwork moves the
score into the nineties, and the only way there is to remove the art the brief
asked for.

The flag stays, and it is not decorative: `?spotlight=text` is a tested,
supported layout for anyone whose connection makes CDN artwork the bottleneck,
and it is the hook a future "data saver" preference would use. A regression test
guards it — it must stay inert unless requested, must keep identical content,
and must not change DOM order for assistive technology.

### Options considered

| # | Option | Cost | Verdict |
| --- | --- | --- | --- |
| **1** | **Ship A, document the ceiling** | None; keeps the composition | **Chosen** |
| 2 | Make B the default on phones | 100 ms median LCP for stability when the CDN is slow; loses the opening image | Not chosen — the trade costs more design than it buys performance |
| 3 | Remove artwork from the phone feature | Closest to 98; deletes the art direction | Rejected — optimising the metric at the product's expense |

If a future measurement shows the CDN materially slower than it is today,
option 2 is a one-line default change plus regenerated baselines: the flag is
already built and tested.
