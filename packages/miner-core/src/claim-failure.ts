// What a failed claim means, from the error the SDK throws. The distinction decides the recovery.
// After a claim reverted in public (a stale claim), the PXE keeps a pending note-delivery index
// for a sequence nullifier that never landed, and every later claim's constrained delivery asserts
// it ("unknown nullifier") until the reverted tx is FINALIZED on L1 (tens of minutes). An expiry
// means nothing happened; a refusal at simulation was never sent or paid; anything else is shown as is.

export type ClaimFailure =
  | 'reverted'
  | 'refused'
  | 'expired'
  | 'delivery-blocked'
  | 'anchor-pruned'
  | 'lost'
  | 'landed-elsewhere'
  | 'other';

/** The miner's own words for a claim seen in a proposed block whose effects the node no longer has. */
export const NO_EFFECTS = 'no effects for';

// The node refuses or evicts an expired claim with the validator's "Invalid expiration timestamp"
// (`@aztec/stdlib` error_texts); aztec.js `waitForTx` reports "Transaction 0x… was dropped.
// Reason: …" and "Transaction 0x… reverted: app_logic_reverted. Reason: …". The stuck delivery index
// surfaces as a nullifier read failure at simulation. The miner's "epoch is not open" is its
// private check (`main.nr`), failed at simulation before anything was proved or sent.
const EXPIRED = /Invalid expiration timestamp|\bexpired\b|\binclude_by_timestamp\b/i;
const REVERTED = /\breverted\b|_reverted\b/i;
const REFUSED = /epoch is not open/i;
const DELIVERY_BLOCKED = /unknown nullifier|Nullifier read request/i;
/** The node's answer to a query pinned to a block hash it no longer has: the claim's anchor was pruned. */
const ANCHOR_PRUNED = /possibly a reorg has occurred/i;
/**
 * A nullifier of the claim is already in the tree: the public simulation's collision (what a replay of a
 * landed claim meets before it is sent), or the node's `TX_ERROR_EXISTING_NULLIFIER` at `sendTx`.
 */
const NULLIFIER_TAKEN = /\bNullifier collision\b|\bExisting nullifier\b/;
/** The miner's public check (`main.nr`): the epoch closed between the send and the block. */
const STALE = /stale claim/i;

export const claimFailureMessage = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? '';

export function classifyClaimFailure(e: unknown): ClaimFailure {
  const m = e instanceof Error ? e.message : String(e);
  if (DELIVERY_BLOCKED.test(m)) return 'delivery-blocked';
  if (ANCHOR_PRUNED.test(m)) return 'anchor-pruned';
  if (m.includes(NO_EFFECTS)) return 'lost';
  // One of the claim's nullifiers is in the tree: most likely another send of the same ticket landed.
  if (NULLIFIER_TAKEN.test(m)) return 'landed-elsewhere';
  if (EXPIRED.test(m)) return 'expired';
  if (REFUSED.test(m)) return 'refused';
  if (REVERTED.test(m)) return 'reverted';
  return 'other';
}

/**
 * Why a claim reverted, as far as the message says: `stale` for the miner's own "stale claim" (the
 * epoch closed first), else the reason after the SDK's "Reason:". A mined revert's receipt carries no
 * reason on Aztec 5.2.0 (the SDK then writes "Reason: unknown"): no reason at all, and the epoch's
 * state decides whether the claim was stale.
 */
export function revertCause(message: string): { stale: true } | { stale: false; reason?: string } {
  if (STALE.test(message)) return { stale: true };
  const reason = /Reason:\s*(.+)$/.exec(message.split('\n')[0] ?? '')?.[1]?.trim();
  return reason && reason !== 'unknown' ? { stale: false, reason } : { stale: false };
}

/** Seconds until an L2 block is final on L1, from the rollup's constants: the pause after a failed reset. */
export const finalitySeconds = (c: {
  slotDuration: number;
  epochDuration: number;
  proofSubmissionEpochs: number;
}): number => (c.proofSubmissionEpochs + 1) * c.epochDuration * c.slotDuration;
