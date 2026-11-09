import { AnimatePresence, motion } from "framer-motion";
import { BellPlus, Check, ChevronDown, ExternalLink, Play, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchDetails } from "../lib/api";
import type { AiringEvent, Media } from "../lib/types";
import { displayTitle } from "../lib/types";
import { fullDateTime } from "../lib/time";
import { useToast, useWatchlist } from "../lib/store";
import { useDialog } from "../lib/useDialog";
import { useSheetSwipe } from "../lib/useSheetSwipe";
import { Chip, Poster } from "./ui";

function SheetSkeleton() {
  return (
    <div className="px-5 pb-8 pt-6 sm:px-7">
      <div className="skeleton h-44 w-full rounded-2xl sm:h-56" />
      <div className="mt-5 flex items-end gap-4">
        <div className="skeleton aspect-[3/4] w-24 rounded-2xl sm:w-32" />
        <div className="flex-1 space-y-3 pb-1">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-7 w-3/4 rounded" />
        </div>
      </div>
      <div className="mt-6 space-y-3">
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-11/12 rounded" />
        <div className="skeleton h-4 w-2/3 rounded" />
      </div>
    </div>
  );
}

interface Props {
  mediaId: number | null;
  seed?: Media | null;
  upcoming?: AiringEvent | null;
  onClose: () => void;
}

function stripHtml(html?: string): string {
  if (!html) return "";
  /* AniList synopsis text mixes raw HTML and markdown escapes — clean both */
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = doc.body.textContent ?? "";
  return text
    .replace(/\\([*_~`>#-])/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function SheetError() {
  return (
    <div className="grid place-items-center gap-3 px-6 py-24 text-center">
      <p className="font-display text-xl font-bold">Couldn’t load this title</p>
      <p className="text-paper-dim">AniList didn’t answer. Close and try again in a moment.</p>
    </div>
  );
}

function Banner({ media }: { media: Media }) {
  const src = media.bannerImage ?? media.coverImage.extraLarge;
  return (
    <div className="relative h-44 w-full overflow-hidden sm:h-56">
      {src ? (
        <img src={src} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-ink-3" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink-2 via-ink-2/35 to-transparent" />
    </div>
  );
}

function PosterHeading({ media, title }: { media: Media; title: string }) {
  return (
    <div className="flex items-end gap-4">
      <Poster
        eager
        src={media.coverImage.extraLarge || media.coverImage.large}
        color={media.coverImage.color}
        alt={title}
        className="aspect-[3/4] w-[4.9rem] shrink-0 rounded-2xl border-2 border-ink-2 shadow-xl sm:w-32"
      />
      <div className="min-w-0 pb-1">
        {media.format && (
          <p className="mono-label mb-1.5">
            {media.format}
            {media.seasonYear ? ` · ${media.seasonYear}` : ""}
          </p>
        )}
        <h3 className="font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
          {title}
        </h3>
      </div>
    </div>
  );
}

function QuickFacts({
  media,
  nextEpisode,
}: {
  media: Media;
  nextEpisode: { episode: number; airingAt: number } | null;
}) {
  const upcomingSoon = nextEpisode != null && nextEpisode.airingAt * 1000 > Date.now() - 3 * 3600_000;
  return (
    <>
      <div className="mt-5 flex flex-wrap gap-2">
        {upcomingSoon && (
          <Chip tone="accent">
            Ep {nextEpisode.episode} · {fullDateTime(nextEpisode.airingAt)}
          </Chip>
        )}
        {media.averageScore != null && media.averageScore > 0 && (
          <Chip tone="gold">
            <Star size={13} strokeWidth={2.2} className="fill-current" />
            {media.averageScore}%
          </Chip>
        )}
        {media.episodes != null && <Chip>{media.episodes} episodes</Chip>}
        {media.status && <Chip>{media.status.replace(/_/g, " ").toLowerCase()}</Chip>}
      </div>

      {media.genres.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {media.genres.map((g) => (
            <span key={g} className="rounded-full bg-ink-4 px-3 py-1.5 text-[0.85rem] font-medium text-paper-dim">
              {g}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function Synopsis({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const needsToggle = text.length >= 260;

  return (
    <div className="mt-5">
      <p
        className={
          "text-[1rem] leading-relaxed text-paper-dim " +
          (expanded || !needsToggle ? "" : "clamp-3")
        }
      >
        {text}
      </p>
      {needsToggle && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="tap-target mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-[0.88rem] font-semibold text-accent transition-colors hover:border-accent/60"
        >
          {expanded ? "Show less" : "Read more"}
          <ChevronDown
            size={14}
            strokeWidth={2.4}
            className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
          />
        </button>
      )}
    </div>
  );
}

function ActionRow({
  media,
  saved,
  onToggleSave,
}: {
  media: Media;
  saved: boolean;
  onToggleSave: () => void;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button
        onClick={onToggleSave}
        className={
          "tap-target flex items-center gap-2.5 rounded-full px-6 py-3.5 text-[1rem] font-semibold transition-all active:scale-[0.97] " +
          (saved
            ? "border border-gold/50 bg-gold-soft text-gold"
            : "bg-accent text-ink shadow-lg shadow-accent/25 hover:brightness-110")
        }
      >
        {saved ? <Check size={19} strokeWidth={2.4} /> : <BellPlus size={19} strokeWidth={2.2} />}
        {saved ? "On your watchlist" : "Add to watchlist"}
      </button>
      {media.trailer?.site === "youtube" && (
        <a
          href={`https://www.youtube.com/watch?v=${media.trailer.id}`}
          target="_blank"
          rel="noreferrer noopener"
          className="tap-target flex items-center gap-2.5 rounded-full border border-line-strong px-6 py-3.5 text-[1rem] font-semibold transition-colors hover:border-paper-faint active:scale-[0.97]"
        >
          <Play size={18} strokeWidth={2} />
          Trailer
        </a>
      )}
    </div>
  );
}

