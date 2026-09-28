// The beats read under the reader's limits, not the reader module's defaults: a host whose client bounds
// each request itself lifts the per-read timer through them.
import { expect, test } from 'bun:test';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { CHUNK, DEFAULT_LIMITS, layoutFromSlots, type Node } from '@yacana/miner-core/reader';
import type { Reader } from '../src/chain';
import { readFixed } from '../src/read-fixed';
import { readLotteryOf, readWindowRows } from '../src/read-window';

test("every read arms the reader's deadline, none the module's default", async () => {
  const silent = {
    getPublicStorageAt: () => new Promise(() => {}),
    getBlockData: () => new Promise(() => {}),
  } as unknown as Node;
  const layout = layoutFromSlots({
    open_epoch: '0x1',
    genesis: '0x2',
    total_supply: '0x3',
    launch_mix: '0x4',
    launch_reveals: '0x5',
  });
  const r: Reader = {
    node: silent,
    miner: AztecAddress.fromBigIntUnsafe(1n),
    token: AztecAddress.fromBigIntUnsafe(2n),
    minerLayout: layout,
    tokenLayout: layout,
    load: async () => ({
      first: 0,
      epochs: Array.from({ length: CHUNK }, (_, e) => new Fr(1000 + e)),
      claims: Array.from({ length: CHUNK }, (_, e) => new Fr(5000 + e)),
    }),
    limits: { ...DEFAULT_LIMITS, timeoutMs: 20 },
  };
  const armed: (number | undefined)[] = [];
  const setTimer = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    armed.push(ms);
    return setTimer(fn, ms);
  }) as typeof setTimeout;
  try {
    const reads = await Promise.allSettled([readFixed(r), readWindowRows(r, 0, 1, 1), readLotteryOf(r)]);
    expect(reads.map((x) => x.status)).toEqual(['rejected', 'rejected', 'rejected']);
  } finally {
    globalThis.setTimeout = setTimer;
  }
  expect(new Set(armed)).toEqual(new Set([20]));
});
