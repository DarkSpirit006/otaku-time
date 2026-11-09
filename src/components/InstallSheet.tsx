import { AnimatePresence, motion } from "framer-motion";
import { Check, CheckCircle2, Download, ExternalLink, MonitorSmartphone, Share, ShieldCheck, Smartphone, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "../lib/useDialog";
import { useSheetSwipe } from "../lib/useSheetSwipe";
import type { InstallPlatform } from "../lib/usePwaInstall";

interface Props {
  open: boolean;
  onClose: () => void;
  platform: InstallPlatform;
  installed: boolean;
  canPrompt: boolean;
  status: "idle" | "prompting" | "accepted" | "dismissed" | "unavailable" | "installed";
  onInstall: () => Promise<void>;
}

function Instructions({ platform }: { platform: InstallPlatform }) {
  if (platform === "ios") return (
    <div className="rounded-2xl border border-line bg-ink-3/60 p-4">
      <p className="mono-label mb-3">Install with Safari</p>
      <ol className="space-y-3 text-[0.93rem] text-paper-dim">
        <li className="flex gap-3"><Share size={19} className="mt-0.5 shrink-0 text-accent" /><span>Open this page in Safari, then tap <strong className="text-paper">Share</strong>.</span></li>
        <li className="flex gap-3"><span className="grid h-5 w-5 shrink-0 place-items-center rounded border border-line-strong text-paper">+</span><span>Choose <strong className="text-paper">Add to Home Screen</strong>.</span></li>
        <li className="flex gap-3"><Check size={19} className="mt-0.5 shrink-0 text-accent" /><span>Enable <strong className="text-paper">Open as Web App</strong> if available.</span></li>
        <li className="flex gap-3"><span className="grid h-5 w-5 shrink-0 place-items-center text-accent">4</span><span>Tap <strong className="text-paper">Add</strong>.</span></li>
      </ol>
    </div>
  );
  if (platform === "android") return (
    <div className="rounded-2xl border border-line bg-ink-3/60 p-4">
      <p className="mono-label mb-2">Install from your browser</p>
      <p className="text-[0.93rem] leading-relaxed text-paper-dim">In Chrome or a supported browser, open the <strong className="text-paper">⋮ menu</strong> and choose <strong className="text-paper">Install app</strong> or <strong className="text-paper">Add to Home screen</strong>. If offered, select Install rather than Create shortcut.</p>
    </div>
  );
  return (
    <div className="rounded-2xl border border-line bg-ink-3/60 p-4">
      <p className="mono-label mb-2">Install from your browser</p>
      <p className="text-[0.93rem] leading-relaxed text-paper-dim">In Chrome or Edge, look for the install icon in the address bar, or open the browser menu and choose <strong className="text-paper">Install Otaku Time</strong> or <strong className="text-paper">Install app</strong>. In Safari for macOS, choose <strong className="text-paper">File → Add to Dock</strong> if available. Menu names vary by browser.</p>
    </div>
  );
}

export function InstallSheet({ open, onClose, platform, installed, canPrompt, status, onInstall }: Props) {
  const [iconError, setIconError] = useState(false);
  const dialogRef = useDialog(open, onClose);
  const scrollRef = useRef<HTMLDivElement>(null);
  const swipe = useSheetSwipe(open, onClose, dialogRef, scrollRef);
  const showPrompt = !installed && platform !== "ios" && canPrompt && status !== "prompting";
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="install-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[140] bg-black/70 md:backdrop-blur-sm" />
          <motion.div
            key="install-sheet" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="install-title" aria-describedby="install-description"
            initial={{ y: "100%", opacity: 0.6 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }} style={{ y: swipe.y }} onClickCapture={swipe.onClickCapture}
            className="fixed inset-x-0 bottom-0 z-[141] mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-line bg-ink-2 shadow-2xl md:inset-y-0 md:my-auto md:max-h-[86vh] md:rounded-3xl"
          >
            <div className="flex shrink-0 touch-none justify-center pb-1 pt-3 md:hidden" aria-hidden="true"><span className="h-1.5 w-12 rounded-full bg-line-strong" /></div>
            <button onClick={onClose} aria-label="Close installation" className="tap-target absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-line bg-ink/70 transition-colors hover:bg-ink-4"><X size={19} /></button>
            <div ref={scrollRef} className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-7 sm:pt-7">
              <div className="flex items-center gap-4 pr-12">
                {iconError ? (
                  <svg viewBox="0 0 32 32" aria-hidden="true" className="h-[72px] w-[72px] shrink-0 rounded-2xl border border-line">
                    <rect width="32" height="32" rx="7" fill="#0d0c0a" />
                    <circle cx="16" cy="16" r="9" fill="none" stroke="#ff4526" strokeWidth="3" />
                    <path d="M16 10v6l4 3" fill="none" stroke="#ece6d8" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width="72" height="72" alt="" onError={() => setIconError(true)} className="h-[72px] w-[72px] shrink-0 rounded-2xl border border-line" />}
                <div><p className="mono-label mb-1 text-accent">Your anime almanac</p><h2 id="install-title" className="font-display text-2xl font-extrabold uppercase leading-tight">Otaku Time</h2></div>
              </div>
              <div className="mt-6">
                <h3 className="font-display text-xl font-bold">{installed ? "You're all set" : "Keep Otaku Time close"}</h3>
                <p id="install-description" className="mt-2 text-[0.95rem] leading-relaxed text-paper-dim">{installed ? "Otaku Time is installed. Open it from your apps or Home Screen." : "Install for quick access to your schedule and watchlist in an app-style window."}</p>
              </div>
              {!installed && (
                <div className="my-5 grid gap-2 text-sm text-paper-dim sm:grid-cols-2">
                  <span className="flex items-center gap-2"><MonitorSmartphone size={17} className="text-accent" /> Quick access from your device</span>
                  <span className="flex items-center gap-2"><ShieldCheck size={17} className="text-accent" /> Your watchlist stays local</span>
                </div>
              )}
              <div aria-live="polite" className="mt-4">
                {installed ? <div className="flex items-center gap-2 rounded-xl border border-gold/40 bg-gold-soft px-4 py-3 text-gold"><CheckCircle2 size={19} /> Installed</div> : (
                  <>
                    {status === "accepted" && <p className="mb-3 rounded-xl border border-gold/40 bg-gold-soft p-3 text-sm text-gold">Installation accepted. Complete any remaining steps in your browser.</p>}
                    {status === "dismissed" && <p className="mb-3 rounded-xl border border-line bg-ink-3 p-3 text-sm text-paper-dim">Installation was dismissed. You can use your browser's install menu whenever you're ready.</p>}
                    {status === "unavailable" && <p className="mb-3 rounded-xl border border-line bg-ink-3 p-3 text-sm text-paper-dim">The install prompt is unavailable. Use your browser's install menu instead.</p>}
                    {showPrompt && <button onClick={() => void onInstall()} className="tap-target mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3.5 font-semibold text-ink transition-transform active:scale-[0.98]"><Download size={19} /> Install Otaku Time</button>}
                    {status === "prompting" && <p className="mb-3 text-sm text-paper-dim">Waiting for your browser's installation dialog…</p>}
                    <Instructions platform={platform} />
                    {!canPrompt && platform !== "ios" && status === "idle" && <p className="mt-3 flex gap-2 text-xs leading-relaxed text-paper-faint"><ExternalLink size={15} className="shrink-0" /> The browser may offer a shortcut instead of an installable app, or may not support installation.</p>}
                  </>
                )}
              </div>
              <button onClick={onClose} className="tap-target mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-line-strong px-5 py-3.5 font-semibold text-paper transition-colors hover:bg-ink-3"><Smartphone size={18} /> {installed ? "Continue" : "Continue in Browser"}</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>, document.body
  );
}
