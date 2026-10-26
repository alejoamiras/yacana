// TS mirror of the contract's epoch close: exact integer retarget clamped to [⌈t/4⌉, 4t] with
// u128 saturation, never 0, and the next epoch's seed. Pinned to the Noir implementation by
// the parity vectors in retarget.test.ts; used by the simulator and the miner's "next target" view.
import { poseidon2Hash } from '@aztec-labs/foundation/crypto/poseidon';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { DOM_SEED } from './proof.ts';

export const U128_MAX = (1n << 128n) - 1n;

export interface EpochRules {
  N: number;
  EXPECTED_EPOCH_SECONDS: bigint;
  T_MAX: bigint;
}

export function nextTarget(target: bigint, actual: bigint, rules: EpochRules): bigint {
  if (actual > rules.T_MAX) throw new Error('actual duration above T_MAX');
  const raw = (target * actual) / rules.EXPECTED_EPOCH_SECONDS;
  const lo = target / 4n + (target % 4n === 0n ? 0n : 1n);
  const hi = target > U128_MAX / 4n ? U128_MAX : target * 4n;
  const clamped = raw < lo ? lo : raw > hi ? hi : raw;
  return clamped === 0n ? 1n : clamped;
}

/** Duration the count close feeds into the retarget: elapsed, capped at T_MAX. */
export const cappedElapsed = (elapsed: bigint, rules: EpochRules): bigint =>
  elapsed > rules.T_MAX ? rules.T_MAX : elapsed;

export const nextSeed = (seed: Fr, nextEpoch: bigint, closingDigest: Fr, now: bigint): Promise<Fr> =>
  poseidon2Hash([new Fr(DOM_SEED), seed, new Fr(nextEpoch), closingDigest, new Fr(now)]);
