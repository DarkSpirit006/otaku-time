/* ============================================================
   Otaku Time — media card HTML builders

   All art is tinted with the colour AniList reports for the
   cover, bucketed into twelve CSS classes (no inline styles, so
   the strict CSP holds). Posters blur up from their own colour
   while they decode, inside a fixed aspect-ratio box.
   ============================================================ */

import { esc } from "../utils/dom.js";
import { titleOf, formatLabel } from "../utils/format.js";
import { countdown, airingTime, shortTime } from "../utils/time.js";
import { watchlist, progressCap } from "../storage/watchlist.js";
import { highlightText } from "../utils/search-rank.js";
import { airingState, episodesBehind, canComplete } from "../utils/media-state.js";
import { icon } from "./icons.js";

/* ------------------------------------------------------------
   Colour + art helpers
   ------------------------------------------------------------ */

function hueOf(hex) {
  const value = String(hex || "").replace("#", "");
  if (value.length === 3) {
    const [r, g, b] = value.split("").map((c) => parseInt(c + c, 16) / 255);
    return hueFromRgb(r, g, b);
  }
  if (value.length !== 6) return null;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return null;
  return hueFromRgb(r, g, b);
}

function hueFromRgb(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 11; // neutral
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return Math.floor(hue / 30) % 12;
}

/** Deterministic tint class for a media object. */
export function tintClass(media) {
  const hue = hueOf(media?.coverImage?.color);
  if (hue === null) {
    const id = Number(media?.id) || 0;
    return `tint-h${id % 12}`;
  }
  return `tint-h${hue}`;
}

/** Escape + wrap matched substrings in <mark> (search highlighting). */
export function highlight(text, query) {
  return highlightText(text, query);
}

function posterUrl(media) {
  return (
    media.coverImage?.large ||
    media.coverImage?.extraLarge ||
    media.coverImage?.medium ||
    null
  );
}

/**
 * Small-to-large candidates, so a phone never downloads a 662px-wide cover
 * for a 158px thumbnail.
 *
 * AniList's field names sit one step below the folders they point at, which
 * is worth writing down: `medium` → /cover/small/ (~100px), `large` →
 * /cover/medium/ (~230px), `extraLarge` → /cover/large/ (~660px). Measured,
 * not assumed. The descriptors have to describe the file, not the field, or
 * the browser escalates to the biggest one for every slot.
 */
function posterSrcset(media) {
  const { medium, large, extraLarge } = media.coverImage || {};
  const pairs = [
    [medium, 100],
    [large, 230],
    [extraLarge, 660],
  ].filter(([url]) => typeof url === "string" && url);
  if (pairs.length < 2) return "";
  return `srcset="${pairs.map(([url, w]) => `${esc(url)} ${w}w`).join(", ")}"`;
}

/* Rendered widths, measured at every breakpoint. Without `sizes` the
   browser assumes 100vw and always downloads the largest candidate, so a
   158px phone thumbnail pulled the 1000px source: ~3 MB of artwork on
   first paint. */
const CARD_SIZES =
  "(max-width: 420px) 45vw, (max-width: 640px) 30vw, (max-width: 1180px) 31vw, 15vw";
const LEAD_SIZES =
  "(max-width: 640px) 27vw, (max-width: 1180px) 13vw, 7vw";

function posterMarkup(media, { eager = false, sizes = "" } = {}) {
  const url = posterUrl(media);
  const title = titleOf(media);
  const loading = eager ? "eager" : "lazy";
  const img = url
    ? `<img class="card__poster" src="${esc(url)}" ${posterSrcset(media)} alt="${esc(title)} poster"
         width="320" height="457" loading="${loading}" decoding="async" data-blur-up
         ${sizes ? `sizes="${esc(sizes)}"` : ""} />`
    : "";
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
  return `${img}
    <div class="card__poster-fallback" ${url ? "hidden" : ""} aria-hidden="true">
      <span class="card__poster-monogram">${esc(initials)}</span>
      <span class="card__poster-title">${esc(title)}</span>
    </div>`;
}

