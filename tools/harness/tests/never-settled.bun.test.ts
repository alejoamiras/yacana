// H5 — a send-ahead that never settles: V6 is pinned with its automatic settlement off, its miner
// and a mined balance settled by hand as the baseline, then a send-ahead sits in a checkpoint no
// proof ever covers. With V6's node stopped and the rig's cheat codes owning the clock, V7 takes
// over, the proof window passes, V6's rollup prunes: its Outbox has no root for that epoch, a
// forward reverts as such, and its pending tip is back at the baseline. Only then V6 runs again
// and serves its version. What its wallets show afterwards is not stageable here (the automine
// node keeps the orphaned block; a fresh node never finishes syncing behind a prune), so the app
// claims nothing about the balance beyond those Ethereum facts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { relative } from 'node:path';
import { OutboxAbi } from '@aztec-foundation/l1-artifacts/OutboxAbi';
import { RollupAbi } from '@aztec-foundation/l1-artifacts/RollupAbi';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { RollupContract } from '@aztec-labs/ethereum/contracts';
import { CheckpointNumber } from '@aztec-labs/foundation/branded-types';
import { forwardAll } from '@yacana/deploy/bridge/forward';
import { type Operator, writeOpts } from '@yacana/deploy/bridge/operator';
import { registerVersion } from '@yacana/deploy/bridge/register';
import { noteAllTransitions } from '@yacana/deploy/bridge/transition';
import { repoRoot } from '@yacana/localnet/toolchain';
import { type RigVersion, startUpgradeRig, type UpgradeRig } from '@yacana/localnet/upgrade-rig';
import type { WorkProver } from '@yacana/miner-core/work';
import { getContract, type Hex } from 'viem';
import { revertName } from '../src/revert.ts';
import { balanceOf, mineOnce, openUser, sendAhead, type User, workProver } from '../src/user.ts';
import { asForwarder, deployBridge, deployMiner, type MinerOnRig } from '../src/yacana.ts';

const enabled = process.env.YACANA_RIG === '1';

describe.skipIf(!enabled)('a send-ahead that never settles (H5)', () => {
  let rig: UpgradeRig;
  let v6v: RigVersion;
  let v6: MinerOnRig;
  let user: User;
  let prover: WorkProver;
  let forwarder: Operator;
  let reward: bigint;

  beforeAll(async () => {
    rig = await startUpgradeRig();
    const bridge = await deployBridge(rig);
    v6v = await rig.deployNext({ bump: 1n });
    await rig.flip(v6v);
    await rig.stopNode();
    const node6 = await rig.startNode(v6v, { autoProve: false });
    v6 = await deployMiner(rig, node6, bridge);
    await registerVersion(v6.operator);
    forwarder = await asForwarder(rig, v6);
    user = await openUser(v6.deployment, node6.nodeUrl);
    prover = await workProver();
    reward = await mineOnce(user, prover);
  }, 900_000);

  afterAll(async () => {
    await prover?.destroy();
    await rig?.teardown();
  });

  test('the prune leaves nothing to consume on Ethereum, rewinds the tip, and the version comes back', async () => {
    const rollup = getContract({
      address: v6v.rollup.toString() as Hex,
      abi: RollupAbi,
      client: rig.publicClient,
    });
    // The baseline: everything so far settled by hand.
    await rig.warpBy(72 * 4);
    await rig.prove();
    const baseline = await rollup.read.getProvenCheckpointNumber();
    expect(await rollup.read.getPendingCheckpointNumber()).toBe(baseline);
    expect(await balanceOf(user)).toBe(reward);

    // The send-ahead lands in a checkpoint that will never be proven.
    const { secrets, txHash } = await sendAhead(user, reward / 2n, 0);
    expect(await balanceOf(user)).toBe(reward / 2n);
    const pendingBefore = await rollup.read.getPendingCheckpointNumber();
    expect(pendingBefore).toBeGreaterThan(baseline);
    // Its epoch and its place in it, read while the checkpoint still exists: the prune forgets it.
    const epochOf = async (c: bigint) =>
      BigInt(
        await new RollupContract(rig.publicClient, v6v.rollup).getEpochNumberForCheckpoint(
          CheckpointNumber(Number(c)),
        ),
      );
    const epoch = await epochOf(pendingBefore);
    let first = pendingBefore;
    while (first > 1n && (await epochOf(first - 1n)) === epoch) first -= 1n;
    const position = pendingBefore - first + 1n;
    const archive = relative(repoRoot, `${rig.runRoot}/witnesses.jsonl`);
    const node6Url = (rig.node as { nodeUrl: string }).nodeUrl;
    const unsettled = await forwardAll(forwarder, {
      source: v6.deployment,
      sourceNodeUrl: node6Url,
      archive,
    });
    expect(unsettled.pending).toEqual([0]);

    // V6's node stopped: the rig's cheat codes own the clock. V7 takes over, the window passes, V6 prunes.
    await user.stop();
    await rig.stopNode();
    const v7v = await rig.deployNext({ bump: 2n });
    await rig.flip(v7v);
    // Registering V6 stamped index 1 already (a registration syncs); V7's arrival is new.
    expect(await noteAllTransitions(v6.operator)).toEqual([2n]);
    const [epochDuration, slotDuration, window] = await Promise.all([
      rollup.read.getEpochDuration(),
      rollup.read.getSlotDuration(),
      rollup.read.getProofSubmissionEpochs(),
    ]);
    await rig.warpBy(Number(epochDuration) * Number(slotDuration) * (Number(window) + 2));
    expect(await rig.prune(v6v)).toBe(true);
    expect(await rollup.read.getPendingCheckpointNumber()).toBe(baseline);

    // On Ethereum: no root for that epoch, and a forward of the unsettled leaf says so.
    const outbox = getContract({
      address: v6v.outbox.toString() as Hex,
      abi: OutboxAbi,
      client: rig.publicClient,
    });
    // The root the epoch would carry with the pruned checkpoint in it was never written.
    expect(await outbox.read.getRootData([epoch, position])).toBe(`0x${'00'.repeat(32)}`);
    const V6 = BigInt(v6.deployment.rollupVersion);
    // As an exit to Ethereum, so the leaf reaches the Outbox (a send-ahead is refused first while no
    // later version is registered); the epoch and position are the pruned checkpoint's.
    const guess = {
      kind: 1 as const,
      amount: reward / 2n,
      aux: `0x${secrets.secretHash.toBuffer().toString('hex')}` as Hex,
      recipientOrRedeemKey: secrets.redeemAddress.toString() as Hex,
      epoch,
      numCheckpointsInEpoch: position,
      leafIndex: 0n,
      path: [] as Hex[],
      sig: '0x' as Hex,
      expiry: 0n,
    };
    expect(await revertName(forwarder.portal.simulate.forward([V6, guess], writeOpts(forwarder)))).toBe(
      'Outbox__NothingToConsumeAtEpoch',
    );
    expect(txHash.length).toBeGreaterThan(2);

    // V6 again, pinned. What the holder's wallet reads then depends on the node, not on the bridge:
    // a node that followed Ethereum through the prune has dropped the block and shows the reward
    // untouched; this toolchain's automine node keeps the orphaned block, and a node syncing from
    // scratch never gets past the pruned checkpoint. So the case asserts only that the version comes
    // back and serves, and the app promises nothing about an unsettled crossing beyond the facts above.
    const node6b = await rig.startNode(v6v, { autoProve: false });
    const info = await createAztecNodeClient(node6b.nodeUrl).getNodeInfo();
    expect(BigInt(info.rollupVersion)).toBe(v6v.version);
  }, 1_800_000);
});
