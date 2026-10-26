// The rollup's pending checkpoint from L1, every fifteen seconds, signed in or out: the one reading
// that says whether the node has every block it should. Its own viem client on the RPC in use; the
// bridge's session, which needs an account, is not involved. Failures are logged and waited out.
// The RPC is trusted as the user chose it: a chain id check keeps another chain's rollup out, nothing
// authenticates the answers, and an answer from an RPC no longer in use is dropped.
import { RollupAbi } from '@aztec-foundation/l1-artifacts/RollupAbi';
import { ethRpcClient } from '@yacana/web-kit/browser/eth-rpc';
import { recordL1 } from '@yacana/web-kit/browser/node-health';
import type { Hex } from 'viem';

export const L1_SAMPLE_MS = 15_000;

export interface L1Sampler {
  stop(): void;
  /** One reading now (the one in flight, if any); resolves when it settled. */
  tick(): Promise<void>;
  /** The RPC changed: a reading out on the former one is dropped, a fresh one starts. */
  switched(): Promise<void>;
}

export function startL1Sampler(o: {
  /** Read at every tick: the RPC the user switches to is sampled from the next one. */
  rpcUrl: () => string;
  rollup: string;
  chainId: bigint;
  intervalMs?: number;
  make?: typeof ethRpcClient;
  log?: (line: string) => void;
}): L1Sampler {
  const make = o.make ?? ethRpcClient;
  let url = '';
  let client: ReturnType<typeof ethRpcClient> | undefined;
  let inflight: Promise<void> | undefined;
  let stopped = false;
  /** Moves with every RPC switch (A → B → A included): the answer of an older generation is dropped. */
  let generation = 0;
  const read = async () => {
    const next = o.rpcUrl();
    if (!next) return;
    if (!client || next !== url) {
      url = next;
      client = make(next);
    }
    const c = client;
    const g = generation;
    const [chainId, head, pending] = await Promise.all([
      c.getChainId(),
      c.getBlockNumber({ cacheTime: 0 }),
      c.readContract({
        address: o.rollup as Hex,
        abi: RollupAbi,
        functionName: 'getPendingCheckpointNumber',
      }),
    ]);
    // Another chain's rollup says nothing about this node; an RPC since replaced says nothing either.
    if (BigInt(chainId) !== o.chainId || stopped || g !== generation) return;
    recordL1({ pendingCheckpoint: Number(pending), head: Number(head) });
  };
  const tick = (): Promise<void> => {
    if (inflight) return inflight;
    const run: Promise<void> = read()
      .catch((e: unknown) => o.log?.(`L1 sample: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        // A reading a switch left behind must not clear the one that replaced it.
        if (inflight === run) inflight = undefined;
      });
    inflight = run;
    return run;
  };
  void tick();
  const timer = setInterval(() => void tick(), o.intervalMs ?? L1_SAMPLE_MS);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    tick,
    switched: () => {
      generation++;
      inflight = undefined;
      return tick();
    },
  };
}
