/* ============================================================
   Otaku Time — anime detail dialog

   Everything AniList gives us for a title, presented in order of
   usefulness: where to watch it, what it is, when it airs, and
   the user's own controls (status, score, notes, reminder).
   ============================================================ */

import { details as fetchDetails } from "../../api/anilist.js";
import { titleOf, formatLabel, cleanDescription, genreLine } from "../../utils/format.js";
import { countdown, airingTime } from "../../utils/time.js";
import { watchlist, LIST_STATUSES, LIST_STATUS_LABELS, progressCap } from "../../storage/watchlist.js";
import { canComplete } from "../../utils/media-state.js";
import { icon } from "../../components/icons.js";
import { esc, qs, qsa } from "../../utils/dom.js";
import { showToast } from "../../components/toast.js";
import { syncFromMedia } from "../../services/metadata.js";
import { offerUndo } from "../../services/undo.js";
import { buildCalendar, icsFileName } from "../../utils/ics.js";
import { dateLabel, detailFacts, detailLinks, safeUrl } from "./facts.js";
import { downloadFile } from "../upcoming/index.js";

let dialog = null;
let content = null;
let currentMedia = null;
let openerElement = null;
let ctxRef = null;
let fetchToken = 0;
let onClosed = null;

const STREAMING_ICONS = {
  crunchyroll: "CR",
  netflix: "N",
  hulu: "H",
  "amazon prime video": "P",
  "amazon": "P",
  hidive: "HD",
  "disney+": "D+",
  "bilibili": "B",
  "youtube": "YT",
  "funimation": "F",
  "apple tv": "TV",
  "hbo max": "M",
  "max": "M",
  "wakanim": "W",
  "vrv": "V",
  "muse asia": "M",
  "aniplus": "A+",
  "iqiyi": "iQ",
};

function streamBadge(site) {
  const key = String(site || "").toLowerCase();
  const mark = Object.entries(STREAMING_ICONS).find(([name]) => key.includes(name))?.[1];
  return mark
    ? `<span class="link-chip__mark" aria-hidden="true">${esc(mark)}</span>`
    : `<span class="link-chip__mark" aria-hidden="true">${icon("globe")}</span>`;
}


export function initDetail(ctx) {
  ctxRef = ctx;
  dialog = qs("#detail-dialog");
  content = qs("#detail-content");
  if (!dialog || !dialog.showModal) return;

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDetail({ viaHistory: true });
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDetail({ viaHistory: true });
  });

  dialog.addEventListener("close", () => {
    content.innerHTML = "";
    currentMedia = null;
    restoreFocus(openerElement);
    openerElement = null;
    onClosed?.();
    onClosed = null;
  });

  content.addEventListener("click", onContentClick);
  content.addEventListener("change", onContentChange);
}

/** Called by the app when the dialog closes for any reason. */
export function setCloseHandler(fn) {
  onClosed = fn;
}

function restoreFocus(opener) {
  if (opener?.isConnected) {
    opener.focus?.();
    return;
  }
  const id = opener?.dataset?.id;
  const replacement = id ? qs(`.card__open[data-id="${id}"], .row__open[data-id="${id}"], .cal-slot[data-id="${id}"]`) : null;
  (replacement || document.getElementById("main"))?.focus?.();
}

function onContentClick(event) {
  const button = event.target.closest("[data-detail-action]");
  if (!button || !currentMedia) return;
  const action = button.dataset.detailAction;

  if (action === "close") {
    closeDetail({ viaHistory: true });
    return;
  }

  if (action === "toggle-save") {
    const result = watchlist.toggle(currentMedia);
    if (!result) {
      showToast(watchlist.storageProblem() || "Couldn't update your watchlist.");
      return;
    }
    renderDetail(currentMedia, { loaded: true });
    ctxRef?.watchlistChanged?.();
    if (result.removed) {
      offerUndo({
        message: `Removed ${titleOf(currentMedia)}`,
        restore: () => Boolean(watchlist.restore(result.item)),
      });
    } else {
      showToast("Saved to watchlist");
    }
    return;
  }

  if (action === "step") {
    const delta = Number(button.dataset.delta) || 0;
    const item = watchlist.find(currentMedia.id);
    if (!item) return;
    const next = item.watched + delta;
    if (watchlist.setWatched(item.id, next)) {
      button.classList.remove("is-pop");
      void button.offsetWidth;
      button.classList.add("is-pop");
      renderDetail(currentMedia, { loaded: true });
      ctxRef?.watchlistChanged?.();
    }
    return;
  }

  if (action === "export-episode") {
    exportEpisode();
    return;
  }

  if (action === "mark-complete") {
    const item = watchlist.find(currentMedia.id);
    const { cap: total } = progressCap(item || currentMedia);
    if (!item || total === null) return;
    watchlist.setWatched(item.id, total);
    if (watchlist.setListStatus(item.id, "completed")) {
      renderDetail(currentMedia, { loaded: true });
      ctxRef?.watchlistChanged?.();
      showToast("Marked complete");
    }
    return;
  }

  if (action === "retry-details") {
    loadDetails(currentMedia);
  }
}

