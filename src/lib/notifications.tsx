/* Local, opt-in reminders. A page must be running for the timer to fire;
   service workers display notifications but cannot schedule them by themselves. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWatchlist } from "./store";
import { useSchedule } from "./schedule-store";

const KEY = "otaku-time.notifications.v1";
const SENT_KEY = "otaku-time.notifications.sent.v1";
type Settings = { enabled: boolean; minutes: number; muted: number[] };
const defaults: Settings = { enabled: false, minutes: 15, muted: [] };
const LEADS = [0, 5, 15, 60];
function readSettings(): Settings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return { enabled: value?.enabled === true, minutes: LEADS.includes(value?.minutes) ? value.minutes : 15,
      muted: Array.isArray(value?.muted) ? value.muted.filter((id: unknown) => typeof id === "number" && Number.isFinite(id)) : [] };
  } catch { return defaults; }
}
const getPermission = (): NotificationPermission | "unsupported" =>
  typeof Notification === "undefined" || !window.isSecureContext ? "unsupported" : Notification.permission;

async function displayNotification(title: string, options: NotificationOptions) {
  // Android Chromium requires ServiceWorkerRegistration.showNotification.
  let registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL) : undefined;
  // A fresh install may still be activating its worker when a reminder is due.
  if (!registration?.active && import.meta.env.PROD && "serviceWorker" in navigator) {
    registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>(resolve => window.setTimeout(() => resolve(undefined), 5000)),
    ]);
  }
  if (registration?.active) await registration.showNotification(title, options);
  else new Notification(title, options);
}

type NotificationsContextValue = {
  settings: Settings;
  permission: NotificationPermission | "unsupported";
  error: string;
  enable: () => Promise<void>;
  disable: () => void;
  setMinutes: (minutes: number) => void;
  toggleShow: (id: number) => void;
  test: () => Promise<void>;
};
const Context = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { entries } = useWatchlist();
  const { events } = useSchedule("upcoming");
  const [settings, setSettings] = useState(readSettings);
  const [permission, setPermission] = useState(getPermission);
  const [error, setError] = useState("");
  const inFlight = useRef(new Set<string>());
  const sentInMemory = useRef(new Set<string>());
  const update = useCallback((fn: (previous: Settings) => Settings) => {
    setSettings(previous => {
      const next = fn(previous);
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {  }
      return next;
    });
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === KEY) setSettings(readSettings()); };
    const refreshPermission = () => setPermission(getPermission());
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refreshPermission);
    document.addEventListener("visibilitychange", refreshPermission);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", refreshPermission); document.removeEventListener("visibilitychange", refreshPermission); };
  }, []);

  const enable = useCallback(async () => {
    setError("");
    if (getPermission() === "unsupported") { setPermission("unsupported"); return; }
    try {
      const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") update(s => ({ ...s, enabled: true }));
      else setError(result === "denied" ? "Notifications are blocked. Allow them in your browser or device settings." : "Notification permission was not granted.");
    } catch { setError("Could not request permission. Check your browser settings."); }
  }, [update]);
  const disable = useCallback(() => update(s => ({ ...s, enabled: false })), [update]);
  const setMinutes = useCallback((minutes: number) => { if (LEADS.includes(minutes)) update(s => ({ ...s, minutes })); }, [update]);
  const toggleShow = useCallback((id: number) => update(s => ({ ...s, muted: s.muted.includes(id) ? s.muted.filter(x => x !== id) : [...s.muted, id] })), [update]);
  const test = useCallback(async () => {
    setError("");
    try {
      if (getPermission() !== "granted") throw new Error("permission");
      await displayNotification("Otaku Time", { body: "Notifications are working while the app is open.", icon: `${import.meta.env.BASE_URL}icons/icon-192.png`, tag: "otaku-time-test" });
    } catch { setError("Could not show a notification. Check browser and device notification settings; on iOS, install and open the app from your Home Screen."); }
  }, []);

  useEffect(() => {
    if (!settings.enabled || permission !== "granted") return;
    let alive = true;
    const check = () => {
      const now = Date.now();
      for (const entry of entries) {
        if (settings.muted.includes(entry.mediaId)) continue;

        const upcoming = events.filter(e => e.mediaId === entry.mediaId && e.airingAt * 1000 >= now - 120_000)
          .reduce<(typeof events)[number] | undefined>((best, e) => !best || e.airingAt < best.airingAt ? e : best, undefined);
        const at = upcoming?.airingAt ?? entry.nextAiringAt;
        const episode = upcoming?.episode ?? entry.nextEpisode;
        if (!at || now < at * 1000 - settings.minutes * 60_000 || now > at * 1000 + 120_000) continue;
        const key = `${entry.mediaId}:${at}`;
        if (inFlight.current.has(key) || sentInMemory.current.has(key)) continue;
        inFlight.current.add(key);
        const deliver = async () => {
          try {
            let sent: Record<string, number> = {};
            try { sent = JSON.parse(localStorage.getItem(SENT_KEY) || "{}"); if (!sent || typeof sent !== "object") sent = {}; } catch {  }
            if (sent[key] || !alive || getPermission() !== "granted") return;
            const body = `${episode ? `Episode ${episode}` : "A new episode"} ${at * 1000 <= Date.now() ? "is airing now" : `airs at ${new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}.`;
            await displayNotification(entry.title, { body, icon: `${import.meta.env.BASE_URL}icons/icon-192.png`, tag: `otaku-time-${key}`, data: { mediaId: entry.mediaId } });
            sentInMemory.current.add(key);
            sent[key] = Date.now();
            const trimmed = Object.fromEntries(Object.entries(sent).filter(([, time]) => typeof time === "number" && time > Date.now() - 30 * 86400_000));
            try { localStorage.setItem(SENT_KEY, JSON.stringify(trimmed)); } catch {  }
          } catch { if (alive) setError("Could not show a reminder. Check browser and device notification settings."); }
          finally { inFlight.current.delete(key); }
        };
        // Serialize across open tabs where Web Locks are available.
        if (navigator.locks) navigator.locks.request(`otaku-time-notification-${key}`, deliver).catch(() => { inFlight.current.delete(key); });
        else void deliver();
      }
    };
    check();
    const timer = window.setInterval(check, 15_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", check); window.removeEventListener("focus", check); };
  }, [settings, permission, entries, events]);

  const value = useMemo(() => ({ settings, permission, error, enable, disable, setMinutes, toggleShow, test }), [settings, permission, error, enable, disable, setMinutes, toggleShow, test]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useNotifications() {
  const value = useContext(Context);
  if (!value) throw new Error("useNotifications outside provider");
  return value;
}
