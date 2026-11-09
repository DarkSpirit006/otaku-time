import { motion } from "framer-motion";
import { Bell, BellOff, Check, ChevronDown, Minus, Plus, Trash2 } from "lucide-react";
import type { AiringEvent, WatchEntry } from "../lib/types";
import type { AiredInfo } from "../lib/aired";
import { displayTitle } from "../lib/types";
import { clockTime, timeAgo } from "../lib/time";
import { Chip, Countdown, Poster } from "./ui";
import { cn } from "../utils/cn";

export function ScheduleCard({
  event,
  saved,
  onToggleSave,
  onOpen,
}: {
  event: AiringEvent;
  saved: boolean;
  onToggleSave: (e: AiringEvent) => void;
  onOpen: (id: number) => void;
}) {
  const m = event.media;
  const title = displayTitle(m);

  return (
    <article
      className="card-contain group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-ink-2 transition-colors hover:border-line-strong"
    >
      <button
        onClick={() => onOpen(m.id)}
        className="block text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Open details for ${title}`}
      >
        <div className="relative aspect-[16/9] overflow-hidden">
          <Poster
            src={m.bannerImage || m.coverImage.extraLarge || m.coverImage.large}
            color={m.coverImage.color}
            alt={title}
            className="absolute inset-0"
          />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-2 to-transparent" />
          <div className="absolute left-3 top-3 flex gap-2">
            <Chip tone="accent" className="backdrop-blur-sm">Ep {event.episode}</Chip>
            {saved && <Chip tone="gold" className="backdrop-blur-sm">Saved</Chip>}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-4 pb-2">
          <h4 className="clamp-2 text-[1.05rem] font-semibold leading-snug">{title}</h4>
          <p className="font-mono text-[0.8rem] tracking-wide text-paper-faint">
            {clockTime(event.airingAt)} · <Countdown target={event.airingAt} duration={m.duration} className="text-accent" />
          </p>
        </div>
      </button>

      <div className="flex items-center justify-between gap-2 px-4 pb-4 pt-1">
        <span className="truncate font-mono text-[0.75rem] uppercase tracking-[0.14em] text-paper-faint">
          {m.format ?? "TV"}{m.duration ? ` · ${m.duration} min` : ""}
        </span>
        <button
          onClick={() => onToggleSave(event)}
          aria-label={saved ? `Remove ${title} from watchlist` : `Add ${title} to watchlist`}
          aria-pressed={saved}
          className={cn(
            "tap-target grid h-11 w-11 place-items-center rounded-full border transition-all active:scale-90",
            saved
              ? "border-accent bg-accent text-ink"
              : "border-line-strong bg-ink-3/50 text-paper-dim hover:border-paper-faint hover:text-paper"
          )}
        >
          {saved ? <BellOff size={18} strokeWidth={2} /> : <Bell size={18} strokeWidth={2} />}
        </button>
      </div>
    </article>
  );
}

export function RecentRow({
  event,
  saved,
  onToggleSave,
  onOpen,
}: {
  event: AiringEvent;
  saved: boolean;
  onToggleSave: (e: AiringEvent) => void;
  onOpen: (id: number) => void;
}) {
  const m = event.media;
  const title = displayTitle(m);
  const now = Date.now();

  return (
    <div
      className="group flex items-center gap-3.5 border-b border-line py-3 last:border-0 sm:gap-4 sm:py-3.5"
    >
      <button onClick={() => onOpen(m.id)} className="shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl" aria-label={`Open details for ${title}`}>
        <Poster
          src={m.coverImage.large || m.coverImage.extraLarge}
          color={m.coverImage.color}
          alt={title}
          className="aspect-[3/4] w-14 rounded-xl border border-line sm:w-16"
        />
      </button>

      <button
        onClick={() => onOpen(m.id)}
        className="min-w-0 flex-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
      >
        <h4 className="clamp-2 text-[1rem] font-semibold leading-snug transition-colors group-hover:text-accent sm:text-[1.05rem]">
          {title}
        </h4>
        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[0.8rem] text-paper-faint">
          <span className="text-accent">Ep {event.episode}</span>
          <span>{clockTime(event.airingAt)}</span>
          <span className="text-paper-dim">{timeAgo(event.airingAt, now)}</span>
        </p>
      </button>

      <button
        onClick={() => onToggleSave(event)}
        aria-label={saved ? `Remove ${title} from watchlist` : `Add ${title} to watchlist`}
        aria-pressed={saved}
        className={cn(
          "tap-target grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-all active:scale-90",
          saved
            ? "border-accent bg-accent text-ink"
            : "border-line-strong text-paper-dim hover:border-paper-faint hover:text-paper"
        )}
      >
        {saved ? <BellOff size={18} strokeWidth={2} /> : <Bell size={18} strokeWidth={2} />}
      </button>
    </div>
  );
}

