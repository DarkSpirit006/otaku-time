/* ============================================================
   Otaku Time — command palette + shortcut help

   One accessible listbox. Commands come from the app so the
   palette can reach navigation, watchlist actions, settings and
   live AniList search without knowing how any of them work.
   ============================================================ */

import { esc, qs } from "../utils/dom.js";
import { icon } from "./icons.js";

let dialog = null;
let input = null;
let list = null;
let provider = null;
let items = [];
let active = -1;
let searchTimer = null;
let searchToken = 0;

export function initPalette({ getCommands, onRun, onSearch }) {
  dialog = qs("#palette-dialog");
  const root = qs("#palette-content");
  if (!dialog || !root) return;
  provider = { getCommands, onRun, onSearch };

  root.innerHTML = `
    <div class="palette__field">
      ${icon("search", "palette__icon")}
      <label class="sr-only" for="palette-input">Command or search</label>
      <input id="palette-input" type="text" role="combobox" aria-expanded="true"
        aria-controls="palette-list" aria-autocomplete="list" autocomplete="off" spellcheck="false"
        placeholder="Jump to a section, search anime, run an action…" />
      <kbd aria-hidden="true">Esc</kbd>
    </div>
    <div class="palette__list" id="palette-list" role="listbox" aria-label="Commands"></div>
    <p class="palette__hint">↑↓ to move · Enter to run · Esc to close</p>`;

  input = qs("#palette-input", root);
  list = qs("#palette-list", root);

  input.addEventListener("input", () => refresh());
  input.addEventListener("keydown", onKeyDown);
  list.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (!option) return;
    run(Number(option.dataset.index));
  });

  dialog.addEventListener("close", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
  });
}

export function openPalette(prefill = "") {
  if (!dialog?.open) dialog.showModal();
  input.value = prefill;
  refresh();
  input.focus();
  input.select();
}

export function closePalette() {
  if (dialog?.open) dialog.close();
}

export function isPaletteOpen() {
  return Boolean(dialog?.open);
}

function refresh() {
  const query = input.value.trim();
  const base = provider.getCommands(query) || [];
  items = base;
  render(query);

  if (searchTimer) clearTimeout(searchTimer);
  if (!query || !provider.onSearch) return;

  const token = ++searchToken;
  searchTimer = setTimeout(async () => {
    const extra = await provider.onSearch(query);
    if (token !== searchToken || input.value.trim() !== query) return;
    const seen = new Set(items.map((item) => item.id));
    items = [...items, ...(extra || []).filter((item) => !seen.has(item.id))];
    render(query);
  }, 220);
}

function render(query) {
  active = items.length ? 0 : -1;
  if (!items.length) {
    list.innerHTML = `<p class="palette__empty">No commands match ${esc(query || "that")}.</p>`;
    input.removeAttribute("aria-activedescendant");
    return;
  }

  let group = "";
  list.innerHTML = items
    .map((item, index) => {
      const heading =
        item.group && item.group !== group
          ? ((group = item.group), `<p class="palette__group" aria-hidden="true">${esc(item.group)}</p>`)
          : "";
      const selected = index === active;
      return `${heading}<button class="palette__item${selected ? " is-active" : ""}" role="option"
        id="palette-option-${index}" data-index="${index}" aria-selected="${selected}">
        <span class="palette__item-icon" aria-hidden="true">${icon(item.icon || "chevron-right")}</span>
        <span class="palette__item-label">${esc(item.label)}</span>
        ${item.hint ? `<span class="palette__item-hint">${esc(item.hint)}</span>` : ""}
      </button>`;
    })
    .join("");

  input.setAttribute("aria-activedescendant", "palette-option-0");
}

function move(delta) {
  if (!items.length) return;
  active = (active + delta + items.length) % items.length;
  for (const option of list.querySelectorAll("[data-index]")) {
    const index = Number(option.dataset.index);
    const selected = index === active;
    option.classList.toggle("is-active", selected);
    option.setAttribute("aria-selected", selected ? "true" : "false");
  }
  const node = qs(`#palette-option-${active}`, list);
  input.setAttribute("aria-activedescendant", `palette-option-${active}`);
  node?.scrollIntoView({ block: "nearest" });
}

function onKeyDown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    move(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    move(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    run(active);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closePalette();
  } else if (event.key === "Tab") {
    // Keep focus inside the palette: it is a modal.
    event.preventDefault();
  }
}

function run(index) {
  const item = items[index];
  if (!item) return;
  closePalette();
  provider.onRun(item);
}

/* ------------------------------------------------------------
   Keyboard help
   ------------------------------------------------------------ */

const SHORTCUTS = [
  ["g then u", "Go to Upcoming"],
  ["g then w", "Go to Watchlist"],
  ["g then r", "Go to Recently aired"],
  ["g then c", "Open the week calendar"],
  ["Ctrl / ⌘ + K", "Command palette"],
  ["j / k", "Move through the current list"],
  ["Enter", "Open the focused title"],
  ["s", "Save or remove the focused title"],
  ["+ / −", "Step episode progress on the focused title"],
  ["f", "Toggle watchlist filters"],
  ["t", "Switch theme"],
  ["/", "Focus search"],
  ["?", "This help"],
  ["Esc", "Close dialog, palette or search"],
];

export function renderHelp() {
  const root = qs("#help-content");
  if (!root) return;
  root.innerHTML = `
    <div class="settings-head">
      <div>
        <h2 id="help-title" tabindex="-1">Keyboard shortcuts</h2>
        <p>Shortcuts are ignored while you type in a field.</p>
      </div>
      <button class="dialog__close" data-help-close aria-label="Close shortcuts">${icon("close")}</button>
    </div>
    <div class="settings-scroll" tabindex="0" role="region" aria-label="Keyboard shortcuts list">
      <dl class="shortcut-list">
        ${SHORTCUTS.map(
          ([keys, label]) =>
            `<div class="shortcut"><dt>${keys
              .split(" then ")
              .map((key) => `<kbd>${esc(key)}</kbd>`)
              .join('<span aria-hidden="true">+</span>')}</dt><dd>${esc(label)}</dd></div>`
        ).join("")}
      </dl>
      <p class="settings-hint">Arrow keys and Tab always work as usual; the palette is the only modal that captures them.</p>
    </div>`;
}

export function openHelp() {
  const dialogEl = qs("#help-dialog");
  if (!dialogEl?.showModal) return;
  renderHelp();
  if (!dialogEl.open) dialogEl.showModal();
  qs("#help-title")?.focus?.();
}

export function closeHelp() {
  const dialogEl = qs("#help-dialog");
  if (dialogEl?.open) dialogEl.close();
}

export function isHelpOpen() {
  return Boolean(qs("#help-dialog")?.open);
}
