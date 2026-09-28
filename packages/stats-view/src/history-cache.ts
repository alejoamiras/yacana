// Rows read at `latest` and older than a 96-epoch margin are kept in the browser for the next
// visit: an observation from one node, not a finality proof, so the key carries the deployment and
// the node (a node's rows never outlive a switch), the text is contiguous ranges of
// `[epoch, target hex, openedAt, claims]`, capped, and every row is validated on the way back in —
// any row the contract could not have written drops the cache whole.
import { PARAMS } from '@yacana/miner-core/generated/params';
import type { EpochRow } from '@yacana/miner-core/reader';

export const CACHE_VERSION = 'v1';
export const MAX_ROWS = 8192;
export const MAX_BYTES = 512 * 1024;
/** Epochs below the open one never written or served: reads are at `latest`, so the tail is always re-read. */
export const MARGIN = 96;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const cacheKey = (d: {
  chainId: string;
  rollupAddress: string;
  miner: string;
  endpoint: string;
}): string =>
  `yacana.epochs.${CACHE_VERSION}.${d.chainId}.${d.rollupAddress.toLowerCase()}.${d.miner.toLowerCase()}.${d.endpoint}`;

type Packed = [number, string, number, number];

/** What a row is checked against: the genesis (nothing opened before it), the clock, and the margin. */
export interface Bounds {
  launchAt: number;
  now: number;
  open: number;
}

const HEX = /^[0-9a-f]{1,32}$/;

const validRow = (p: unknown, prev: Packed | undefined, b: Bounds): p is Packed =>
  Array.isArray(p) &&
  p.length === 4 &&
  Number.isSafeInteger(p[0]) &&
  p[0] >= 0 &&
  p[0] < b.open - MARGIN &&
  (prev === undefined || p[0] === prev[0] + 1) &&
  typeof p[1] === 'string' &&
  HEX.test(p[1]) &&
  BigInt(`0x${p[1]}`) >= 1n &&
  Number.isSafeInteger(p[2]) &&
  p[2] >= b.launchAt &&
  p[2] <= b.now &&
  Number.isSafeInteger(p[3]) &&
  p[3] >= 0 &&
  p[3] <= PARAMS.N;

const unpack = ([epoch, target, openedAt, claims]: Packed): EpochRow => ({
  epoch,
  target: BigInt(`0x${target}`),
  openedAt,
  claims,
  duration: null,
  retarget: null,
  closedBy: null,
});

const drop = (storage: StorageLike, key: string): null => {
  try {
    storage.removeItem(key);
  } catch {
    /* nothing to drop */
  }
  return null;
};

/** The `ranges` of a cache text, or null when the text is over the cap or not the shape. */
const parseRanges = (text: string): unknown[] | null => {
  if (text.length > MAX_BYTES) return null;
  try {
    const ranges = (JSON.parse(text) as { ranges?: unknown } | null)?.ranges;
    return Array.isArray(ranges) ? ranges : null;
  } catch {
    return null;
  }
};

/** The rows of validated ranges, or null on the first row that fails. */
function collect(ranges: unknown[], b: Bounds): Map<number, EpochRow> | null {
  const out = new Map<number, EpochRow>();
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length === 0) return null;
    let prev: Packed | undefined;
    for (const p of range) {
      if (!validRow(p, prev, b) || out.has(p[0])) return null;
      out.set(p[0], unpack(p));
      prev = p;
    }
  }
  return out.size > MAX_ROWS ? null : out;
}

/** The cached rows, or null: nothing kept, over the caps, malformed, or a row outside `b` (then dropped). */
export function readCache(storage: StorageLike, key: string, b: Bounds): Map<number, EpochRow> | null {
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  const ranges = parseRanges(text);
  const rows = ranges && collect(ranges, b);
  return rows ?? drop(storage, key);
}

const pack = (rows: EpochRow[]): Packed[][] => {
  const ranges: Packed[][] = [];
  for (const r of rows) {
    const last = ranges[ranges.length - 1];
    const p: Packed = [r.epoch, r.target.toString(16), r.openedAt, r.claims];
    if (last && (last[last.length - 1] as Packed)[0] === r.epoch - 1) last.push(p);
    else ranges.push([p]);
  }
  return ranges;
};

/**
 * Writes the rows below `open − 96`, the newest 8192 at most, trimmed from the oldest end until the
 * text is under 512 KB; a quota error is swallowed (the cache is a convenience, never a dependency).
 */
export function writeCache(
  storage: StorageLike,
  key: string,
  rows: ReadonlyMap<number, EpochRow>,
  open: number,
): void {
  let kept = [...rows.values()].filter((r) => r.epoch < open - MARGIN).sort((a, b) => a.epoch - b.epoch);
  if (kept.length > MAX_ROWS) kept = kept.slice(kept.length - MAX_ROWS);
  if (kept.length === 0) return;
  let text = JSON.stringify({ ranges: pack(kept) });
  while (text.length > MAX_BYTES && kept.length > 0) {
    kept = kept.slice(Math.min(kept.length, 256));
    text = JSON.stringify({ ranges: pack(kept) });
  }
  try {
    if (kept.length) storage.setItem(key, text);
  } catch {
    /* quota: this visit's rows stay in memory only */
  }
}
