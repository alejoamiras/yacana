// The epoch map's geometry, in fractions of its width: every epoch the chain has has a cell at its
// absolute index over `[first, open]` (`first` is 0, or where a continuation started), so a page of
// history arriving adds bars and moves none.
import type { EpochRow } from '@yacana/miner-core/reader';
import { WINDOW } from './window';

export const MAP_HEIGHT = 18;
export type Tone = 'harder' | 'easier' | 'roll' | 'open';

export interface Bar {
  epoch: number;
  x: number;
  w: number;
  /** px */
  h: number;
  tone: Tone;
}

/** The cells across the rail: one per epoch of `[first, open]`. */
const cells = (open: number, first: number): number => open + 1 - first;

/** Cell `e` spans `[(e - first) / cells, (e + 1 - first) / cells)`. */
export const cellX = (e: number, open: number, first = 0): number => (e - first) / cells(open, first);
export const cellW = (open: number, first = 0): number => 1 / cells(open, first);

/** 3 px at a few seconds, the full 18 px from a day: `clamp(3, log10(duration s) × 4.6, 18)`. */
export const barHeight = (durationS: number | null): number =>
  durationS === null ? 3 : Math.max(3, Math.min(MAP_HEIGHT, Math.log10(Math.max(1, durationS)) * 4.6));

/** Colour by what happened next: harder violet, easier grey, the escape hatch amber. */
export const toneOf = (r: EpochRow, open: number): Tone => {
  if (r.epoch === open) return 'open';
  if (r.closedBy === 'roll') return 'roll';
  return (r.retarget ?? 1) < 1 ? 'harder' : 'easier';
};

/** One bar per held row at its absolute cell. */
export const barsFor = (rows: readonly EpochRow[], open: number, first = 0): Bar[] =>
  rows
    .filter((r) => r.epoch >= first && r.epoch <= open)
    .map((r) => ({
      epoch: r.epoch,
      x: cellX(r.epoch, open, first),
      w: cellW(open, first),
      h: barHeight(r.duration),
      tone: toneOf(r, open),
    }));

/** The window box over cells `[from, min(from + 48, open + 1))`: a full window is 48 cells, the first epoch alone is one. */
export const windowBox = (from: number, open: number, first = 0): { x: number; w: number } => {
  const end = Math.min(from + WINDOW, open + 1);
  return { x: cellX(from, open, first), w: (end - from) / cells(open, first) };
};

/** The epoch under a fraction of the width. */
export const epochAtX = (x: number, open: number, first = 0): number =>
  Math.min(open, Math.max(first, first + Math.floor(x * cells(open, first))));

export interface Tick {
  x: number;
  label: string;
}

const DAY = 86_400;
const mmdd = (unix: number) => new Date(unix * 1000).toISOString().slice(5, 10);

/**
 * Day ticks along the rail: "launch · MM-DD" at the first cell, then the first held epoch of each
 * later UTC day at its cell, "now" at the right edge. A day with no held epoch has no tick. One pass
 * over the rows: a timestamp far in the future costs nothing more than a label.
 */
export function dayTicks(rows: readonly EpochRow[], launchAt: number, open: number, first = 0): Tick[] {
  const held = [...rows].filter((r) => r.epoch >= first && r.epoch <= open).sort((a, b) => a.epoch - b.epoch);
  const ticks: Tick[] = [{ x: 0, label: `launch · ${mmdd(launchAt)}` }];
  let lastDay = Math.floor(launchAt / DAY);
  for (const r of held) {
    const day = Math.floor(r.openedAt / DAY);
    if (day <= lastDay) continue;
    const x = cellX(r.epoch, open, first);
    if (x > (ticks[ticks.length - 1] as Tick).x) ticks.push({ x, label: mmdd(day * DAY) });
    lastDay = day;
  }
  ticks.push({ x: 1, label: 'now' });
  return ticks;
}

/** The ticks that fit: the first and the last always, the rest only `labelPx` apart on a `widthPx` rail. */
export function thinTicks(ticks: readonly Tick[], widthPx: number, labelPx = 48): Tick[] {
  if (ticks.length <= 2 || widthPx <= 0) return [...ticks];
  const first = ticks[0] as Tick;
  const last = ticks[ticks.length - 1] as Tick;
  const out = [first];
  let lastX = first.x * widthPx;
  for (const t of ticks.slice(1, -1)) {
    const px = t.x * widthPx;
    if (px - lastX >= labelPx && last.x * widthPx - px >= labelPx) {
      out.push(t);
      lastX = px;
    }
  }
  out.push(last);
  return out;
}
