// H0 — the flip alone: the local network upgrades itself twice with no Yacana involved. Proves the
// rig can deploy a rollup, carry a governance vote through the node's clock, stop the old node,
// pin a node to the new version and see it settle. Every warp's headroom against the proof window
// and the whole run's wall time are printed for the CI budget.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { createExtendedL1Client } from '@aztec/ethereum/client';
import { OutboxContract, RegistryContract, RollupContract } from '@aztec/ethereum/contracts';
import { type RigVersion, startUpgradeRig, type UpgradeRig } from '@yacana/localnet/upgrade-rig';
import { foundry } from 'viem/chains';
import { sponsoredTransaction } from '../src/sponsored.ts';

const enabled = process.env.YACANA_RIG === '1';

describe.skipIf(!enabled)('the flip alone (H0)', () => {
  let rig: UpgradeRig;
  const startedAt = Date.now();
  beforeAll(async () => {
    rig = await startUpgradeRig();
  }, 600_000);
  afterAll(async () => {
    await rig?.teardown();
    for (const w of rig?.warps ?? [])
      console.info(
        `H0 warp +${w.seconds}s on v${w.version}: proof headroom ${w.headroomSlots ?? 'none pending'} slots`,
      );
    console.info(`H0 wall time ${((Date.now() - startedAt) / 1000).toFixed(0)} s`);
  });

  test('V5 → V6 → V7: each flip lands in the Registry and a pinned node settles on the new version', async () => {
    const client = createExtendedL1Client([rig.l1RpcUrl], rig.signerKey, foundry);
    const registry = new RegistryContract(client, rig.registry);
    const v5 = rig.versions[0] as RigVersion;
    expect(await registry.getNumberOfVersions()).toBe(1);

    const v6 = await rig.deployNext({ bump: 1n });
    expect(v6.version).not.toBe(v5.version);
    // The new rollup is constructed with the pinned node's own genesis, or that node could never follow it.
    const genesis6 = await new RollupContract(client, v6.rollup).getGenesisArchiveTreeRoot();
    expect(genesis6.equals(rig.genesisRoot)).toBe(true);
    expect(v6.inbox.equals(v5.inbox)).toBe(false);
    expect(v6.outbox.equals(v5.outbox)).toBe(false);
    // Not canonical until governance says so.
    expect((await registry.getCanonicalAddress()).equals(v5.rollup)).toBe(true);

    await rig.flip(v6);
    expect(await registry.getNumberOfVersions()).toBe(2);
    expect((await registry.getRollupAddress(1)).equals(v6.rollup)).toBe(true);

    // The old network keeps building and settling after the flip until it is stopped.
    const oldNode = createAztecNodeClient(rig.node?.nodeUrl as string);
    const provenBefore = await oldNode.getBlockNumber('proven');
    await rig.warpBy(72 * 4);
    await rig.prove();
    expect(await oldNode.getBlockNumber('proven')).toBeGreaterThan(provenBefore);

    await rig.stopNode();
    const node6 = await rig.startNode(v6);
    const client6 = createAztecNodeClient(node6.nodeUrl);
    const info = await client6.getNodeInfo();
    expect(BigInt(info.rollupVersion)).toBe(v6.version);
    expect(info.l1ContractAddresses.rollupAddress.equals(v6.rollup)).toBe(true);

    // V6 takes a user transaction: a fresh account deploys itself, the sponsored FPC paying.
    const sponsored = await sponsoredTransaction(node6.nodeUrl);
    expect(sponsored.blockNumber).toBeGreaterThan(0);
    expect(await client6.getBlockNumber('proposed')).toBeGreaterThanOrEqual(sponsored.blockNumber);

    // A settled checkpoint on V6 writes a non-zero root into V6's own Outbox.
    await rig.warpBy(72 * 5);
    await rig.prove();
    expect(await client6.getBlockNumber('proven')).toBeGreaterThan(0);
    const rollup6 = new RollupContract(client, v6.rollup);
    const proven = await rollup6.getProvenCheckpointNumber();
    const roots = await new OutboxContract(client, v6.outbox).getRoots(
      await rollup6.getEpochNumberForCheckpoint(proven),
    );
    expect(roots.some((r) => !r.isZero())).toBe(true);

    // Twice in one run: V7, with V6 as the running node.
    const v7 = await rig.deployNext({ bump: 2n });
    await rig.flip(v7);
    expect(await registry.getNumberOfVersions()).toBe(3);
    expect((await registry.getCanonicalAddress()).equals(v7.rollup)).toBe(true);
  }, 1_800_000);
});
