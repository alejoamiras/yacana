import type { Fr } from '@aztec-labs/foundation/curves/bn254';
import { computeDigest, isWinner, proofToFields, secretCommitment } from './proof.ts';
import type { WorkProver } from './work.ts';

export interface MiningJob {
  domain: Fr;
  seed: Fr;
  epoch: bigint;
  secret: Fr;
  /** Bound into the commitment: whoever else obtains the proof and secret cannot redirect the reward. */
  recipient: Fr;
  target: bigint;
  /** First nonce to try; a miner resuming mid-epoch continues where it stopped. */
  startNonce?: bigint;
}

export interface Winner {
  nonce: bigint;
  out: Fr;
  proof: Uint8Array;
  proofFields: Fr[];
  digest: Fr;
  attempts: number;
}

export interface MineOptions {
  /**
   * Called after every proof, winners included, before anything is returned; return false to
   * stop without a winner (epoch switched, user paused), which also discards a winner that was
   * mined against a stale epoch.
   */
  onAttempt?: (nonce: bigint, digest: Fr, proveMs: number) => boolean | undefined;
}

export async function mineEpoch(
  prover: WorkProver,
  job: MiningJob,
  opts: MineOptions = {},
): Promise<Winner | null> {
  const minerCommit = await secretCommitment(job.secret, job.recipient);
  let attempts = 0;
  for (let nonce = job.startNonce ?? 1n; ; nonce++) {
    const t0 = performance.now();
    const { proof, out } = await prover.prove({
      domain: job.domain,
      seed: job.seed,
      epoch: job.epoch,
      minerCommit,
      nonce,
    });
    const proofFields = proofToFields(proof);
    const digest = await computeDigest(proofFields);
    attempts++;
    if (opts.onAttempt?.(nonce, digest, performance.now() - t0) === false) return null;
    if (isWinner(digest, job.target)) return { nonce, out, proof, proofFields, digest, attempts };
  }
}
