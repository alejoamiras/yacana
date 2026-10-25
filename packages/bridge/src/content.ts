// The four message contents the portal and the miner agree on, hashed as Aztec's own token portal
// does: the first four bytes of keccak256 of the ABI-style signature, then each argument as a
// 32-byte big-endian word, then sha256 truncated into a field (`Hash.sol` / `sha256_to_field`).
// The signature makes each kind's content unique; nothing on either side ever calls it.
import { keccak256 } from '@aztec-labs/foundation/crypto/keccak';
import { sha256ToField } from '@aztec-labs/foundation/crypto/sha256';
import type { Fr } from '@aztec-labs/foundation/curves/bn254';
import type { EthAddress } from '@aztec-labs/foundation/eth-address';

export const EXIT_SIGNATURE = 'exit_to_l1(address,uint256,bytes32)';
export const SEND_AHEAD_SIGNATURE = 'send_ahead(uint256,bytes32,address)';
export const CLAIM_SIGNATURE = 'claim_from_l1(uint256)';
export const RETIRE_SIGNATURE = 'retire(uint256)';

export const MAX_AMOUNT = (1n << 128n) - 1n;

const word = (v: bigint): Buffer => {
  if (v < 0n || v >= 1n << 256n) throw new Error('word out of range');
  return Buffer.from(v.toString(16).padStart(64, '0'), 'hex');
};
const amountWord = (amount: bigint): Buffer => {
  if (amount < 0n || amount > MAX_AMOUNT) throw new Error(`amount ${amount} is not a u128`);
  return word(amount);
};
const selector = (signature: string): Buffer => keccak256(Buffer.from(signature, 'utf8')).subarray(0, 4);
const content = (signature: string, words: Buffer[]): Fr =>
  sha256ToField([Buffer.concat([selector(signature), ...words])]);

/** K1: burn on Aztec, mint YACA to `recipient`; `tag` is a hash the sender recognises. */
export const exitContent = (recipient: EthAddress, amount: bigint, tag: Fr): Fr =>
  content(EXIT_SIGNATURE, [recipient.toBuffer32(), amountWord(amount), tag.toBuffer()]);

/** K2: burn on Aztec, hold on Ethereum for the next version; `redeemKey` signs its forward or redeem. */
export const sendAheadContent = (amount: bigint, secretHash: Fr, redeemKey: EthAddress): Fr =>
  content(SEND_AHEAD_SIGNATURE, [amountWord(amount), secretHash.toBuffer(), redeemKey.toBuffer32()]);

/** K4: the portal's message into a version's Inbox; the secret hash rides on the message itself. */
export const claimContent = (amount: bigint): Fr => content(CLAIM_SIGNATURE, [amountWord(amount)]);

/** K5: the portal tells a version's miner that mining is over. */
export const retireContent = (version: bigint): Fr => content(RETIRE_SIGNATURE, [word(version)]);
