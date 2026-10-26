// Chain reads the miner needs: the open epoch, its parameters and its claim count. A lying RPC
// can only waste work here, never steal — claims are verified on-chain.
import type { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import type { Contract } from '@aztec-labs/aztec.js/contracts';
import { assertTimestamp } from './reader.ts';

export interface EpochParams {
  target: bigint;
  seed: bigint;
  openedAt: bigint;
}

export interface EpochView {
  epoch: bigint;
  params: EpochParams;
  claims: number;
}

// simulate() wraps the decoded return value: { result, offchainEffects, offchainMessages }.
const unwrap = async <T>(p: Promise<unknown>): Promise<T> => ((await p) as { result: T }).result;

// Before launch() epoch 0 does not exist; say when it can, instead of an uninitialized-storage error.
async function readParams(miner: Contract, from: AztecAddress, epoch: bigint) {
  try {
    return await unwrap<{ target: bigint; seed: bigint; opened_at: bigint }>(
      miner.methods.epoch_params(epoch).simulate({ from }),
    );
  } catch (e) {
    if (epoch !== 0n) throw e;
    const g = await unwrap<{ launch_at: bigint }>(miner.methods.genesis().simulate({ from })).catch(
      () => null,
    );
    if (!g) throw e;
    throw new Error(`not launched: launch() may open epoch 0 from unix time ${g.launch_at}`);
  }
}

// Separate simulations can straddle an epoch close; the view is only returned once the open
// epoch reads the same before and after the parameter reads.
export async function readOpenEpoch(miner: Contract, from: AztecAddress): Promise<EpochView> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const epoch = await unwrap<bigint>(miner.methods.open_epoch().simulate({ from }));
    const raw = await readParams(miner, from, epoch);
    const claims = Number(await unwrap<bigint>(miner.methods.claims_in(epoch).simulate({ from })));
    const still = await unwrap<bigint>(miner.methods.open_epoch().simulate({ from }));
    if (still === epoch)
      return {
        epoch,
        params: {
          target: raw.target,
          seed: raw.seed,
          openedAt: assertTimestamp(`epoch ${epoch}: opened_at`, raw.opened_at),
        },
        claims,
      };
  }
  throw new Error('epoch kept changing while reading it');
}

export const readRules = async (miner: Contract, from: AztecAddress) => {
  const [n, expected, tMax, reward, ttl] = await unwrap<bigint[]>(
    miner.methods.constants().simulate({ from }),
  );
  return {
    N: Number(n),
    EXPECTED_EPOCH_SECONDS: expected ?? 0n,
    T_MAX: tMax ?? 0n,
    REWARD: reward ?? 0n,
    CLAIM_TTL_SECONDS: ttl ?? 0n,
  };
};
