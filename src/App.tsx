import { MotionConfig } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider, WatchlistProvider } from "./lib/store";
import { ScheduleProvider } from "./lib/schedule-store";
import { usePwaInstall } from "./lib/usePwaInstall";
import { NotificationsProvider } from "./lib/notifications";
import { ThemeProvider } from "./lib/theme";
import type { Media, Section } from "./lib/types";
import { BottomTabs, DesktopRail, MobileTopBar } from "./components/Chrome";
import { SearchOverlay } from "./components/SearchOverlay";
import { DetailSheet } from "./components/DetailSheet";
import { InstallSheet } from "./components/InstallSheet";
import { SettingsSheet } from "./components/SettingsSheet";
import { CommandPalette, ShortcutHelp } from "./components/Palette";
import { SectionHead } from "./components/ui";
import { Upcoming } from "./views/Upcoming";
import { Watchlist } from "./views/Watchlist";
import { Recent } from "./views/Recent";
import { SectionPager } from "./components/SectionPager";

const SECTION_META: Record<Section, { index: string; title: string; meta: string }> = {
  upcoming: { index: "01", title: "Upcoming", meta: "Airs next" },
  watchlist: { index: "02", title: "Watchlist", meta: "Your tracks" },
  recent: { index: "03", title: "Recently aired", meta: "The log" },
};

function validSection(hash: string): Section {
  const h = hash.replace("#", "").split("/")[0];
  return h === "watchlist" || h === "recent" || h === "upcoming" ? h : "upcoming";
}

