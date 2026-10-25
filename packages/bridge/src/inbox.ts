// A message the portal sent into a version's Inbox — a deposit, a forwarded send-ahead, the retire
// signal — as the L2 side must name it to consume it: the same leaf the Inbox inserted.
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import type { EthAddress } from '@aztec-labs/foundation/eth-address';
import type { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { computeSecretHash } from '@aztec-labs/stdlib/hash';
import { L1Actor, L1ToL2Message, L2Actor } from '@aztec-labs/stdlib/messaging';
import { claimContent, retireContent } from './content.ts';

export interface InboundScope {
  chainId: bigint;
  rollupVersion: bigint;
  miner: AztecAddress;
  portal: EthAddress;
}

export const inboxLeaf = (scope: InboundScope, content: Fr, secretHash: Fr, index: bigint): Fr =>
  new L1ToL2Message(
    new L1Actor(scope.portal, Number(scope.chainId)),
    new L2Actor(scope.miner, Number(scope.rollupVersion)),
    content,
    secretHash,
    new Fr(index),
  ).hash();

/** A deposit's or a forwarded send-ahead's leaf: what `claim_from_l1` consumes. */
export const claimLeaf = (scope: InboundScope, amount: bigint, secretHash: Fr, index: bigint): Fr =>
  inboxLeaf(scope, claimContent(amount), secretHash, index);

/** The retire signal's secret is the fixed zero, so anyone may consume it; its hash is public. */
export const retireSecretHash = (): Promise<Fr> => computeSecretHash(Fr.ZERO);

export const retireLeaf = async (scope: InboundScope, index: bigint): Promise<Fr> =>
  inboxLeaf(scope, retireContent(scope.rollupVersion), await retireSecretHash(), index);
