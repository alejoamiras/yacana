// A send is safe only once its epoch's proof is on Ethereum, and each epoch has a deadline for that
// proof: `getTimestampForEpoch(e + proofSubmissionEpochs + 1)` on the version's Rollup, read over
// the Ethereum RPC. Past it, the rollup prunes the epoch and the burn is undone.
import { RollupAbi } from '@aztec-foundation/l1-artifacts/RollupAbi';
import { type Client, getContract, type Hex } from 'viem';

export interface RollupReads {
  proofSubmissionEpochs(): Promise<bigint>;
  timestampForEpoch(epoch: bigint): Promise<bigint>;
  provenCheckpoint(): Promise<bigint>;
  epochOfCheckpoint(checkpoint: bigint): Promise<bigint>;
}

/** The reads over the Rollup's ABI; a fake stands in for tests. */
export const rollupReads = (client: Client, rollup: Hex): RollupReads => {
  const c = getContract({ address: rollup, abi: RollupAbi, client });
  return {
    proofSubmissionEpochs: async () => BigInt(await c.read.getProofSubmissionEpochs()),
    timestampForEpoch: (epoch) => c.read.getTimestampForEpoch([epoch]),
    provenCheckpoint: () => c.read.getProvenCheckpointNumber(),
    epochOfCheckpoint: async (checkpoint) => BigInt(await c.read.getEpochForCheckpoint([checkpoint])),
  };
};

/** Unix seconds by which `epoch`'s proof must land, per the rollup's own constants. */
export async function proofDeadline(r: RollupReads, epoch: bigint): Promise<bigint> {
  const window = await r.proofSubmissionEpochs();
  return r.timestampForEpoch(epoch + window + 1n);
}

/**
 * Whether the proven checkpoint's epoch has reached `epoch`. An epoch is proven checkpoint by
 * checkpoint, so this says a proof of the epoch has begun to land, not that a given block of it is
 * covered: a block's own settlement is `checkpointProven` of its checkpoint.
 */
export async function epochProven(r: RollupReads, epoch: bigint): Promise<boolean> {
  const proven = await r.provenCheckpoint();
  if (proven === 0n) return false;
  return (await r.epochOfCheckpoint(proven)) >= epoch;
}

/** Whether the rollup's proof on Ethereum covers `checkpoint`: the one settlement a block has. */
export async function checkpointProven(r: RollupReads, checkpoint: bigint): Promise<boolean> {
  return checkpoint > 0n && (await r.provenCheckpoint()) >= checkpoint;
}

/** Past its deadline and still unproven: the epoch is pruned or about to be. */
export const missedDeadline = (deadline: bigint, proven: boolean, nowSeconds: bigint): boolean =>
  !proven && nowSeconds > deadline;
