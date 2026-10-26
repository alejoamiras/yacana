import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { CHUNK, type Node, type SlotTable, type StorageLayout } from '@yacana/miner-core/reader';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { HISTORY, type Reader, readLive } from './live';

// web-kit's fetch guard, held for this suite alone: later suites in the run get the realm's fetch back.
beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

// Slots need no hashing here: any distinct field per epoch will do for a fake node.
const table: SlotTable = {
  first: 0,
  epochs: Array.from({ length: CHUNK }, (_, e) => new Fr(1_000_000n + BigInt(e) * 4n)),
  claims: Array.from({ length: CHUNK }, (_, e) => new Fr(3_000_000n + BigInt(e))),
};
const layout: StorageLayout = { open_epoch: { slot: new Fr(15) }, total_supply: { slot: new Fr(8) } };

function fakeReader(open: number, opts: { failSlots?: boolean; first?: number } = {}): Reader {
  const values = new Map<string, bigint>([
    [new Fr(15).toString(), BigInt(open)],
    [new Fr(8).toString(), 4n * 10n ** 18n * BigInt(open * 4)],
  ]);
  for (let e = 0; e <= open; e++) {
    const base = (table.epochs[e] as Fr).toBigInt();
    values.set(new Fr(base).toString(), 1n << 122n);
    values.set(new Fr(base + 1n).toString(), BigInt(e + 1));
    values.set(new Fr(base + 2n).toString(), BigInt(e * 300));
    values.set((table.claims[e] as Fr).toString(), e === open ? 1n : 4n);
  }
  const node = {
    getPublicStorageAt: async (_b: unknown, _c: unknown, slot: Fr) =>
      new Fr(values.get(slot.toString()) ?? 0n),
    getBlockData: async () => ({
      header: { globalVariables: { blockNumber: 99, timestamp: BigInt(open * 300 + 10) } },
    }),
  } as unknown as Node;
  return {
    node,
    miner: AztecAddress.fromBigIntUnsafe(7n),
    token: AztecAddress.fromBigIntUnsafe(8n),
    minerLayout: layout,
    tokenLayout: layout,
    load: async () => {
      if (opts.failSlots) throw new Error('slot chunk 0: 503');
      return table;
    },
    first: opts.first ?? 0,
  };
}

describe('readLive', () => {
  test('the open epoch and the twelve before it, linked, none with a seed; the fixed slots', async () => {
    const live = await readLive(fakeReader(20));
    expect(live.rows.map((r) => r.epoch)).toEqual(
      Array.from({ length: HISTORY + 1 }, (_, i) => 20 - HISTORY + i),
    );
    expect(live.rows.at(-1)).toMatchObject({ epoch: 20, claims: 1, duration: null });
    expect(live.rows.at(-2)).toMatchObject({ epoch: 19, duration: 300, closedBy: 'claims' });
    // Nothing on the page proves against the seed any more: no row reads it.
    expect(live.rows.every((r) => r.seed === undefined)).toBe(true);
    expect(live).toMatchObject({ open: 20, block: { number: 99 } });
    expect(live.historyError).toBeUndefined();
    expect(live.supply).toBe(4n * 10n ** 18n * 80n);
  });

  test('a continuation reads from its first epoch: nothing before it exists', async () => {
    const live = await readLive(fakeReader(20, { first: 15 }));
    expect(live.rows.map((r) => r.epoch)).toEqual([15, 16, 17, 18, 19, 20]);
    expect(live.historyError).toBeUndefined();
  });

  test('a slot chunk that fails keeps the fixed slots and says why the rows are missing', async () => {
    const live = await readLive(fakeReader(3, { failSlots: true }));
    expect(live.rows).toEqual([]);
    expect(live.historyError).toMatch(/503/);
    expect(live).toMatchObject({ open: 3, block: { number: 99 } });
  });
});
