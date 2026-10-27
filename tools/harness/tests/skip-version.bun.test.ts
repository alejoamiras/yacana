// H7 — a version Yacana skips: the Registry moves V5 → V6 → V7 while Yacana registers no V6. A
// send-ahead from V5 forwards straight into V7, and V5's exits close on the later of the flip plus
// the floor and V7's observed activation — the deadline the portal computes from the transitions
// it stamped, whatever Yacana did with the version in between (H9's deadline boundary too).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { policyFor } from '@yacana/bridge/policy';
import { forwardArgsFromArchive, readArchive } from '@yacana/bridge/witness';
import { archivePath, forwardAll } from '@yacana/deploy/bridge/forward';
import { type Operator, writeOpts } from '@yacana/deploy/bridge/operator';
import { registerVersion } from '@yacana/deploy/bridge/register';
import { versionStatus } from '@yacana/deploy/bridge/status';
import { noteAllTransitions } from '@yacana/deploy/bridge/transition';
import { continuationOf } from '@yacana/deploy/deploy';
import { repoRoot } from '@yacana/localnet/toolchain';
import { type RigNode, startUpgradeRig, type UpgradeRig } from '@yacana/localnet/upgrade-rig';
import type { WorkProver } from '@yacana/miner-core/work';
import { revertName } from '../src/revert.ts';
import {
  balanceOf,
  claimFromL1,
  crossing,
  mineOnce,
  openUser,
  sendAhead,
  type User,
  workProver,
} from '../src/user.ts';
import { asForwarder, deployBridge, deployMiner, type MinerOnRig } from '../src/yacana.ts';

const enabled = process.env.YACANA_RIG === '1';

describe.skipIf(!enabled)('a skipped version (H7)', () => {
  let rig: UpgradeRig;
  let node5: RigNode;
  let v5: MinerOnRig;
  let user: User;
  let prover: WorkProver;
  let forwarder: Operator;
  let archive: string;
  let reward: bigint;

  beforeAll(async () => {
    rig = await startUpgradeRig();
    node5 = rig.node as RigNode;
    const bridge = await deployBridge(rig);
    v5 = await deployMiner(rig, node5, bridge);
    await registerVersion(v5.operator);
    forwarder = await asForwarder(rig, v5);
    archive = relative(repoRoot, `${rig.runRoot}/witnesses.jsonl`);
    user = await openUser(v5.deployment, node5.nodeUrl);
    prover = await workProver();
    reward = await mineOnce(user, prover);
  }, 900_000);

  afterAll(async () => {
    await prover?.destroy();
    await rig?.teardown();
  });

  test('V5 → V6 → V7 with V6 unregistered: the send-ahead lands on V7, the deadline follows V7', async () => {
    const V5 = BigInt(v5.deployment.rollupVersion);
    const half = reward / 2n;
    await sendAhead(user, half, 0);
    await sendAhead(user, reward / 4n, 1);
    await rig.warpBy(72 * 5);
    await rig.prove();
    expect(
      (await forwardAll(forwarder, { source: v5.deployment, sourceNodeUrl: node5.nodeUrl, archive })).pending,
    ).toEqual([]);

    // Two flips; Yacana never touches V6.
    const v6v = await rig.deployNext({ bump: 1n });
    await rig.flip(v6v);
    const v7v = await rig.deployNext({ bump: 2n });
    await rig.flip(v7v);
    expect(await noteAllTransitions(v5.operator)).toEqual([1n, 2n]);
    const status = await versionStatus(v5.operator, V5);
    expect(status.flipAt).toBeGreaterThan(0n);
    expect(status.afterNextAt).toBeGreaterThanOrEqual(status.flipAt);
    const floor = status.flipAt + policyFor().exitFloor;
    expect(status.deadline).toBe(
      (status.afterNextAt > floor ? status.afterNextAt : floor) + status.pausedSeconds,
    );

    // V7's miner is V5's continuation; V6 stays a Registry entry Yacana never registered.
    const continuation = await continuationOf(v5.recordPath, 'node-only');
    await user.stop();
    await rig.stopNode();
    const node7 = await rig.startNode(v7v);
    const v7 = await deployMiner(rig, node7, v5.deployment.bridge as never, { continuation });
    await registerVersion(v7.operator);
    expect((await versionStatus(v7.operator, BigInt(v7.deployment.rollupVersion))).registryIndex).toBe(2n);

    // The send-ahead forwards into V7 and is claimed there.
    const report = await forwardAll(forwarder, {
      source: v5.deployment,
      archive,
      fromArchive: true,
      target: v7.deployment,
    });
    expect(report.forwarded.map((f) => f.index).sort()).toEqual([0, 1]);
    await rig.nudge();
    const user7 = await openUser(v7.deployment, node7.nodeUrl);
    try {
      const first = report.forwarded.find((f) => f.index === 0);
      if (!first) throw new Error('send-ahead 0 not forwarded');
      const secrets = await crossing(user, 0);
      await claimFromL1(user7, half, secrets.secret, secrets.secretHash, first.inboxIndex, user7.from, 300);
      expect(await balanceOf(user7)).toBe(half);
    } finally {
      await user7.stop();
    }

    // Past the deadline, V5's remaining exit is refused; the deadline moved with nothing else.
    await rig.stopNode();
    const now = BigInt((await rig.publicClient.getBlock()).timestamp);
    await rig.warpBy(Number(status.deadline - now) + 60);
    const [, second] = readArchive(readFileSync(archivePath(v5.deployment.profile, archive), 'utf8'));
    if (!second) throw new Error('send-ahead 1 not archived');
    expect(
      await revertName(
        forwarder.portal.simulate.forward([V5, forwardArgsFromArchive(second)], writeOpts(forwarder)),
      ),
    ).toBe('DeadlinePassed');
  }, 1_800_000);
});