const STATUS_LABELS: Record<WatchEntry["status"], string> = {
  watching: "Watching",
  planned: "Planned",
  paused: "Paused",
  completed: "Completed",
  dropped: "Dropped",
};

function StatusPicker({
  entry,
  onChange,
}: {
  entry: WatchEntry;
  onChange: (s: WatchEntry["status"]) => void;
}) {
  const done = entry.status === "completed";
  return (
    <span className={cn("relative inline-flex items-center", done && "text-gold")}>
      <select
        value={entry.status}
        onChange={(e) => onChange(e.target.value as WatchEntry["status"])}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`Status for ${entry.title}`}
        className={cn(
          "tap-target appearance-none rounded-full border border-line bg-ink-3/70 py-1.5 pl-3 pr-8 font-mono text-[0.78rem] font-medium uppercase tracking-[0.12em] outline-none transition-colors focus:border-accent",
          done ? "border-gold/40 bg-gold-soft text-gold" : "text-paper-dim"
        )}
      >
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} strokeWidth={2.4} className="pointer-events-none absolute right-2.5 text-paper-faint" />
    </span>
  );
}

function AiringLine({ nextAt, nextEp }: { nextAt: number; nextEp?: number }) {
  const prefix = nextEp ? `Ep ${nextEp} ` : "";
  if (nextAt * 1000 <= Date.now()) {
    return (
      <p className="mt-2 font-mono text-[0.82rem] text-paper-dim">
        <span className="whitespace-nowrap">
          {prefix}aired · <span className="text-paper-faint">{clockTime(nextAt)}</span>
        </span>
      </p>
    );
  }
  return (
    <p className="mt-2 font-mono text-[0.82rem] text-paper-dim">
      {prefix}in <Countdown target={nextAt} className="font-semibold text-accent" />
      <span className="whitespace-nowrap text-paper-faint"> · {clockTime(nextAt)}</span>
    </p>
  );
}

function EpisodeLedger({
  behind,
  caughtUp,
}: {
  behind: number;
  caughtUp: boolean;
}) {
  if (behind <= 0 && !caughtUp) return null;
  return (
    <div className="mt-2 flex items-center gap-2">
      {behind > 0 && (
        <Chip tone="accent">
          {behind} ep{behind === 1 ? "" : "s"} behind
        </Chip>
      )}
      {caughtUp && (
        <Chip tone="gold">
          <Check size={13} strokeWidth={2.6} />
          Caught up
        </Chip>
      )}
    </div>
  );
}

