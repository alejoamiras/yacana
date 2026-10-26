import { poseidon2Hash } from '@aztec-labs/foundation/crypto/poseidon';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import type { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { siloNullifier } from '@aztec-labs/stdlib/hash';
import { DOMAINS } from './generated/params.ts';

/** A non-ZK UltraHonk proof for the Noir recursive verifier: 410 fields, 32-byte big-endian each. */
export const PROOF_FIELDS = 410;

// Domain separators are generated from yacana.params.json, the same source as the Noir globals.
export const { DOM_DEPLOY, DOM_SECRET, DOM_WORK, DOM_TICKET, DOM_NULL, DOM_SEED, DOM_LAUNCH } = DOMAINS;

/** Split bb's binary proof into its field elements. Throws on any length but 410 × 32 bytes. */
export function proofToFields(proof: Uint8Array): Fr[] {
  if (proof.length !== PROOF_FIELDS * 32) {
    throw new Error(`proof is ${proof.length} bytes, expected ${PROOF_FIELDS * 32}`);
  }
  const fields: Fr[] = [];
  for (let i = 0; i < PROOF_FIELDS; i++)
    fields.push(Fr.fromBuffer(Buffer.from(proof.subarray(i * 32, i * 32 + 32))));
  return fields;
}

/** The ticket: Poseidon2(DOM_TICKET ∥ proof[0..410]), as the contract computes it. */
export async function computeDigest(fields: Fr[]): Promise<Fr> {
  if (fields.length !== PROOF_FIELDS)
    throw new Error(`expected ${PROOF_FIELDS} fields, got ${fields.length}`);
  return poseidon2Hash([new Fr(DOM_TICKET), ...fields]);
}

export const low128 = (digest: Fr): bigint => digest.toBigInt() & ((1n << 128n) - 1n);

export const isWinner = (digest: Fr, target: bigint): boolean => low128(digest) < target;

/** Poseidon2(DOM_SECRET, secret, recipient): a leaked (proof, secret) can only pay this recipient. */
export const secretCommitment = (secret: Fr, recipient: Fr): Promise<Fr> =>
  poseidon2Hash([new Fr(DOM_SECRET), secret, recipient]);

/**
 * Poseidon2(DOM_DEPLOY, chain_id, rollup_version, miner_contract, version): binds a proof to one
 * deployment on one rollup, so a fork or upgrade sharing chain id, address and state cannot reuse work.
 */
export const deployDomain = (
  chainId: bigint,
  rollupVersion: bigint,
  minerContract: Fr,
  version: bigint,
): Promise<Fr> =>
  poseidon2Hash([new Fr(DOM_DEPLOY), new Fr(chainId), new Fr(rollupVersion), minerContract, new Fr(version)]);

/** The nullifier a claim emits for its ticket, as the chain records it (siloed by the miner contract). */
export const ticketNullifier = async (digest: Fr, miner: AztecAddress): Promise<Fr> =>
  siloNullifier(miner, await poseidon2Hash([new Fr(DOM_NULL), digest]));
