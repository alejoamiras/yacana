// Everything a crossing needs, from the wallet master and nothing else: the secret whose hash a
// send-ahead or deposit commits to (claimable on any later version by whoever re-derives it), the
// tag an exit to Ethereum carries, and the secp256k1 key that alone may forward or redeem a held
// send. One index per crossing, per version; the labels are pinned by the vectors — changing one
// orphans every crossing ever made.
import { poseidon2Hash, poseidon2HashWithSeparator } from '@aztec-labs/foundation/crypto/poseidon';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { computeSecretHash } from '@aztec-labs/stdlib/hash';
import { DOMAINS, SEPARATORS } from '@yacana/miner-core/generated/params';
import { hkdf } from '@yacana/miner-core/keys/derive';
import { privateKeyToAccount } from 'viem/accounts';

const EXIT_INFO = 'yacana.exit.v1';
const REDEEM_INFO = 'yacana.redeem.v1';
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
/** Every public log of an exit is also tagged by its own hash so the owner finds it in one call. */
export const EXIT_LOG_SEPARATOR = SEPARATORS.SEP_EXIT_LOG;

export interface CrossingScope {
  chainId: bigint;
  portal: EthAddress;
  version: bigint;
}

export interface CrossingSecrets {
  index: number;
  /** The preimage a claim on the next version presents. Never leaves the device except to claim. */
  secret: Fr;
  /** What a send-ahead or deposit commits to; the portal and the miner see only this. */
  secretHash: Fr;
  /** What an exit to Ethereum carries: a hash, so the log names nothing. */
  tag: Fr;
  /** The per-crossing Ethereum signer; its address is in the send-ahead's content. */
  redeemKey: `0x${string}`;
  redeemAddress: EthAddress;
}

/** Decimal chain id, lowercase hex portal, decimal version, decimal index: one canonical spelling. */
const label = (info: string, s: CrossingScope, index: number): string =>
  `${info}:${s.chainId}:${s.portal.toString().toLowerCase()}:${s.version}:${index}`;

const reduceOrder = (bytes: Uint8Array): bigint => {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  const k = v % (SECP256K1_ORDER - 1n);
  return k + 1n; // never the zero scalar
};

export async function deriveCrossingSecrets(
  master: Uint8Array,
  scope: CrossingScope,
  index: number,
): Promise<CrossingSecrets> {
  if (master.length !== 32) throw new Error(`master is ${master.length} bytes, expected 32`);
  if (!Number.isInteger(index) || index < 0)
    throw new Error(`crossing index ${index} is not a natural number`);
  const [secretBytes, keyBytes] = await Promise.all([
    hkdf(master, label(EXIT_INFO, scope, index), 64),
    hkdf(master, label(REDEEM_INFO, scope, index), 64),
  ]);
  const secret = Fr.fromBufferReduce(Buffer.from(secretBytes));
  const redeemKey = `0x${reduceOrder(keyBytes).toString(16).padStart(64, '0')}` as const;
  const [secretHash, tag] = await Promise.all([
    computeSecretHash(secret),
    poseidon2Hash([new Fr(DOMAINS.DOM_EXIT), secret]),
  ]);
  return {
    index,
    secret,
    secretHash,
    tag,
    redeemKey,
    redeemAddress: EthAddress.fromString(privateKeyToAccount(redeemKey).address),
  };
}

/** The tag under which the miner logs an exit a second time: by its own hash, findable in one query. */
export const exitLogTag = (hashOrTag: Fr): Promise<Fr> =>
  poseidon2HashWithSeparator([hashOrTag], EXIT_LOG_SEPARATOR);