export default function App() {
  const [section, setSection] = useState<Section>(() => validSection(window.location.hash));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSeed, setSearchSeed] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailSeed, setDetailSeed] = useState<Media | null>(null);
  const [installOpen, setInstallOpen] = useState(() => new URL(window.location.href).searchParams.getAll("install").includes("1"));
  const install = usePwaInstall();

  const openInstall = useCallback(() => {
    setSettingsOpen(false);
    setPaletteOpen(false);
    setHelpOpen(false);
    setInstallOpen(true);
  }, []);
  const closeInstall = useCallback(() => {
    setInstallOpen(false);
    const url = new URL(window.location.href);
    if (url.searchParams.has("install")) {
      // Preserve unrelated query tokens byte-for-byte; URLSearchParams would re-encode them.

      const remaining = url.search.slice(1).split("&").filter(token => !new URLSearchParams(token).has("install"));
      const search = remaining.length ? `?${remaining.join("&")}` : "";
      history.replaceState(history.state, "", `${url.pathname}${search}${url.hash}`);
    }
  }, []);
  useEffect(() => {
    const onHistory = () => {
      if (new URL(window.location.href).searchParams.getAll("install").includes("1")) {
        setSettingsOpen(false);
        setPaletteOpen(false);
        setHelpOpen(false);
        setInstallOpen(true);
      } else setInstallOpen(false);
    };
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, []);

  const panelRefs = useRef<Record<Section, HTMLElement | null>>({ upcoming: null, watchlist: null, recent: null });
  const scrollMemory = useRef<Record<Section, number>>({ upcoming: 0, watchlist: 0, recent: 0 });
  const sectionRef = useRef(section);
  sectionRef.current = section;

  const switchSection = useCallback((next: Section, repeatScroll = false) => {
    const current = sectionRef.current;
    if (current === next) {
      if (repeatScroll) {
        if (window.innerWidth < 1024) panelRefs.current[next]?.scrollTo({ top: 0, behavior: "smooth" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    if (window.innerWidth >= 1024) scrollMemory.current[current] = window.scrollY;
    sectionRef.current = next;
    setSection(next);
    if (window.innerWidth >= 1024) {
      requestAnimationFrame(() => window.scrollTo({ top: scrollMemory.current[next], behavior: "instant" }));
    }
  }, []);

  const navigate = useCallback((next: Section) => {
    const same = sectionRef.current === next;
    switchSection(next, same);
    if (!same && window.location.hash !== `#${next}`) history.pushState(null, "", `#${next}`);
  }, [switchSection]);

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash;
      if (h.startsWith("#show/")) {
        const id = Number(h.replace("#show/", ""));
        if (Number.isFinite(id)) setDetailId(id);
      } else {
        setDetailId(null);
        switchSection(validSection(h));
      }
    };
    onHash();
    window.addEventListener("popstate", onHash);
    window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener("popstate", onHash); window.removeEventListener("hashchange", onHash); };
  }, [switchSection]);

  const openDetail = useCallback((id: number, seed?: Media) => {
    setDetailSeed(seed ?? null);
    setDetailId(id);
    if (window.location.hash !== `#show/${id}`) {
      history.pushState(null, "", `#show/${id}`);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
    if (window.location.hash.startsWith("#show/")) {
      history.pushState(null, "", `#${section}`);
    }
  }, [section]);

  useEffect(() => {
    let gArmed = false;
    let gTimer = 0;
    const onKey = (e: KeyboardEvent) => {
      if (installOpen || searchOpen || settingsOpen || paletteOpen || helpOpen || detailId !== null) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.key === "g") {
        gArmed = true;
        window.clearTimeout(gTimer);
        gTimer = window.setTimeout(() => (gArmed = false), 900);
        return;
      }
      if (gArmed) {
        const map: Record<string, Section> = { u: "upcoming", w: "watchlist", r: "recent" };
        const s = map[e.key];
        if (s) {
          navigate(s);
          gArmed = false;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(gTimer);
    };
  }, [navigate, installOpen, searchOpen, settingsOpen, paletteOpen, helpOpen, detailId]);

  const panelContent = (id: Section) => {
    const meta = SECTION_META[id];
    return (
      <>
        <SectionHead
          index={meta.index}
          title={meta.title}
          meta={meta.meta}
          aside={<p className="mono-label hidden pb-1 sm:block">Data · AniList — stored only in your browser</p>}
        />
        {id === "upcoming" && <Upcoming onOpenDetail={openDetail} />}
        {id === "watchlist" && <Watchlist onOpenDetail={openDetail} onGoUpcoming={() => navigate("upcoming")} />}
        {id === "recent" && <Recent onOpenDetail={openDetail} />}
        <footer className="mt-16 border-t border-line pt-5">
          <p className="font-mono text-[0.78rem] leading-relaxed tracking-wide text-paper-faint">
            Otaku Time · a local-first broadcast almanac
            <span className="mx-2 text-line-strong">/</span> data provided by AniList · artwork belongs to its respective owners
            <span className="mx-2 text-line-strong">/</span> no account required
          </p>
        </footer>
      </>
    );
  };

  return (
    <ErrorBoundary>
      {/* reducedMotion="user" makes framer honour the OS setting too —
        the CSS override alone can't stop JS-driven transforms. */}
      <MotionConfig reducedMotion="user">
        <ThemeProvider>
          <WatchlistProvider>
            <ToastProvider>
              <ScheduleProvider>
                <NotificationsProvider>
                <div className="grain min-h-dvh">

                  <div className="column-rules fixed inset-0 z-0 ml-[264px] hidden lg:block" aria-hidden="true" />

                  <div className="relative z-10 flex">
                    <DesktopRail
                      section={section}
                      onNavigate={navigate}
                      onSearch={() => setSearchOpen(true)}
                      onSettings={() => setSettingsOpen(true)}
                    />

                    <div className="min-w-0 flex-1">
                      <MobileTopBar onSearch={() => setSearchOpen(true)} onSettings={() => setSettingsOpen(true)} />

                      <SectionPager
                        section={section}
                        onNavigate={navigate}
                        panelRefs={panelRefs}
                        disabled={searchOpen || settingsOpen || paletteOpen || helpOpen || installOpen || detailId !== null}
                        panels={{ upcoming: panelContent("upcoming"), watchlist: panelContent("watchlist"), recent: panelContent("recent") }}
                      />
                    </div>
                  </div>

                  <BottomTabs section={section} onNavigate={navigate} />

                  <SearchOverlay
                    open={searchOpen}
                    suspended={detailId !== null || installOpen}
                    initialQuery={searchSeed}
                    onClose={() => {
                      setSearchOpen(false);
                      setSearchSeed("");
                    }}
                    onOpenDetail={(id, seed) => {
                      openDetail(id, seed);
                    }}
                  />

                  <DetailSheet mediaId={installOpen ? null : detailId} seed={detailSeed} onClose={closeDetail} />

                  <SettingsSheet
                    open={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                    onShowHelp={() => setHelpOpen(true)}
                    onInstall={openInstall}
                  />

                  <CommandPalette
                    open={paletteOpen}
                    onClose={() => setPaletteOpen(false)}
                    onNavigate={navigate}
                    onSearchQuery={(q) => {
                      setSearchSeed(q);
                      setSearchOpen(true);
                    }}
                    onShowHelp={() => setHelpOpen(true)}
                    onInstall={openInstall}
                  />

                  <InstallSheet open={installOpen} onClose={closeInstall} {...install} onInstall={install.promptInstall} />
                  <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
                </div>
                </NotificationsProvider>
              </ScheduleProvider>
            </ToastProvider>
          </WatchlistProvider>
        </ThemeProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}
