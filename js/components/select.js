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

function closeWrapper(wrapper, { returnFocus = false } = {}) {
  if (!wrapper.classList.contains("is-open")) return;
  wrapper.classList.remove("is-open");
  wrapper.listbox.hidden = true;
  wrapper.trigger.setAttribute("aria-expanded", "false");
  const active = wrapper.listbox.querySelector(".select__option.is-active");
  if (active) active.classList.remove("is-active");
  if (returnFocus) wrapper.trigger.focus();
}

function openWrapper(wrapper) {
  const { select, trigger, listbox } = wrapper;
  for (const other of wrappers) {
    if (other !== wrapper) closeWrapper(other);
  }
  const options = qsa("option", select);
  const activeIndex = Math.max(0, select.selectedIndex);
  renderOptions(select, listbox, activeIndex);
  wrapper.classList.add("is-open");
  listbox.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  const active = listbox.querySelectorAll(".select__option")[activeIndex];
  active?.classList.add("is-active");
  active?.scrollIntoView({ block: "nearest" });
}

function commit(wrapper, index) {
  const { select } = wrapper;
  const option = select.options[index];
  if (!option || option.disabled) return;
  if (select.selectedIndex !== index) {
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  syncTrigger(wrapper);
  closeWrapper(wrapper, { returnFocus: true });
}

/** Refresh the trigger text after the native select changed. */
export function syncTrigger(wrapper) {
  const label = wrapper.trigger.querySelector(".select__value");
  const option = wrapper.select.options[wrapper.select.selectedIndex];
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
    if (wrapper.classList.contains("is-open")) closeWrapper(state, { returnFocus: true });
    else openWrapper(state);
  });

  trigger.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        openWrapper(state);
        moveActive(event.key === "ArrowDown" ? 1 : -1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        openWrapper(state);
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

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (wrapper.classList.contains("is-open") && !wrapper.contains(event.target)) {
        closeWrapper(state);
      }
    },
    true
  );

  return state;
}

/** Enhance all currently-unenhanced native selects under root. */
export function enhanceSelects(root = document) {
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

/** Close every open custom select. */
export function closeAllSelects() {
  for (const wrapper of wrappers) closeWrapper(wrapper);
}
