import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info } from "lucide-react";
import type { Media, WatchEntry } from "./types";
import { displayTitle } from "./types";

const STORAGE_KEY = "otaku-time.watchlist.v2";
const BACKUP_KEY = "otaku-time.watchlist.backup";

const STATUS_VALUES = ["watching", "planned", "paused", "completed", "dropped"] as const;

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asStatus(v: unknown): WatchEntry["status"] {
  return STATUS_VALUES.includes(v as (typeof STATUS_VALUES)[number])
    ? (v as WatchEntry["status"])
    : "watching";
}

function coerceEntry(id: number, raw: unknown, nowTs: number): WatchEntry | null {
  if (!Number.isFinite(id) || !raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = asString(r.title);
  if (!title) return null;

  const total = asNumber(r.totalEpisodes);
  const progress = asNumber(r.progress);

  return {
    mediaId: id,
    title,
    cover: asString(r.cover),
    color: asString(r.color),
    format: asString(r.format),
    mediaStatus: asString(r.mediaStatus),
    totalEpisodes: total != null && total > 0 ? Math.floor(total) : undefined,
    progress: progress != null && progress >= 0 ? Math.floor(progress) : 0,
    status: asStatus(r.status),
    addedAt: asNumber(r.addedAt) ?? nowTs,
    updatedAt: asNumber(r.updatedAt) ?? nowTs,
    nextAiringAt: asNumber(r.nextAiringAt),
    nextEpisode: asNumber(r.nextEpisode),
  };
}

function quarantineStoredBlob() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const key = localStorage.getItem(BACKUP_KEY) === null ? BACKUP_KEY : `${BACKUP_KEY}.${Date.now()}`;
      localStorage.setItem(key, raw);
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch {

  }
}

function readEntries(): Record<number, WatchEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad shape");

    const nowTs = Date.now();
    const out: Record<number, WatchEntry> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = coerceEntry(Number(key), value, nowTs);
      if (entry) out[entry.mediaId] = entry;
    }
    return out;
  } catch {
    quarantineStoredBlob();
    return {};
  }
}

function importCandidates(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.entries)) return obj.entries;
    return Object.entries(obj).map(([key, value]) =>
      value && typeof value === "object" && !("mediaId" in value)
        ? { ...value, mediaId: Number(key) }
        : value
    );
  }
  return [];
}

function writeEntries(entries: Record<number, WatchEntry>): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

interface WatchlistCtx {
  entries: WatchEntry[];
  storageError: string;
  map: Record<number, WatchEntry>;
  has: (id: number) => boolean;
  add: (media: Media) => void;
  remove: (id: number) => void;
  bump: (id: number) => void;
  setProgress: (id: number, value: number) => void;
  setStatus: (id: number, status: WatchEntry["status"]) => void;
  importEntries: (raw: unknown) => number;
  clearAll: () => void;
  refreshAiring: (items: { mediaId: number; airingAt: number; episode: number }[]) => void;
}