function WatchLinks({ links }: { links: Media["externalLinks"] }) {
  if (links.length === 0) return null;
  return (
    <div className="mt-6 border-t border-line pt-5">
      <p className="mono-label mb-3">Where to watch</p>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <a
            key={l.site + l.url}
            href={l.url}
            target="_blank"
            rel="noreferrer noopener"
            className="tap-target flex min-h-[44px] items-center gap-1.5 rounded-full border border-line px-4 text-[0.9rem] font-medium text-paper-dim transition-colors hover:border-accent hover:text-accent"
          >
            {l.site}
            <ExternalLink size={13} strokeWidth={2} />
          </a>
        ))}
      </div>
    </div>
  );
}

export function DetailSheet({ mediaId, seed, upcoming, onClose }: Props) {
  const [media, setMedia] = useState<Media | null>(seed ?? null);
  const [error, setError] = useState(false);
  const { has, add, remove } = useWatchlist();
  const toast = useToast();

  const scrollRef = useRef<HTMLDivElement>(null);

  const open = mediaId !== null;

  useEffect(() => {
    setMedia(seed ?? null);
    setError(false);
    if (mediaId === null) return;
    const controller = new AbortController();
    fetchDetails(mediaId, controller.signal)
      .then((m) => { if (!m) throw new Error("empty"); setMedia(m); })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(true);
      });
    return () => controller.abort();
  }, [mediaId, seed]);

  const dialogRef = useDialog(open, onClose);
  const swipe = useSheetSwipe(open, onClose, dialogRef, scrollRef);

  const title = media ? displayTitle(media) : "";
  const saved = media ? has(media.id) : false;
  const nextEp = media?.nextAiringEpisode ?? (upcoming ? { episode: upcoming.episode, airingAt: upcoming.airingAt } : null);
  const description = useMemo(() => stripHtml(media?.description), [media?.description]);

  const toggleSave = () => {
    if (!media) return;
    if (saved) {
      remove(media.id);
      toast("Removed from watchlist", "info");
    } else {
      add(media);
      toast("Added to watchlist");
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 z-[120] bg-black/70 md:backdrop-blur-sm"
          />
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title || "Anime details"}
            initial={{ y: "100%", opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            ref={dialogRef}
            style={{ y: swipe.y }}
            onClickCapture={swipe.onClickCapture}
            className="fixed inset-x-0 bottom-0 z-[121] mx-auto flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-line bg-ink-2 shadow-2xl md:inset-y-0 md:my-auto md:max-h-[86vh] md:rounded-3xl"
          >

            <div
              className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-3 active:cursor-grabbing md:hidden"
              aria-hidden="true"
            >
              <span className="h-1.5 w-12 rounded-full bg-line-strong" />
            </div>

            <button
              onClick={onClose}
              aria-label="Close details"
              className="tap-target absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-line bg-ink/70 backdrop-blur transition-colors hover:bg-ink-4 active:scale-90"
            >
              <X size={19} strokeWidth={2.2} />
            </button>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              {!media && !error && <SheetSkeleton />}
              {error && !media && <SheetError />}

              {media && (
                <>
                  <Banner media={media} />

                  <div className="relative -mt-16 px-5 pb-8 sm:px-7">
                    <PosterHeading media={media} title={title} />

                    <QuickFacts media={media} nextEpisode={nextEp} />

                    <Synopsis text={description} />

                    {media.studios.length > 0 && (
                      <p className="mt-4 font-mono text-[0.8rem] tracking-wide text-paper-faint">
                        Studio — {media.studios.join(", ")}
                      </p>
                    )}

                    <ActionRow media={media} saved={saved} onToggleSave={toggleSave} />

                    <WatchLinks links={media.externalLinks} />
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