function onContentChange(event) {
  const field = event.target.closest("[data-progress-input], [data-detail-field], [data-reminder-field]");
  if (!field || !currentMedia) return;

  if (field.matches("[data-progress-input]")) {
    const item = watchlist.find(currentMedia.id);
    const value = Number.parseInt(field.value, 10);
    if (!Number.isFinite(value)) {
      field.value = String(item ? item.watched : 0);
      return;
    }
    if (watchlist.setWatched(currentMedia.id, value)) {
      const clamped = watchlist.find(currentMedia.id).watched;
      if (clamped !== value) {
        field.value = String(clamped);
        const { cap: total, source } = progressCap(watchlist.find(currentMedia.id));
        showToast(
          source === "aired"
            ? `Progress capped at episode ${total} — AniList hasn't published a total yet.`
            : `Progress capped at episode ${total}.`
        );
      }
      renderDetail(currentMedia, { loaded: true });
      ctxRef?.watchlistChanged?.();
    }
    return;
  }

  if (field.matches("[data-reminder-field]")) {
    const item = watchlist.find(currentMedia.id);
    if (!item) return;
    if (field.dataset.reminderField === "enabled") {
      watchlist.setReminder(item.id, { enabled: field.checked });
    } else {
      watchlist.setReminder(item.id, { lead: Number(field.value) });
    }
    ctxRef?.watchlistChanged?.();
    return;
  }

  const key = field.dataset.detailField;
  const item = watchlist.find(currentMedia.id);
  if (!item) return;
  if (key === "status") {
    watchlist.setListStatus(item.id, field.value === "none" ? null : field.value);
    renderDetail(currentMedia, { loaded: true });
    ctxRef?.watchlistChanged?.();
  } else if (key === "score") {
    const value = field.value === "" ? null : Number(field.value);
    if (watchlist.setScore(item.id, value)) {
      renderDetail(currentMedia, { loaded: true });
      ctxRef?.watchlistChanged?.();
    } else {
      showToast("Scores run from 0 to 100.");
    }
  } else if (key === "notes") {
    watchlist.setNotes(item.id, field.value);
    ctxRef?.watchlistChanged?.();
  }
}

function exportEpisode() {
  const item = watchlist.find(currentMedia.id);
  const next = currentMedia.nextAiringEpisode || item?.nextAiringEpisode;
  if (!next || !Number.isFinite(next.airingAt)) {
    showToast("No airing time is known for this title yet.");
    return;
  }
  const prefs = ctxRef?.prefs() ?? { reminder: 15 };
  const event = {
    id: next.episode ?? 0,
    airingAt: next.airingAt,
    episode: next.episode,
    media: {
      id: currentMedia.id,
      title: currentMedia.title,
      duration: currentMedia.duration,
      format: currentMedia.format,
    },
  };
  // A stable id per title keeps the UID meaningful across exports.
  event.id = currentMedia.id * 1000 + (next.episode || 0);
  const { content: ics } = buildCalendar({
    events: [event],
    reminderMinutes: item?.reminder?.lead ?? prefs.reminder,
    calendarName: `Otaku Time — ${titleOf(currentMedia)}`,
  });
  downloadFile(ics, icsFileName("episode", currentMedia.id), "text/calendar");
  showToast("Episode exported — open the file to add it to your calendar.");
}

