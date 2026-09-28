// What the chain says of a recorded win: its sends' fates, where its nullifier landed, whether its
// ticket can still mint. A read that cannot answer says `unknown`; nothing here decides what to do.
import { Fr } from '@aztec/aztec.js/fields';
import { MerkleTreeId } from '@aztec/stdlib/trees';
import { type TxEffect, TxHash } from '@aztec/stdlib/tx';
import { fixedSlot } from '@yacana/miner-core/reader';
import type { Deployment } from './chain';

export type Tip = 'latest' | 'checkpointed';

/** A send in a block with its effects, reverted in one, still in the pool, unknown to the node, or unreadable. */
export type Fate = { block: number; effect: TxEffect } | 'reverted' | 'pending' | 'dropped' | 'unknown';

export interface Landed {
  block: number;
  effect: TxEffect;
  txHash: string;
}

const carries = (effect: TxEffect, nullifier: string): boolean =>
  effect.nullifiers.some((n) => n.toString() === nullifier);

export async function fate(d: Deployment, hash: string): Promise<Fate> {
  try {
    const r = await d.node.getTxReceipt(TxHash.fromString(hash), { includeTxEffect: true });
    if (r.status === 'dropped') return 'dropped';
    if (r.status === 'pending') return 'pending';
    if (r.blockNumber === undefined) return 'unknown';
    if (r.executionResult !== 'success') return 'reverted';
    return r.txEffect ? { block: Number(r.blockNumber), effect: r.txEffect } : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** A send found in a block carrying the ticket's nullifier: that send minted it. */
export const mintedBy = (f: Fate, hash: string, nullifier: string): Landed | undefined =>
  typeof f === 'object' && carries(f.effect, nullifier) ? { ...f, txHash: hash } : undefined;

/**
 * The block holding `nullifier` at the latest tip, read with its transactions (a block's effects come
 * only on request): `absent` when the tree has no such leaf, `unknown` when the block or its body
 * cannot be read or does not carry it.
 */
export async function carrier(d: Deployment, nullifier: string): Promise<Landed | 'absent' | 'unknown'> {
  try {
    const [leaf] = await d.node.findLeavesIndexes('latest', MerkleTreeId.NULLIFIER_TREE, [
      Fr.fromString(nullifier),
    ]);
    if (!leaf) return 'absent';
    const block = await d.node.getBlock(leaf.l2BlockNumber, { includeTransactions: true });
    const effect = block?.body.txEffects.find((fx) => carries(fx, nullifier));
    return effect
      ? { block: Number(leaf.l2BlockNumber), effect, txHash: effect.txHash.toString() }
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Whether `nullifier` is absent from the tree at `tip`. */
export async function absentAt(d: Deployment, nullifier: string, tip: Tip): Promise<boolean | 'unknown'> {
  try {
    const [leaf] = await d.node.findLeavesIndexes(tip, MerkleTreeId.NULLIFIER_TREE, [
      Fr.fromString(nullifier),
    ]);
    return leaf === undefined;
  } catch {
    return 'unknown';
  }
}

/**
 * Whether a ticket of `epoch` can still mint at `tip` (`main.nr`: its epoch open, the version not
 * retired). A node whose open epoch is behind the ticket's has not caught up: `unknown`, never "closed".
 */
export async function canMint(d: Deployment, epoch: bigint, tip: Tip): Promise<boolean | 'unknown'> {
  try {
    const layout = d.miner.artifact.storageLayout;
    const slots = [fixedSlot(layout, 'open_epoch'), fixedSlot(layout, 'retired')] as const;
    const at = (slot: Fr) => d.node.getPublicStorageAt(tip, d.miner.address, slot);
    // Both settle before any answer: one given up on its sibling's failure would outlive the check.
    const [open, retired] = await Promise.allSettled([at(slots[0]), at(slots[1])]);
    if (open.status === 'rejected' || retired.status === 'rejected') return 'unknown';
    if (!retired.value.isZero() || open.value.toBigInt() > epoch) return false;
    return open.value.toBigInt() === epoch ? true : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The time (unix s) of the block at `tip`: a send past its expiry there can land in no later block. */
export async function tipAt(d: Deployment, tip: Tip): Promise<number | 'unknown'> {
  try {
    const block = await d.node.getBlock(tip);
    return block ? Number(block.header.globalVariables.timestamp) : 'unknown';
  } catch {
    return 'unknown';
  }
}
