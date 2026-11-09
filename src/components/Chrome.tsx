import { motion } from "framer-motion";
import { CalendarClock, History, ListChecks, Moon, Search, Settings2, Sun } from "lucide-react";
import type { Section } from "../lib/types";
import { formatClock } from "../lib/time";
import { useNow, useWatchlist } from "../lib/store";
import { useTheme } from "../lib/theme";
import { cn } from "../utils/cn";

const SECTIONS: { id: Section; label: string; icon: typeof CalendarClock }[] = [
  { id: "upcoming", label: "Upcoming", icon: CalendarClock },
  { id: "watchlist", label: "Watchlist", icon: ListChecks },
  { id: "recent", label: "Aired", icon: History },
];

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line-strong bg-ink-2">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="8.5" className="text-accent" stroke="currentColor" />
          <path d="M12 7.5V12l3.4 2.5" className="text-paper" />
        </svg>
      </span>
      {!compact && (

        <span className="wordmark min-w-0 truncate font-display font-extrabold uppercase leading-none">
          Otaku<span className="text-accent">Time</span>
        </span>
      )}
    </div>
  );
}

function RailAction({
  onClick,
  icon: Icon,
  label,
  ariaLabel,
  pressed,
}: {
  onClick: () => void;
  icon: typeof Settings2;
  label: string;
  ariaLabel: string;
  pressed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      title={ariaLabel}
      className="tap-target flex h-[3rem] w-full items-center gap-3 rounded-xl border border-line px-4 text-[0.95rem] text-paper-dim transition-colors hover:border-line-strong hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Icon size={17} strokeWidth={2} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function DesktopRail({
  section,
  onNavigate,
  onSearch,
  onSettings,
}: {
  section: Section;
  onNavigate: (s: Section) => void;
  onSearch: () => void;
  onSettings: () => void;
}) {
  const { entries } = useWatchlist();
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const now = useNow(1000);
  const clock = formatClock(now);

  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-line px-6 py-7 lg:flex">
      <button onClick={() => onNavigate("upcoming")} aria-label="Otaku Time — home" className="self-start rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <Wordmark />
      </button>
      <p className="mono-label mt-2.5">Broadcast almanac</p>

      <button
        onClick={onSearch}
        className="tap-target mt-8 flex items-center gap-3 rounded-xl border border-line bg-ink-2 px-4 py-3 text-left text-paper-faint transition-colors hover:border-line-strong hover:text-paper-dim"
      >
        <Search size={17} strokeWidth={2} />
        <span className="flex-1 text-[0.95rem]">Search anime…</span>
        <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[0.7rem] text-paper-faint">/</kbd>
      </button>

      <nav className="mt-9 flex flex-col gap-1" aria-label="Sections">
        <p className="mono-label mb-2">Index</p>
        {SECTIONS.map((s, i) => {
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onNavigate(s.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3.5 rounded-lg px-2 py-3 text-left transition-colors",
                active ? "text-paper" : "text-paper-faint hover:text-paper-dim"
              )}
            >
              {active && (
                <motion.span
                  layoutId="rail-indicator"
                  className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-full bg-accent"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              <span className={cn("font-mono text-[0.75rem] tracking-wide", active ? "text-accent" : "text-paper-faint")}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 font-display text-[1.1rem] font-bold uppercase tracking-tight">
                {s.label}
              </span>
              {s.id === "watchlist" && entries.length > 0 && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[0.78rem] font-semibold text-accent">
                  {entries.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-5">
        {/* Theme and Settings — identical size, no manual refresh: the
            schedule keeps itself current. */}
        <div className="flex flex-col gap-2">
          <RailAction
            onClick={toggle}
            icon={ThemeIcon}
            label={theme === "dark" ? "Paper theme" : "Ink theme"}
            ariaLabel={theme === "dark" ? "Switch to paper theme" : "Switch to ink theme"}
            pressed={theme === "light"}
          />
          <RailAction onClick={onSettings} icon={Settings2} label="Settings" ariaLabel="Open settings" />
        </div>
        <div className="border-t border-line pt-4">
          <p className="mono-label mb-1">Local time</p>
          <p className="font-mono text-[1.35rem] font-semibold tabular-nums tracking-tight">{clock.time}</p>
          <p className="mt-0.5 text-[0.85rem] text-paper-faint">{clock.date}</p>
        </div>
      </div>
    </aside>
  );
}

export function MobileTopBar({
  onSearch,
  onSettings,
}: {
  onSearch: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/95 lg:hidden">
      <div className="flex h-16 items-center justify-between gap-2 px-4">
        <Wordmark />
        <div className="flex items-center gap-1.5">

          <button
            onClick={onSettings}
            aria-label="Open settings"
            className="tap-target grid h-11 w-11 place-items-center rounded-full text-paper-dim transition-colors hover:bg-ink-3 active:scale-90"
          >
            <Settings2 size={19} strokeWidth={2} />
          </button>
          <button
            onClick={onSearch}
            aria-label="Search anime"
            className="tap-target grid h-11 w-11 place-items-center rounded-full bg-accent text-ink transition-all hover:brightness-110 active:scale-90"
          >
            <Search size={19} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </header>
  );
}

export function BottomTabs({ section, onNavigate }: { section: Section; onNavigate: (s: Section) => void }) {
  const { entries } = useWatchlist();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink/95 pb-safe lg:hidden"
      aria-label="Sections"
    >
      <div className="mx-auto grid max-w-md grid-cols-3">
        {SECTIONS.map((s) => {
          const active = section === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => onNavigate(s.id)}
              aria-current={active ? "page" : undefined}
              className="relative flex min-h-[62px] flex-col items-center justify-center gap-1 outline-none focus-visible:bg-ink-3"
            >
              {active && (
                <motion.span
                  layoutId="tab-glow"
                  className="absolute inset-x-4 top-0 h-[2.5px] rounded-full bg-accent"
                  transition={{ type: "spring", stiffness: 520, damping: 40 }}
                />
              )}
              <span className="relative">
                <Icon
                  size={23}
                  strokeWidth={active ? 2.2 : 1.8}
                  className={cn("transition-colors", active ? "text-accent" : "text-paper-faint")}
                />
                {s.id === "watchlist" && entries.length > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[0.62rem] font-bold text-ink">
                    {entries.length}
                  </span>
                )}
              </span>
              <span className={cn("text-[0.78rem] font-semibold tracking-wide transition-colors", active ? "text-paper" : "text-paper-faint")}>
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
