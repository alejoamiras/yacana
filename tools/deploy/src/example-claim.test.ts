import { describe, expect, test } from 'bun:test';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { computePublicDataTreeLeafSlot, deriveStorageSlotInMap } from '@aztec/stdlib/hash';
import { TxHash } from '@aztec/stdlib/tx';
import { TABLE_EPOCHS } from '@yacana/miner-core/reader';
import { loadLayouts } from '@yacana/miner-core/slots';
import {
  type EffectView,
  type ExampleClaim,
  effectView,
  exampleClaimFromEffect,
  sponsorFeeLeaf,
} from './example-claim.ts';

const fixture = (await Bun.file(
  new URL('../fixtures/example-claim-effect.json', import.meta.url),
).json()) as {
  identity: ExampleClaim;
  effect: EffectView;
};
const recorded = (await Bun.file(
  new URL('../../../deployments/testnet.example-claim.json', import.meta.url),
).json()) as ExampleClaim;
const layout = (await loadLayouts()).miner;
const fee = await sponsorFeeLeaf();
const { miner, chainId, rollupVersion } = recorded;
const identity = { miner, chainId, rollupVersion };
const extract = (effect: EffectView, id = identity) => exampleClaimFromEffect(effect, id, layout, 40, fee);

describe('the example claim from a transaction effect', () => {
  test('the committed testnet effect yields the committed record: the leaf writes, the siloed ticket, the sponsor', async () => {
    expect(fixture.identity).toEqual(recorded);
    const claim = await extract(fixture.effect);
    expect(claim).toEqual(recorded);
    expect(claim.claims[1] - claim.claims[0]).toBe(1);
    expect(fixture.effect.nullifiers).toContain(claim.nullifier);
    expect(fixture.effect.noteHashes).toContain(claim.noteHash);
  });

  test('anything but one sponsored claim of this deployment is refused', async () => {
    const e = fixture.effect;
    const without = (pred: (w: { leafSlot: string; value: string }) => boolean) => ({
      ...e,
      publicDataWrites: e.publicDataWrites.filter((w) => !pred(w)),
    });
    // The miner's two leaves are the ones whose values are the counter and the digest; drop the counter.
    const count = BigInt(recorded.claims[1]);
    const counter = e.publicDataWrites.find((w) => BigInt(w.value) === count) as { leafSlot: string };
    await expect(extract(without((w) => w.leafSlot === counter.leafSlot))).rejects.toThrow(/no claims\[e\]/);
    await expect(
      extract({ ...e, nullifiers: e.nullifiers.filter((n) => n !== recorded.nullifier) }),
    ).rejects.toThrow(/no ticket nullifier/);
    // Two notes: a batch of claims in one epoch (one counter, one digest, a note each) or a first claim with
    // its handshake; either way not "one claim, as recorded".
    await expect(
      extract({ ...e, noteHashes: [...e.noteHashes, `0x${'7'.padStart(64, '0')}`] }),
    ).rejects.toThrow(/2 note hashes: not one plain claim/);
    await expect(extract({ ...e, noteHashes: [] })).rejects.toThrow(/0 note hashes/);
    // Without the fee-juice write on the sponsor's balance leaf, the fee was someone else's.
    const sponsorLeaf = (
      await computePublicDataTreeLeafSlot(
        fee.feeJuice,
        await deriveStorageSlotInMap(fee.balancesSlot, { toField: () => fee.sponsor.toField() }),
      )
    ).toString();
    expect(e.publicDataWrites.some((w) => w.leafSlot === sponsorLeaf)).toBe(true);
    await expect(extract(without((w) => w.leafSlot === sponsorLeaf))).rejects.toThrow(/no fee-juice write/);
    // Another deployment's address derives other leaves: the same effect is not its claim.
    await expect(extract(e, { ...identity, miner: `0x${'1'.padStart(64, '0')}` })).rejects.toThrow(
      /no claims/,
    );
  });
});

/** The committed record against the chain it came from: `YACANA_TESTNET_NODE_URL=https://… bun test tools/deploy`. */
const testnet = process.env.YACANA_TESTNET_NODE_URL ?? '';
describe.skipIf(!testnet)('the recorded claim on the testnet', () => {
  test('re-reading the transaction from the node yields the committed record', async () => {
    const node = createAztecNodeClient(testnet);
    const effect = await node.getTxEffect(TxHash.fromString(recorded.txHash));
    expect(effect).toBeTruthy();
    const view = effectView(effect);
    expect(view).toEqual(fixture.effect);
    expect(await exampleClaimFromEffect(view, identity, layout, TABLE_EPOCHS - 1, fee)).toEqual(recorded);
  }, 120_000);
});
