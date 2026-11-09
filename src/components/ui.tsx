import { motion } from "framer-motion";
import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNow } from "../lib/store";
import { countdownParts, pad, shortCountdown } from "../lib/time";
import { cn } from "../utils/cn";

export function Poster({
  src,
  color,
  alt,
  className,
  eager = false,
}: {
  src?: string;
  color?: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={cn("relative overflow-hidden bg-ink-3", className)}
      style={color && !broken ? { backgroundColor: `${color}22` } : undefined}
    >
      {src && !broken ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          className={cn("img-fade absolute inset-0 h-full w-full object-cover", loaded && "is-loaded")}
        />
      ) : null}
      {(!src || broken) && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="mono-label !text-[0.8rem] text-paper-faint">{alt.slice(0, 2).toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}

export function Countdown({
  target,
  duration,
  className,
}: {
  target: number;
  /** Episode run time in minutes — bounds how long "Airing now" is true. */
  duration?: number | null;
  className?: string;
}) {
  /* Adaptive tick rate: seconds precision only matters in the last hour;
     distant events refresh rarely, keeping 100+ cards cheap on phones. */
  const remainingSec = Math.abs(target - Math.floor(Date.now() / 1000));
  const interval = remainingSec < 3600 ? 1000 : remainingSec < 86400 ? 20_000 : 60_000;
  const now = useNow(interval);
  return <span className={className}>{shortCountdown(target, now, duration)}</span>;
}

export function BigCountdown({ target }: { target: number }) {
  const now = useNow(1000);
  const p = countdownParts(target, now);
  const showDays = p.days > 0;
  const cells: { value: string; unit: string }[] = showDays
    ? [
      { value: pad(p.days), unit: "days" },
      { value: pad(p.hours), unit: "hrs" },
      { value: pad(p.minutes), unit: "min" },
      { value: pad(p.seconds), unit: "sec" },
    ]
    : [
      { value: pad(p.hours), unit: "hrs" },
      { value: pad(p.minutes), unit: "min" },
      { value: pad(p.seconds), unit: "sec" },
    ];

  return (

    <div className="flex items-baseline gap-2 sm:gap-3.5" role="timer" aria-live="off">
      {cells.map((c, i) => (
        <div key={c.unit} className="flex items-baseline gap-2 sm:gap-3.5">
          {i > 0 && (
            <span className="font-display text-3xl font-bold leading-none text-accent sm:text-5xl">:</span>
          )}
          <div className="flex flex-col items-center gap-1.5">
            <motion.span
              key={c.value}
              initial={{ y: 6, opacity: 0.4 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.18 }}
              className="countdown-digits font-display font-extrabold leading-none tracking-tight tabular-nums"
            >
              {c.value}
            </motion.span>
            <span className="mono-label !text-[0.75rem] !tracking-[0.22em] text-paper-faint">
              {c.unit}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SectionHead({
  index,
  title,
  meta,
  aside,
}: {
  index: string;
  title: string;
  meta?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 hairline-b pb-5 sm:mb-8">
      <div className="min-w-0">
        <p className="mono-label mb-2 flex items-center gap-2">
          <span className="text-accent">{index}</span>
          <span aria-hidden="true" className="inline-block h-px w-8 bg-line-strong" />
          {meta ?? "Broadcast almanac"}
        </p>
        <h2 className="font-display text-masthead font-extrabold uppercase leading-[0.95] tracking-[-0.02em]">
          {title}
        </h2>
      </div>
      {aside}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-2">
      <div className="skeleton aspect-[16/10] w-full" />
      <div className="space-y-2.5 p-4">
        <div className="skeleton h-4 w-3/4 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <div className="skeleton h-16 w-12 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton h-3 w-1/3 rounded" />
      </div>
      <div className="skeleton h-9 w-9 rounded-full" />
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const offline = message.toLowerCase().includes("offline") || message.toLowerCase().includes("network");
  const Icon = offline ? CloudOff : AlertTriangle;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-line bg-ink-2 px-6 py-12 text-center">
      <Icon size={36} strokeWidth={1.6} className="text-accent" />
      <div>
        <p className="font-display text-xl font-bold">Could not load the schedule</p>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-paper-dim">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="tap-target flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-[0.95rem] font-semibold text-ink transition-transform active:scale-95"
      >
        <RefreshCw size={17} strokeWidth={2.2} />
        Retry
      </button>
    </div>
  );
}

export function Chip({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "gold" | "live";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.75rem] font-medium tracking-wide",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "gold" && "bg-gold-soft text-gold",
        tone === "live" && "bg-accent text-ink",
        tone === "default" && "border border-line bg-ink-3/60 text-paper-dim",
        className
      )}
    >
      {children}
    </span>
  );
}
