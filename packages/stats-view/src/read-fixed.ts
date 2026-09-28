import {
  DEFAULT_LIMITS,
  fixedSlot,
  readGenesis,
  readLatestBlock,
  readOpenEpochNumber,
  readSlot,
  readTotalSupply,
  TABLE_EPOCHS,
} from '@yacana/miner-core/reader';
import type { Reader } from './chain';
import type { Fixed } from './state';

/** An open epoch the slot table can address; anything else (a lying node) is refused before it is walked. */
export function assertOpenEpoch(open: number): number {
  if (!Number.isSafeInteger(open) || open < 0 || open >= TABLE_EPOCHS)
    throw new Error(`the node reports open epoch ${open}: not an epoch this deployment can have`);
  return open;
}

/** The miner's two bridge counters, when its layout has them (a miner without bridge functions has none). */
async function readMinerFlows(r: Reader): Promise<Fixed['miner']> {
  if (!r.minerLayout.exited_total || !r.minerLayout.claimed_from_l1_total) return undefined;
  const [exited, claimedFromL1] = await Promise.all([
    readSlot(r.node, r.miner, fixedSlot(r.minerLayout, 'exited_total'), DEFAULT_LIMITS),
    readSlot(r.node, r.miner, fixedSlot(r.minerLayout, 'claimed_from_l1_total'), DEFAULT_LIMITS),
  ]);
  return { exited: exited.toBigInt(), claimedFromL1: claimedFromL1.toBigInt() };
}

/** Beat one: the open epoch's number and the latest block, with the supply, the genesis and the bridge counters (fixed slots). */
export async function readFixed(r: Reader): Promise<Fixed> {
  const [open, block, supply, genesis, miner] = await Promise.all([
    readOpenEpochNumber(r.node, r.miner, r.minerLayout),
    readLatestBlock(r.node),
    readTotalSupply(r.node, r.token, r.tokenLayout),
    readGenesis(r.node, r.miner, r.minerLayout),
    readMinerFlows(r),
  ]);
  return {
    open: assertOpenEpoch(open),
    block,
    supply,
    genesis,
    ...(miner ? { miner } : {}),
    readAt: Date.now(),
  };
}
