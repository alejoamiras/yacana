// The Worker's mining run over a prover, kept free of the Worker globals so it can be tested: the
// winning attempt of a native proof is announced only after the proof verified against the job's
// own public inputs, and a proof that fails that check never reaches the ledger.
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { score } from '@yacana/miner-core/metrics';
import { mineEpoch, type Winner } from '@yacana/miner-core/miner';
import { isWinner, secretCommitment } from '@yacana/miner-core/proof';
import type { WorkInputs, WorkProver, WorkResult } from '@yacana/miner-core/work';
import type { ProverKind } from './presto';
import type { FromWorker, MineJob } from './worker-protocol';

/** What a prover that may hand work to Presto exposes beyond `WorkProver`. */
export interface NativeAwareProver extends WorkProver {
  /** Who made the last proof this prover returned. */
  readonly lastProver: ProverKind;
  verifyWin(inputs: WorkInputs, result: WorkResult): Promise<boolean>;
  forceLocal(reason: 'invalid-proof'): void;
}

const nativeAware = (p: WorkProver): p is NativeAwareProver => 'verifyWin' in p;

type Attempt = Extract<FromWorker, { type: 'attempt' }>;

const winnerMessage = (job: MineJob, w: Winner, prover: ProverKind): FromWorker => ({
  type: 'winner',
  epoch: job.epoch,
  secretId: job.secretId,
  nonce: w.nonce,
  out: w.out.toString(),
  proofFields: w.proofFields.map((f) => f.toString()),
  digest: w.digest.toString(),
  attempts: w.attempts,
  prover,
});

/**
 * Mines `job` from `startNonce` until a winner is reported or `keepGoing` says stop. A native win is
 * held back until `verifyWin` passes and the job still owns the loop; one that fails the check is
 * dropped without a trace in the ledger, the prover flips to WASM and the same nonce is proved again.
 * Resolves true on a reported winner, false when stopped.
 */
export async function mineFrom(
  p: WorkProver,
  job: MineJob,
  startNonce: bigint,
  keepGoing: (nonce: bigint) => boolean,
  post: (m: FromWorker) => void,
): Promise<boolean> {
  const native = nativeAware(p) ? p : null;
  const inputs: Omit<WorkInputs, 'nonce'> = {
    domain: Fr.fromString(job.domain),
    seed: Fr.fromString(job.seed),
    epoch: job.epoch,
    minerCommit: await secretCommitment(Fr.fromString(job.secret), Fr.fromString(job.recipient)),
  };
  let held: Attempt | null = null;
  const winner = await mineEpoch(
    p,
    {
      ...inputs,
      secret: Fr.fromString(job.secret),
      recipient: Fr.fromString(job.recipient),
      target: job.target,
      startNonce,
    },
    {
      onAttempt: (nonce, digest, proveMs) => {
        const win = isWinner(digest, job.target);
        const attempt: Attempt = {
          type: 'attempt',
          epoch: job.epoch,
          secretId: job.secretId,
          nonce,
          proveMs,
          score: score(digest),
          win,
          target: job.target,
        };
        // `lastProver` is what made this very proof: a WASM proof under a native prover goes out at once.
        if (win && native?.lastProver === 'presto') held = attempt;
        else post(attempt);
        return keepGoing(nonce);
      },
    },
  );
  if (!winner) return false;
  const pending = held as Attempt | null;
  if (native && pending) {
    const ok = await native.verifyWin(
      { ...inputs, nonce: winner.nonce },
      { proof: winner.proof, out: winner.out },
    );
    // A Stop or a replacement that landed during the verification wins; the nonce does not advance twice.
    if (!keepGoing(winner.nonce)) return false;
    if (!ok) {
      native.forceLocal('invalid-proof');
      return mineFrom(p, job, winner.nonce, keepGoing, post);
    }
    post(pending);
  }
  post(winnerMessage(job, winner, pending ? 'presto' : 'wasm'));
  return true;
}
