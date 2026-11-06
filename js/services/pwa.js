/* ============================================================
   Otaku Time — service worker registration + update handshake

   Updates are never forced. A waiting worker is announced, the
   user decides, and the page reloads only after the new worker
   takes control.
   ============================================================ */

let registration = null;
let callbacks = {};
// The browser hands out one beforeinstallprompt event per page load, and
// only when the app is actually installable. Until it arrives there is no
// install to offer, and claiming otherwise would be a lie to the user.
let installEvent = null;
let reloading = false;
// A brand-new visitor gets a controller when the fresh worker calls
// clients.claim(). That is not an update, and reloading for it would
// throw away whatever the person had already typed or opened.
let hadController = false;
let updateRequested = false;

export function initPwa({ onUpdateReady, onControllerChange } = {}) {
  callbacks = { onUpdateReady, onControllerChange };

  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep the browser's own mini-infobar out of the way: the offer lives
    // in Settings, where the rest of the app's affordances are.
    event.preventDefault();
    installEvent = event;
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
  });

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

/** Has this browser offered an install that is still unused? */
export function canInstall() {
  return Boolean(installEvent);
}

/**
 * Ask the browser to install the app.
 *
 * Resolves to "accepted", "dismissed" or "unavailable". The captured
 * event is single-use by spec, so it is dropped before prompting: a
 * second call must not pretend an install is still on offer.
 */
export async function promptInstall() {
  if (!installEvent) return "unavailable";

  const event = installEvent;
  installEvent = null;

  try {
    event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    // Some browsers expose the event but refuse to open the dialog.
    return "unavailable";
  }
}
