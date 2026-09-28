// The stats page reads in two beats and publishes each as it lands: beat one is the fixed slots
// (the page has numbers in a few hundred milliseconds), beat two the epoch window (the strip, the
// charts and the table). Pure over injected reads and sinks, so the order and the failure rules are
// tested without a node.
import type { EpochRow } from '@yacana/miner-core/reader';
import type { Fixed, History, Lottery } from './state';
import { type EpochWindow, WINDOW } from './window';

export interface BeatReads {
  fixed: () => Promise<Fixed>;
  /** The rows of `[from, to]` and, when it exists, the one after `to` (the seam that closes the last row). */
  rows: (from: number, to: number, open: number) => Promise<EpochRow[]>;
  lottery: () => Promise<Lottery>;
}

export interface BeatSinks {
  fixed: (f: Fixed) => void;
  history: (h: History) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const upsert = (held: ReadonlyMap<number, EpochRow>, rows: readonly EpochRow[]): Map<number, EpochRow> => {
  const next = new Map(held);
  for (const r of rows) next.set(r.epoch, r);
  return next;
};

const newest = (rows: ReadonlyMap<number, EpochRow>): number | undefined =>
  rows.size ? Math.max(...rows.keys()) : undefined;

/** The lottery is decoration next to the rows: a failed read leaves it null and the next poll asks again. */
const lotteryOrNull = (read: BeatReads): Promise<Lottery | null> => read.lottery().catch(() => null);

/** Rows above `open` cannot exist: a node answering a lower open epoch (a reorg, a different node) drops them. */
const below = (rows: Map<number, EpochRow>, open: number): Map<number, EpochRow> => {
  for (const e of [...rows.keys()]) if (e > open) rows.delete(e);
  return rows;
};

/**
 * The first read. Beat one is published the moment it lands; beat two follows with the newest
 * window and the lottery. A history failure still leaves beat one on the page and says so in
 * `history.error`, with no rows. `first` is the chain's first epoch: nothing is read below it.
 */
export async function bootBeats(read: BeatReads, publish: BeatSinks, first = 0): Promise<Fixed> {
  const fixed = await read.fixed();
  publish.fixed(fixed);
  try {
    const rows = await read.rows(Math.max(first, fixed.open - WINDOW + 1), fixed.open, fixed.open);
    publish.history({ rows: upsert(new Map(), rows), lottery: await lotteryOrNull(read) });
  } catch (e) {
    publish.history({ rows: new Map(), lottery: null, error: message(e) });
  }
  return fixed;
}

/**
 * The poll: beat one again, then the rows from the last one held (it may just have closed) to the
 * open epoch, joined to what is held. More closes than a window since the last read would leave a
 * gap; the held rows are dropped for the newest window instead. A history read that fails keeps the
 * rows held and says so; the fixed slots are published either way.
 */
export async function pollBeats(
  read: BeatReads,
  publish: BeatSinks,
  held: { fixed: Fixed; history: History | null },
  first = 0,
): Promise<void> {
  const fixed = await read.fixed();
  publish.fixed(fixed);
  const from = Math.max(first, Math.min(held.fixed.open, fixed.open) - 1, fixed.open - WINDOW + 1);
  const rows0 = held.history?.rows ?? new Map<number, EpochRow>();
  const top = newest(rows0);
  const base = top === undefined || from <= top + 1 ? rows0 : new Map<number, EpochRow>();
  try {
    const rows = await read.rows(from, fixed.open, fixed.open);
    const lottery = held.history?.lottery ?? (await lotteryOrNull(read));
    publish.history({ rows: below(upsert(base, rows), fixed.open), lottery });
  } catch (e) {
    // The rows stay, minus any above the open epoch beat one just published: those cannot exist either way.
    publish.history({
      rows: below(new Map(rows0), fixed.open),
      lottery: held.history?.lottery ?? null,
      error: message(e),
    });
  }
}

/** A window the visitor asked for that is not held: read whole and joined; a failure is said, not a crash. */
export async function windowBeat(
  read: BeatReads,
  publish: BeatSinks,
  held: { fixed: Fixed; history: History },
  w: EpochWindow,
): Promise<void> {
  try {
    const rows = await read.rows(w.from, w.to, held.fixed.open);
    publish.history({ ...held.history, rows: upsert(held.history.rows, rows), error: undefined });
  } catch (e) {
    publish.history({ ...held.history, error: message(e) });
  }
}
