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
import { ApiError, fetchSchedule } from "./api";
import type { AiringEvent } from "./types";

export interface KindState {
  events: AiringEvent[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadMoreError: string;
  error: string;
  syncedAt: number;
}

const empty: KindState = {
  events: [],
  page: 0,
  hasMore: false,
  loading: true,
  loadingMore: false,
  loadMoreError: "",
  error: "",
  syncedAt: 0,
};

export interface KindApi extends KindState {

  reload: () => void;
  loadMore: () => void;
}

/* Freshness policy -------------------------------------------------------
   No refresh button, no pull gesture. The store keeps itself current:
   • a visible tab ticks every SYNC_INTERVAL_MS and refetches once the data
     is older than STALE_AFTER_MS,
   • returning to the tab, refocusing the window or coming back online
     refetches immediately if stale.
   Background refetches are silent: no skeleton, no error banner, and the
   reader's "load further ahead" pages are preserved. */
const SYNC_INTERVAL_MS = 20_000;
const STALE_AFTER_MS = 60_000;
const INITIAL_PAGES = 3;

type Kind = "upcoming" | "recent";

function mergeEvents(existing: AiringEvent[], incoming: AiringEvent[]): AiringEvent[] {
  const byId = new Map<number, AiringEvent>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.airingAt - b.airingAt);
}

function useKind(kind: Kind): KindApi {
  const [state, setState] = useState<KindState>(empty);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const busyRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(
    async ({ background = false }: { background?: boolean } = {}) => {

      if (background && (busyRef.current || stateRef.current.loadingMore)) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const gen = ++genRef.current;
      busyRef.current = true;

      if (!background) setState((s) => ({ ...s, loading: true, loadingMore: false, error: "" }));

      try {
        /* Refetch every page the reader already pulled in, so a refresh can
           never shrink the list or resurrect a stale entry. */
        const targetPages = background
          ? Math.max(stateRef.current.page, INITIAL_PAGES)
          : INITIAL_PAGES;

        const pages = await Promise.all(
          Array.from({ length: targetPages }, (_, i) =>
            fetchSchedule(kind, i + 1, controller.signal)
          )
        );
        if (genRef.current !== gen) return;

        setState((s) => ({
          ...s,
          events: mergeEvents([], pages.flatMap((p) => p.items)),
          page: Math.max(...pages.map((p) => p.page)),
          hasMore: pages[pages.length - 1].hasMore,
          loading: false,
          error: "",
          syncedAt: Date.now(),
        }));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (genRef.current !== gen) return;

        /* A failed background pass keeps the last good data on screen. */
        if (background) return;

        const message =
          err instanceof ApiError && err.status === 0
            ? "You appear to be offline. Reconnect and retry."
            : err instanceof Error
              ? err.message
              : "Something went wrong loading the schedule.";
        setState((s) => ({ ...s, loading: false, loadingMore: false, error: message }));
      } finally {
        if (genRef.current === gen) busyRef.current = false;
      }
    },
    [kind]
  );

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (s.loading || s.loadingMore || !s.hasMore || busyRef.current) return;
    const gen = genRef.current;
    setState((prev) => ({ ...prev, loadingMore: true, loadMoreError: "" }));
    try {
      const next = await fetchSchedule(kind, s.page + 1, abortRef.current?.signal ?? undefined);
      if (genRef.current !== gen) return;
      setState((prev) => ({
        ...prev,
        events: mergeEvents(prev.events, next.items),
        page: next.page,
        hasMore: next.hasMore,
        loadingMore: false,
      }));
    } catch {
      if (genRef.current !== gen) return;
      setState((prev) => ({ ...prev, loadingMore: false, loadMoreError: "Could not load more episodes. Check your connection and try again." }));
    }
  }, [kind]);

  useEffect(() => {
    load();

    const refreshIfStale = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - stateRef.current.syncedAt < STALE_AFTER_MS) return;
      load({ background: true });
    };

    const timer = window.setInterval(refreshIfStale, SYNC_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfStale);
    window.addEventListener("focus", refreshIfStale);
    window.addEventListener("online", refreshIfStale);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfStale);
      window.removeEventListener("focus", refreshIfStale);
      window.removeEventListener("online", refreshIfStale);
      abortRef.current?.abort();
    };
  }, [load]);

  return useMemo(() => ({ ...state, reload: load, loadMore }), [state, load, loadMore]);
}

const ScheduleContext = createContext<{ upcoming: KindApi; recent: KindApi } | null>(null);

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const upcoming = useKind("upcoming");
  const recent = useKind("recent");
  const value = useMemo(() => ({ upcoming, recent }), [upcoming, recent]);
  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

export function useSchedule(kind: Kind): KindApi {
  const ctx = useContext(ScheduleContext);
  if (!ctx) throw new Error("useSchedule outside provider");
  return ctx[kind];
}