function ProgressRow({
  progress,
  total,
  cap,
  cappedByAired,
  onDecrement,
  onIncrement,
}: {
  progress: number;
  total?: number;
  cap?: number | null;
  cappedByAired: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  const shown = progress;
  const atCap = cap != null && progress >= cap;
  const pct = total ? Math.min(100, (Math.min(progress, cap ?? total) / total) * 100) : null;

  return (
    <div className="mt-auto flex items-center gap-3 pt-4">
      <div className="flex items-center gap-1 rounded-full border border-line bg-ink-3/60 p-1">
        <button
          onClick={onDecrement}
          disabled={progress <= 0}
          aria-label="Decrease progress"
          className="tap-target grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-ink-4 disabled:opacity-30 active:scale-90"
        >
          <Minus size={16} strokeWidth={2.2} />
        </button>
        <span className="min-w-[3.6rem] text-center font-mono text-[0.95rem] font-semibold tabular-nums">
          {shown}{total ? `/${total}` : ""}
        </span>
        <button
          onClick={onIncrement}
          disabled={atCap}
          aria-label={atCap && cappedByAired ? "Caught up with aired episodes" : "Mark one episode watched"}
          title={atCap && cappedByAired ? "Caught up — nothing further has aired" : undefined}
          className="tap-target grid h-10 w-10 place-items-center rounded-full bg-accent text-ink transition-all hover:brightness-110 disabled:opacity-30 active:scale-90"
        >
          <Plus size={16} strokeWidth={2.4} />
        </button>
      </div>

      {pct !== null && (
        <div className="hidden flex-1 items-center gap-2.5 sm:flex">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-4">
            <motion.div
              className="h-full rounded-full bg-gold"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22 }}
            />
          </div>
          <span className="font-mono text-[0.75rem] text-paper-faint">{Math.round(pct)}%</span>
        </div>
      )}
    </div>
  );
}

export function WatchlistCard({
  entry,
  info,
  onBump,
  onSetProgress,
  onSetStatus,
  onRemove,
  onOpen,
  index,
}: {
  entry: WatchEntry;
  info: AiredInfo;
  onBump: (id: number) => void;
  onSetProgress: (id: number, v: number) => void;
  onSetStatus: (id: number, s: WatchEntry["status"]) => void;
  onRemove: (id: number) => void;
  onOpen: (id: number) => void;
  index: number;
}) {
  const { cap } = info;
  const nextAt = info.nextAiringAt;
  const behind = info.behind ?? 0;
  const showBehind = info.latestAired != null && behind > 0;
  const atCap = cap != null && entry.progress >= cap;
  const showCaughtUp = !showBehind && atCap && cap != null && cap > 0;

  return (

    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.15), ease: [0.22, 0.9, 0.24, 1] }}
      className="flex gap-4 rounded-2xl border border-line bg-ink-2 p-4 sm:gap-5 sm:p-5"
    >
      <button
        onClick={() => onOpen(entry.mediaId)}
        className="shrink-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Open details for ${entry.title}`}
      >
        <Poster
          src={entry.cover}
          color={entry.color}
          alt={entry.title}
          className="aspect-[3/4] w-[4.6rem] rounded-xl border border-line sm:w-24"
        />
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">

            <button
              onClick={() => onOpen(entry.mediaId)}
              className="block max-w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <h4 className="clamp-2 text-[1.1rem] font-semibold leading-snug">{entry.title}</h4>
            </button>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-mono text-[0.75rem] uppercase tracking-[0.14em] text-paper-faint">
                {entry.format ?? "TV"}
                {entry.totalEpisodes ? ` · ${entry.totalEpisodes} ep` : " · Ongoing"}
              </span>
              <StatusPicker entry={entry} onChange={(st) => onSetStatus(entry.mediaId, st)} />
            </div>
          </div>
          <button
            onClick={() => onRemove(entry.mediaId)}
            aria-label={`Remove ${entry.title} from watchlist`}
            className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-full text-paper-faint transition-colors hover:bg-accent-soft hover:text-accent active:scale-90"
          >
            <Trash2 size={18} strokeWidth={1.9} />
          </button>
        </div>

        {nextAt && nextAt * 1000 > Date.now() - 3 * 3600_000 && (
          <AiringLine nextAt={nextAt} nextEp={info.nextEpisode} />
        )}

        <EpisodeLedger behind={showBehind ? behind : 0} caughtUp={showCaughtUp} />

        <ProgressRow
          progress={entry.progress}
          total={entry.totalEpisodes}
          cap={cap}
          cappedByAired={info.cappedByAired}
          onDecrement={() => onSetProgress(entry.mediaId, entry.progress - 1)}
          onIncrement={() => onBump(entry.mediaId)}
        />
      </div>
    </motion.article>
  );
}