/** Open the detail dialog for a media object. */
export function openDetail(media, opener) {
  if (!dialog || !dialog.showModal || !media) return;
  openerElement = opener || document.activeElement;
  currentMedia = media;
  renderDetail(media, { loaded: Boolean(media.description) });
  if (!dialog.open) dialog.showModal();
  if (!media.description) loadDetails(media);
}

function loadDetails(media) {
  const token = ++fetchToken;
  fetchDetails(media.id)
    .then(({ media: full }) => {
      if (token !== fetchToken || !full || currentMedia?.id !== media.id) return;
      mergeDetails(media, full);
      syncFromMedia(full);
      renderDetail(media, { loaded: true });
    })
    .catch((error) => {
      if (token !== fetchToken) return;
      renderDetail(media, { loaded: false, fetchError: error?.message || "Details unavailable." });
    });
}

function mergeDetails(target, full) {
  for (const [key, value] of Object.entries(full)) {
    if (value !== null && value !== undefined && !(Array.isArray(value) && !value.length)) target[key] = value;
  }
}

/** Close with the shared fade/scale-out animation. */
export function closeDetail({ viaHistory = false } = {}) {
  if (!dialog?.open) return;
  if (viaHistory) ctxRef?.closeDetailRoute?.();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    dialog.close();
    return;
  }
  if (dialog.classList.contains("is-closing")) return;
  dialog.classList.add("is-closing");
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    dialog.classList.remove("is-closing");
    dialog.close();
  };
  dialog.addEventListener("transitionend", (event) => {
    if (event.target === dialog) finish();
  }, { once: true });
  setTimeout(finish, 450);
}

/* ------------------------------------------------------------
   Rendering
   ------------------------------------------------------------ */


