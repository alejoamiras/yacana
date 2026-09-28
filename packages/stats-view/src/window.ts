// The window: 48 epochs the strip, the charts and the table show, `[from, from + 47]` clamped to
// the chain; `?from=` names it, absent means the newest one, which follows the open epoch. The
// chain begins at `first`: 0, or the epoch a continuation started at (it has none before).
import { type EpochRow, linkRows } from '@yacana/miner-core/reader';

/** Epochs per window: the strip's cells, the reader's page, one ‹ › step. */
export const WINDOW = 48;

export interface EpochWindow {
  from: number;
  to: number;
}

/** The newest window's first epoch. */
export const newestFrom = (open: number, first = 0): number => Math.max(first, open - WINDOW + 1);

/** `[from, to]` for a `?from=` (null = the newest window), clamped so a window never overhangs either end. */
export function windowFor(from: number | null, open: number, first = 0): EpochWindow {
  const newest = newestFrom(open, first);
  const start = from === null ? newest : Math.min(Math.max(first, from), newest);
  return { from: start, to: Math.min(open, start + WINDOW - 1) };
}

/** The `?from=` to write for `from`: null once it is the newest window, so the URL follows the open epoch again. */
export const normaliseFrom = (from: number, open: number, first = 0): number | null => {
  const newest = newestFrom(open, first);
  const f = Math.min(Math.max(first, from), newest);
  return f === newest ? null : f;
};

export const olderFrom = (w: EpochWindow, open: number, first = 0): number | null =>
  normaliseFrom(w.from - WINDOW, open, first);
export const newerFrom = (w: EpochWindow, open: number, first = 0): number | null =>
  normaliseFrom(w.from + WINDOW, open, first);
/** The window with `epoch` in its middle. */
export const centredFrom = (epoch: number, open: number, first = 0): number | null =>
  normaliseFrom(epoch - Math.floor(WINDOW / 2), open, first);

/** Whether every epoch of `w` is held — with `to + 1` when the chain has it, so the last row closes. */
export function windowHeld(rows: ReadonlyMap<number, EpochRow>, w: EpochWindow, open: number): boolean {
  const end = Math.min(open, w.to + 1);
  for (let e = w.from; e <= end; e++) if (!rows.has(e)) return false;
  return true;
}

/**
 * The window's rows, ascending and linked: the last one closes through `to + 1` when that row is
 * held (the reads fetch it for this seam); a gap inside the window leaves the row before it open.
 */
export function windowRowsOf(rows: ReadonlyMap<number, EpochRow>, w: EpochWindow): EpochRow[] {
  const span: EpochRow[] = [];
  for (let e = w.from; e <= w.to + 1; e++) {
    const r = rows.get(e);
    if (r) span.push(r);
  }
  return linkRows(span).filter((r) => r.epoch <= w.to);
}