function scoreBadge(media) {
  if (!Number.isInteger(media.averageScore) || media.averageScore <= 0) return "";
  return `<span class="badge badge--score">${media.averageScore}%</span>`;
}

function saveButton(media, extraClass = "") {
  const saved = watchlist.has(media.id);
  const title = titleOf(media);
  return `<button class="save-btn ${saved ? "is-saved" : ""} ${extraClass}" data-action="save" data-id="${media.id}"
      aria-pressed="${saved}" aria-label="${saved ? `Remove ${esc(title)} from watchlist` : `Save ${esc(title)} to watchlist`}">
      ${icon("check")}
    </button>`;
}

/** Small "rescheduled" marker driven by the stored schedule change. */
function scheduleChangeBadge(id) {
  const item = watchlist.find(id);
  const change = item?.scheduleChange;
  if (!change || !Number.isFinite(change.to)) return "";
  const moved = change.to > change.from ? "Delayed" : "Moved earlier";
  return `<span class="badge badge--change" title="Airing time changed">${moved}</span>`;
}

/* ------------------------------------------------------------
   Schedule card
   ------------------------------------------------------------ */

/**
 * @param {{media:object, episode?:number, airingAt?:number, id?:number}} entry
 * @param {{timezone:string, hour12:boolean}} prefs
 */
export function eventCard(entry, prefs, opts = {}) {
  const media = entry.media;
  const title = titleOf(media);
  const query = opts.query || "";
  const nowSeconds = Date.now() / 1000;

  const episodeBadge = Number.isInteger(entry.episode)
    ? `<span class="card__ep">EP ${entry.episode}</span>`
    : "";

  let airingEpoch = null;
  let airingText = "";
  if (Number.isFinite(entry.airingAt)) {
    airingEpoch = entry.airingAt;
    airingText = countdown(entry.airingAt, media.duration, nowSeconds);
  } else if (Number.isFinite(media.nextAiringEpisode?.airingAt)) {
    airingEpoch = media.nextAiringEpisode.airingAt;
    airingText = countdown(airingEpoch, media.duration, nowSeconds);
  } else {
    airingText = airingState(
      { mediaStatus: media.status, nextAiringEpisode: null },
      nowSeconds
    ).text || "Schedule unavailable";
  }

  const past = airingEpoch !== null && airingEpoch < nowSeconds;
  const titleHtml = query ? highlightText(title, query) : esc(title);
  const timeFull = airingEpoch !== null ? airingTime(airingEpoch, prefs.timezone, prefs.hour12) : "";
  const synonym =
    query &&
    media.synonyms?.find((value) => highlightText(value, query).includes("<mark>")) || "";

  return `<article class="card ${tintClass(media)}" data-eid="e${entry.id ?? `x${media.id}`}">
    <button class="card__open" data-action="detail" data-id="${media.id}" aria-label="Details for ${esc(title)}"></button>
    <div class="card__poster-wrap">
      ${posterMarkup(media, { sizes: CARD_SIZES })}
      ${episodeBadge}
      ${saveButton(media, "card__save")}
    </div>
    <div class="card__body">
      <div class="card__topline">
        <span>${esc(formatLabel(media.format))}</span>
        ${scoreBadge(media)}
      </div>
      <span class="card__title">${titleHtml}</span>
      ${synonym ? `<span class="card__synonym">= ${esc(synonym)}</span>` : ""}
      <span class="card__airing${past ? " is-past" : ""}">
        <span class="card__countdown" ${
          airingEpoch !== null
            ? `data-countdown data-epoch="${airingEpoch}" data-duration="${media.duration ?? 0}"`
            : ""
        }>${esc(airingText)}</span>${timeFull ? `<span class="card__time"> · ${esc(timeFull)}</span>` : ""}
      </span>
    </div>
  </article>`;
}

/* ------------------------------------------------------------
   Watchlist card (v2)
   ------------------------------------------------------------ */

