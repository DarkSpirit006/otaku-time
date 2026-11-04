/* ============================================================
   Otaku Time — media card HTML builders
   Markup matches css/components/cards.css + feature sheets.
   ============================================================ */

import { esc } from "../utils/dom.js";
import { titleOf, formatLabel } from "../utils/format.js";
import { countdown, airingTime } from "../utils/time.js";
import { watchlist } from "../storage/watchlist.js";
import { icon } from "./icons.js";

/** Escape + wrap matched substrings in <mark> (search highlighting). */
export function highlight(text, query) {
  const safe = esc(text);
  const q = String(query || "").trim();
  if (!q) return safe;
  const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${pattern})`, "ig"), "<mark>$1</mark>");
}

function posterMarkup(media, query) {
  const url = media.coverImage?.large || media.coverImage?.extraLarge || media.coverImage?.medium;
  const title = titleOf(media);
  const alt = query ? `${title} poster` : `${title} poster`;
  const img = url
    ? `<img class="card__poster" src="${esc(url)}" alt="${esc(alt)}" width="320" height="457" loading="lazy" decoding="async" />`
    : "";
  const fallback = `<div class="card__poster-fallback" ${url ? "hidden" : ""}>
      ${icon("film")}
      <span>${esc(title)}</span>
    </div>`;
  return `${img}${fallback}`;
}

function scoreBadge(media) {
  if (!Number.isInteger(media.averageScore) || media.averageScore <= 0) return "";
  return `<span class="badge badge--score">${media.averageScore}%</span>`;
}

/**
 * Schedule/search card (Upcoming, Recently aired grid, search results).
 * @param {{media:object, episode?:number, airingAt?:number}} entry
 * @param {{timezone:string, hour12:boolean}} prefs
 * @param {{query?:string, showEpisode?:boolean}} [opts]
 */
export function eventCard(entry, prefs, opts = {}) {
  const media = entry.media;
  const title = titleOf(media);
  const saved = watchlist.has(media.id);
  const query = opts.query || "";

  const episodeBadge = Number.isInteger(entry.episode)
    ? `<span class="card__ep">EP ${entry.episode}</span>`
    : "";
  const save = `<button class="save-btn card__save ${saved ? "is-saved" : ""}" data-action="save" data-id="${media.id}"
      aria-label="${saved ? `Remove ${esc(title)} from watchlist` : `Save ${esc(title)} to watchlist`}">
      ${icon("check")}
    </button>`;

  // Airing line: explicit event time, else next-episode time, else status.
  let airingText = "";
  let airingEpoch = null;
  if (Number.isFinite(entry.airingAt)) {
    airingEpoch = entry.airingAt;
    airingText = countdown(entry.airingAt, media.duration, Date.now() / 1000);
  } else if (Number.isFinite(media.nextAiringEpisode?.airingAt)) {
    airingEpoch = media.nextAiringEpisode.airingAt;
    airingText = countdown(media.nextAiringEpisode.airingAt, media.duration, Date.now() / 1000);
  } else {
    airingText = media.status === "FINISHED" ? "Complete" : media.status === "RELEASING" ? "Airing" : "TBA";
  }

  const airingClass = airingEpoch !== null && airingEpoch < Date.now() / 1000 ? " is-past" : "";

  const topLine = `<div class="card__topline">
      <span>${esc(formatLabel(media.format))}</span>
      ${scoreBadge(media)}
    </div>`;

  const titleText = query ? highlight(title, query) : esc(title);
  const timeFull = airingEpoch !== null ? airingTime(airingEpoch, prefs.timezone, prefs.hour12) : "";

  return `<article class="card">
    <button class="card__open" data-action="detail" data-id="${media.id}" aria-label="Details for ${esc(title)}"></button>
    <div class="card__poster-wrap">
      ${posterMarkup(media, query)}
      ${episodeBadge}
      ${save}
    </div>
    <div class="card__body">
      ${topLine}
      <span class="card__title">${titleText}</span>
      <span class="card__airing${airingClass}" ${airingEpoch !== null ? `data-countdown data-epoch="${airingEpoch}" data-duration="${media.duration ?? 0}"` : ""}>
        ${esc(airingText)}${timeFull ? `<span class="card__time"> · ${esc(timeFull)}</span>` : ""}
      </span>
    </div>
  </article>`;
}

/**
 * Watchlist card with progress controls.
 * @param {{...mediaFields, watched:number, nextAiringEpisode?:{airingAt:number}}} item
 */
export function watchlistCard(item, prefs) {
  const title =
    item.title?.english || item.title?.romaji || item.title?.native || "Untitled anime";
  const saved = true;
  const total = Number.isInteger(item.episodes) ? item.episodes : null;
  const watched = Number.isInteger(item.watched) ? item.watched : 0;
  const complete = total !== null && watched >= total;
  const score = Number.isInteger(item.averageScore) && item.averageScore > 0 ? item.averageScore : null;

  const mediaLike = {
    id: item.id,
    title: item.title,
    coverImage: item.coverImage,
    format: item.format,
    status: item.status,
    averageScore: score,
    episodes: total,
    duration: Number.isInteger(item.duration) ? item.duration : null,
    nextAiringEpisode: item.nextAiringEpisode?.airingAt
      ? { airingAt: item.nextAiringEpisode.airingAt }
      : null,
  };

  const body = `<div class="card__body">
      <div class="card__topline">
        <span>${esc(formatLabel(item.format))}</span>
        ${score ? `<span class="badge badge--score">${score}%</span>` : ""}
      </div>
      <span class="card__title">${esc(title)}</span>
      ${
        item.nextAiringEpisode?.airingAt
          ? `<span class="card__airing" data-countdown data-epoch="${item.nextAiringEpisode.airingAt}" data-duration="0">next ${esc(
              countdown(item.nextAiringEpisode.airingAt, null, Date.now() / 1000)
            )}</span>`
          : ""
      }
      <div class="card__progress">
        <span class="card__progress-text ${complete ? "is-complete" : ""}">
          <span>${total !== null ? `Watched ${watched}/${total}` : `Watched ${watched}`}</span>
          <span class="progress-mini" aria-hidden="true">
            <span class="progress-mini__fill" style="--progress: ${
              total ? Math.round((watched / total) * 100) : 0
            }%"></span>
          </span>
        </span>
        <button class="bump-btn" data-action="bump" data-id="${item.id}" data-delta="1"
          aria-label="Increase watched episodes for ${esc(title)}" ${complete ? "disabled" : ""}>
          ${complete ? "Done" : "+1"}
        </button>
      </div>
    </div>`;

  return `<article class="card ${complete ? "is-complete" : "is-tracked"}">
    <button class="card__open" data-action="detail" data-id="${item.id}" aria-label="Details for ${esc(title)}"></button>
    <div class="card__poster-wrap">
      ${posterMarkup(mediaLike, "")}
      <span class="card__ep">${complete ? "DONE" : `EP ${watched + 1}`}</span>
      <button class="save-btn card__save ${saved ? "is-saved" : ""}" data-action="save" data-id="${item.id}"
        aria-label="Remove ${esc(title)} from watchlist">${icon("check")}</button>
    </div>
    ${body}
  </article>`;
}

/**
 * Timeline row for Recently aired.
 */
export function timelineRow(entry, prefs) {
  const media = entry.media;
  const title = titleOf(media);
  const saved = watchlist.has(media.id);
  const nowSeconds = Date.now() / 1000;
  const agoSeconds = nowSeconds - entry.airingAt;
  const url = media.coverImage?.medium || media.coverImage?.large;

  const image = url
    ? `<img src="${esc(url)}" alt="" width="54" height="81" loading="lazy" decoding="async" />`
    : "";
  const fullTime = airingTime(entry.airingAt, prefs.timezone, prefs.hour12);

  return `<article class="row">
    <div class="row__poster">
      ${image}
      <button class="row__open" data-action="detail" data-id="${media.id}" aria-label="Details for ${esc(title)}"></button>
    </div>
    <div class="row__body">
      <button class="row__title" data-action="detail" data-id="${media.id}">${esc(title)}</button>
      <p class="row__meta">
        <span class="row__ep">Episode ${entry.episode}</span>
        <span aria-hidden="true">·</span>
        <span>${esc(fullTime)}</span>
        ${Number.isInteger(media.averageScore) && media.averageScore > 0 ? `<span aria-hidden="true">·</span><span>${media.averageScore}%</span>` : ""}
      </p>
    </div>
    <p class="row__ago ${agoSeconds < 3600 ? "is-recent" : ""}" data-countdown data-epoch="${entry.airingAt}" data-duration="${media.duration ?? 0}">
      ${esc(countdown(entry.airingAt, media.duration, nowSeconds))}
    </p>
    <div class="row__actions">
      <button class="save-btn ${saved ? "is-saved" : ""}" data-action="save" data-id="${media.id}"
        aria-label="${saved ? `Remove ${esc(title)} from watchlist` : `Save ${esc(title)} to watchlist`}">
        ${icon("check")}
      </button>
      <button class="btn btn--ghost btn--sm" data-action="detail" data-id="${media.id}">Details</button>
    </div>
  </article>`;
}

/** Day-group section (Upcoming + Recently aired share the head styles). */
export function dayGroup({ key, label, relative = "", count = 0, content, now = false }) {
  return `<section class="day-group" data-day="${esc(key)}">
    <header class="day-group__head">
      <h3 class="day-group__label">${esc(label)}${
        relative ? ` <span class="day-group__relative">· ${esc(relative)}</span>` : ""
      }</h3>
      <span class="day-group__rule" aria-hidden="true"></span>
      <span class="day-group__count">${count} episode${count === 1 ? "" : "s"}</span>
    </header>
    ${now ? '<div class="now-divider"><span>Now</span></div>' : ""}
    ${content}
  </section>`;
}

/** "Next up" spotlight (Upcoming only). */
export function spotlight(entry, prefs, { saved }) {
  const media = entry.media;
  const title = titleOf(media);
  const nowSeconds = Date.now() / 1000;
  const timeText = countdown(entry.airingAt, media.duration, nowSeconds);
  const fullTime = airingTime(entry.airingAt, prefs.timezone, prefs.hour12);
  const url = media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium;

  const poster = url
    ? `<img src="${esc(url)}" alt="${esc(title)}" width="320" height="457" fetchpriority="high" decoding="async" />`
    : "";

  return `<section class="spotlight" aria-label="Next episode">
    <div class="spotlight__content">
      <p class="spotlight__label">Next episode</p>
      <h2 class="spotlight__title">
        <button data-action="detail" data-id="${media.id}">${esc(title)}</button>
      </h2>
      <div class="spotlight__meta">
        <span class="badge badge--accent">Episode ${entry.episode}</span>
        ${Number.isInteger(media.averageScore) && media.averageScore > 0 ? `<span class="badge badge--score">${media.averageScore}%</span>` : ""}
        <span class="badge">${esc(formatLabel(media.format))}</span>
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
