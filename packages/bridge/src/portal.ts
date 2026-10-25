// The portal and YACA as viem sees them: the committed ABIs (typed `as const`, so every call and
// event is checked) and the argument shapes the portal's forward path takes.
import type { L2ToL1MembershipWitness } from '@aztec-labs/stdlib/messaging';
import { yacaAbi } from '@yacana/portal/abi/YACA';
import { yacanaPortalAbi } from '@yacana/portal/abi/YacanaPortal';
import { type Client, getContract, type Hex } from 'viem';

export { yacaAbi, yacanaPortalAbi };

/** 1 = an exit to Ethereum (mint to a recipient), 2 = a send-ahead (held for the next version). */
export type ExitKind = 1 | 2;

/** The portal's `ForwardArgs` struct, as viem encodes it. */
export interface ForwardArgs {
  kind: ExitKind;
  amount: bigint;
  /** The exit's tag (kind 1) or secret hash (kind 2). */
  aux: Hex;
  /** The Ethereum recipient (kind 1) or the redeem key (kind 2). */
  recipientOrRedeemKey: Hex;
  epoch: bigint;
  numCheckpointsInEpoch: bigint;
  leafIndex: bigint;
  path: Hex[];
  /** Kind 2 by anyone but a listed forwarder: the redeem key's Forward signature; empty otherwise. */
  sig: Hex;
  expiry: bigint;
}

/** What an exit says about itself, as the miner recorded it; the witness completes the proof. */
export interface ExitLeaf {
  kind: ExitKind;
  amount: bigint;
  aux: Hex;
  recipientOrRedeemKey: Hex;
}

export const forwardArgs = (
  exit: ExitLeaf,
  witness: Pick<
    L2ToL1MembershipWitness,
    'epochNumber' | 'numCheckpointsInEpoch' | 'leafIndex' | 'siblingPath'
  >,
  signed: { sig: Hex; expiry: bigint } = { sig: '0x', expiry: 0n },
): ForwardArgs => ({
  ...exit,
  epoch: BigInt(witness.epochNumber),
  numCheckpointsInEpoch: BigInt(witness.numCheckpointsInEpoch),
  leafIndex: witness.leafIndex,
  path: witness.siblingPath.toBufferArray().map((b) => `0x${b.toString('hex')}` as Hex),
  ...signed,
});

export const portalAt = <C extends Client>(address: Hex, client: C) =>
  getContract({ address, abi: yacanaPortalAbi, client });

export const yacaAt = <C extends Client>(address: Hex, client: C) =>
  getContract({ address, abi: yacaAbi, client });

export type Portal = ReturnType<typeof portalAt>;
