import { describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { deriveStorageSlotInMap } from '@aztec/stdlib/hash';
import {
  assertTimestamp,
  CHUNK,
  DEFAULT_LIMITS,
  type EpochRow,
  epochExists,
  linkRows,
  type Node,
  readEpochs,
  readGenesis,
  readOpenEpochNumber,
  slotTableFromJson,
  slotTableToJson,
  TABLE_EPOCHS,
} from './reader.ts';
import { deriveSlotTable, loadLayouts } from './slots.ts';

const layout = (await loadLayouts()).miner;
const miner = AztecAddress.fromBigIntUnsafe(7n);
const slotOf = (name: string): Fr => {
  const slot = layout[name]?.slot;
  if (!slot) throw new Error(`no slot for ${name}`);
  return slot;
};

describe('slot table', () => {
  test('chunks 0 and 200 are what deriveStorageSlotInMap gives, and survive JSON', async () => {
    for (const chunk of [0, 200]) {
      const table = await deriveSlotTable(layout, chunk);
      expect(table.first).toBe(chunk * CHUNK);
      expect(table.epochs).toHaveLength(CHUNK);
      for (const i of [0, 1, CHUNK - 1]) {
        const key = { toField: () => new Fr(table.first + i) };
        expect(table.epochs[i]?.equals(await deriveStorageSlotInMap(layout.epochs?.slot as Fr, key))).toBe(
          true,
        );
        expect(table.claims[i]?.equals(await deriveStorageSlotInMap(layout.claims?.slot as Fr, key))).toBe(
          true,
        );
      }
      const json = slotTableToJson(table);
      expect(json.length).toBeLessThan(72_000);
      const back = slotTableFromJson(json, chunk);
      expect(back.epochs.map(String)).toEqual(table.epochs.map(String));
      expect(() => slotTableFromJson(json, chunk + 1)).toThrow(/malformed/);
    }
  });
});

/** A node whose public storage is a map of slot → value; every read is counted. */
function fakeNode(values: Map<string, bigint>, delayMs = 0) {
  let reads = 0;
  let inFlight = 0;
  let peak = 0;
  const node = {
    async getPublicStorageAt(_b: unknown, _c: unknown, slot: Fr) {
      reads++;
      peak = Math.max(peak, ++inFlight);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      inFlight--;
      return new Fr(values.get(slot.toString()) ?? 0n);
    },
  } as unknown as Node;
  return { node, reads: () => reads, peak: () => peak };
}

/** Public storage of a chain with `open + 1` epochs, N claims each except the open one. */
async function chain(open: number) {
  const table = await deriveSlotTable(layout, 0);
  const values = new Map<string, bigint>();
  values.set(slotOf('open_epoch').toString(), BigInt(open));
  for (let e = 0; e <= open; e++) {
    const base = (table.epochs[e] as Fr).toBigInt();
    values.set(new Fr(base).toString(), (1n << 122n) >> BigInt(e % 3));
    values.set(new Fr(base + 1n).toString(), 1000n + BigInt(e));
    values.set(new Fr(base + 2n).toString(), 1_700_000_000n + BigInt(e) * 300n);
    values.set((table.claims[e] as Fr).toString(), e === open ? 1n : e === 2 ? 2n : 4n);
  }
  return { values, load: async () => table };
}

describe('readEpochs', () => {
  test('three reads per epoch, four with the seed, at most `concurrency` in flight, capped at maxEpochs', async () => {
    const { values, load } = await chain(9);
    const { node, reads, peak } = fakeNode(values, 2);
    expect(await readOpenEpochNumber(node, miner, layout)).toBe(9);
    const rows = await readEpochs(node, miner, { from: 0, to: 9 }, load, {
      limits: { ...DEFAULT_LIMITS, concurrency: 3 },
    });
    expect(rows.map((r) => r.epoch)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(reads()).toBe(1 + 30);
    // Reads in flight are bounded by `concurrency`, not by epochs × reads per epoch.
    expect(peak()).toBeLessThanOrEqual(3);
    expect(rows[1]).toMatchObject({
      target: (1n << 122n) >> 1n,
      openedAt: 1_700_000_300,
      claims: 4,
      duration: 300,
      closedBy: 'claims',
    });
    expect(rows[1]?.retarget).toBeCloseTo(0.5, 6);
    // Epoch 2 closed with 2 of 4 claims: someone rolled it.
    expect(rows[2]?.closedBy).toBe('roll');
    expect(rows[9]).toMatchObject({ duration: null, retarget: null, closedBy: null, claims: 1 });
    expect(rows[0]?.seed).toBeUndefined();
    const withSeed = await readEpochs(node, miner, { from: 3, to: 3 }, load, { withSeed: true });
    expect(withSeed[0]?.seed).toBe(1003n);
    const capped = await readEpochs(node, miner, { from: 0, to: 9 }, load, {
      limits: { ...DEFAULT_LIMITS, maxEpochs: 4 },
    });
    expect(capped.map((r) => r.epoch)).toEqual([0, 1, 2, 3]);
  });

  test('beyond the table the read refuses instead of guessing; a slow node fails the read; nonsense is refused', async () => {
    const { values, load } = await chain(1);
    const { node } = fakeNode(values);
    // A zero target (an empty slot, a lying node) is not a row: it would make every ratio infinite.
    const table = await load();
    const broken = new Map(values);
    broken.set((table.epochs[1] as Fr).toString(), 0n);
    await expect(readEpochs(fakeNode(broken).node, miner, { from: 0, to: 1 }, load)).rejects.toThrow(
      /target 0/,
    );
    // A u64 that no Date can hold would crash every clock the pages render.
    const late = new Map(values);
    late.set(new Fr((table.epochs[1] as Fr).toBigInt() + 2n).toString(), 1n << 63n);
    await expect(readEpochs(fakeNode(late).node, miner, { from: 0, to: 1 }, load)).rejects.toThrow(
      /not a timestamp/,
    );
    await expect(readEpochs(node, miner, { from: TABLE_EPOCHS - 1, to: TABLE_EPOCHS }, load)).rejects.toThrow(
      /beyond the slot table/,
    );
    const slow = fakeNode(values, 50).node;
    await expect(
      readEpochs(slow, miner, { from: 0, to: 1 }, load, { limits: { ...DEFAULT_LIMITS, timeoutMs: 10 } }),
    ).rejects.toThrow(/no answer/);
    const unbounded = { ...DEFAULT_LIMITS, timeoutMs: Number.POSITIVE_INFINITY };
    expect(await readEpochs(slow, miner, { from: 0, to: 1 }, load, { limits: unbounded })).toHaveLength(2);
    expect(await readGenesis(node, miner, layout)).toEqual({ target: 0n, seed: 0n, launchAt: 0 });
    expect(await epochExists(node, miner, 0, load)).toBe(true);
    expect(assertTimestamp('t', 8_640_000_000_000n)).toBe(8_640_000_000_000n);
    expect(() => assertTimestamp('t', 8_640_000_000_001n)).toThrow(/not a timestamp/);
    expect(await epochExists(fakeNode(new Map()).node, miner, 0, load)).toBe(false);
  });

  test('a failed batch hands out no more epochs; its reads in flight end before it rejects', async () => {
    const { values, load } = await chain(30);
    const broken = new Map(values);
    const table = await load();
    broken.set((table.epochs[2] as Fr).toString(), 0n);
    const fake = fakeNode(broken, 5);
    const limits = { ...DEFAULT_LIMITS, concurrency: 3 };
    await expect(readEpochs(fake.node, miner, { from: 0, to: 30 }, load, { limits })).rejects.toThrow(
      /target 0/,
    );
    const afterRejection = fake.reads();
    // Each lane finishes the epoch it holds and takes no other: two epochs of 3 reads per lane at most.
    expect(afterRejection).toBeLessThanOrEqual(3 * 2 * 3);
    await new Promise((r) => setTimeout(r, 60));
    expect(fake.reads()).toBe(afterRejection);
  });
});

describe('linkRows', () => {
  test('a gap in the rows leaves the earlier one open-ended', () => {
    const row = (epoch: number, openedAt: number, claims = 4): EpochRow => ({
      epoch,
      target: 100n,
      openedAt,
      claims,
      duration: null,
      retarget: null,
      closedBy: null,
    });
    const linked = linkRows([row(0, 0), row(1, 10), row(3, 40)]);
    expect(linked[0]).toMatchObject({ duration: 10, retarget: 1, closedBy: 'claims' });
    expect(linked[1]).toMatchObject({ duration: null, closedBy: null });
    expect(linked[2]).toMatchObject({ duration: null });
  });
});