const WatchlistContext = createContext<WatchlistCtx | null>(null);

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<number, WatchEntry>>(() => readEntries());
  const mapRef = useRef(map);
  const [storageError, setStorageError] = useState(() => {
    try { localStorage.getItem(STORAGE_KEY); return ""; }
    catch { return "Browser storage is unavailable. Changes may be lost when you close this page; export a backup."; }
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) {
        const next = readEntries();
        mapRef.current = next;
        setMap(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((updater: (prev: Record<number, WatchEntry>) => Record<number, WatchEntry>) => {
    const next = updater(mapRef.current);
    if (next === mapRef.current) return;
    mapRef.current = next;
    setMap(next);
    setStorageError(writeEntries(next) ? "" : "Could not save to browser storage. Changes may be lost when you close this page; export a backup.");
  }, []);

  const add = useCallback(
    (media: Media) =>
      commit((prev) => {
        if (prev[media.id]) return prev;
        return {
          ...prev,
          [media.id]: {
            mediaId: media.id,
            title: displayTitle(media),
            cover: media.coverImage.extraLarge || media.coverImage.large,
            color: media.coverImage.color,
            format: media.format,
            mediaStatus: media.status,
            totalEpisodes: media.episodes,
            progress: 0,
            status: "watching",
            addedAt: Date.now(),
            updatedAt: Date.now(),
            nextAiringAt: media.nextAiringEpisode?.airingAt,
            nextEpisode: media.nextAiringEpisode?.episode,
          },
        };
      }),
    [commit]
  );

  const remove = useCallback(
    (id: number) =>
      commit((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }),
    [commit]
  );

  const setProgress = useCallback(
    (id: number, value: number) =>
      commit((prev) => {
        const entry = prev[id];
        if (!entry) return prev;
        const max = entry.totalEpisodes;
        const clamped = Math.max(0, max ? Math.min(value, max) : value);
        return { ...prev, [id]: { ...entry, progress: clamped, updatedAt: Date.now() } };
      }),
    [commit]
  );

  const bump = useCallback(
    (id: number) =>
      commit((prev) => {
        const entry = prev[id];
        if (!entry) return prev;
        const max = entry.totalEpisodes;
        const nextVal = max ? Math.min(entry.progress + 1, max) : entry.progress + 1;
        const done = max ? nextVal >= max : false;
        return {
          ...prev,
          [id]: { ...entry, progress: nextVal, status: done ? "completed" : entry.status, updatedAt: Date.now() },
        };
      }),
    [commit]
  );

  const setStatus = useCallback(
    (id: number, status: WatchEntry["status"]) =>
      commit((prev) => {
        const entry = prev[id];
        if (!entry) return prev;
        return { ...prev, [id]: { ...entry, status, updatedAt: Date.now() } };
      }),
    [commit]
  );

  const clearAll = useCallback(() => commit(() => ({})), [commit]);

  const importEntries = useCallback(
    (raw: unknown): number => {
      const nowTs = Date.now();
      const next: Record<number, WatchEntry> = {};
      for (const item of importCandidates(raw)) {
        if (!item || typeof item !== "object") continue;
        const id = Number((item as Record<string, unknown>).mediaId);
        const entry = coerceEntry(id, item, nowTs);
        if (entry) next[entry.mediaId] = entry;
      }

      const count = Object.keys(next).length;
      if (count === 0) throw new Error("No valid watchlist entries found in that file.");
      commit(() => next);
      return count;
    },
    [commit]
  );

  const refreshAiring = useCallback(
    (items: { mediaId: number; airingAt: number; episode: number }[]) =>
      commit((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const { mediaId, airingAt, episode } of items) {
          const entry = next[mediaId];
          if (entry && (entry.nextAiringAt !== airingAt || entry.nextEpisode !== episode)) {
            next[mediaId] = { ...entry, nextAiringAt: airingAt, nextEpisode: episode };
            changed = true;
          }
        }
        return changed ? next : prev;
      }),
    [commit]
  );

  const entries = useMemo(
    () => Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt),
    [map]
  );
  const has = useCallback((id: number) => id in map, [map]);

  const value = useMemo(
    () => ({ entries, storageError, map, has, add, remove, bump, setProgress, setStatus, importEntries, clearAll, refreshAiring }),
    [entries, storageError, map, has, add, remove, bump, setProgress, setStatus, importEntries, clearAll, refreshAiring]
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistCtx {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error("useWatchlist outside provider");
  return ctx;
}

interface Toast {
  id: number;
  message: string;
  kind: "ok" | "info";
}

const ToastContext = createContext<(message: string, kind?: "ok" | "info") => void>(() => { });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((message: string, kind: "ok" | "info" = "ok") => {
    const id = ++idRef.current;
    setToasts([{ id, message, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(92px+env(safe-area-inset-bottom,0px))] z-[90] flex flex-col items-center gap-2 md:bottom-8 md:left-auto md:right-8 md:items-end"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 500, damping: 34 }}
              className="flex max-w-[min(26rem,calc(100vw-2rem))] items-center gap-2.5 rounded-full border border-line bg-ink-3/95 px-5 py-3 text-[0.95rem] font-medium shadow-2xl shadow-black/60 backdrop-blur"
            >
              {t.kind === "ok" ? (
                <CheckCircle2 size={18} className="shrink-0 text-gold" />
              ) : (
                <Info size={18} className="shrink-0 text-accent" />
              )}
              <span className="truncate">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

const clockSubscribers = new Set<() => void>();
let clockTimer = 0;
let clockNow = Date.now();

function ensureClock() {
  if (clockTimer || typeof window === "undefined") return;
  const tick = () => {
    clockNow = Date.now();
    for (const fn of clockSubscribers) fn();
  };
  clockTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") tick();
  }, 1000);
}

function stopClock() {
  if (clockTimer && clockSubscribers.size === 0) {
    window.clearInterval(clockTimer);
    clockTimer = 0;
  }
}

export function useNow(everyMs: number | null = 1000): number {
  const [, force] = useState(0);
  const lastRef = useRef(clockNow);

  useEffect(() => {
    if (everyMs === null) return;
    const onTick = () => {
      if (clockNow - lastRef.current >= everyMs - 50) {
        lastRef.current = clockNow;
        force((n) => n + 1);
      }
    };
    clockSubscribers.add(onTick);
    ensureClock();
    /* Catch up immediately when returning to a backgrounded tab */
    const onVis = () => {
      if (document.visibilityState === "visible") {
        clockNow = Date.now();
        lastRef.current = clockNow;
        force((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clockSubscribers.delete(onTick);
      document.removeEventListener("visibilitychange", onVis);
      stopClock();
    };
  }, [everyMs]);

  return everyMs === null ? clockNow : clockNow;
}
