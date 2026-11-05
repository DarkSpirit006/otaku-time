/* ============================================================
   Otaku Time — anime detail dialog
   Lazy-loads the full AniList record when only a schedule
   snapshot is available, and manages progress inline.
   ============================================================ */

import { details as fetchDetails } from "../../api/anilist.js";
import { titleOf, formatLabel, statusLabel, cleanDescription, genreLine } from "../../utils/format.js";
import { countdown, airingTime } from "../../utils/time.js";
import { watchlist } from "../../storage/watchlist.js";
import { icon } from "../../components/icons.js";
import { esc, qs, qsa } from "../../utils/dom.js";
import { showToast } from "../../components/toast.js";

let dialog = null;
let content = null;
let currentMedia = null;
let openerElement = null;
let ctxRef = null;
let fetchToken = 0;

export function initDetail(ctx) {
  ctxRef = ctx;
  dialog = qs("#detail-dialog");
  content = qs("#detail-content");
  if (!dialog || !dialog.showModal) return;

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDetail();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDetail();
  });

  dialog.addEventListener("close", () => {
    content.innerHTML = "";
    currentMedia = null;
    restoreFocus(openerElement);
    openerElement = null;
  });

  content.addEventListener("click", onContentClick);
  content.addEventListener("change", onContentChange);
}

/** Return focus to the opener, even if the view re-rendered underneath it. */
function restoreFocus(opener) {
  if (opener?.isConnected) {
    opener.focus?.();
    return;
  }
  const id = opener?.dataset?.id;
  const replacement = id ? qs(`.card__open[data-id="${id}"], .row__open[data-id="${id}"]`) : null;
  (replacement || document.getElementById("main"))?.focus?.();
}

function onContentClick(event) {
  const button = event.target.closest("[data-detail-action]");
  if (!button || !currentMedia) return;
  const action = button.dataset.detailAction;

  if (action === "close") {
    closeDetail();
    return;
  }

  if (action === "toggle-save") {
    const result = watchlist.toggle(currentMedia);
    if (result) {
      showToast(result.removed ? "Removed from watchlist" : "Saved to watchlist");
      renderDetail(currentMedia, { loaded: true });
      ctxRef?.watchlistChanged?.();
    } else {
      showToast(watchlist.storageProblem() || "Couldn't update your watchlist.");
    }
    return;
  }

  if (action === "bump") {
    const delta = Number(button.dataset.delta) || 0;
    const item = watchlist.find(currentMedia.id);
    if (!item) return;
    const next = item.watched + delta;
    if (watchlist.setProgress(currentMedia, next)) {
      bumpPop(button);
      renderDetail(currentMedia, { loaded: true });
      ctxRef?.watchlistChanged?.();
    }
    return;
  }
}

function onContentChange(event) {
  const input = event.target.closest("[data-progress-input]");
  if (!input || !currentMedia) return;
  const value = Number.parseInt(input.value, 10);
  if (!Number.isFinite(value)) {
    // Invalid/cleared input: snap back to the stored value.
    const item = watchlist.find(currentMedia.id);
    input.value = item ? String(item.watched) : "0";
    return;
  }
  if (watchlist.setProgress(currentMedia, value)) {
    renderDetail(currentMedia, { loaded: true });
    ctxRef?.watchlistChanged?.();
  }
}

function bumpPop(button) {
  button.classList.remove("is-pop");
  void button.offsetWidth;
  button.classList.add("is-pop");
}

/** Open the detail dialog for a media object. */
export function openDetail(media, opener) {
  if (!dialog || !dialog.showModal || !media) return;
  openerElement = opener || document.activeElement;
  currentMedia = media;
  renderDetail(media, { loaded: Boolean(media.description) });

  if (!dialog.open) dialog.showModal();

  // Lazily fetch the full record when we only have a schedule snapshot.
  if (!media.description) {
    const token = ++fetchToken;
    fetchDetails(media.id)
      .then(({ media: full }) => {
        if (token !== fetchToken || !full || currentMedia?.id !== media.id) return;
        mergeDetails(media, full);
        renderDetail(media, { loaded: true });
      })
      .catch((error) => {
        if (token !== fetchToken) return;
        renderDetail(media, { loaded: false, fetchError: error?.message || "Details unavailable." });
      });
  }
}

/** Merge a full details payload into a schedule snapshot (in place). */
function mergeDetails(target, full) {
  for (const [key, value] of Object.entries(full)) {
    if (value !== null && value !== undefined) target[key] = value;
  }
}

