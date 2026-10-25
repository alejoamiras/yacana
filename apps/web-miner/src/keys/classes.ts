// An account's address depends on the account contract's class as much as on the master: an SDK
// that ships a new class gives every master a new address. The vault therefore knows two classes —
// the build's and the one before it — and a master fingerprint that names the master without any
// class, so a record made under the old class opens under the new one exactly once and only when
// the master is the same.
import { SchnorrInitializerlessAccountContractArtifact } from '@aztec-labs/accounts/schnorr';
import { Grumpkin } from '@aztec-labs/foundation/crypto/grumpkin';
import { poseidon2Hash, poseidon2HashWithSeparator } from '@aztec-labs/foundation/crypto/poseidon';
import { Schnorr } from '@aztec-labs/foundation/crypto/schnorr';
import { Fq, Fr } from '@aztec-labs/foundation/curves/bn254';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import {
  computeContractAddressFromInstance,
  computePartialAddress,
  getContractClassFromArtifact,
} from '@aztec-labs/stdlib/contract';
import { deriveKeys, derivePublicKeyFromSecretKey } from '@aztec-labs/stdlib/keys';
import { deriveAccountFields, hkdf } from '@yacana/miner-core/keys/derive';

/**
 * The recipe the last shipped build (Aztec 5.2.0) derived addresses with: its account class and its
 * address separator (`CONTRACT_ADDRESS_V2`; 6.0.0 hashes under V3 and no longer exports V2). Records
 * without a fingerprint are verified against it, once, on the apex. An SDK bump that moves either
 * moves this pair to the outgoing build's values, pinned by a vector computed under that build.
 */
export const PREVIOUS_ACCOUNT_CLASS_ID = '0x1c59d7500b7d8ba4bb13ace9e7c07e9576a11a5966624ced14f8efd117b9d5b2';
export const PREVIOUS_ADDRESS_SEPARATOR = 4099338721;

let current: Promise<string> | undefined;
/** The build's account class id, from the SDK's own artifact. */
export const currentAccountClassId = (): Promise<string> => {
  current ??= getContractClassFromArtifact(SchnorrInitializerlessAccountContractArtifact).then((c) =>
    c.id.toString(),
  );
  return current;
};

/**
 * Account `index` of `master` under `classId`: the initializerless Schnorr account's instance
 * (no initializer, the signing key's hash as the immutables hash, the secret's public keys, the
 * derived salt, no deployer), with the class id set rather than taken from the artifact. With a
 * `separator`, the address is the SDK's own `computeAddress` under that separator instead of its
 * current one: `((poseidon2([publicKeysHash, partialAddress], separator) · G) + ivpk_m).x`.
 */
export async function addressUnderClass(
  master: Uint8Array,
  index: number,
  classId: string,
  separator?: number,
): Promise<string> {
  const fields = await deriveAccountFields(master, index);
  const { publicKeys } = await deriveKeys(fields.secret);
  const signingPublicKey = await new Schnorr().computePublicKey(fields.signingKey);
  const immutablesHash = await poseidon2Hash([signingPublicKey.x, signingPublicKey.y]);
  const instance = {
    originalContractClassId: Fr.fromHexString(classId),
    initializationHash: Fr.ZERO,
    immutablesHash,
    publicKeys,
    salt: fields.salt,
    deployer: AztecAddress.ZERO,
    version: 2,
  } as const;
  if (separator === undefined) return (await computeContractAddressFromInstance(instance)).toString();
  const preaddress = await poseidon2HashWithSeparator(
    [await publicKeys.hash(), await computePartialAddress(instance)],
    separator,
  );
  const point = await Grumpkin.add(
    await derivePublicKeyFromSecretKey(new Fq(preaddress.toBigInt())),
    publicKeys.ivpkM,
  );
  return new AztecAddress(point.x).toString();
}

const FINGERPRINT_INFO = 'yacana.master.fp.v1';

/** Names a master without naming an address: 32 bytes of HKDF under a label of its own, as hex. */
export async function fingerprintOf(master: Uint8Array): Promise<string> {
  const bytes = await hkdf(master, FINGERPRINT_INFO, 32);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The two classes a record is checked against; tests substitute their own. */
export interface AccountClasses {
  current: { id: string; addressOf: (master: Uint8Array, index: number) => Promise<string> };
  previous: { id: string; addressOf: (master: Uint8Array, index: number) => Promise<string> };
}

export const buildClasses = async (): Promise<AccountClasses> => {
  const id = await currentAccountClassId();
  return {
    current: { id, addressOf: (m, i) => addressUnderClass(m, i, id) },
    previous: {
      id: PREVIOUS_ACCOUNT_CLASS_ID,
      addressOf: (m, i) => addressUnderClass(m, i, PREVIOUS_ACCOUNT_CLASS_ID, PREVIOUS_ADDRESS_SEPARATOR),
    },
  };
};
