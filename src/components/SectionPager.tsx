import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import type { Section } from "../lib/types";

export const SECTIONS: Section[] = ["upcoming", "watchlist", "recent"];

interface Props {
  section: Section;
  onNavigate: (section: Section) => void;
  panels: Record<Section, ReactNode>;
  panelRefs: RefObject<Record<Section, HTMLElement | null>>;
  disabled: boolean;
}

export function SectionPager({ section, onNavigate, panels, panelRefs, disabled }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const width = useRef(0);
  const sectionRef = useRef(section);
  const navigateRef = useRef(onNavigate);
  const disabledRef = useRef(disabled);
  sectionRef.current = section;
  navigateRef.current = onNavigate;
  disabledRef.current = disabled;

  const settle = (target: number) => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    x.stop();
    if (reduced) x.set(target);
    else animate(x, target, { type: "spring", stiffness: 430, damping: 42, mass: 0.85 });
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // Reset to the measured viewport width on rotation or resize.

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      width.current = el.clientWidth;
      x.stop();
      x.set(window.innerWidth < 1024 ? -SECTIONS.indexOf(sectionRef.current) * width.current : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); x.stop(); };
  }, [x]);

  // All navigation methods settle the same track.

  useLayoutEffect(() => {
    if (window.innerWidth < 1024) settleRef.current(-SECTIONS.indexOf(section) * width.current);
    else { x.stop(); x.set(0); }
  }, [section, x]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let gesture: { startX: number; startY: number; origin: number; lastX: number; lastTime: number; velocity: number; axis: "pending" | "x" | "y" } | null = null;
    let suppressClick = false;
    let clickTimer = 0;
    const start = (event: TouchEvent) => {
      if (gesture?.axis === "x") settleRef.current(-SECTIONS.indexOf(sectionRef.current) * width.current);
      gesture = null;
      if (disabledRef.current || window.innerWidth >= 1024 || event.touches.length !== 1) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="group"]')) return;
      for (let node: HTMLElement | null = target; node && node !== el; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowX;
        if ((overflow === "auto" || overflow === "scroll") && node.scrollWidth > node.clientWidth + 1) return;
      }
      const touch = event.touches[0];
      gesture = { startX: touch.clientX, startY: touch.clientY, origin: x.get(), lastX: touch.clientX, lastTime: performance.now(), velocity: 0, axis: "pending" };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) {
        if (gesture.axis === "x") settleRef.current(-SECTIONS.indexOf(sectionRef.current) * width.current);
        gesture = null;
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      if (gesture.axis === "pending") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
        if (Math.abs(dy) >= Math.abs(dx) || !event.cancelable) { gesture.axis = "y"; return; }
        gesture.axis = "x";
        x.stop();
        gesture.origin = x.get();
      }
      if (gesture.axis !== "x") return;
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      gesture.velocity = (touch.clientX - gesture.lastX) / Math.max(1, now - gesture.lastTime);
      gesture.lastX = touch.clientX;
      gesture.lastTime = now;
      const min = -(SECTIONS.length - 1) * width.current;
      const raw = gesture.origin + dx;

      x.set(raw > 0 ? raw * 0.22 : raw < min ? min + (raw - min) * 0.22 : raw);
    };
    const end = (event: TouchEvent) => {
      const g = gesture;
      gesture = null;
      if (!g || g.axis !== "x") return;
      suppressClick = true;
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => { suppressClick = false; }, 400);
      const dx = (event.changedTouches[0]?.clientX ?? g.startX) - g.startX;
      const index = SECTIONS.indexOf(sectionRef.current);
      const velocity = performance.now() - g.lastTime < 100 ? g.velocity : 0;
      const commit = event.type !== "touchcancel" && (Math.abs(dx) > width.current * 0.22 || (Math.abs(dx) > 25 && Math.abs(velocity) > 0.5));
      const next = Math.max(0, Math.min(SECTIONS.length - 1, index + (dx < 0 ? 1 : -1)));
      if (commit && next !== index) navigateRef.current(SECTIONS[next]);
      else settleRef.current(-index * width.current);
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("click", click, true);
      window.clearTimeout(clickTimer);
    };
  }, [x]);

  return (
    <div ref={viewport} className="section-viewport">
      <motion.div className="section-track" style={{ x }}>
        {SECTIONS.map((id) => (
          <main
            key={id}
            ref={(node) => { panelRefs.current[id] = node; }}
            className="section-panel"
            data-section={id}
            aria-hidden={section !== id}
            inert={section !== id}
          >
            <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:px-6 lg:px-10 lg:pb-20 lg:pt-10">
              {panels[id]}
            </div>
          </main>
        ))}
      </motion.div>
    </div>
  );
}
