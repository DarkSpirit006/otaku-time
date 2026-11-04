/* ============================================================
   Otaku Time — Search results view
   Local-first: instant ranked results from the media pool,
   merged with the remote AniList response when it lands.
   ============================================================ */

import { eventCard } from "../../components/card.js";
import { emptyState, notice, sectionHead } from "../../components/states.js";
import { esc } from "../../utils/dom.js";

export const state = {
  results: [],
  loading: false,
  error: "",
  warning: "",
  generation: 0,
};

/** Replace results and re-render (called by app.js search flow). */
export function setResults({ results, loading = false, error = "", warning = "" }) {
  state.results = Array.isArray(results) ? results : [];
  state.loading = loading;
  state.error = error;
  state.warning = warning;
}

export function render(ctx) {
  const app = document.getElementById("app");
  const query = ctx.query();
  const prefs = ctx.prefs();
  const { results, loading, error, warning } = state;

  const status = loading
    ? `<div class="search-status" role="status">
         <span class="search-status__spinner" aria-hidden="true"></span>
         <span>Searching AniList for <span class="search-term">${esc(query)}</span>…</span>
       </div>`
    : `<div class="search-status">
         <span class="search-count">${results.length}</span>
         <span>result${results.length === 1 ? "" : "s"} for <span class="search-term">${esc(query)}</span></span>
       </div>`;

  const head = sectionHead({
    eyebrow: "Search",
    title: "Results",
    meta: "",
    aside: "",
  });

  if (error) {
    app.innerHTML = `<div class="view-enter">
      ${head}
      ${notice(error, "danger")}
      ${results.length ? status + grid(results, prefs, query) : ""}
    </div>`;
    return;
  }

  if (!results.length && loading) {
    app.innerHTML = `<div class="view-enter">${head}${status}</div>`;
    return;
  }

  if (!results.length) {
    app.innerHTML = `<div class="view-enter">
      ${head}
      ${warning ? notice(warning, "warning") : ""}
      ${emptyState({
        icon: "search",
        title: `No matches for “${query}”`,
        text: "Check the spelling, or try the romaji title.",
      })}
    </div>`;
    return;
  }

  app.innerHTML = `<div class="view-enter">
    ${head}
    ${warning ? notice(warning, "warning") : ""}
    ${status}
    ${grid(results, prefs, query)}
  </div>`;
}

function grid(results, prefs, query) {
  const cards = results
    .map((media, index) =>
      eventCard({ media }, prefs, { query }).replace(
        "<article class=",
        `<article style="--stagger:${Math.min(index, 10)}" class=`
      )
    )
    .join("");
  return `<div class="card-grid stagger-in">${cards}</div>`;
}