function tintOf(media) {
  const hue = String(media?.coverImage?.color || "").replace("#", "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/.test(hue)) return `tint-h${(media?.id || 0) % 12}`;
  const full = hue.length === 3 ? hue.split("").map((c) => c + c).join("") : hue;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return "tint-h11";
  const delta = max - min;
  let h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  h = (h * 60 + 360) % 360;
  return `tint-h${Math.floor(h / 30) % 12}`;
}

function scheduleChangeBlock(item) {
  const change = item?.scheduleChange;
  if (!change || !Number.isFinite(change.from) || !Number.isFinite(change.to)) return "";
  const delayed = change.to > change.from;
  return `<p class="detail-change">
    <span class="badge badge--change">${delayed ? "Delayed" : "Moved earlier"}</span>
    <span>Was ${esc(new Date(change.from * 1000).toLocaleString())} · now ${esc(
      new Date(change.to * 1000).toLocaleString()
    )}</span>
  </p>`;
}

function renderDetail(media, { loaded, fetchError = "" }) {
  const prefs = ctxRef?.prefs() ?? { timezone: "UTC", hour12: true, reminder: 15 };
  const title = titleOf(media);
  const item = watchlist.find(media.id);
  const { cap: total, source } = progressCap(item || media);
  const watched = item?.watched ?? 0;
  const complete = canComplete(item || media) && total !== null && watched >= total;

  const posterUrl = media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium;
  const banner = media.bannerImage
    ? `<img src="${esc(media.bannerImage)}" alt="" width="940" height="300" decoding="async" data-blur-up />`
    : posterUrl
      ? `<img class="detail-banner__fallback" src="${esc(posterUrl)}" alt="" aria-hidden="true" width="940" height="300" decoding="async" />`
      : "";
  const poster = posterUrl
    ? `<img src="${esc(posterUrl)}" alt="${esc(title)} poster" width="320" height="457" decoding="async" data-blur-up />`
    : `<div class="detail-poster__empty">${icon("film")}</div>`;

  /* ---- links ---- */
  const { streaming, others, trailer } = detailLinks(media);

  const linkChip = (link) =>
    `<a class="link-chip" href="${esc(link.safe)}" target="_blank" rel="noopener noreferrer noreferrer">
      ${streamBadge(link.site)}<span>${esc(link.site)}</span>${icon("external", "link-chip__out")}
    </a>`;

  /* ---- facts ---- */
  const facts = detailFacts(media, total);

  const synonyms = (media.synonyms || []).filter((value) => value && value !== title).slice(0, 3);

  const next = media.nextAiringEpisode;
  const nextBlock = next?.airingAt
    ? `<div class="detail-next">
        <div class="detail-next__head">
          <strong>Next episode — ep ${String(next.episode).padStart(2, "0")}</strong>
          <button class="detail-ics" data-detail-action="export-episode">Add .ics ${icon("download")}</button>
        </div>
        <div class="detail-next__row">
          <time class="detail-next__count" data-countdown data-epoch="${next.airingAt}" data-duration="${media.duration ?? 0}">${esc(
            countdown(next.airingAt, media.duration, Date.now() / 1000)
          )}</time>
          <span class="detail-next__when">${esc(airingTime(next.airingAt, prefs.timezone, prefs.hour12))}</span>
        </div>
      </div>`
    : "";

  const synopsis = loaded
    ? cleanDescription(media.description) || "AniList has no synopsis for this title."
    : "Loading full details from AniList…";

  const progressBlock = item
    ? `<div class="detail-progress">
        <div class="detail-progress__head">
          <label for="detail-progress">Episodes watched</label>
          <span class="detail-progress__count">${total !== null ? `${watched} / ${total}` : watched}</span>
        </div>
        <div class="detail-progress__controls">
          <button class="step-btn" data-detail-action="step" data-delta="-1" aria-label="Decrease progress"
            ${watched <= 0 ? "disabled" : ""}>${icon("minus")}</button>
          <input class="number-input" id="detail-progress" data-progress-input type="number" inputmode="numeric"
            min="0" ${total !== null ? `max="${total}"` : ""} value="${watched}"
            aria-label="Episodes watched" />
          <button class="step-btn step-btn--plus" data-detail-action="step" data-delta="1" aria-label="Increase progress"
            ${complete ? "disabled" : ""}>${icon("plus")}</button>
          ${
            !complete && canComplete(item)
              ? `<button class="btn btn--ghost btn--sm" data-detail-action="mark-complete">Mark all watched</button>`
              : ""
          }
        </div>
        ${source === "aired" ? `<p class="detail-hint">AniList hasn't published a total episode count, so progress stops at episode ${total}, the last one that has aired.</p>` : ""}
        ${!next && !total ? `<p class="detail-hint">Episode count and schedule are unknown for this title.</p>` : ""}
      </div>`
    : "";

  const personalBlock = item
    ? `<div class="detail-personal">
        <div class="field">
          <label class="field__label" for="detail-status">Your status</label>
          <select class="native-select" id="detail-status" data-detail-field="status">
            <option value="none" ${!item.listStatus ? "selected" : ""}>No status</option>
            ${LIST_STATUSES.map(
              (status) =>
                `<option value="${status}" ${item.listStatus === status ? "selected" : ""}>${LIST_STATUS_LABELS[status]}</option>`
            ).join("")}
          </select>
        </div>
        <label class="field" for="detail-score">
          <span class="field__label">Your score <span class="field__hint">0–100</span></span>
          <input class="number-input" id="detail-score" data-detail-field="score" type="number" inputmode="numeric"
            min="0" max="100" value="${item.score ?? ""}" placeholder="—" />
        </label>
        <label class="field field--wide" for="detail-notes">
          <span class="field__label">Notes</span>
          <textarea class="notes-input" id="detail-notes" data-detail-field="notes" rows="3"
            maxlength="4000" placeholder="Private notes — stored in this browser">${esc(item.notes || "")}</textarea>
        </label>
        <div class="detail-reminder">
          <label class="switch">
            <input type="checkbox" data-reminder-field="enabled" ${item.reminder?.enabled !== false ? "checked" : ""} />
            <span class="switch__track" aria-hidden="true"></span>
            <span>Remind me</span>
          </label>
          <div class="field">
            <label class="field__label" for="detail-lead">Lead time</label>
            <select class="native-select" id="detail-lead" data-reminder-field="lead">
              ${[5, 10, 15, 30, 60]
                .map(
                  (minutes) =>
                    `<option value="${minutes}" ${(item.reminder?.lead ?? prefs.reminder) === minutes ? "selected" : ""}>${minutes} min before</option>`
                )
                .join("")}
            </select>
          </div>
        </div>
      </div>`
    : "";

  const fetchNotice = fetchError
    ? `<div class="notice notice--warning" role="status">${esc(fetchError)} Showing what we already had.
        <button class="btn btn--ghost btn--sm" data-detail-action="retry-details">Retry</button></div>`
    : "";

  /* Dossier chips: only the fields AniList actually returned. */
  const chips = [
    media.format ? formatLabel(media.format) : "",
    media.mediaStatus || media.status || "",
    Number.isInteger(media.episodes) ? `${media.episodes} episodes` : "Episodes TBA",
    media.seasonYear ? `${media.season || ""} ${media.seasonYear}`.trim() : "",
    Number.isInteger(media.averageScore) && media.averageScore > 0 ? `${(media.averageScore / 10).toFixed(1)}` : "",
  ].filter(Boolean);

  content.innerHTML = `
    <header class="dossier-head">
      <p class="dossier-head__file">File #${media.id} — dossier</p>
      <button class="dialog__close" data-detail-action="close" aria-label="Close details">${icon("close")}</button>
    </header>
    <div class="detail-banner ${tintOf(media)}">
      ${banner}
      <div class="detail-banner__title">
        <h2 class="detail-title" id="detail-title">${esc(title)}</h2>
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-poster">${poster}</div>
      <div class="detail-main">
        ${media.title?.romaji && media.title.romaji !== title ? `<p class="detail-sub">${esc(media.title.romaji)}</p>` : ""}
        ${media.title?.native && media.title.native !== title ? `<p class="detail-sub detail-sub--native">${esc(media.title.native)}</p>` : ""}
        ${synonyms.length ? `<p class="detail-alias">Synonyms — ${esc(synonyms.join(" · "))}</p>` : ""}

        <div class="detail-chips">
          ${chips
            .map(
              (chip, index) =>
                `<span class="detail-chip${index === 1 && /RELEASING|AIRING/i.test(chip) ? " detail-chip--live" : ""}">${
                  index === 4 ? `<span class="detail-chip__star" aria-hidden="true">★</span>` : ""
                }${esc(chip)}</span>`
            )
            .join("")}
        </div>

        ${fetchNotice}
        ${scheduleChangeBlock(item)}
        ${nextBlock}

        <div class="detail-actions">
          <button class="btn ${item ? "btn--secondary" : "btn--primary"} detail-save" data-detail-action="toggle-save">
            ${icon(item ? "check" : "plus")} ${item ? "In watchlist" : "Save to watchlist"}
          </button>
          ${trailer ? `<a class="btn btn--ghost" href="${esc(trailer.url)}" target="_blank" rel="noopener noreferrer">${icon("play")} Trailer</a>` : ""}
        </div>

        ${progressBlock}
        ${personalBlock}

        <section class="detail-sec">
          <h3 class="detail-sec__label">Synopsis</h3>
          <div class="detail-synopsis" tabindex="0" role="group" aria-label="Synopsis">${esc(synopsis)}</div>
        </section>

        <section class="detail-sec">
          <h3 class="detail-sec__label">On record</h3>
          <dl class="detail-facts">
            ${facts
              .map(([key, value]) => `<div class="detail-fact"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`)
              .join("")}
          </dl>
        </section>

        ${
          streaming.length || others.length
            ? `<section class="detail-sec">
                 <h3 class="detail-sec__label">Where to watch</h3>
                 <div class="detail-links" aria-label="Where to watch">${streaming
                   .concat(others)
                   .map(linkChip)
                   .join("")}</div>
               </section>`
            : ""
        }

        <section class="detail-sec">
          <h3 class="detail-sec__label">Genres</h3>
          <div class="detail-tags">${(media.genres || [])
            .map((genre) => `<button class="badge badge--genre" data-action="genre" data-value="${esc(genre)}">${esc(genre)}</button>`)
            .join("")}</div>
        </section>

        <p class="detail-footer">
          ${esc(genreLine(media.genres) || "Anime")}${
            Number.isInteger(media.episodes) ? ` · ${media.episodes} episodes` : ""
          } · Data from AniList
        </p>
      </div>
    </div>`;

  revealImages();
}

function revealImages() {
  for (const img of qsa("img[data-blur-up]", content)) {
    if (img.complete && img.naturalWidth) {
      img.classList.add("is-loaded");
    } else {
      img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    }
  }
}

/** True when the dialog is open (used by keyboard handling). */
export function isDetailOpen() {
  return Boolean(dialog?.open);
}

/** The media currently shown, if any. */
export function currentDetailMedia() {
  return currentMedia;
}
