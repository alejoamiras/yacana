import { PARAMS } from '@yacana/miner-core/generated/params';
import type { EpochRow } from '@yacana/miner-core/reader';
import { describe, expect, test } from 'vitest';
import {
  type Bounds,
  cacheKey,
  MARGIN,
  MAX_BYTES,
  MAX_ROWS,
  readCache,
  type StorageLike,
  writeCache,
} from './history-cache';

const LAUNCH = 1_700_000_000;
const row = (e: number): EpochRow => ({
  epoch: e,
  target: (1n << 122n) + BigInt(e),
  openedAt: LAUNCH + e * 300,
  claims: e % 5,
  duration: 300,
  retarget: 1,
  closedBy: 'claims',
});
const rowsOf = (epochs: number[]) => new Map(epochs.map((e) => [e, row(e)]));

function fakeStorage(opts: { quota?: boolean } = {}) {
  const m = new Map<string, string>();
  const s: StorageLike = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.quota) throw new DOMException('quota', 'QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k) => void m.delete(k),
  };
  return { s, m };
}

const KEY = 'yacana.epochs.v1.test';
const OPEN = 1000;
const bounds: Bounds = { launchAt: LAUNCH, now: LAUNCH + OPEN * 300 + 10, open: OPEN };
const epochs = (m: Map<number, EpochRow> | null) => [...(m?.keys() ?? [])].sort((a, b) => a - b);

/** A cache text with one packed row swapped for `p`. */
const poisoned = (p: unknown, at = 5): string => {
  const { s, m } = fakeStorage();
  writeCache(s, KEY, rowsOf(Array.from({ length: 20 }, (_, i) => i)), OPEN);
  const body = JSON.parse(m.get(KEY) as string) as { ranges: unknown[][] };
  (body.ranges[0] as unknown[])[at] = p;
  return JSON.stringify(body);
};

describe('the history cache', () => {
  test('the key names the deployment and the node', () => {
    expect(cacheKey({ chainId: '31337', rollupAddress: '0xABC', miner: '0xDEF', endpoint: 'f00d' })).toBe(
      'yacana.epochs.v1.31337.0xabc.0xdef.f00d',
    );
  });

  test('round trip: closed rows below open − 96 come back, as rows without closing facts', () => {
    const { s } = fakeStorage();
    const held = rowsOf(Array.from({ length: OPEN + 1 }, (_, i) => i));
    writeCache(s, KEY, held, OPEN);
    const back = readCache(s, KEY, bounds);
    expect(epochs(back)).toEqual(Array.from({ length: OPEN - MARGIN }, (_, i) => i));
    expect(back?.get(7)).toEqual({ ...row(7), duration: null, retarget: null, closedBy: null });
  });

  test('the newest 96 are never written, and a cache is read only below the margin', () => {
    const { s, m } = fakeStorage();
    writeCache(s, KEY, rowsOf(Array.from({ length: 200 }, (_, i) => 850 + i)), OPEN);
    const text = m.get(KEY) as string;
    expect(text).toContain(`[${OPEN - MARGIN - 1},`);
    expect(text).not.toContain(`[${OPEN - MARGIN},`);
    expect(epochs(readCache(s, KEY, bounds))).toEqual(Array.from({ length: 54 }, (_, i) => 850 + i));
    // Nothing below the margin: nothing written, nothing there.
    const empty = fakeStorage();
    writeCache(empty.s, KEY, rowsOf([950, 951]), OPEN);
    expect(empty.m.has(KEY)).toBe(false);
    expect(readCache(empty.s, KEY, bounds)).toBeNull();
  });

  test.each([
    ['a gap inside a range', [7, 'abc', LAUNCH + 2100, 1]],
    ['a target of zero', [5, '0', LAUNCH + 1500, 1]],
    ['a target over u128', [5, `1${'0'.repeat(32)}`, LAUNCH + 1500, 1]],
    ['an opening before the genesis', [5, 'abc', LAUNCH - 1, 1]],
    ['an opening in the future', [5, 'abc', bounds.now + 1, 1]],
    ['more claims than N', [5, 'abc', LAUNCH + 1500, PARAMS.N + 1]],
    ['a fractional epoch', [5.5, 'abc', LAUNCH + 1500, 1]],
    ['a row with three fields', [5, 'abc', LAUNCH + 1500]],
  ])('%s drops the cache whole', (_name, p) => {
    const { s, m } = fakeStorage();
    m.set(KEY, poisoned(p));
    expect(readCache(s, KEY, bounds)).toBeNull();
    expect(m.has(KEY)).toBe(false);
  });

  test('malformed text, a duplicate epoch across ranges and an empty range drop it too', () => {
    const { s, m } = fakeStorage();
    m.set(KEY, '{not json');
    expect(readCache(s, KEY, bounds)).toBeNull();
    m.set(KEY, JSON.stringify({ ranges: [[[1, 'a', LAUNCH, 0]], [[1, 'a', LAUNCH, 0]]] }));
    expect(readCache(s, KEY, bounds)).toBeNull();
    m.set(KEY, JSON.stringify({ ranges: [[]] }));
    expect(readCache(s, KEY, bounds)).toBeNull();
    m.set(KEY, JSON.stringify({ rows: [] }));
    expect(readCache(s, KEY, bounds)).toBeNull();
    expect(m.has(KEY)).toBe(false);
  });

  test('the caps: the newest 8192 rows are kept on write, a text over 512 KB is refused on read', () => {
    const { s, m } = fakeStorage();
    const open = 20_000;
    writeCache(s, KEY, rowsOf(Array.from({ length: 10_000 }, (_, i) => i)), open);
    const back = readCache(s, KEY, { ...bounds, now: LAUNCH + open * 300 + 10, open });
    expect(back?.size).toBeLessThanOrEqual(MAX_ROWS);
    expect((m.get(KEY) as string).length).toBeLessThanOrEqual(MAX_BYTES);
    const kept = epochs(back);
    expect(kept[kept.length - 1]).toBe(9999);
    expect(kept[0]).toBe(10_000 - (back?.size ?? 0));
    m.set(KEY, `{"ranges":[[[0,"1",${LAUNCH},0]]]}${' '.repeat(MAX_BYTES)}`);
    expect(readCache(s, KEY, bounds)).toBeNull();
    expect(m.has(KEY)).toBe(false);
  });

  test('a quota error is swallowed', () => {
    const { s, m } = fakeStorage({ quota: true });
    expect(() => writeCache(s, KEY, rowsOf([1, 2, 3]), OPEN)).not.toThrow();
    expect(m.size).toBe(0);
  });
});
