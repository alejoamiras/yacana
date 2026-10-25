// One accepted claim, as its transaction's public effect records it: the leaf writes to this
// deployment's `claims[e]` and `last_digest[e]`, the siloed ticket nullifier of that digest, the
// fee-juice write on the sponsor's balance. Public storage keeps counts and a digest per epoch,
// never a nullifier or a note hash, so the landing's ledger example can only come from an effect,
// recorded once and committed.
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { getContractInstanceFromInstantiationParams } from '@aztec-labs/aztec.js/contracts';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { FEE_JUICE_ADDRESS, FEE_JUICE_BALANCES_SLOT, SPONSORED_FPC_SALT } from '@aztec-labs/constants';
import { SponsoredFPCContract } from '@aztec-labs/noir-contracts.js/SponsoredFPC';
import { computePublicDataTreeLeafSlot, deriveStorageSlotInMap } from '@aztec-labs/stdlib/hash';
import { ticketNullifier } from '@yacana/miner-core/proof';
import { fixedSlot, type StorageLayout } from '@yacana/miner-core/reader';

export interface ExampleClaim {
  miner: string;
  chainId: string;
  rollupVersion: string;
  epoch: number;
  /** The counter before and after: a claim increments by one. */
  claims: [number, number];
  block: number;
  txHash: string;
  nullifier: string;
  noteHash: string;
}

/** A transaction effect with its fields as hex strings: what the node returns, made serialisable. */
export interface EffectView {
  txHash: string;
  l2BlockNumber: number;
  nullifiers: string[];
  noteHashes: string[];
  publicDataWrites: { leafSlot: string; value: string }[];
}

export interface Identity {
  miner: string;
  chainId: string;
  rollupVersion: string;
}

/** Where the effect must show the fee: the sponsor's fee-juice balance leaf, so "paid by the sponsor" is read, not assumed. */
export interface FeeLeaf {
  feeJuice: AztecAddress;
  balancesSlot: Fr;
  sponsor: AztecAddress;
}

/** The canonical sponsored FPC's balance in the fee-juice contract: the leaf every sponsored transaction debits. */
export const sponsorFeeLeaf = async (): Promise<FeeLeaf> => ({
  feeJuice: AztecAddress.fromNumberUnsafe(FEE_JUICE_ADDRESS),
  balancesSlot: new Fr(FEE_JUICE_BALANCES_SLOT),
  sponsor: (
    await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
      salt: new Fr(SPONSORED_FPC_SALT),
    })
  ).address,
});

type RawEffect = {
  l2BlockNumber: number;
  data: {
    txHash: { toString(): string };
    nullifiers: { toString(): string }[];
    noteHashes: { toString(): string }[];
    publicDataWrites: { leafSlot: { toString(): string }; value: { toString(): string } }[];
  };
};

export const effectView = (effect: unknown): EffectView => {
  const e = effect as RawEffect;
  return {
    txHash: e.data.txHash.toString(),
    l2BlockNumber: e.l2BlockNumber,
    nullifiers: e.data.nullifiers.map((n) => n.toString()),
    noteHashes: e.data.noteHashes.map((n) => n.toString()),
    publicDataWrites: e.data.publicDataWrites.map((w) => ({
      leafSlot: w.leafSlot.toString(),
      value: w.value.toString(),
    })),
  };
};

const leafOf = async (contract: AztecAddress, slot: Fr, key: Fr): Promise<string> =>
  (
    await computePublicDataTreeLeafSlot(contract, await deriveStorageSlotInMap(slot, { toField: () => key }))
  ).toString();

/**
 * The claim in `effect` for `identity.miner`, searching epochs `0..epochs`. Refused when the effect
 * lacks the pair of leaf writes, writes claims of more than one epoch, lacks the digest's siloed
 * ticket among its nullifiers (the search is by value, never by position), carries other than
 * exactly one note hash, or shows no fee write on the sponsor's balance. One note is what makes
 * it one claim: a batch of claims in one epoch leaves one counter and one digest but a note each,
 * and an account's first claim adds the delivery handshake's note, so neither can be "one claim,
 * as recorded".
 */
export async function exampleClaimFromEffect(
  effect: EffectView,
  identity: Identity,
  layout: StorageLayout,
  epochs: number,
  fee: FeeLeaf,
): Promise<ExampleClaim> {
  const miner = AztecAddress.fromStringUnsafe(identity.miner);
  const writes = new Map(effect.publicDataWrites.map((w) => [w.leafSlot, w.value]));
  const found: { epoch: number; claims: string; digest: string }[] = [];
  for (let e = 0; e <= epochs; e++) {
    const claims = writes.get(await leafOf(miner, fixedSlot(layout, 'claims'), new Fr(e)));
    const digest = writes.get(await leafOf(miner, fixedSlot(layout, 'last_digest'), new Fr(e)));
    if (claims !== undefined && digest !== undefined) found.push({ epoch: e, claims, digest });
  }
  const one = found[0];
  if (!one)
    throw new Error(`no claims[e] and last_digest[e] writes for ${identity.miner} in epochs 0..${epochs}`);
  if (found.length > 1) throw new Error(`the effect claims in ${found.length} epochs: not one claim`);
  const nullifier = (await ticketNullifier(Fr.fromString(one.digest), miner)).toString();
  if (!effect.nullifiers.includes(nullifier))
    throw new Error(`the effect writes claims[${one.epoch}] but carries no ticket nullifier for its digest`);
  if (effect.noteHashes.length !== 1)
    throw new Error(`the effect carries ${effect.noteHashes.length} note hashes: not one plain claim`);
  if (!writes.has(await leafOf(fee.feeJuice, fee.balancesSlot, fee.sponsor.toField())))
    throw new Error('the effect shows no fee-juice write on the sponsor: the fee was not the sponsor’s');
  const after = Number(BigInt(one.claims));
  return {
    ...identity,
    epoch: one.epoch,
    claims: [after - 1, after],
    block: effect.l2BlockNumber,
    txHash: effect.txHash,
    nullifier,
    noteHash: effect.noteHashes[0] as string,
  };
}
