import { AnimatePresence, motion } from "framer-motion";
import { BookmarkPlus } from "lucide-react";
import { useMemo, useState } from "react";
import type { AiringEvent, Media, WatchEntry } from "../lib/types";
import { useWatchlist } from "../lib/store";
import { useSchedule } from "../lib/schedule-store";
import { airedInfo, type AiredInfo } from "../lib/aired";
import { WatchlistCard } from "../components/Cards";

type Sort = "recent" | "next" | "title" | "progress";
type StatusFilter = "all" | WatchEntry["status"];

export function Watchlist({
  onOpenDetail,
  onGoUpcoming,
}: {
  onOpenDetail: (id: number, seed?: Media) => void;
  onGoUpcoming: () => void;
}) {
  const { entries, storageError, bump, setProgress, setStatus, remove } = useWatchlist();
  const { events } = useSchedule("upcoming");
  const { events: recentEvents } = useSchedule("recent");
  const [sort, setSort] = useState<Sort>("recent");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: entries.length, watching: 0, planned: 0, paused: 0, completed: 0, dropped: 0 };
    for (const e of entries) counts[e.status]++;
    return counts;
  }, [entries]);

  const liveByMedia = useMemo(() => {
    const nowSec = Date.now() / 1000;
    const map = new Map<number, AiringEvent>();
    for (const e of events) {
      const cur = map.get(e.mediaId);
      if (!cur) {
        map.set(e.mediaId, e);
        continue;
      }
      const curFuture = cur.airingAt > nowSec;
      const eFuture = e.airingAt > nowSec;
      if (eFuture && (!curFuture || e.airingAt < cur.airingAt)) map.set(e.mediaId, e);
      else if (!eFuture && !curFuture && e.airingAt > cur.airingAt) map.set(e.mediaId, e);
    }
    return map;
  }, [events]);

  const recentLatestByMedia = useMemo(() => {
    const nowSec = Date.now() / 1000;
    const map = new Map<number, number>();
    for (const e of recentEvents) {
      if (e.airingAt > nowSec) continue;
      map.set(e.mediaId, Math.max(map.get(e.mediaId) ?? 0, e.episode));
    }
    return map;
  }, [recentEvents]);

  const infoByMedia = useMemo(() => {
    const now = Date.now();
    const map = new Map<number, AiredInfo>();
    for (const entry of entries) {
      map.set(
        entry.mediaId,
        airedInfo(entry, liveByMedia.get(entry.mediaId), recentLatestByMedia.get(entry.mediaId), now)
      );
    }
    return map;
  }, [entries, liveByMedia, recentLatestByMedia]);

  const visible = useMemo(
    () => (statusFilter === "all" ? entries : entries.filter((e) => e.status === statusFilter)),
    [entries, statusFilter]
  );

  const sorted = useMemo(() => {
    const list = [...visible];
    if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "next")
      list.sort(
        (a, b) =>
          (infoByMedia.get(a.mediaId)?.nextAiringAt ?? Infinity) -
          (infoByMedia.get(b.mediaId)?.nextAiringAt ?? Infinity)
      );
    else if (sort === "progress") list.sort((a, b) => b.progress - a.progress);
    else list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }, [visible, sort, infoByMedia]);

  const stats = useMemo(() => {
    const now = Date.now();
    const watched = entries.reduce((n, e) => n + e.progress, 0);
    const airingSoon = entries.filter((e) => {
      const at = infoByMedia.get(e.mediaId)?.nextAiringAt;
      return at && at * 1000 - now < 24 * 3600_000 && at * 1000 > now - 3 * 3600_000;
    }).length;

    const behind = entries.filter((e) => {
      const info = infoByMedia.get(e.mediaId);
      return info?.behind != null && info.behind > 0;
    }).length;
    return { shows: entries.length, watched, airingSoon, behind };
  }, [entries, infoByMedia]);

  if (entries.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-3xl border border-dashed border-line-strong bg-ink-2/50 px-6 py-16 text-center"
      >
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent-soft">
          <BookmarkPlus size={28} strokeWidth={1.8} className="text-accent" />
        </span>
        {storageError && <p role="alert" className="text-accent">{storageError}</p>}
        <div>
          <p className="font-display text-2xl font-extrabold tracking-tight">Your watchlist is empty</p>
          <p className="mt-2 text-[1rem] leading-relaxed text-paper-dim">
            Track shows from the schedule and episode countdowns, progress and airing alerts live here.
          </p>
        </div>
        <button
          onClick={onGoUpcoming}
          className="tap-target rounded-full bg-accent px-7 py-3.5 text-[1rem] font-semibold text-ink shadow-lg shadow-accent/25 transition-all hover:brightness-110 active:scale-95"
        >
          Browse the schedule
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      {storageError && <p role="alert" className="mb-4 rounded-xl border border-accent/50 bg-accent-soft p-4 text-accent">{storageError}</p>}

      <div className="mb-7 grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-ink-2 sm:grid-cols-4">
        {[
          { label: "Shows tracked", value: String(stats.shows) },
          { label: "Episodes seen", value: String(stats.watched) },
          { label: "Airing < 24h", value: String(stats.airingSoon) },
          { label: "Shows behind", value: String(stats.behind) },
        ].map((s, i) => (
          <div
            key={s.label}
            className={
              "px-5 py-4 " +
              (i < 2 ? "border-b border-line sm:border-b-0 " : "") +
              (i % 2 === 0 ? "border-r border-line " : "") +
              (i < 3 ? "sm:border-r sm:border-line" : "")
            }
          >
            <p className="font-display text-[1.7rem] font-extrabold leading-none text-paper">{s.value}</p>
            <p className="mono-label mt-1.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
        {(
          [
            ["all", "All"],
            ["watching", "Watching"],
            ["planned", "Planned"],
            ["paused", "Paused"],
            ["completed", "Completed"],
            ["dropped", "Dropped"],
          ] as [StatusFilter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={statusFilter === key}
            onClick={() => setStatusFilter(key)}
            className={
              "tap-target shrink-0 rounded-full border px-4 py-2.5 text-[0.9rem] font-semibold transition-colors active:scale-95 " +
              (statusFilter === key
                ? "border-accent bg-accent text-ink"
                : "border-line bg-ink-2 text-paper-dim hover:border-line-strong")
            }
          >
            {label}
            <span className={statusFilter === key ? "ml-1.5 font-mono text-[0.78rem] opacity-80" : "ml-1.5 font-mono text-[0.78rem] text-paper-faint"}>
              {statusCounts[key]}
            </span>
          </button>
        ))}
      </div>

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Sort watchlist">
        {(
          [
            ["recent", "Last updated"],
            ["next", "Airing soon"],
            ["title", "A–Z"],
            ["progress", "Progress"],
          ] as [Sort, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={sort === key}
            onClick={() => setSort(key)}
            className={
              "tap-target shrink-0 rounded-full border px-5 py-2.5 text-[0.92rem] font-semibold transition-colors active:scale-95 " +
              (sort === key
                ? "border-accent bg-accent text-ink"
                : "border-line bg-ink-2 text-paper-dim hover:border-line-strong")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {sorted.length === 0 && <p className="rounded-2xl border border-line bg-ink-2 px-6 py-10 text-center text-paper-dim" role="status">No shows with this status. Choose another filter.</p>}

      <div className={sorted.length === 1 ? "grid grid-cols-1 gap-3.5" : "grid grid-cols-1 gap-3.5 xl:grid-cols-2"}>
        <AnimatePresence initial={false}>
          {sorted.map((entry, i) => (
            <WatchlistCard
              key={entry.mediaId}
              entry={entry}
              index={i}
              info={infoByMedia.get(entry.mediaId) ?? airedInfo(entry, undefined, undefined, Date.now())}
              onBump={bump}
              onSetProgress={setProgress}
              onSetStatus={setStatus}
              onRemove={(id) => remove(id)}
              onOpen={onOpenDetail}
            />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
