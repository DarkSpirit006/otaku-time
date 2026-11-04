/* ============================================================
   Otaku Time — accessible custom select
   Progressive enhancement: the native <select> stays in the
   DOM and remains the source of truth; a combobox + listbox
   overlay is rendered beside it. Keyboard: Esc, Tab, arrows,
   Home/End, type-ahead. Re-enhances when new selects mount.
   ============================================================ */

import { qsa } from "../utils/dom.js";

const enhanced = new WeakSet();
const wrappers = new Set();

function optionLabel(option) {
  return (option.textContent || "").replace(/\s+/g, " ").trim();
}

function selectedValue(select) {
  return select.options[select.selectedIndex]?.value ?? "";
}

function renderOptions(select, listbox, activeIndex) {
  listbox.innerHTML = "";
  qsa("option", select).forEach((option, index) => {
    const li = document.createElement("li");
    li.className = "select__option";
    li.setAttribute("role", "option");
    li.id = `${listbox.id}-opt-${index}`;
    li.setAttribute("aria-selected", String(index === activeIndex));
    li.dataset.value = option.value;
    if (index === activeIndex) li.classList.add("is-active");
    if (option.disabled) li.setAttribute("aria-disabled", "true");
    li.textContent = optionLabel(option);
    listbox.appendChild(li);
  });
}

function closeWrapper(state, { returnFocus = false } = {}) {
  const el = state.wrapper;
  if (!el.classList.contains("is-open")) return;
  el.classList.remove("is-open");
  state.listbox.hidden = true;
  state.trigger.setAttribute("aria-expanded", "false");
  const active = state.listbox.querySelector(".select__option.is-active");
  if (active) active.classList.remove("is-active");
  if (returnFocus) state.trigger.focus();
}

function openWrapper(state) {
  const { select, trigger, listbox, wrapper: el } = state;
  closeAllSelects(state);
  const activeIndex = Math.max(0, select.selectedIndex);
  renderOptions(select, listbox, activeIndex);
  el.classList.add("is-open");
  listbox.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  const active = listbox.querySelectorAll(".select__option")[activeIndex];
  active?.classList.add("is-active");
  active?.scrollIntoView({ block: "nearest" });
}

function commit(state, index) {
  const { select } = state;
  const option = select.options[index];
  if (!option || option.disabled) return;
  if (select.selectedIndex !== index) {
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  syncTrigger(state);
  closeWrapper(state, { returnFocus: true });
}

/** Refresh the trigger text after the native select changed. */
export function syncTrigger(state) {
  const label = state.trigger.querySelector(".select__value");
  const option = state.select.options[state.select.selectedIndex];
  if (label && option) label.textContent = optionLabel(option);
}

function enhance(select) {
  if (enhanced.has(select)) return null;
  if (!select.id) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "select";
  wrapper.dataset.enhanced = "true";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select__trigger";
  trigger.id = `${select.id}-trigger`;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = '<span class="select__value"></span><span class="select__chevron"></span>';

  const listbox = document.createElement("ul");
  listbox.className = "select__menu";
  listbox.id = `${select.id}-listbox`;
  listbox.hidden = true;
  listbox.setAttribute("role", "listbox");
  listbox.tabIndex = -1;
  listbox.setAttribute("aria-label", select.getAttribute("aria-label") || "Options");

  wrapper.append(trigger, listbox);
  select.after(wrapper);
  select.setAttribute("aria-labelledby", trigger.id);
  select.classList.add("is-enhanced");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const state = { select, trigger, listbox, wrapper };
  wrappers.add(state);
  enhanced.add(select);
  syncTrigger(state);

  const optionIndexes = () => qsa("option", select).map((_, i) => i);
  const selectableIndexes = () =>
    optionIndexes().filter((i) => !select.options[i].disabled);

  const moveActive = (delta) => {
    const items = qsa(".select__option", listbox);
    if (!items.length) return;
    let index = items.findIndex((item) => item.classList.contains("is-active"));
    if (index < 0) index = 0;
    const step = delta > 0 ? 1 : -1;
    for (let i = 0; i < items.length; i++) {
      index = (index + step + items.length) % items.length;
      if (!select.options[index]?.disabled) break;
    }
    items.forEach((item, i) => item.classList.toggle("is-active", i === index));
    items[index]?.scrollIntoView({ block: "nearest" });
  };

  const commitActive = () => {
    const items = qsa(".select__option", listbox);
    const index = items.findIndex((item) => item.classList.contains("is-active"));
    if (index >= 0) commit(state, index);
  };

  let typeBuffer = "";
  let typeTimer = null;
  const typeAhead = (key) => {
    typeBuffer += key.toLowerCase();
    if (typeTimer) clearTimeout(typeTimer);
    typeTimer = setTimeout(() => (typeBuffer = ""), 700);
    const indexes = selectableIndexes();
    const match = indexes.find((i) => optionLabel(select.options[i]).toLowerCase().startsWith(typeBuffer));
    if (match !== undefined) commit(state, match);
  };

  trigger.addEventListener("click", () => {
    if (state.wrapper.classList.contains("is-open")) closeWrapper(state, { returnFocus: true });
    else openWrapper(state);
  });

  trigger.addEventListener("keydown", (event) => {
    // When the menu is already open the wrapper handles keys — letting both
    // levels run would double-advance the active option or commit instantly.
    const isOpen = state.wrapper.classList.contains("is-open");
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!isOpen) {
          event.stopPropagation();
          openWrapper(state);
          moveActive(event.key === "ArrowDown" ? 1 : -1);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!isOpen) {
          event.stopPropagation();
          openWrapper(state);
        }
        break;
      default:
        break;
    }
  });

  listbox.addEventListener("click", (event) => {
    const item = event.target.closest(".select__option");
    if (!item) return;
    const index = qsa(".select__option", listbox).indexOf(item);
    if (index >= 0) commit(state, index);
  });

  wrapper.addEventListener("keydown", (event) => {
    if (!wrapper.classList.contains("is-open")) return;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        closeWrapper(state, { returnFocus: true });
        break;
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        moveActive(-selectableIndexes().length || -1);
        break;
      case "End":
        event.preventDefault();
        moveActive(selectableIndexes().length || 1);
        break;
      case "Tab":
        closeWrapper(state);
        break;
      case "Enter":
        event.preventDefault();
        commitActive();
        break;
      case " ":
        event.preventDefault();
        commitActive();
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          typeAhead(event.key);
        }
    }
  });

  bindGlobalHandlers();
  return state;
}

let globalBound = false;
function bindGlobalHandlers() {
  if (globalBound) return;
  globalBound = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      for (const state of [...wrappers]) {
        if (!state.select.isConnected) {
          wrappers.delete(state);
          continue;
        }
        if (state.wrapper.classList.contains("is-open") && !state.wrapper.contains(event.target)) {
          closeWrapper(state);
        }
      }
    },
    true
  );
}

/** Enhance all currently-unenhanced native selects under root. */
export function enhanceSelects(root = document) {
  for (const state of [...wrappers]) {
    if (!state.select.isConnected) wrappers.delete(state);
  }
  for (const select of qsa("select", root)) enhance(select);
}

/** Keep newly mounted selects enhanced (dialogs render fresh HTML). */
export function observeSelects(root = document.body) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.("select")) enhance(node);
        else if (node.querySelector) enhanceSelects(node);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** Close every open custom select (optionally except one). */
export function closeAllSelects(except = null) {
  for (const state of [...wrappers]) {
    if (!state.select.isConnected) {
      wrappers.delete(state);
      continue;
    }
    if (state !== except) closeWrapper(state);
  }
}
