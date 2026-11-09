import { motion } from "framer-motion";
import { BellPlus, Check, CirclePlay } from "lucide-react";
import type { AiringEvent } from "../lib/types";
import { displayTitle } from "../lib/types";
import { BigCountdown, Poster } from "./ui";
import { cn } from "../utils/cn";

export function Hero({
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
  const art = m.bannerImage || m.coverImage.extraLarge || m.coverImage.large;
  const genres = m.genres.slice(0, 2);

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 0.9, 0.24, 1] }}
      className="relative overflow-hidden rounded-3xl border border-line bg-ink-2 shadow-2xl shadow-black/40"
    >

      <div className="absolute inset-0" aria-hidden="true">
        {art && (
          <img
            src={art}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-50 [mask-image:linear-gradient(205deg,black_8%,transparent_68%)]"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(130% 100% at 92% -6%, ${m.coverImage.color ?? "#ff4526"}40, transparent 55%), linear-gradient(178deg, color-mix(in srgb, var(--color-ink) 28%, transparent) 0%, color-mix(in srgb, var(--color-ink) 68%, transparent) 46%, var(--color-ink) 84%)`,
          }}
        />
      </div>

      <div className="relative p-5 sm:p-8 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12 lg:p-10">

        <div className="mb-4 flex items-center justify-between gap-4 lg:contents">
          <p className="mono-label flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Next broadcast
          </p>
          <motion.button
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 0.55, ease: [0.22, 0.9, 0.24, 1] }}
            onClick={() => onOpen(m.id)}
            aria-label={`Open details for ${title}`}
            className="shrink-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Poster
              eager
              src={m.coverImage.extraLarge || m.coverImage.large}
              color={m.coverImage.color}
              alt={title}
              className="aspect-[3/4] w-[5.4rem] rounded-2xl border border-line-strong shadow-2xl shadow-black/45 sm:w-36 lg:w-44"
            />
          </motion.button>
        </div>

        <div className="min-w-0 lg:order-1">
          <button
            onClick={() => onOpen(m.id)}
            className="group -ml-1 block w-full rounded-lg p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Open details for ${title}`}
          >

            <h3 className="max-w-[19ch] text-balance font-display text-[clamp(1.9rem,1.42rem+2.1vw,4.3rem)] font-extrabold leading-[0.99] tracking-[-0.015em] transition-colors group-hover:text-accent">
              {title}
            </h3>
          </button>

          <p className="mt-3.5 whitespace-nowrap text-[1rem] text-paper-dim">
            <span className="font-semibold text-paper">Episode {event.episode}</span>
            <span aria-hidden="true" className="mx-2 text-paper-faint">·</span>
            {new Date(event.airingAt * 1000).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
            <span aria-hidden="true" className="mx-2 text-paper-faint">·</span>
            {new Date(event.airingAt * 1000).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>

          {genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {genres.map((g) => (
                <span key={g} className="rounded-full bg-ink/55 px-3 py-1 text-[0.85rem] font-medium text-paper-dim backdrop-blur-sm ring-1 ring-line">
                  {g}
                </span>
              ))}
            </div>
          )}

          <div className="mt-7">
            <BigCountdown target={event.airingAt} />
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={() => onToggleSave(event)}
              aria-pressed={saved}
              className={cn(
                "tap-target flex items-center justify-center gap-2.5 rounded-full px-6 py-3.5 text-[1rem] font-semibold transition-all active:scale-[0.97] max-[420px]:w-full",
                saved
                  ? "border border-gold/60 bg-gold-soft text-gold"
                  : "bg-accent text-ink shadow-lg shadow-accent/25 hover:brightness-110"
              )}
            >
              {saved ? <Check size={19} strokeWidth={2.4} /> : <BellPlus size={19} strokeWidth={2.2} />}
              <span className="whitespace-nowrap">{saved ? "On your watchlist" : "Track this show"}</span>
            </button>
            <button
              onClick={() => onOpen(m.id)}
              className="tap-target flex items-center justify-center gap-2.5 rounded-full border border-line-strong bg-ink/45 px-6 py-3.5 text-[1rem] font-semibold backdrop-blur transition-colors hover:border-paper-faint active:scale-[0.97] max-[420px]:w-full"
            >
              <CirclePlay size={19} strokeWidth={2} />
              <span className="whitespace-nowrap">Details</span>
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

