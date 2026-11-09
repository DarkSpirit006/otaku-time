import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownWideNarrow, Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AiringEvent, Media } from "../lib/types";
import { displayTitle } from "../lib/types";
import { airingPhase, groupByDay, isToday } from "../lib/time";
import { useNow, useToast, useWatchlist } from "../lib/store";
import { useSchedule } from "../lib/schedule-store";
import { Hero } from "../components/Hero";
import { ScheduleCard } from "../components/Cards";
import { CardSkeleton, ErrorState } from "../components/ui";

interface Props {
  onOpenDetail: (id: number, seed?: Media) => void;
}

type FormatFilter = "all" | "TV" | "MOVIE" | "OVA" | "ONA" | "watchlist";

export function Upcoming({ onOpenDetail }: Props) {
  const { events, loading, error, hasMore, loadingMore, loadMoreError, loadMore, reload } = useSchedule("upcoming");
  const { has, add, remove, refreshAiring } = useWatchlist();
  const toast = useToast();
  const [filter, setFilter] = useState<FormatFilter>("all");
  const [heroRevision, setHeroRevision] = useState(0);

  useEffect(() => {
    const now = Date.now() / 1000;
    const next = new Map<number, { mediaId: number; airingAt: number; episode: number }>();
    for (const e of events) {
      if (e.airingAt < now - 120) continue;
      const previous = next.get(e.mediaId);
      if (!previous || e.airingAt < previous.airingAt) next.set(e.mediaId, { mediaId: e.mediaId, airingAt: e.airingAt, episode: e.episode });
    }
    if (next.size) refreshAiring([...next.values()]);
  }, [events, refreshAiring]);

  const now = useNow(60_000);
  const filtered = useMemo(() => {
    let list = events.filter((e) => airingPhase(e.airingAt, now, e.media.duration) !== "aired");
    if (filter === "watchlist") list = list.filter((e) => has(e.mediaId));
    else if (filter !== "all") list = list.filter((e) => e.media.format === filter);
    return list;
  }, [events, filter, has, now]);

  const hero = useMemo(() => {
    const nowSec = Date.now() / 1000;
    return filtered.find((e) => e.airingAt > nowSec) ?? null;
  }, [filtered, heroRevision]);

  useEffect(() => {
    if (!hero) return;
    const delay = hero.airingAt * 1000 - Date.now();
    if (delay < 0) return;
    const timer = window.setTimeout(() => setHeroRevision((revision) => revision + 1), delay + 20);
    return () => window.clearTimeout(timer);
  }, [hero?.id, hero?.airingAt]);

  const titleSpan = (e: AiringEvent) => (
    <span className="max-w-[11rem] truncate align-bottom text-paper sm:max-w-none">{displayTitle(e.media)}</span>
  );
  const linedUp = useMemo(() => {
    return hero ? filtered.filter((e) => e.id !== hero.id) : filtered;
  }, [filtered, hero]);

  const days = useMemo(() => groupByDay(linedUp, Date.now()), [linedUp]);

  const toggleSave = (e: AiringEvent) => {
    if (has(e.mediaId)) {
      remove(e.mediaId);
      toast("Removed from watchlist", "info");
    } else {
      add(e.media);
      toast("Added to watchlist");
    }
  };

  if (loading && events.length === 0) {
    return (
      <div>
        <div className="skeleton mb-8 h-[26rem] w-full rounded-3xl sm:h-80" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (error && events.length === 0) return <ErrorState message={error} onRetry={() => reload()} />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      {hero && <Hero event={hero} saved={has(hero.mediaId)} onToggleSave={toggleSave} onOpen={onOpenDetail} />}

      {filtered.length > 1 && (
        <div className="mt-6 flex items-center gap-3 overflow-hidden rounded-full border border-line bg-ink-2 py-2.5 pl-4">
          <span className="mono-label flex shrink-0 items-center gap-1.5 !text-[0.72rem] text-accent">
            <Radio size={13} strokeWidth={2.2} /> Wire
          </span>
          <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]">
            <div className="flex w-max animate-ticker gap-8 whitespace-nowrap pr-8 motion-reduce:animate-none">
              {[...filtered.slice(1, 9), ...filtered.slice(1, 9)].map((e, i) => (
                <button
                  key={`${e.id}-${i}`}
                  tabIndex={-1}
                  onClick={() => onOpenDetail(e.mediaId, e.media)}
                  className="group/wire font-mono text-[0.8rem] text-paper-dim outline-none"
                  aria-hidden={i >= Math.min(filtered.length - 1, 8)}
                >
                  {titleSpan(e)}
                  <span className="text-paper-faint"> · Ep {e.episode}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-2 no-scrollbar overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]" role="group" aria-label="Filter schedule">
        {(["all", "watchlist", "TV", "MOVIE", "ONA", "OVA"] as FormatFilter[]).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={
              "tap-target relative shrink-0 rounded-full border px-5 py-2.5 text-[0.92rem] font-semibold transition-colors active:scale-95 " +
              (filter === f
                ? "border-accent bg-accent text-ink"
                : "border-line bg-ink-2 text-paper-dim hover:border-line-strong hover:text-paper")
            }
          >
            {f === "all" ? "Everything" : f === "watchlist" ? "My shows" : f === "TV" ? "TV" : f === "MOVIE" ? "Movies" : f}
          </button>
        ))}
      </div>

      <div className="mt-8 space-y-10">
        <AnimatePresence initial={false}>
          {days.map((day) => {
            const today = day.items.some((e) => isToday(e.airingAt, Date.now()));
            return (
              <section key={day.key}>
                <div className="mb-4 flex items-baseline justify-between gap-4">
                  <h3 className="flex items-baseline gap-3 font-display text-[1.5rem] font-extrabold uppercase tracking-tight sm:text-[1.75rem]">
                    {day.label}
                    {today && <span className="shrink-0 whitespace-nowrap rounded-full bg-accent px-2.5 py-0.5 font-mono text-[0.72rem] font-bold uppercase tracking-[0.14em] text-ink">Live today</span>}
                  </h3>
                  <span className="font-mono text-[0.8rem] text-paper-faint">
                    {day.dateLine} · {day.items.length} ep{day.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {day.items.map((e) => (
                    <ScheduleCard
                      key={e.id}
                      event={e}
                      saved={has(e.mediaId)}
                      onToggleSave={toggleSave}
                      onOpen={onOpenDetail}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </AnimatePresence>

        {days.length === 0 && filtered.length === 0 && !loading && (
          <p className="rounded-2xl border border-line bg-ink-2 px-6 py-14 text-center text-paper-dim">
            Nothing in this filter for the loaded window.
          </p>
        )}
      </div>

      {loadMoreError && <p role="alert" className="mt-5 text-center text-accent">{loadMoreError}</p>}
      {hasMore && (
        <div className="mt-10 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="tap-target flex items-center gap-2.5 rounded-full border border-line-strong px-7 py-3.5 text-[1rem] font-semibold text-paper-dim transition-colors hover:border-paper-faint hover:text-paper disabled:opacity-50 active:scale-95"
          >
            <ArrowDownWideNarrow size={18} strokeWidth={2} />
            {loadingMore ? "Loading…" : "Load further ahead"}
          </button>
        </div>
      )}
    </motion.div>
  );
}
