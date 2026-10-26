// The redeem key's word: an EIP-712 signature the portal checks before it moves a held send-ahead —
// `Forward` names the version it may land on, `Redeem` the Ethereum recipient — bound to the exact
// leaf (version, epoch, leaf id, content) and an expiry, so a signature fits one crossing once.
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import type { Hex, TypedDataDomain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sendAheadContent } from './content.ts';
import type { ForwardArgs } from './portal.ts';

export const PORTAL_DOMAIN = (chainId: bigint, portal: Hex): TypedDataDomain => ({
  name: 'YacanaPortal',
  version: '1',
  chainId: Number(chainId),
  verifyingContract: portal,
});

export const SIGNED_TYPES = {
  Forward: [
    { name: 'version', type: 'uint256' },
    { name: 'epoch', type: 'uint256' },
    { name: 'leafId', type: 'uint256' },
    { name: 'contentHash', type: 'bytes32' },
    { name: 'target', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
  Redeem: [
    { name: 'version', type: 'uint256' },
    { name: 'epoch', type: 'uint256' },
    { name: 'leafId', type: 'uint256' },
    { name: 'contentHash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const;

export const leafIdOf = (args: Pick<ForwardArgs, 'path' | 'leafIndex'>): bigint =>
  (1n << BigInt(args.path.length)) + args.leafIndex;

/** The send-ahead content as the portal recomputes it from the forward arguments. */
export const sendAheadContentOf = (args: Pick<ForwardArgs, 'amount' | 'aux' | 'recipientOrRedeemKey'>): Hex =>
  `0x${sendAheadContent(
    args.amount,
    Fr.fromHexString(args.aux),
    EthAddress.fromString(args.recipientOrRedeemKey),
  )
    .toBuffer()
    .toString('hex')}`;

export interface Signing {
  chainId: bigint;
  portal: Hex;
  version: bigint;
  expiry: bigint;
}

export async function signForward(key: Hex, s: Signing, args: ForwardArgs, target: bigint): Promise<Hex> {
  return privateKeyToAccount(key).signTypedData({
    domain: PORTAL_DOMAIN(s.chainId, s.portal),
    types: SIGNED_TYPES,
    primaryType: 'Forward',
    message: {
      version: s.version,
      epoch: args.epoch,
      leafId: leafIdOf(args),
      contentHash: sendAheadContentOf(args),
      target,
      expiry: s.expiry,
    },
  });
}

export async function signRedeem(key: Hex, s: Signing, args: ForwardArgs, recipient: Hex): Promise<Hex> {
  return privateKeyToAccount(key).signTypedData({
    domain: PORTAL_DOMAIN(s.chainId, s.portal),
    types: SIGNED_TYPES,
    primaryType: 'Redeem',
    message: {
      version: s.version,
      epoch: args.epoch,
      leafId: leafIdOf(args),
      contentHash: sendAheadContentOf(args),
      recipient,
      expiry: s.expiry,
    },
  });
}
