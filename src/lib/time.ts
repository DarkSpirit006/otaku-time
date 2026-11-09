export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function countdownParts(targetSec: number, nowMs: number) {
  const diff = Math.max(0, targetSec - Math.floor(nowMs / 1000));
  return {
    days: Math.floor(diff / 86400),
    hours: Math.floor((diff % 86400) / 3600),
    minutes: Math.floor((diff % 3600) / 60),
    seconds: diff % 60,
    total: diff,
  };
}

export const DEFAULT_EPISODE_MIN = 24;

export function airingPhase(
  targetSec: number,
  nowMs: number,
  durationMin?: number | null
): "upcoming" | "live" | "aired" {
  const nowSec = Math.floor(nowMs / 1000);
  if (nowSec < targetSec) return "upcoming";
  const runSec = (durationMin && durationMin > 0 ? durationMin : DEFAULT_EPISODE_MIN) * 60;
  return nowSec < targetSec + runSec ? "live" : "aired";
}

export function shortCountdown(targetSec: number, nowMs: number, durationMin?: number | null): string {
  const phase = airingPhase(targetSec, nowMs, durationMin);
  if (phase === "live") return "Airing now";
  if (phase === "aired") return `Aired ${timeAgo(targetSec, nowMs)}`;
  const p = countdownParts(targetSec, nowMs);
  if (p.days > 0) return `${p.days}d ${p.hours}h`;
  if (p.hours > 0) return `${p.hours}h ${pad(p.minutes)}m`;
  if (p.minutes > 0) return `${p.minutes}m ${pad(p.seconds)}s`;
  return `${p.seconds}s`;
}

export function timeAgo(targetSec: number, nowMs: number): string {
  const diff = Math.floor(nowMs / 1000) - targetSec;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const d = Math.floor(diff / 86400);
  if (d < 7) return `${d}d ago`;
  return new Date(targetSec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function clockTime(targetSec: number): string {
  return new Date(targetSec * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fullDateTime(targetSec: number): string {
  const d = new Date(targetSec * 1000);
  const date = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${date} · ${clockTime(targetSec)}`;
}

export interface DayGroup<T> {
  key: string;
  label: string;
  dateLine: string;
  items: T[];
}

function dayLabel(date: Date, todayStart: number): string {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const delta = Math.round((start - todayStart) / 86400000);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  if (delta > 1 && delta < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  if (delta < -1 && delta > -7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function groupByDay<T extends { airingAt: number }>(items: T[], nowMs: number): DayGroup<T>[] {
  const now = new Date(nowMs);
  const groups = new Map<string, DayGroup<T>>();
  const sorted = [...items].sort((a, b) => a.airingAt - b.airingAt);

  for (const item of sorted) {
    const d = new Date(item.airingAt * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let g = groups.get(key);
    if (!g) {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      g = {
        key,
        label: dayLabel(d, todayStart),
        dateLine: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        items: [],
      };
      groups.set(key, g);
    }
    g.items.push(item);
  }
  return [...groups.values()];
}

export function isToday(targetSec: number, nowMs: number): boolean {
  const a = new Date(targetSec * 1000);
  const b = new Date(nowMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatClock(nowMs: number): { time: string; date: string } {
  const d = new Date(nowMs);
  return {
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    date: d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
  };
}
