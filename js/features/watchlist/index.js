/* ============================================================
   Otaku Time — Watchlist section
   Local data only: stats strip + tracked poster grid,
   newest additions first. No filters — the list is yours.
   ============================================================ */

import { watchlist } from "../../storage/watchlist.js";
import { watchlistCard } from "../../components/card.js";
import { emptyState, notice, sectionHead } from "../../components/states.js";
import { esc } from "../../utils/dom.js";

function statsBlock(items) {
  const total = items.length;
  const completed = items.filter(
    (item) => Number.isInteger(item.episodes) && item.episodes > 0 && item.watched >= item.episodes
  ).length;
  const inProgress = items.filter((item) => item.watched > 0).length - completed;
  const episodes = items.reduce((sum, item) => sum + (Number.isInteger(item.watched) ? item.watched : 0), 0);

  return `<div class="stats" role="list" aria-label="Watchlist statistics">
    <div class="stat" role="listitem"><span class="stat__value">${total}</span><span class="stat__label">Titles tracked</span></div>
    <div class="stat" role="listitem"><span class="stat__value">${Math.max(0, inProgress)}</span><span class="stat__label">In progress</span></div>
    <div class="stat" role="listitem"><span class="stat__value">${completed}</span><span class="stat__label">Completed</span></div>
    <div class="stat" role="listitem"><span class="stat__value">${episodes}</span><span class="stat__label">Episodes watched</span></div>
  </div>`;
}

export function render(ctx) {
  const app = document.getElementById("app");
  const prefs = ctx.prefs();
  const storedProblem = watchlist.storageProblem();

  // Everything, newest first.
  const all = watchlist.all().slice().sort((a, b) => b.createdAt - a.createdAt);

  const head = sectionHead({
    eyebrow: "Your library",
    title: "Watchlist",
    meta: all.length
      ? `${all.length} title${all.length === 1 ? "" : "s"} · saved locally in this browser`
      : "",
    aside: "",
  });

  if (watchlist.isCorrupt()) {
    app.innerHTML = `${head}${notice(storedProblem, "danger")}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${emptyState({
          icon: "bell",
          title: "Saved data needs attention",
          text: "Your existing file was left untouched. You can import a backup from Settings.",
          action: `<button class="btn btn--secondary" data-action="open-settings">Open settings</button>`,
        })}
      </div>`;
    return;
  }

  if (!all.length) {
    app.innerHTML = `${head}${storedProblem ? notice(storedProblem, "warning") : ""}
      <div class="${ctx.animate ? "view-enter" : ""}">
        ${emptyState({
          icon: "sparkle",
          title: "Your watchlist is empty",
          text: "Save shows from Upcoming or Recently aired and they'll live here — stored only in this browser.",
          action: `<button class="btn btn--primary" data-action="go-upcoming">Browse upcoming</button>`,
        })}
      </div>`;
    return;
  }

  const cards = all
    .map(
      (item, index) =>
        watchlistCard(item, prefs).replace(
          "<article class=",
          `<article style="--stagger:${Math.min(index, 10)}" class=`
        )
    )
    .join("");

  app.innerHTML = `
    <div class="${ctx.animate ? "view-enter" : ""}">
      ${head}
      ${storedProblem ? notice(storedProblem, "warning") : ""}
      ${statsBlock(all)}
      <div class="card-grid${ctx.animate ? " stagger-in" : ""}">${cards}</div>
    </div>`;
}

export function handleAction(name, el, ctx) {
  if (name === "go-upcoming") {
    ctx.navigate?.("upcoming");
    return true;
  }
  if (name === "open-settings") {
    ctx.openSettings?.();
    return true;
  }
  return false;
}
