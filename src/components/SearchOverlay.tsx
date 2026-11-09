import { AnimatePresence, motion } from "framer-motion";
import { BellPlus, Check, Flame, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchTrending, searchAnime } from "../lib/api";
import type { Media } from "../lib/types";
import { displayTitle } from "../lib/types";
import { useWatchlist } from "../lib/store";
import { useDialog } from "../lib/useDialog";
import { Poster } from "./ui";
import { cn } from "../utils/cn";

interface Props {
  open: boolean;
  suspended?: boolean;
  initialQuery?: string;
  onClose: () => void;
  onOpenDetail: (id: number, seed?: Media) => void;
}

function ResultRow({ media, onOpen }: { media: Media; onOpen: (id: number, seed?: Media) => void }) {
  const { has, add, remove } = useWatchlist();
  const saved = has(media.id);
  const title = displayTitle(media);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 0.9, 0.24, 1] }}
      className="flex items-center gap-3.5 border-b border-line py-3 last:border-0"
    >
      <button
        onClick={() => onOpen(media.id, media)}
        className="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Open details for ${title}`}
      >
        <Poster src={media.coverImage.large} color={media.coverImage.color} alt={title} className="aspect-[3/4] w-14 rounded-lg border border-line" />
      </button>
      <button
        onClick={() => onOpen(media.id, media)}
        className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <h4 className="clamp-2 text-[1.05rem] font-semibold leading-snug">{title}</h4>
        <p className="mt-0.5 font-mono text-[0.78rem] tracking-wide text-paper-faint">
          {[media.format, media.seasonYear, media.averageScore ? `${media.averageScore}%` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </button>
      <button
        onClick={() => (saved ? remove(media.id) : add(media))}
        aria-label={saved ? `Remove ${title} from watchlist` : `Add ${title} to watchlist`}
        aria-pressed={saved}
        className={cn(
          "tap-target grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-all active:scale-90",
          saved ? "border-accent bg-accent text-ink" : "border-line-strong text-paper-dim hover:border-paper-faint hover:text-paper"
        )}
      >
        {saved ? <Check size={18} strokeWidth={2.4} /> : <BellPlus size={18} strokeWidth={2} />}
      </button>
    </motion.div>
  );
}

export function SearchOverlay({ open, suspended = false, initialQuery, onClose, onOpenDetail }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Media[]>([]);
  const [trending, setTrending] = useState<Media[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [trendingError, setTrendingError] = useState(false);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const dialogRef = useDialog(open && !suspended, onClose);

  useEffect(() => {
    if (!open) return;
    if (initialQuery) setQuery(initialQuery);
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(t);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open || trending.length > 0) return;
    const controller = new AbortController();
    setTrendingError(false);
    fetchTrending(controller.signal).then(setTrending).catch(() => { if (!controller.signal.aborted) setTrendingError(true); });
    return () => controller.abort();
  }, [open, trending.length, retry]);

  useEffect(() => {
    const q = query.trim();
    setSearchError("");
    if (!open || q.length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setResults([]);
    setSearched(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchAnime(q, controller.signal)
        .then((items) => {
          if (controller.signal.aborted) return;
          setResults(items);
          setSearched(true);
          setLoading(false);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setLoading(false);
          setSearchError(err instanceof Error ? err.message : "Could not search AniList.");
        });
    }, 240);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, retry]);

  const list = query.trim().length >= 2 ? results : trending;
  const heading = query.trim().length >= 2 ? null : "Trending now";

  const content = useMemo(() => {
    if ((query.trim().length >= 2 && searchError) || (query.trim().length < 2 && trendingError))
      return <div role="alert" className="px-1 py-12 text-center text-paper-dim"><p>{searchError || "Could not load trending anime. Check your connection."}</p><button onClick={() => setRetry(n => n + 1)} className="tap-target mt-4 rounded-full bg-accent px-6 py-3 font-semibold text-ink">Try again</button></div>;
    if (query.trim().length >= 2 && searched && !loading && results.length === 0)
      return (
        <p className="px-1 py-16 text-center text-paper-dim">
          Nothing matches “{query.trim()}”.<br />
          <span className="text-[0.9rem] text-paper-faint">Try the romaji or english title.</span>
        </p>
      );
    return (
      <div>
        {heading && (
          <p className="mono-label mb-2 flex items-center gap-2 px-1 pt-2">
            <Flame size={14} className="text-accent" /> {heading}
          </p>
        )}
        {list.map((m) => (
          <ResultRow key={m.id} media={m} onOpen={onOpenDetail} />
        ))}
        {loading && (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3.5">
                <div className="skeleton h-[4.7rem] w-14 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-2/3 rounded" />
                  <div className="skeleton h-3 w-1/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }, [query, searched, loading, results, list, heading, onOpenDetail, searchError, trendingError]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="search"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.28, ease: [0.22, 0.9, 0.24, 1] }}
          className="fixed inset-0 z-[110] flex flex-col bg-ink/97 md:backdrop-blur-lg"
          role="dialog"
          aria-modal={!suspended}
          aria-hidden={suspended}
          inert={suspended}
          aria-label="Search anime"
          ref={dialogRef}
        >
          <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pt-4 sm:pt-8">
            <div className="flex min-h-[56px] flex-1 items-center gap-3 rounded-2xl border border-line-strong bg-ink-2 px-4 focus-within:border-accent">
              <Search size={20} className="shrink-0 text-paper-faint" strokeWidth={2} />
              {/* 16px input font: iOS safari won't auto-zoom */}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                spellCheck={false}
                placeholder="Search anime…"
                aria-label="Search anime"
                className="w-full bg-transparent text-[1.05rem] outline-none placeholder:text-paper-faint"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear search" className="tap-target grid h-9 w-9 place-items-center rounded-full text-paper-faint hover:text-paper">
                  <X size={17} strokeWidth={2.2} />
                </button>
              )}
            </div>
            <button
              onClick={onClose}
              className="tap-target flex h-14 items-center rounded-2xl border border-line px-4 text-[0.95rem] font-semibold text-paper-dim transition-colors hover:text-paper"
            >
              Cancel
            </button>
          </div>

          <div className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3">
            {content}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
