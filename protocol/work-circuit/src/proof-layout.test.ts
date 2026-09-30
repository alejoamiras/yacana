// The ticket digest is defined against this manifest, so the committed file is pinned by hash:
// a toolchain bump that changes the layout must be a deliberate regeneration, not drift.
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import layout from './generated/proof-layout.json';

const PINNED_SHA256 = '2c913f7e65b40f9d706c5badaeb3122525c41d8e2a4b976ed0122883e9b7f6c3';

describe('proof-layout manifest', () => {
  test('has 410 contiguous slots in the bb 5.2.0 phase order', () => {
    expect(layout.aztecVersion).toBe('5.2.0');
    expect(layout.slots).toHaveLength(410);
    for (const [i, s] of layout.slots.entries()) expect(s.index).toBe(i);
    expect(Object.entries(layout.phases).map(([k, v]) => [k, v.from, v.count])).toEqual([
      ['io', 0, 8],
      ['oink', 8, 32],
      ['sumcheck_univariates', 40, 200],
      ['sumcheck_evaluations', 240, 41],
      ['gemini_folds', 281, 96],
      ['gemini_evals', 377, 25],
      ['shplonk', 402, 4],
      ['kzg', 406, 4],
    ]);
  });

  test('is byte-identical to the pinned generation', async () => {
    const file = await Bun.file(resolve(import.meta.dir, 'generated', 'proof-layout.json')).arrayBuffer();
    expect(new Bun.CryptoHasher('sha256').update(file).digest('hex')).toBe(PINNED_SHA256);
  });
});

// The miner checks the points at these starts and nothing else, so a wrong start leaves a coordinate
// the ticket hashes free to be respelled. Pinned three ways, and against the fixture's real points.
describe('point starts', () => {
  const Q = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;
  const step = (from: number, to: number) =>
    Array.from({ length: (to - from) / 4 + 1 }, (_, i) => from + 4 * i);
  const STARTS = [0, 4, ...step(8, 36), ...step(281, 373), 402, 406];

  const fields = async (): Promise<bigint[]> => {
    const proof = Buffer.from(
      await Bun.file(resolve(import.meta.dir, '../fixtures/yacana_work/proof')).arrayBuffer(),
    );
    return Array.from({ length: 410 }, (_, i) =>
      BigInt(`0x${proof.subarray(i * 32, i * 32 + 32).toString('hex')}`),
    );
  };
  const coordinate = (lo: bigint, hi: bigint) => (lo < 1n << 136n && hi < 1n << 118n ? lo + (hi << 136n) : Q);
  /** A reduced affine point on y² = x³ + 3 at `p`, in x_lo, x_hi, y_lo, y_hi order. */
  const isPoint = (f: bigint[], p: number) => {
    const [x, y] = [coordinate(f[p] ?? 0n, f[p + 1] ?? 0n), coordinate(f[p + 2] ?? 0n, f[p + 3] ?? 0n)];
    return x < Q && y < Q && (y * y) % Q === (x * x * x + 3n) % Q;
  };

  test('the independent list, the manifest and the generated Noir agree', async () => {
    expect(STARTS).toHaveLength(36);
    expect(layout.slots.filter((s) => s.label.endsWith('.x_lo')).map((s) => s.index)).toEqual(STARTS);
    const noir = await Bun.file(
      resolve(import.meta.dir, '../../contracts/yacana_miner/src/proof_points.nr'),
    ).text();
    expect([...noir.matchAll(/^\s+(\d+),/gm)].map((m) => Number(m[1]))).toEqual(STARTS);
  });

  test('every start holds the point at infinity or a reduced point on the curve', async () => {
    const f = await fields();
    for (const p of STARTS)
      expect([p, f.slice(p, p + 4).every((x) => x === 0n) || isPoint(f, p)]).toEqual([p, true]);
  });

  test('no other non-zero window of four fields is a point', async () => {
    const f = await fields();
    for (let p = 0; p + 4 <= 410; p++) {
      if (STARTS.includes(p) || f.slice(p, p + 4).every((x) => x === 0n)) continue;
      expect([p, isPoint(f, p)]).toEqual([p, false]);
    }
  });
});
