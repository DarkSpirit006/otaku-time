import { animate, useMotionValue } from "framer-motion";
import { useEffect, useRef, type MouseEvent, type RefObject } from "react";

/** Native scrolling wins unless a downward gesture begins at the top.
 * The header/handle can always be dragged. Shared by both mobile sheets. */
export function useSheetSwipe(open: boolean, onClose: () => void, sheetRef: RefObject<HTMLDivElement | null>, scrollRef: RefObject<HTMLDivElement | null>) {
  const y = useMotionValue(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const suppressClick = useRef(false);

  useEffect(() => {
    const sheet = sheetRef.current;
    const scroll = scrollRef.current;
    if (!open || !sheet || !scroll) return;
    let gesture: { x: number; startY: number; lastY: number; time: number; velocity: number; dragging: boolean; distance: number } | null = null;
    let timer = 0;
    const snapBack = () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) y.set(0);
      else animate(y, 0, { type: "spring", stiffness: 500, damping: 43, mass: 0.8 });
    };
    const start = (event: TouchEvent) => {
      if (gesture?.dragging) snapBack();
      gesture = null;
      if (!window.matchMedia("(max-width: 767px)").matches || event.touches.length !== 1) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (scroll.contains(target)) {
        // Don't steal a gesture from a nested list or the main scroller.
        for (let node: HTMLElement | null = target; node; node = node.parentElement) {
          const overflow = getComputedStyle(node).overflowY;
          if ((node === scroll || overflow === "auto" || overflow === "scroll") && node.scrollTop > 0) return;
          if (node === scroll) break;
        }
      }
      const touch = event.touches[0];
      gesture = { x: touch.clientX, startY: touch.clientY, lastY: touch.clientY, time: performance.now(), velocity: 0, dragging: false, distance: 0 };
      suppressClick.current = false;
    };
    const move = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) return;
      const touch = event.touches[0], dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.startY;
      if (!gesture.dragging) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || !event.cancelable) { gesture = null; return; }
        y.stop();
        gesture.dragging = true;
        suppressClick.current = true;
      }
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      gesture.velocity = (touch.clientY - gesture.lastY) / Math.max(1, now - gesture.time);
      gesture.lastY = touch.clientY;
      gesture.time = now;
      gesture.distance = Math.max(0, dy);
      y.set(gesture.distance);
    };
    const end = (event: TouchEvent) => {
      if (gesture?.dragging) {
        const velocity = performance.now() - gesture.time < 100 ? gesture.velocity : 0;
        if (event.type !== "touchcancel" && (gesture.distance > 120 || (gesture.distance > 35 && velocity > 0.7))) onCloseRef.current();
        else snapBack();
        clearTimeout(timer);
        timer = window.setTimeout(() => { suppressClick.current = false; }, 400);
      }
      gesture = null;
    };
    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
    return () => {
      sheet.removeEventListener("touchstart", start);
      sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", end);
      clearTimeout(timer);
    };
  }, [open, sheetRef, scrollRef, y]);

  const onClickCapture = (event: MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  return { y, onClickCapture };
}
