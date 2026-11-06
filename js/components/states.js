/* ============================================================
   Otaku Time — shared view-state HTML builders
   ============================================================ */

import { esc } from "../utils/dom.js";

/** Loading skeleton grid (classes match cards.css). */
export function skeletonGrid(count = 6) {
  const cards = Array.from({ length: count }, () =>
    `<article class="skeleton-card" aria-hidden="true">
       <div class="skeleton-shimmer skeleton-card__poster"></div>
       <div class="skeleton-card__body">
         <div class="skeleton-shimmer skeleton-card__line"></div>
         <div class="skeleton-shimmer skeleton-card__line skeleton-card__line--short"></div>
       </div>
     </article>`
  ).join("");
  return `<div class="skeleton-grid">${cards}</div>`;
}

/** Empty-state block. */
export function emptyState({ icon = "sparkle", title, text, action = "" }) {
  return `<div class="empty">
    <div class="empty__icon" aria-hidden="true">${iconSvg(icon)}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(text)}</p>
    ${action}
  </div>`;
}

/** Notice bar (danger by default, warning variant). */
export function notice(text, kind = "danger") {
  if (!text) return "";
  return `<div class="notice${kind === "warning" ? " notice--warning" : ""}" role="status">${esc(text)}</div>`;
}

/**
 * Section heading: eyebrow + h1 + meta on the left, optional
 * * aside (extra controls) on the right.
 */
export function sectionHead({ eyebrow, title, meta = "", aside = "", tail = "" }) {
  // `tail` is rendered as outlined type — a quiet second half of the
  // masthead. It joins the title with no whitespace, so the heading's
  // accessible name stays exactly the section name ("Upcoming") instead
  // of becoming "Up coming"; a tail that starts a new word carries its
  // own leading space.
  return `<header class="section-head">
    <div class="section-head__left">
      <p class="section-head__eyebrow">${esc(eyebrow)}</p>
      <h1 id="section-title">${esc(title)}${tail ? `<span class="section-head__tail">${esc(tail)}</span>` : ""}</h1>
      <p class="section-head__meta" id="section-meta">${meta}</p>
    </div>
    ${aside ? `<div class="section-head__aside">${aside}</div>` : ""}
  </header>`;
}

/** Inline icon helper for empty states. */
function iconSvg(name) {
  const paths = {
    sparkle:
      '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  };
  const body = paths[name] || paths.sparkle;
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Skeleton rows that mirror the timeline layout. */
export function skeletonRows(count = 5) {
  const rows = Array.from(
    { length: count },
    () => `<div class="skeleton-row" aria-hidden="true">
        <div class="skeleton-shimmer skeleton-row__poster"></div>
        <div class="skeleton-row__body">
          <div class="skeleton-shimmer skeleton-card__line"></div>
          <div class="skeleton-shimmer skeleton-card__line skeleton-card__line--short"></div>
        </div>
      </div>`
  ).join("");
  return `<div class="skeleton-rows">${rows}</div>`;
}

/** Skeleton that matches the weekly calendar grid. */
export function skeletonCalendar() {
  const columns = Array.from(
    { length: 7 },
    () => `<div class="skeleton-cal__col" aria-hidden="true">
        <div class="skeleton-shimmer skeleton-cal__head"></div>
        <div class="skeleton-shimmer skeleton-cal__slot"></div>
        <div class="skeleton-shimmer skeleton-cal__slot"></div>
        <div class="skeleton-shimmer skeleton-cal__slot"></div>
      </div>`
  ).join("");
  return `<div class="skeleton-cal">${columns}</div>`;
}

/**
 * A row of toggle chips.
 * @param {{name:string, label:string, active?:boolean, value?:string}[]} items
 */
export function chips(items, { label = "", action = "chip" } = {}) {
  return `<div class="chips" role="group" aria-label="${esc(label)}">${items
    .map(
      (item) => `<button class="chip${item.active ? " is-active" : ""}" data-action="${action}"
        data-chip="${esc(item.name)}" data-value="${esc(item.value ?? item.name)}"
        aria-pressed="${item.active ? "true" : "false"}">${esc(item.label)}</button>`
    )
    .join("")}</div>`;
}
