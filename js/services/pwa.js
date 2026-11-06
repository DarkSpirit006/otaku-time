/* ============================================================
   Otaku Time — service worker registration + update handshake

   Updates are never forced. A waiting worker is announced, the
   user decides, and the page reloads only after the new worker
   takes control.
   ============================================================ */

let registration = null;
let callbacks = {};
let reloading = false;
// A brand-new visitor gets a controller when the fresh worker calls
// clients.claim(). That is not an update, and reloading for it would
// throw away whatever the person had already typed or opened.
let hadController = false;
let updateRequested = false;

export function initPwa({ onUpdateReady, onControllerChange } = {}) {
  callbacks = { onUpdateReady, onControllerChange };

  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

  if ("serviceWorker" in navigator) {
    hadController = Boolean(navigator.serviceWorker.controller);
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController && !updateRequested) {
      // First-install claim: adopt the worker silently.
      hadController = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    callbacks.onControllerChange?.();
  });

  // The registration path is relative so GitHub Pages subpaths work.
  navigator.serviceWorker
    .register("./sw.js", { scope: "./" })
    .then((reg) => {
      registration = reg;
      hadController = hadController || Boolean(navigator.serviceWorker.controller);
      watchInstalling(reg);
      reg.addEventListener("updatefound", () => watchInstalling(reg));
      // Check for a new build when the tab regains focus.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    })
    .catch(() => {
      /* A failed registration must never break the app. */
    });
}

function watchInstalling(reg) {
  const worker = reg.installing;
  if (!worker) {
    if (reg.waiting && navigator.serviceWorker.controller) announce();
    return;
  }
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" && navigator.serviceWorker.controller) announce();
  });
}

function announce() {
  callbacks.onUpdateReady?.(() => {
    const waiting = registration?.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    updateRequested = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  });
}

/** Ask the browser to install the app (returns 'unavailable' when it cannot). */
export function promptInstall() {
  return "unavailable";
}
