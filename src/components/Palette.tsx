import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CalendarArrowDown,
  Command,
  CornerDownLeft,
  History,
  Keyboard,
  ListChecks,
  Moon,
  Search,
  Smartphone,
  Sun,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildICS, downloadFile } from "../lib/ics";
import { useTheme } from "../lib/theme";
import { useToast, useWatchlist } from "../lib/store";
import type { Section } from "../lib/types";
import { cn } from "../utils/cn";
import { useDialog } from "../lib/useDialog";

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Zap;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onSearchQuery,
  onShowHelp,
  onInstall,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (s: Section) => void;
  onSearchQuery: (q: string) => void;
  onShowHelp: () => void;
  onInstall: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialog(open, onClose);
  const { theme, toggle } = useTheme();
  const { entries } = useWatchlist();
  const toast = useToast();

  const actions: Action[] = useMemo(
    () => [
      { id: "go-upcoming", label: "Go to Upcoming", hint: "g u", icon: Zap, run: () => onNavigate("upcoming") },
      { id: "go-watchlist", label: "Go to Watchlist", hint: "g w", icon: ListChecks, run: () => onNavigate("watchlist") },
      { id: "go-recent", label: "Go to Recently aired", hint: "g r", icon: History, run: () => onNavigate("recent") },
      {
        id: "theme",
        label: theme === "dark" ? "Switch to Paper theme" : "Switch to Ink theme",
        icon: theme === "dark" ? Sun : Moon,
        run: toggle,
      },
      {
        id: "ics",
        label: "Export calendar (.ics)",
        hint: `${entries.length} tracked`,
        icon: CalendarArrowDown,
        run: () => {
          const { content, count } = buildICS(entries);
          if (count === 0) {
            toast("No upcoming airings to export", "info");
            return;
          }
          downloadFile("otaku-time.ics", content, "text/calendar");
          toast(`Calendar exported — ${count} reminders`);
        },
      },
      { id: "install", label: "Install Otaku Time", icon: Smartphone, run: onInstall },
      { id: "help", label: "Keyboard shortcuts", hint: "?", icon: Keyboard, run: onShowHelp },
    ],
    [onNavigate, onShowHelp, onInstall, theme, toggle, entries, toast]
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? actions.filter((a) => a.label.toLowerCase().includes(q))
    : actions;

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[active]) {
          filtered[active].run();
          onClose();
        } else if (q) {
          onSearchQuery(query.trim());
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, q, query, onClose, onSearchQuery]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            key="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            ref={dialogRef}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 0.9, 0.24, 1] }}
            className="fixed inset-x-4 top-[12vh] z-[121] mx-auto max-w-xl overflow-hidden rounded-2xl border border-line bg-ink shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <Command size={19} strokeWidth={2} className="shrink-0 text-accent" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command or search…"
                aria-label="Command palette"
                className="w-full bg-transparent text-[1.05rem] outline-none placeholder:text-paper-faint"
              />
              <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[0.72rem] text-paper-faint">esc</kbd>
            </div>

            <div className="max-h-[46vh] overflow-y-auto overscroll-contain p-2">
              {filtered.map((a, i) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.id}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      a.run();
                      onClose();
                    }}
                    className={cn(
                      "flex w-full items-center gap-3.5 rounded-xl px-4 py-3.5 text-left transition-colors",
                      i === active ? "bg-accent-soft" : ""
                    )}
                  >
                    <Icon size={18} strokeWidth={2} className={cn("shrink-0", i === active ? "text-accent" : "text-paper-faint")} />
                    <span className="min-w-0 flex-1 truncate text-[1rem] font-medium">{a.label}</span>
                    {a.hint && (
                      <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[0.72rem] text-paper-faint">
                        {a.hint}
                      </kbd>
                    )}
                    {i === active && <CornerDownLeft size={15} className="text-accent" />}
                  </button>
                );
              })}
              {q && filtered.length === 0 && (
                <button
                  onClick={() => {
                    onSearchQuery(query.trim());
                    onClose();
                  }}
                  className="flex w-full items-center gap-3.5 rounded-xl bg-accent-soft px-4 py-3.5 text-left"
                >
                  <Search size={18} strokeWidth={2} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-[1rem] font-medium">
                    Search anime for “{query.trim()}”
                  </span>
                  <ArrowRight size={16} className="text-accent" />
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

const SHORTCUTS: [string, string][] = [
  ["/", "Focus search"],
  ["Ctrl K", "Command palette"],
  ["g then u", "Upcoming"],
  ["g then w", "Watchlist"],
  ["g then r", "Recently aired"],
  ["?", "This sheet"],
  ["Esc", "Close anything"],
];

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useDialog(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            key="help"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            ref={dialogRef}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed inset-x-4 top-[16vh] z-[121] mx-auto max-w-sm rounded-2xl border border-line bg-ink p-5 shadow-2xl sm:p-6"
          >
            <button onClick={onClose} className="tap-target float-right rounded-lg px-3 text-sm font-semibold text-paper-dim hover:text-paper">Close</button>
            <p className="mono-label mb-1">Help</p>
            <h3 className="font-display text-[1.5rem] font-extrabold tracking-tight">Keyboard shortcuts</h3>
            <div className="mt-4 divide-y divide-line">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={keys} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-[0.95rem] text-paper-dim">{label}</span>
                  <kbd className="rounded-md border border-line bg-ink-3 px-2.5 py-1 font-mono text-[0.8rem] font-semibold">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
