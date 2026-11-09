import { motion } from "framer-motion";
import { ArrowDownWideNarrow } from "lucide-react";
import { useMemo } from "react";
import type { AiringEvent, Media } from "../lib/types";
import { groupByDay } from "../lib/time";
import { useToast, useWatchlist } from "../lib/store";
import { useSchedule } from "../lib/schedule-store";
import { RecentRow } from "../components/Cards";
import { ErrorState, RowSkeleton } from "../components/ui";

export function Recent({ onOpenDetail }: { onOpenDetail: (id: number, seed?: Media) => void }) {
  const { events, loading, error, hasMore, loadingMore, loadMoreError, loadMore, reload } = useSchedule("recent");
  const { has, add, remove } = useWatchlist();
  const toast = useToast();

  const days = useMemo(() => {
    const grouped = groupByDay(events, Date.now());
    for (const g of grouped) g.items.reverse();
    grouped.sort((a, b) => b.items[0].airingAt - a.items[0].airingAt);
    return grouped;
  }, [events]);

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
      <div className="rounded-2xl border border-line bg-ink-2 px-4 py-2 sm:px-5">
        {Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)}
      </div>
    );
  }

  if (error && events.length === 0) return <ErrorState message={error} onRetry={() => reload()} />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <div className="space-y-8">
        {days.map((day) => (
          <section key={day.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-4">
              <h3 className="font-display text-[1.4rem] font-extrabold uppercase tracking-tight sm:text-[1.6rem]">
                {day.label}
              </h3>
              <span className="font-mono text-[0.8rem] text-paper-faint">
                {day.dateLine} · {day.items.length}
              </span>
            </div>
            <div className="rounded-2xl border border-line bg-ink-2 px-4 sm:px-5">
              {day.items.map((e) => (
                <RecentRow
                  key={e.id}
                  event={e}
                  saved={has(e.mediaId)}
                  onToggleSave={toggleSave}
                  onOpen={onOpenDetail}
                />
              ))}
            </div>
          </section>
        ))}

        {days.length === 0 && !loading && (
          <p className="rounded-2xl border border-line bg-ink-2 px-6 py-14 text-center text-paper-dim">
            Nothing aired in the loaded window yet.
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
            {loadingMore ? "Loading…" : "Load earlier episodes"}
          </button>
        </div>
      )}
    </motion.div>
  );
}
