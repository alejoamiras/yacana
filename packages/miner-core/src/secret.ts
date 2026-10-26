import { Fr } from '@aztec-labs/foundation/curves/bn254';

// The secret is a bearer credential for the tickets it commits to, valid for one epoch: the
// caller generates it when an epoch starts and discards it at close. Drawn straight from the
// platform CSPRNG (Fr.random() can be made deterministic by the ambient SEED variable).
export function newEpochSecret(): Fr {
  const bytes = new Uint8Array(64);
  globalThis.crypto.getRandomValues(bytes);
  return Fr.fromBufferReduce(Buffer.from(bytes));
}