function segmentMeter(watched, total) {
  const cells = 12;
  const filled =
    total !== null && total > 0
      ? Math.min(cells, Math.round((watched / total) * cells))
      : Math.min(cells, watched);
  const label =
    total !== null ? `${watched} of ${total} episodes watched` : `${watched} episodes watched`;
  const marks = Array.from(
    { length: cells },
    (_, index) => `<span class="segment${index < filled ? " is-on" : ""}"></span>`
  ).join("");
  return `<span class="segments" role="img" aria-label="${esc(label)}">${marks}</span>`;
}

function statusPill(item) {
  const status = item.listStatus;
  if (!status) return "";
  const auto = item.statusSource !== "user" ? " is-auto" : "";
  return `<span class="status-pill status-pill--${status}${auto}">${esc(
    status === "onhold" ? "On hold" : status.charAt(0).toUpperCase() + status.slice(1)
  )}</span>`;
}

/**
 * @param {object} item watchlist item
 * @param {{timezone:string, hour12:boolean}} prefs
 */
export function watchlistCard(item, prefs) {
  const title = item.title?.english || item.title?.romaji || item.title?.native || "Untitled anime";
  const { cap: total } = progressCap(item);
  const watched = Number.isInteger(item.watched) ? item.watched : 0;
  const complete = total !== null && watched >= total;
  const nowSeconds = Date.now() / 1000;
  const airing = airingState(item, nowSeconds);
  const behind = episodesBehind(item, nowSeconds);
  const done = canComplete(item) && complete;
  const score = Number.isInteger(item.score) ? item.score : null;
  const nextEpisode = Number.isInteger(item.nextAiringEpisode?.episode)
    ? item.nextAiringEpisode.episode
    : null;

  const airingLine =
    airing.kind === "countdown"
      ? `<span class="card__airing" data-countdown data-epoch="${airing.epoch}" data-duration="0"
           data-prefix="${nextEpisode ? `Next ep ${nextEpisode} ` : "Next "}"></span>`
      : airing.text
        ? `<span class="card__airing is-${airing.kind}">${esc(airing.text)}</span>`
        : "";

  const badge = complete
    ? "DONE"
    : watched > 0
      ? `EP ${watched + 1}`
      : behind !== null && behind > 0
        ? `${behind} NEW`
        : "NEW";

  // `is-tracked` means "in progress" (matches the stats above the grid);
  // `card--saved` marks every library card, which is what gestures bind to.
  const inProgress = item.listStatus === "watching" || item.listStatus === "onhold";
  return `<article class="card card--saved ${tintClass(item)}${inProgress ? " is-tracked" : ""}${complete ? " is-complete" : ""}"
      data-eid="w${item.id}" data-id="${item.id}">
    <button class="card__open" data-action="detail" data-id="${item.id}" aria-label="Details for ${esc(title)}"></button>
    <div class="card__poster-wrap">
      ${posterMarkup(item, { sizes: CARD_SIZES })}
      <span class="card__ep">${badge}</span>
      ${saveButton(item, "card__save")}
      ${scheduleChangeBadge(item.id)}
    </div>
    <div class="card__body">
      <div class="card__topline">
        <span>${esc(formatLabel(item.format))}</span>
        ${statusPill(item)}
        ${score !== null ? `<span class="badge badge--score">${score}</span>` : ""}
      </div>
      <span class="card__title">${esc(title)}</span>
      ${airingLine}
      ${behind !== null && behind > 0 && !complete ? `<span class="card__behind">${behind} episode${behind === 1 ? "" : "s"} behind</span>` : ""}
      <div class="card__progress">
        ${segmentMeter(watched, total)}
        <span class="card__progress-text${complete ? " is-complete" : ""}">
          <span>${total !== null ? `${watched}/${total}` : watched}</span>
        </span>
      </div>
      <div class="card__controls" data-controls>
        <button class="step-btn" data-action="step" data-delta="-1" data-id="${item.id}"
          aria-label="Decrease watched episodes for ${esc(title)}" ${watched <= 0 ? "disabled" : ""}>
          ${icon("minus")}
        </button>
        <button class="step-btn step-btn--plus" data-action="step" data-delta="1" data-id="${item.id}"
          aria-label="Increase watched episodes for ${esc(title)}" ${complete ? "disabled" : ""}>
          ${icon("plus")}
        </button>
        <label class="sr-only" for="progress-${item.id}">Episodes watched for ${esc(title)}</label>
        <input class="number-input card__number" id="progress-${item.id}" data-progress-input data-id="${item.id}"
          type="number" inputmode="numeric" min="0" ${total !== null ? `max="${total}"` : ""} value="${watched}" />
        ${done ? `<span class="badge badge--ok">Complete</span>` : ""}
      </div>
    </div>
  </article>`;
}

