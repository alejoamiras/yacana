// miner-core against the pinned cross-language vectors; the contract's generated
// test/vectors.nr asserts the same values, so a drift on either side fails its own tests.
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { poseidon2Hash } from '@aztec-labs/foundation/crypto/poseidon';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { PARAMS } from './generated/params.ts';
import { computeDigest, DOM_NULL, deployDomain, low128, proofToFields, secretCommitment } from './proof.ts';
import { nextSeed, nextTarget } from './retarget.ts';

const vectors = (await Bun.file(
  resolve(import.meta.dir, '../../../protocol/work-circuit/fixtures/vectors.json'),
).json()) as {
  fixtureProof: string[];
  digest: string;
  low128: string;
  deployDomain: { chainId: string; rollupVersion: string; miner: string; version: string; value: string };
  secretCommitment: { secret: string; recipient: string; value: string };
  nullifier: string;
  nextSeed: { seed: string; nextEpoch: string; now: string; value: string };
  retarget: { expectedEpochSeconds: number; target: string; actual: string; value: string };
};
const fr = (h: string) => Fr.fromString(h);
const big = (h: string) => BigInt(h);

describe('cross-language vectors', () => {
  test('the fixture proof hashes to the pinned digest and low128', async () => {
    const proof = new Uint8Array(
      await Bun.file(
        resolve(import.meta.dir, '../../../protocol/work-circuit/fixtures/yacana_work/proof'),
      ).arrayBuffer(),
    );
    const fields = proofToFields(proof);
    expect(fields.map((f) => f.toString())).toEqual(vectors.fixtureProof.map((h) => fr(h).toString()));
    const digest = await computeDigest(fields);
    expect(digest.toBigInt()).toBe(big(vectors.digest));
    expect(low128(digest)).toBe(big(vectors.low128));
  });

  test('deploy domain, secret commitment, ticket nullifier and seed chain', async () => {
    const d = vectors.deployDomain;
    expect(
      (await deployDomain(big(d.chainId), big(d.rollupVersion), fr(d.miner), big(d.version))).toBigInt(),
    ).toBe(big(d.value));
    const c = vectors.secretCommitment;
    expect((await secretCommitment(fr(c.secret), fr(c.recipient))).toBigInt()).toBe(big(c.value));
    expect((await poseidon2Hash([new Fr(DOM_NULL), fr(vectors.digest)])).toBigInt()).toBe(
      big(vectors.nullifier),
    );
    const s = vectors.nextSeed;
    expect((await nextSeed(fr(s.seed), big(s.nextEpoch), fr(vectors.digest), big(s.now))).toBigInt()).toBe(
      big(s.value),
    );
  });

  // Pinned under one profile's EXPECTED_EPOCH_SECONDS; another profile reports a visible skip, not
  // a silent pass. Re-pin (pin-vectors.ts) when a profile is promoted.
  test.skipIf(BigInt(vectors.retarget.expectedEpochSeconds) !== PARAMS.EXPECTED_EPOCH_SECONDS)(
    `retarget vector (pinned for EXPECTED_EPOCH_SECONDS = ${vectors.retarget.expectedEpochSeconds})`,
    () => {
      const r = vectors.retarget;
      const rules = {
        N: PARAMS.N,
        EXPECTED_EPOCH_SECONDS: PARAMS.EXPECTED_EPOCH_SECONDS,
        T_MAX: PARAMS.T_MAX,
      };
      expect(nextTarget(big(r.target), big(r.actual), rules)).toBe(big(r.value));
    },
  );
});
