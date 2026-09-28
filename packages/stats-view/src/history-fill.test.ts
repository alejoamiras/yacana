import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { CHUNK, type EpochRow, type SlotTable } from '@yacana/miner-core/reader';
import { describe, expect, test } from 'vitest';
import type { Reader } from './chain';
import { createFill, type FillDeps, type FillState, readTo } from './history-fill';
import { readWindowRows } from './read-window';
import type { History } from './state';
import { WINDOW } from './window';

const row = (e: number): EpochRow => ({
  epoch: e,
  target: 1n << 122n,
  openedAt: e * 300,
  claims: 4,
  duration: null,
  retarget: null,
  closedBy: null,
});
const held = (epochs: number[]): History => ({
  rows: new Map(epochs.map((e) => [e, row(e)])),
  lottery: null,
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A fill over a fake node: `asked` logs each page, the knobs stand in for the health store and the queue. */
function fake(open: number, epochs: number[], opts: { fail?: boolean; first?: number } = {}) {
  const asked: [number, number][] = [];
  const states: FillState[] = [];
  let history = held(epochs);
  const knobs = { transport: 'ok' as 'ok' | 'throttled' | 'silent', foreground: false, serialCalls: 0 };
  const deps: FillDeps = {
    rows: async (from, to) => {
      asked.push([from, to]);
      if (opts.fail) throw new Error('503');
      return range(from, to).map(row);
    },
    held: () => ({ open, history }),
    publish: (h) => {
      history = h;
    },
    transport: () => knobs.transport,
    foreground: () => knobs.foreground,
    serial: (fn) => {
      knobs.serialCalls++;
      return fn();
    },
    persist: () => {},
    onState: (s) => states.push(s),
    ...(opts.first !== undefined && { first: opts.first }),
  };
  return {
    fill: createFill(deps),
    deps,
    asked,
    states,
    knobs,
    rows: () => [...history.rows.keys()].sort((a, b) => a - b),
  };
}

describe('the history fill', () => {
  test('readTo is the oldest epoch of the run held down from the open one', () => {
    expect(readTo(held(range(953, 1000)).rows, 1000)).toBe(953);
    expect(readTo(held([...range(900, 940), ...range(953, 1000)]).rows, 1000)).toBe(953);
    expect(readTo(held(range(0, 30)).rows, 30)).toBe(0);
    expect(readTo(held([]).rows, 30)).toBeNull();
    // Right after a close the open epoch may not be held yet: the run starts at the newest held one.
    expect(readTo(held(range(953, 1000)).rows, 1001)).toBe(953);
    // A number no loop could count down from: the walk is over the held keys, not the gap.
    expect(readTo(held(range(953, 1000)).rows, 1e20)).toBe(953);
  });

  test('a page the queue held back obeys a stop that came after it was queued', async () => {
    const f = fake(1000, range(953, 1000));
    const queued: (() => Promise<void>)[] = [];
    f.deps.serial = (fn) => {
      queued.push(fn);
      return Promise.resolve();
    };
    await f.fill.tick();
    expect(queued).toHaveLength(1);
    f.knobs.transport = 'throttled';
    await f.fill.tick();
    expect(f.fill.state()).toEqual({ phase: 'stopped', reason: 'throttled', readTo: 953 });
    await (queued[0] as () => Promise<void>)();
    expect(f.asked).toEqual([]);
    expect(f.fill.state().phase).toBe('stopped');
  });

  test('one page per tick, newest first, joined under the rows held; the queue is used each time', async () => {
    const f = fake(1000, range(953, 1000));
    await f.fill.tick();
    expect(f.asked).toEqual([[953 - WINDOW, 952]]);
    expect(f.fill.state()).toEqual({ phase: 'filling', readTo: 905 });
    await f.fill.tick();
    expect(f.asked[1]).toEqual([857, 904]);
    expect(f.rows()[0]).toBe(857);
    expect(f.knobs.serialCalls).toBe(2);
  });

  test('stops at epoch 0 and asks nothing more', async () => {
    const f = fake(60, range(13, 60));
    await f.fill.tick();
    expect(f.asked).toEqual([[0, 12]]);
    expect(f.fill.state()).toEqual({ phase: 'stopped', reason: 'complete', readTo: 0 });
    await f.fill.tick();
    expect(f.asked).toHaveLength(1);
    const done = fake(30, range(0, 30));
    await done.fill.tick();
    expect(done.asked).toEqual([]);
    expect(done.fill.state().reason).toBe('complete');
  });

  test('a continuation is complete at its first epoch, not at 0', async () => {
    const f = fake(60, range(30, 60), { first: 25 });
    await f.fill.tick();
    expect(f.asked).toEqual([[25, 29]]);
    expect(f.fill.state()).toEqual({ phase: 'stopped', reason: 'complete', readTo: 25 });
    expect(readTo(held(range(25, 40)).rows, 40, 25)).toBe(25);
  });

  test('stops for the visit on a throttle or a silence, before reading; a failed page stops it too', async () => {
    const f = fake(1000, range(953, 1000));
    f.knobs.transport = 'throttled';
    await f.fill.tick();
    expect(f.asked).toEqual([]);
    expect(f.fill.state()).toEqual({ phase: 'stopped', reason: 'throttled', readTo: 953 });
    f.knobs.transport = 'ok';
    await f.fill.tick();
    expect(f.asked).toEqual([]);
    const failing = fake(1000, range(953, 1000), { fail: true });
    await failing.fill.tick();
    expect(failing.fill.state()).toEqual({ phase: 'stopped', reason: 'failed', readTo: 953 });
    const silent = fake(1000, range(953, 1000), { fail: true });
    silent.knobs.transport = 'silent';
    await silent.fill.tick();
    expect(silent.asked).toEqual([]);
    expect(silent.fill.state().reason).toBe('silent');
  });

  test('yields to a foreground window fetch and resumes on the next tick', async () => {
    const f = fake(1000, range(953, 1000));
    f.knobs.foreground = true;
    await f.fill.tick();
    expect(f.asked).toEqual([]);
    expect(f.fill.state().phase).toBe('idle');
    f.knobs.foreground = false;
    await f.fill.tick();
    expect(f.asked).toHaveLength(1);
  });

  test('a page is 48 × 3 + 3 storage reads: the epochs and the successor for the seam', async () => {
    let count = 0;
    const table: SlotTable = {
      first: 0,
      epochs: Array.from({ length: CHUNK }, (_, e) => new Fr(1000 + e)),
      claims: Array.from({ length: CHUNK }, (_, e) => new Fr(5000 + e)),
    };
    // Any chunk: the same slots shifted, `first` where the reader expects it.
    const load = async (chunk: number): Promise<SlotTable> => ({ ...table, first: chunk * CHUNK });
    const node = {
      getPublicStorageAt: async () => {
        count++;
        return new Fr(1n);
      },
    };
    const r = {
      node,
      miner: AztecAddress.fromBigIntUnsafe(1n),
      load,
    } as unknown as Reader;
    const rows = await readWindowRows(r, 100, 147, 1000);
    expect(rows.map((x) => x.epoch)).toEqual(range(100, 148));
    expect(count).toBe(48 * 3 + 3);
    count = 0;
    // The newest window has no successor beyond the open epoch.
    await readWindowRows(r, 953, 1000, 1000);
    expect(count).toBe(48 * 3);
  });
});
