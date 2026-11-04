/* ============================================================
   Otaku Time — DOM utilities
   ============================================================ */

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a value for safe interpolation into HTML strings. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

/** querySelector shorthand. */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** querySelectorAll shorthand returning a real array. */
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Delegate an event listener: fires when `selector` matches within `root`.
 * Returns a cleanup function.
 */
export function delegate(root, type, selector, handler) {
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

/** Remove an element after its exit animation (or immediately if reduced motion). */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
