import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { computeDigest, isWinner, low128, proofToFields, secretCommitment } from './proof.ts';

const fixture = resolve(import.meta.dir, '../../../protocol/work-circuit/fixtures/yacana_work/proof');

describe('proof → ticket', () => {
  test('splits the fixture proof into 410 big-endian fields and hashes it deterministically', async () => {
    const proof = new Uint8Array(await Bun.file(fixture).arrayBuffer());
    const fields = proofToFields(proof);
    expect(fields).toHaveLength(410);
    // Slot 8 is W_L.x_lo, a 136-bit limb: strictly below 2^136 and non-zero for a real proof.
    expect(fields[8]?.toBigInt()).toBeGreaterThan(0n);
    expect(fields[8]?.toBigInt()).toBeLessThan(1n << 136n);
    const a = await computeDigest(fields);
    const b = await computeDigest(fields);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(await computeDigest(fields.map((f, i) => (i === 409 ? f.add(Fr.ONE) : f))))).toBe(false);
    expect(low128(a)).toBeLessThan(1n << 128n);
    expect(isWinner(a, (1n << 128n) - 1n)).toBe(true);
    expect(isWinner(a, 0n)).toBe(false);
  });

  test('rejects proofs of the wrong length', () => {
    expect(() => proofToFields(new Uint8Array(409 * 32))).toThrow(/expected 13120/);
  });

  test('secret commitment differs from the raw secret', async () => {
    const secret = new Fr(7n);
    expect((await secretCommitment(secret, new Fr(1n))).equals(secret)).toBe(false);
    // The recipient is part of the preimage: the same secret commits differently per recipient.
    expect(
      (await secretCommitment(secret, new Fr(1n))).equals(await secretCommitment(secret, new Fr(2n))),
    ).toBe(false);
  });
});
