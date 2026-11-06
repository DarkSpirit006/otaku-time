/* ============================================================
   Otaku Time — toast (single polite live region in index.html)

   Supports one optional action ("Undo", "Update", "Retry").
   A repeated identical message is re-announced: the live region is
   emptied and refilled on the next frame so assistive technology
   sees a genuine change instead of a no-op mutation.
   ============================================================ */

let timer = null;
let actionHandler = null;

function parts() {
  const toast = document.getElementById("toast");
  if (!toast) return null;
  return {
    toast,
    text: toast.querySelector(".toast__text"),
    action: toast.querySelector(".toast__action"),
  };
}

/**
 * Show a toast.
 * @param {string} message
 * @param {number|{ms?:number, actionLabel?:string, onAction?:Function, tone?:'info'|'warn'|'error'}} [options]
 */
export function showToast(message, options = {}) {
  const settings = typeof options === "number" ? { ms: options } : options || {};
  const ms = settings.ms ?? (settings.actionLabel ? 6000 : 4000);
  const node = parts();
  if (!node || !message) return;
  const { toast, text, action } = node;

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (action) {
    actionHandler = typeof settings.onAction === "function" ? settings.onAction : null;
    const label = settings.actionLabel || "";
    if (action.dataset.label !== label) {
      action.textContent = label;
      action.dataset.label = label;
    }
    action.hidden = !label;
  }

  toast.dataset.tone = settings.tone || "info";
  toast.classList.add("is-visible");

  const paint = () => {
    if (text) text.textContent = message;
    else toast.textContent = message;
  };

  // Identical message → clear first so the live region registers a change.
  const current = text ? text.textContent : toast.textContent;
  if (current === message) {
    if (text) text.textContent = "";
    else toast.textContent = "";
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(paint);
    else setTimeout(paint, 16);
  } else {
    paint();
  }

  timer = setTimeout(() => hideToast(), ms);
}

/** Hide the toast and forget any pending action. */
export function hideToast() {
  const node = parts();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  actionHandler = null;
  if (!node) return;
  node.toast.classList.remove("is-visible");
  if (node.action) {
    node.action.hidden = true;
    node.action.dataset.label = "";
  }
}

/** Wire the toast action button once at boot. */
export function initToast() {
  const node = parts();
  if (!node?.action) return;
  node.action.addEventListener("click", () => {
    const handler = actionHandler;
    hideToast();
    if (handler) handler();
  });
}

/** True when a toast with an action is currently visible. */
export function toastActionVisible() {
  const node = parts();
  return Boolean(node?.action && !node.action.hidden);
}