/* ------------------------------------------------------------
   Timeline row (Recently aired)
   ------------------------------------------------------------ */

export function timelineRow(entry, prefs, { index = null, lede = false } = {}) {
  const media = entry.media;
  const title = titleOf(media);
  const nowSeconds = Date.now() / 1000;
  const agoSeconds = nowSeconds - entry.airingAt;
  const url = media.coverImage?.medium || media.coverImage?.large;
  const fullTime = airingTime(entry.airingAt, prefs.timezone, prefs.hour12);
  const clock = Number.isFinite(entry.airingAt)
    ? shortTime(new Date(entry.airingAt * 1000), prefs.timezone, prefs.hour12)
    : "TBA";

  // A failed poster just shows the tinted plate; the row never breaks.
  const plate = `<div class="row__plate" aria-hidden="true">
      <span>${esc(title.slice(0, 1))}</span>
    </div>`;
  const image = url
    ? `<img src="${esc(url)}" alt="" width="54" height="81" loading="lazy" decoding="async" data-blur-up />`
    : "";

  return `<article class="row ${lede ? "row--lede " : ""}${tintClass(media)}" data-eid="e${
    entry.id ?? `x${media.id}`
  }">
    <p class="row__clock" aria-label="Aired at ${esc(fullTime)}">
      <time datetime="${new Date(entry.airingAt * 1000).toISOString()}">${esc(clock)}</time>
    </p>
    <div class="row__poster">
      ${plate}
      ${image}
      <button class="row__open" data-action="detail" data-id="${media.id}" aria-label="Details for ${esc(title)}"></button>
    </div>
    <div class="row__body">
      <button class="row__title" data-action="detail" data-id="${media.id}">${esc(title)}</button>
      <p class="row__meta">
        <span class="row__ep">Episode ${esc(String(entry.episode ?? "?"))}</span>
        ${Number.isInteger(media.averageScore) && media.averageScore > 0 ? `<span aria-hidden="true">·</span><span>${media.averageScore}%</span>` : ""}
        ${media.format ? `<span aria-hidden="true">·</span><span>${esc(formatLabel(media.format))}</span>` : ""}
      </p>
    </div>
    <p class="row__ago ${agoSeconds >= 0 && agoSeconds < 3600 ? "is-recent" : ""}" data-countdown data-epoch="${
      entry.airingAt
    }" data-duration="${media.duration ?? 0}">
      ${esc(countdown(entry.airingAt, media.duration, nowSeconds))}
    </p>
    <div class="row__actions">
      ${saveButton(media)}
    </div>
  </article>`;
}

/* ------------------------------------------------------------
   Editorial lead strip
   ------------------------------------------------------------ */

export function leadStrip(entries, prefs) {
  const items = entries
    .map((entry, index) => {
      const media = entry.media;
      const title = titleOf(media);
      const nowSeconds = Date.now() / 1000;
      const timeText = countdown(entry.airingAt, media.duration, nowSeconds);
      const fullTime = airingTime(entry.airingAt, prefs.timezone, prefs.hour12);
      const number = String(index + 1).padStart(2, "0");

      return `<article class="lead-panel ${tintClass(media)}" data-eid="e${entry.id ?? `x${media.id}`}">
        <button class="lead-panel__open" data-action="detail" data-id="${media.id}" aria-label="Details for ${esc(title)}"></button>
        <div class="lead-panel__media">
          ${posterMarkup(media, { sizes: LEAD_SIZES })}
          <span class="lead-panel__index">${number}</span>
          ${saveButton(media, "lead-panel__save")}
        </div>
        <div class="lead-panel__body">
          <p class="lead-panel__meta">
            <span class="lead-panel__ep">Ep ${entry.episode}</span>
            <span>${esc(formatLabel(media.format))}</span>
            ${Number.isInteger(media.averageScore) && media.averageScore > 0 ? `<span>${media.averageScore}%</span>` : ""}
            ${scheduleChangeBadge(media.id)}
          </p>
          <h3 class="lead-panel__title">${esc(title)}</h3>
          <p class="lead-panel__time">
            <span data-countdown data-epoch="${entry.airingAt}" data-duration="${media.duration ?? 0}">${esc(timeText)}</span>
            <span class="lead-panel__clock">${esc(fullTime)}</span>
          </p>
        </div>
      </article>`;
    })
    .join("");

  return `<div class="lead-strip${entries.length > 1 ? " lead-strip--multi" : ""}">${items}</div>`;
}

