/* One browser-wide installation manager. Initialise before React mounts so the
   one-shot beforeinstallprompt event is retained even if no sheet is open. */
import { useSyncExternalStore } from "react";

type InstallChoice = { outcome: "accepted" | "dismissed"; platform?: string };
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<InstallChoice | void>;
  userChoice?: Promise<InstallChoice>;
}
export type InstallPlatform = "ios" | "android" | "desktop";
type InstallStatus = "idle" | "prompting" | "accepted" | "dismissed" | "unavailable" | "installed";
interface Snapshot {
  platform: InstallPlatform;
  installed: boolean;
  canPrompt: boolean;
  status: InstallStatus;
}

function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  // iPadOS may identify itself as a Mac; real Macs do not have touch points.
  if (/iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/i.test(ua) ? "android" : "desktop";
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

let initialized = false;
let deferred: BeforeInstallPromptEvent | null = null;
let snapshot: Snapshot = { platform: "desktop", installed: false, canPrompt: false, status: "idle" };
const subscribers = new Set<() => void>();
function update(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  subscribers.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function initializePwaInstall() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const installed = isStandalone();
  snapshot = { platform: detectPlatform(), installed, canPrompt: false, status: installed ? "installed" : "idle" };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    if (snapshot.installed) return;
    deferred = event as BeforeInstallPromptEvent;
    if (snapshot.status !== "prompting") update({ canPrompt: true, status: "idle" });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    update({ installed: true, canPrompt: false, status: "installed" });
  });
  const onDisplayModeChange = () => {
    const inStandalone = isStandalone();
    if (inStandalone) {
      deferred = null;
      update({ installed: true, canPrompt: false, status: "installed" });
    } else if (snapshot.installed) {
      update({ installed: false, canPrompt: !!deferred, status: "idle" });
    }
  };
  if (displayMode.addEventListener) displayMode.addEventListener("change", onDisplayModeChange);
  else displayMode.addListener(onDisplayModeChange); // older Safari
}

/** Must be called directly from a click handler to retain user activation. */
async function promptInstall() {
  const event = deferred;
  if (snapshot.installed || snapshot.status === "prompting") return;
  if (!event) {
    update({ canPrompt: false, status: "unavailable" });
    return;
  }
  deferred = null; // Native events are single-use, including after dismissal.
  update({ canPrompt: false, status: "prompting" });
  try {
    const result = await event.prompt();
    const choice = event.userChoice ? await event.userChoice : result;
    if (!snapshot.installed) update({ canPrompt: !!deferred, status: choice?.outcome === "accepted" ? "accepted" : choice?.outcome === "dismissed" ? "dismissed" : "unavailable" });
  } catch {
    if (!snapshot.installed) update({ canPrompt: !!deferred, status: "unavailable" });
  }
}

export function usePwaInstall() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return { ...state, promptInstall };
}
