import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  CalendarArrowDown,
  ChevronRight,
  Download,
  Moon,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildICS, buildWatchlistExport, downloadFile } from "../lib/ics";
import { useTheme } from "../lib/theme";
import { useToast, useWatchlist } from "../lib/store";
import { useNotifications } from "../lib/notifications";
import { useDialog } from "../lib/useDialog";
import { useSheetSwipe } from "../lib/useSheetSwipe";
import { cn } from "../utils/cn";

function Row({
  icon: Icon,
  title,
  hint,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: typeof Download;
  title: string;
  hint?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "tap-target flex w-full items-center gap-4 rounded-2xl border border-line bg-ink-2 px-5 py-4 text-left transition-all hover:border-line-strong active:scale-[0.99] disabled:opacity-40",
        danger && "border-accent/40"
      )}
    >
      <span
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
          danger ? "bg-accent-soft text-accent" : "bg-ink-3 text-paper-dim"
        )}
      >
        <Icon size={19} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[1rem] font-semibold", danger && "text-accent")}>{title}</span>
        {hint && <span className="block truncate text-[0.85rem] text-paper-faint">{hint}</span>}
      </span>
      <ChevronRight size={17} className="shrink-0 text-paper-faint" />
    </button>
  );
}

export function SettingsSheet({
  open,
  onClose,
  onShowHelp,
  onInstall,
}: {
  open: boolean;
  onClose: () => void;
  onShowHelp: () => void;
  onInstall: () => void;
}) {
  const { theme, toggle } = useTheme();
  const { entries, importEntries, clearAll } = useWatchlist();
  const notifications = useNotifications();
  const notificationsOn = notifications.settings.enabled && notifications.permission === "granted";
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setConfirmClear(false); setPendingImport(null); }
  }, [open]);

  const dialogRef = useDialog(open, onClose);
  const swipe = useSheetSwipe(open, onClose, dialogRef, scrollRef);

  useEffect(() => {
    if (confirmClear) cancelClearRef.current?.focus({ preventScroll: true });
  }, [confirmClear]);

  const exportICS = () => {
    const { content, count } = buildICS(entries);
    if (count === 0) {
      toast("No upcoming airings to export", "info");
      return;
    }
    downloadFile("otaku-time.ics", content, "text/calendar");
    toast(`Calendar exported — ${count} reminder${count === 1 ? "" : "s"}`);
  };

  const exportJSON = () => {
    if (entries.length === 0) {
      toast("Your watchlist is empty", "info");
      return;
    }
    downloadFile("otaku-time-watchlist.json", buildWatchlistExport(entries), "application/json");
    toast(`Exported ${entries.length} show${entries.length === 1 ? "" : "s"}`);
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const count = importEntries(JSON.parse(text));
      toast(`Imported ${count} show${count === 1 ? "" : "s"}`);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That file could not be imported.", "info");
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
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            key="settings"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            ref={dialogRef}
            style={{ y: swipe.y }}
            onClickCapture={swipe.onClickCapture}
            className="fixed inset-x-0 bottom-0 z-[101] mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-line bg-ink shadow-2xl md:inset-y-0 md:my-auto md:rounded-3xl"
          >
            <div
              className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-3 active:cursor-grabbing md:hidden"
              aria-hidden="true"
            >
              <span className="h-1.5 w-12 rounded-full bg-line-strong" />
            </div>

            <div className="flex items-center justify-between px-5 pb-4 pt-3 sm:px-6">
              <div>
                <p className="mono-label">Preferences</p>
                <h3 className="font-display text-[1.6rem] font-extrabold tracking-tight">Settings</h3>
              </div>
              <button
                onClick={onClose}
                aria-label="Close settings"
                className="tap-target grid h-11 w-11 place-items-center rounded-full border border-line transition-colors hover:bg-ink-3 active:scale-90"
              >
                <X size={18} strokeWidth={2.2} />
              </button>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">

              <div className="rounded-2xl border border-line bg-ink-2 p-4">
                <p className="mono-label mb-3">Appearance</p>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Theme">
                  {(
                    [
                      ["dark", "Ink", Moon],
                      ["light", "Paper", Sun],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <button
                      key={value}
                      onClick={() => {
                        if (theme !== value) toggle();
                      }}
                      aria-pressed={theme === value}
                      className={cn(
                        "tap-target flex items-center justify-center gap-2.5 rounded-xl border py-3.5 text-[0.95rem] font-semibold transition-all active:scale-[0.98]",
                        theme === value
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line text-paper-dim hover:border-line-strong"
                      )}
                    >
                      <Icon size={18} strokeWidth={2} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <Row icon={Smartphone} title="Install Otaku Time" hint="Add the app to your device" onClick={onInstall} />

              <section className="rounded-2xl border border-line bg-ink-2 p-4" aria-labelledby="notification-heading">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Bell size={19} /></span>
                  <div className="min-w-0 flex-1">
                    <h4 id="notification-heading" className="font-semibold">Watchlist reminders</h4>
                    <p className="text-sm text-paper-faint">Get a reminder before an episode airs.</p>
                  </div>
                  <button
                    role="switch"
                    aria-label="Watchlist notifications"
                    aria-checked={notificationsOn}
                    onClick={() => { if (notificationsOn) notifications.disable(); else void notifications.enable(); }}
                    disabled={notifications.permission === "unsupported"}
                    className="tap-target relative grid h-11 w-14 shrink-0 place-items-center disabled:opacity-40"
                  >
                    <span className={cn("relative block h-8 w-14 rounded-full border transition-colors", notificationsOn ? "border-accent bg-accent" : "border-line-strong bg-ink-4")}>
                      <span className={cn("absolute left-1 top-1 h-5 w-5 rounded-full bg-paper transition-transform", notificationsOn ? "translate-x-6" : "translate-x-0")} />
                    </span>
                  </button>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-paper-dim">
                  Reminders work only while Otaku Time is open. Background tabs may be delayed; closed-app reminders are not supported. Airing times require current AniList data.
                </p>
                {notifications.permission === "unsupported" && <p className="mt-2 text-sm text-accent" role="status">Notifications are unavailable here. Use a supported browser over HTTPS; on iOS, add the app to your Home Screen.</p>}
                {notifications.permission === "denied" && <p className="mt-2 text-sm text-accent" role="status">Notifications are blocked. Allow them in your browser and device settings.</p>}
                {notifications.error && <p className="mt-2 text-sm text-accent" role="alert">{notifications.error}</p>}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <label htmlFor="reminder-lead" className="text-sm font-semibold">Remind me</label>
                  <select id="reminder-lead" value={notifications.settings.minutes} onChange={(event) => notifications.setMinutes(Number(event.target.value))} className="min-h-11 rounded-xl border border-line-strong bg-ink-3 px-3 text-sm">
                    <option value={0}>At airtime</option>
                    <option value={5}>5 minutes before</option>
                    <option value={15}>15 minutes before</option>
                    <option value={60}>1 hour before</option>
                  </select>
                </div>
                {notificationsOn && <button onClick={() => void notifications.test()} className="tap-target mt-3 text-sm font-semibold text-accent underline underline-offset-4">Send test notification</button>}
                <p className="mono-label mb-2 mt-4">Shows to notify</p>
                {entries.length === 0 ? <p className="text-sm text-paper-faint">Add shows to your watchlist to choose reminders.</p> : (
                  <div className="max-h-48 space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-line bg-ink p-2">
                    {entries.map(entry => (
                      <label key={entry.mediaId} className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-ink-3">
                        <input type="checkbox" checked={!notifications.settings.muted.includes(entry.mediaId)} onChange={() => notifications.toggleShow(entry.mediaId)} className="h-5 w-5 shrink-0 accent-accent" />
                        <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <Row
                icon={CalendarArrowDown}
                title="Export calendar (.ics)"
                hint="Episode reminders for your phone's calendar"
                onClick={exportICS}
              />
              <Row
                icon={Download}
                title="Export watchlist"
                hint={`${entries.length} show${entries.length === 1 ? "" : "s"} as JSON`}
                onClick={exportJSON}
              />
              <Row
                icon={Upload}
                title="Import watchlist"
                hint="Restore a previously exported file"
                onClick={() => fileRef.current?.click()}
              />
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { if (entries.length) setPendingImport(f); else void onImportFile(f); }
                  e.target.value = "";
                }}
              />

              {pendingImport && (
                <div role="alert" className="rounded-2xl border border-accent/50 bg-accent-soft p-4">
                  <p className="font-semibold text-paper">Replace your watchlist?</p>
                  <p className="mt-1 text-sm text-paper-dim">Importing {pendingImport.name} replaces all {entries.length} saved shows and their progress. Export a backup first if needed.</p>
                  <div className="mt-4 flex gap-3">
                    <button onClick={() => setPendingImport(null)} className="tap-target flex-1 rounded-xl border border-line-strong px-4 py-3 font-semibold">Cancel import</button>
                    <button onClick={() => { const file = pendingImport; setPendingImport(null); void onImportFile(file); }} className="tap-target flex-1 rounded-xl bg-accent px-4 py-3 font-semibold text-ink">Replace watchlist</button>
                  </div>
                </div>
              )}
              {!confirmClear ? (
                <button
                  ref={clearButtonRef}
                  onClick={() => setConfirmClear(true)}
                  disabled={entries.length === 0}
                  className="tap-target flex w-full items-center justify-center gap-2.5 rounded-2xl border border-accent/40 py-4 text-[1rem] font-semibold text-accent transition-all hover:bg-accent-soft active:scale-[0.99] disabled:opacity-40"
                >
                  <Trash2 size={18} strokeWidth={2} />
                  Clear watchlist
                </button>
              ) : (
                <div role="alert" className="rounded-2xl border border-accent/50 bg-accent-soft p-4">
                  <p className="font-semibold text-paper">Clear your watchlist?</p>
                  <p className="mt-1 text-sm leading-relaxed text-paper-dim">
                    This will remove all {entries.length} saved show{entries.length === 1 ? "" : "s"} and their progress. This cannot be undone.
                  </p>
                  <div className="mt-4 flex gap-3">
                    <button
                      ref={cancelClearRef}
                      onClick={() => {
                        setConfirmClear(false);
                        requestAnimationFrame(() => clearButtonRef.current?.focus({ preventScroll: true }));
                      }}
                      className="tap-target flex-1 rounded-xl border border-line-strong px-4 py-3 font-semibold text-paper"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        clearAll();
                        setConfirmClear(false);
                        toast("Watchlist cleared", "info");
                        onClose();
                      }}
                      className="tap-target flex-1 rounded-xl bg-accent px-4 py-3 font-semibold text-ink"
                    >
                      Yes, clear all
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  onShowHelp();
                  onClose();
                }}
                className="w-full pt-1 text-center font-mono text-[0.8rem] tracking-wide text-paper-faint underline-offset-4 hover:underline"
              >
                Keyboard shortcuts (Ctrl K · ? · g u/w/r)
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
