/* ============================================================
   Otaku Time — tiny event bus for cross-module updates
   ============================================================ */

const target = new EventTarget();

/** Subscribe to a bus event. Returns an unsubscribe function. */
export function on(type, handler) {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

/** Publish a bus event with an optional detail object. */
export function emit(type, detail = {}) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

/* Event names (documented contract):
   watchlist:changed — {reason}
   prefs:changed      — {prefs}
   theme:changed      — {theme}
   schedule:changed   — {kind}
   section:changed    — {section}
   focus-search       — {}
*/