/** Day-group section (Upcoming + Recently aired share the head styles). */
export function dayGroup({ key, label, relative = "", count = 0, content, partial = false }) {
  return `<section class="day-group${partial ? " is-partial" : ""}" data-day="${esc(key)}">
    <header class="day-group__head">
      <h3 class="day-group__label">${esc(label)}${
        relative ? ` <span class="day-group__relative">· ${esc(relative)}</span>` : ""
      }</h3>
      <span class="day-group__rule" aria-hidden="true"></span>
      <span class="day-group__count">${count} episode${count === 1 ? "" : "s"}${
        partial ? ` · more may load` : ""
      }</span>
    </header>
    ${content}
  </section>`;
}

/* ------------------------------------------------------------
   Spotlight
   ------------------------------------------------------------ */

export function spotlight(entry, prefs, { saved }) {
  const media = entry.media;
  const title = titleOf(media);
  const nowSeconds = Date.now() / 1000;
  const timeText = countdown(entry.airingAt, media.duration, nowSeconds);
  const fullTime = airingTime(entry.airingAt, prefs.timezone, prefs.hour12).replace(
    /^(\w+), /,
    "$1 "
  );
  const url = posterUrl(media);

  // The typographic plate always sits underneath; a poster that fails to
  // decode simply reveals it instead of leaving a hole.
  const poster = `<div class="spotlight__poster-fallback" aria-hidden="true">
       <span class="spotlight__poster-mark">OT</span>
       <span class="spotlight__poster-title">${esc(title)}</span>
     </div>${
    url
      ? `<img class="card__poster" src="${esc(url)}" ${posterSrcset(media)}
           sizes="(max-width: 760px) 100vw, 46vw" alt="${esc(title)} poster" width="320" height="457"
           fetchpriority="high" decoding="async" data-blur-up />`
      : ""
  }`;

  return `<section class="spotlight ${tintClass(media)}" aria-label="Next episode">
    <div class="spotlight__content">
      <p class="spotlight__label">Next episode</p>
      <h2 class="spotlight__title">
        <button data-action="detail" data-id="${media.id}">${esc(title)}</button>
      </h2>
      <div class="spotlight__meta">
        <span class="badge badge--accent">Episode ${entry.episode}</span>
        ${scoreBadge(media)}
        <span class="badge">${esc(formatLabel(media.format))}</span>
        ${scheduleChangeBadge(media.id)}
      </div>
      <div class="spotlight__countdown">
        <span class="spotlight__countdown-value" data-countdown data-epoch="${entry.airingAt}" data-duration="${media.duration ?? 0}">${esc(timeText)}</span>
        <span class="spotlight__countdown-time">${esc(fullTime)}</span>
      </div>
      <div class="spotlight__actions">
        <button class="btn btn--primary" data-action="detail" data-id="${media.id}">View details</button>
        <button class="btn ${saved ? "btn--secondary" : "btn--ghost"}" data-action="save" data-id="${media.id}">
          ${saved ? "In watchlist" : "Add to watchlist"}
        </button>
      </div>
    </div>
    <div class="spotlight__media">
      <div class="spotlight__poster">
        ${poster}
        <button data-action="detail" data-id="${media.id}" aria-label="Details for ${esc(title)}"></button>
      </div>
    </div>
  </section>`;
}