/** Close with the shared fade/scale-out animation. */
export function closeDetail() {
  if (!dialog?.open) return;
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

function renderDetail(media, { loaded, fetchError = "" }) {
  const prefs = ctxRef?.prefs() ?? { timezone: "UTC", hour12: true };
  const title = titleOf(media);
  const savedItem = watchlist.find(media.id);
  const total = Number.isInteger(media.episodes) ? media.episodes : savedItem?.episodes ?? null;
  const watched = savedItem?.watched ?? 0;
  const nextAt = media.nextAiringEpisode?.airingAt ?? null;

  const posterUrl = media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium;
  // No banner on many obscure titles — use a blurred poster wash so the
  // header never collapses into an empty strip.
  const banner = media.bannerImage
    ? `<img src="${esc(media.bannerImage)}" alt="" width="940" height="300" decoding="async" />`
    : posterUrl
      ? `<img class="detail-banner__fallback" src="${esc(posterUrl)}" alt="" aria-hidden="true" width="940" height="300" decoding="async" />`
      : "";
  const poster = posterUrl
    ? `<img src="${esc(posterUrl)}" alt="${esc(title)}" width="320" height="457" decoding="async" />`
    : "";

  const eyebrow = [
    media.status ? statusLabel(media.status) : "",
    media.format ? formatLabel(media.format) : "",
    media.seasonYear ? `${media.season} ${media.seasonYear}` : "",
  ]
    .filter(Boolean)
    .map((part) => `<span>${esc(part)}</span>`)
    .join('<span aria-hidden="true">·</span>');

  const tags = (media.genres || [])
    .slice(0, 6)
    .map((genre) => `<span class="badge">${esc(genre)}</span>`)
    .join("");

  const synopsis = loaded
    ? cleanDescription(media.description) || "No synopsis provided by AniList."
    : "Loading full details from AniList…";
  const fetchNotice = fetchError
    ? `<div class="notice notice--warning" role="status">${esc(fetchError)} Showing what we already had.</div>`
    : "";

  const nextBlock =
    nextAt !== null
      ? `<div class="detail-next">
          <div>
            <strong>Next episode</strong>
            <span>Episode ${media.nextAiringEpisode.episode} · ${esc(
              airingTime(nextAt, prefs.timezone, prefs.hour12)
            )}</span>
          </div>
          <time data-countdown data-epoch="${nextAt}" data-duration="${media.duration ?? 0}">${esc(
            countdown(nextAt, media.duration, Date.now() / 1000)
          )}</time>
        </div>`
      : "";

  const external = (media.externalLinks || [])
    .filter((link) => link.site && link.url)
    .slice(0, 3)
    .map(
      (link) =>
        `<a class="btn btn--ghost btn--sm" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(
          link.site
        )} ↗</a>`
    )
    .join("");

  content.innerHTML = `
    <button class="dialog__close" data-detail-action="close" aria-label="Close details">${icon("close")}</button>
    <div class="detail-banner">${banner}</div>
    <div class="detail-body">
      <div class="detail-poster">${poster}</div>
      <div class="detail-main">
        <p class="detail-eyebrow">${eyebrow || "<span>Anime</span>"}</p>
        <h2 class="detail-title" id="detail-title">${esc(title)}</h2>
        ${media.title?.romaji && media.title.romaji !== title ? `<p class="detail-sub">${esc(media.title.romaji)}</p>` : ""}
        ${media.title?.native && media.title.native !== title ? `<p class="detail-sub">${esc(media.title.native)}</p>` : ""}
        ${fetchNotice}
        <div class="detail-tags">${tags}</div>
        <p class="detail-genres">${esc(genreLine(media.genres))}${
          media.averageScore ? ` · Score ${media.averageScore}%` : ""
        }${media.duration ? ` · ${media.duration} min` : ""}</p>
        <div class="detail-synopsis" tabindex="0" role="group" aria-label="Synopsis">${synopsis}</div>
        ${nextBlock}
        <div class="detail-actions">
          <button class="btn ${savedItem ? "btn--secondary" : "btn--primary"}" data-detail-action="toggle-save">
            ${icon("check")} ${savedItem ? "In watchlist" : "Add to watchlist"}
          </button>
          ${
            savedItem
              ? `<div class="detail-progress">
                  <label for="detail-progress">Progress</label>
                  <button class="bump-btn" data-detail-action="bump" data-delta="-1" aria-label="Decrease progress" ${
                    watched <= 0 ? "disabled" : ""
                  }>${icon("minus")}</button>
                  <input class="number-input" id="detail-progress" data-progress-input type="number" inputmode="numeric"
                    min="0" ${total !== null ? `max="${total}"` : ""} value="${watched}"
                    aria-label="Episodes watched (of ${total ?? "?"})" />
                  <button class="bump-btn" data-detail-action="bump" data-delta="1" aria-label="Increase progress" ${
                    total !== null && watched >= total ? "disabled" : ""
                  }>${icon("plus")}</button>
                  ${total !== null ? `<span class="badge">${watched}/${total}</span>` : ""}
                </div>`
              : ""
          }
          <div class="detail-external">${external}</div>
        </div>
      </div>
    </div>`;

  // Fade the banner in once its image decodes.
  for (const img of qsa(".detail-banner img", content)) {
    if (img.complete) img.classList.add("is-loaded");
    else img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
  }
}
