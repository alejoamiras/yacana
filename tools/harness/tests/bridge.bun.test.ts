// The bridge on one version, no flip: a mined balance leaves to Ethereum and comes back as YACA
// (H1), the same leaf never twice, the counters and the supply agree (H8); a held send-ahead is
// redeemed by its key's word alone while no later version exists (H6); the brake and the bound
// hold (H9); an exit from a miner the portal never registered is unconsumable (H10).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { policyFor } from '@yacana/bridge/policy';
import { yacanaPortalAbi } from '@yacana/bridge/portal';
import { signRedeem } from '@yacana/bridge/signatures';
import { type ArchivedExit, forwardArgsFromArchive, readArchive } from '@yacana/bridge/witness';
import { archiveExits, archivePath, forwardAll } from '@yacana/deploy/bridge/forward';
import { type Operator, writeOpts } from '@yacana/deploy/bridge/operator';
import { pause, pauseAll, unpause } from '@yacana/deploy/bridge/pause';
import { registerVersion } from '@yacana/deploy/bridge/register';
import { versionStatus } from '@yacana/deploy/bridge/status';
import { repoRoot } from '@yacana/localnet/toolchain';
import { type RigNode, startUpgradeRig, type UpgradeRig } from '@yacana/localnet/upgrade-rig';
import type { WorkProver } from '@yacana/miner-core/work';
import { type Hex, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { errorName, revertName } from '../src/revert.ts';
import { balanceOf, exitToL1, mineOnce, openUser, sendAhead, type User, workProver } from '../src/user.ts';
import { asForwarder, deployBridge, deployMiner, type MinerOnRig } from '../src/yacana.ts';

const enabled = process.env.YACANA_RIG === '1';
/** Anvil account 3: an Ethereum recipient with no other role. */
const RECIPIENT = privateKeyToAccount(
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
).address;

describe.skipIf(!enabled)('the bridge on one version', () => {
  let rig: UpgradeRig;
  let node: RigNode;
  let v5: MinerOnRig;
  let user: User;
  let prover: WorkProver;
  let forwarder: Operator;
  let archive: string;
  let reward: bigint;

  beforeAll(async () => {
    rig = await startUpgradeRig();
    node = rig.node as RigNode;
    const bridge = await deployBridge(rig);
    v5 = await deployMiner(rig, node, bridge);
    await registerVersion(v5.operator);
    forwarder = await asForwarder(rig, v5);
    archive = relative(repoRoot, `${rig.runRoot}/witnesses.jsonl`);
    user = await openUser(v5.deployment, node.nodeUrl);
    prover = await workProver();
    reward = await mineOnce(user, prover);
  }, 900_000);

  afterAll(async () => {
    await prover?.destroy();
    await user?.stop();
    await rig?.teardown();
  });

  const settle = async () => {
    await rig.warpBy(72 * 5);
    await rig.prove();
  };
  const forward = (op = forwarder) =>
    forwardAll(op, { source: v5.deployment, sourceNodeUrl: node.nodeUrl, archive });

  test('H1: an exit to Ethereum mints YACA there once; the counters and the supply agree', async () => {
    const before = await balanceOf(user);
    expect(before).toBe(reward);
    const half = reward / 2n;
    await exitToL1(user, half, EthAddress.fromString(RECIPIENT), 0);
    expect(await balanceOf(user)).toBe(reward - half);

    // The local network settles on its own; after a warp and a prove the exit's epoch is on Ethereum.
    await settle();
    // The first forward of a version is the expensive one (every counter, balance and bitmap word
    // cold): the estimate is what the per-leaf gas bound must clear.
    const { entries } = await archiveExits({ source: v5.deployment, sourceNodeUrl: node.nodeUrl, archive });
    const cold = await forwarder.portal.estimateGas.forward(
      [BigInt(v5.deployment.rollupVersion), forwardArgsFromArchive(entries[0] as ArchivedExit)],
      writeOpts(forwarder),
    );
    console.info(`H1 cold forward gas estimate: ${cold}`);
    expect(cold).toBeLessThan(policyFor().leafGas);
    const report = await forward();
    expect(report.pending).toEqual([]);
    expect(report.failed.map((f) => errorName(f.reason))).toEqual([]);
    expect(report.forwarded.map((f) => f.index)).toEqual([0]);
    expect(await v5.operator.yaca.read.balanceOf([RECIPIENT])).toBe(half);
    expect(await v5.operator.yaca.read.totalSupply()).toBe(half);
    const status = await versionStatus(v5.operator, BigInt(v5.deployment.rollupVersion));
    expect(status.exited).toBe(half);
    expect(status.inbound).toBe(0n);
    expect(status.cap).toBeGreaterThanOrEqual(policyFor().allowance);
    expect(status.headroom).toBe(status.cap - half);

    // Replay: the script skips a consumed leaf, and the portal refuses it outright.
    expect((await forward()).forwarded).toEqual([]);
    const [entry] = readArchive(readFileSync(archivePath(v5.deployment.profile, archive), 'utf8'));
    const version = BigInt(v5.deployment.rollupVersion);
    expect(
      await revertName(
        forwarder.portal.simulate.forward(
          [version, forwardArgsFromArchive(entry as never)],
          writeOpts(forwarder),
        ),
      ),
    ).toBe('Outbox__AlreadyNullified');
  }, 900_000);

  test('H6: with no later version registered, a send-ahead is redeemed by its key at once', async () => {
    const amount = reward / 4n;
    const { secrets } = await sendAhead(user, amount, 1);
    await settle();
    const report = await forward();
    // Nothing to forward it into: the script holds it without a target record, and the portal
    // itself has no registered canonical to take it; it stays in the archive.
    expect(report).toMatchObject({ forwarded: [], failed: [], refusedKind2: 'no target record' });
    const entries = readArchive(readFileSync(archivePath(v5.deployment.profile, archive), 'utf8'));
    const held = entries.find((e) => e.index === 1);
    if (!held) throw new Error('the send-ahead was not archived');
    const version = BigInt(v5.deployment.rollupVersion);
    const args = forwardArgsFromArchive(held);
    expect(await revertName(forwarder.portal.simulate.forward([version, args], writeOpts(forwarder)))).toBe(
      'NotForwardable',
    );
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 24 * 3600 * 400);
    const portal = v5.deployment.bridge?.portal as Hex;
    const sig = await signRedeem(
      secrets.redeemKey,
      { chainId: BigInt(v5.deployment.chainId), portal, version, expiry },
      args,
      RECIPIENT,
    );
    const supplyBefore = await v5.operator.yaca.read.totalSupply();
    const hash = await forwarder.portal.write.redeem(
      [version, args, RECIPIENT, expiry, sig],
      writeOpts(forwarder),
    );
    const receipt = await rig.publicClient.waitForTransactionReceipt({ hash });
    const [redeemed] = parseEventLogs({ abi: yacanaPortalAbi, eventName: 'Redeemed', logs: receipt.logs });
    expect(redeemed?.args.amount).toBe(amount);
    expect((await v5.operator.yaca.read.totalSupply()) - supplyBefore).toBe(amount);
    // A wrong recipient under the same signature, and the same leaf again, are both refused.
    expect(
      await revertName(
        forwarder.portal.simulate.redeem(
          [version, args, forwarder.account?.address as Hex, expiry, sig],
          writeOpts(forwarder),
        ),
      ),
    ).toBe('NotAuthorised');
    expect(
      await revertName(
        forwarder.portal.simulate.redeem([version, args, RECIPIENT, expiry, sig], writeOpts(forwarder)),
      ),
    ).toBe('Outbox__AlreadyNullified');
  }, 900_000);

  test('H9: a pause holds exits and the budget is charged; pauseAll covers every version', async () => {
    const version = BigInt(v5.deployment.rollupVersion);
    const amount = reward / 8n;
    await exitToL1(user, amount, EthAddress.fromString(RECIPIENT), 2);
    await settle();
    await pause(v5.operator, version, 600n);
    const paused = await versionStatus(v5.operator, version);
    expect(paused.paused).toBe(true);
    expect(paused.pausedSeconds).toBe(600n);
    const held = await forward();
    expect(held.forwarded).toEqual([]);
    expect(held.failed.map((f) => errorName(f.reason))).toEqual(['VersionPaused']);
    await unpause(v5.operator, version);
    const released = await versionStatus(v5.operator, version);
    expect(released.paused).toBe(false);
    expect(released.pausedSeconds).toBeLessThan(600n);
    const report = await forward();
    expect(report.forwarded.map((f) => f.index)).toEqual([2]);
    // pauseAll: over the maximum is refused; within it, every registered version pauses.
    expect(
      await revertName(
        v5.operator.portal.simulate.pauseAll([policyFor().pauseMax + 1n], writeOpts(v5.operator)),
      ),
    ).toBe('PauseTooLong');
    await pauseAll(v5.operator, 60n);
    expect((await versionStatus(v5.operator, version)).paused).toBe(true);
    await unpause(v5.operator, version);
  }, 900_000);

  test('H10: an exit from a miner the portal never registered cannot be consumed', async () => {
    const other = await deployMiner(rig, node, v5.deployment.bridge as never);
    const stranger = await openUser(other.deployment, node.nodeUrl);
    try {
      await mineOnce(stranger, prover);
      await exitToL1(stranger, reward / 2n, EthAddress.fromString(RECIPIENT), 0);
      await settle();
      const report = await forwardAll(forwarder, {
        source: other.deployment,
        sourceNodeUrl: node.nodeUrl,
        archive: relative(repoRoot, `${rig.runRoot}/witnesses-other.jsonl`),
      });
      // Same version, another sender: the portal consumes under its registered miner, and that leaf is not in the tree.
      expect(report.forwarded).toEqual([]);
      expect(report.failed.map((f) => errorName(f.reason))).toEqual(['MerkleLib__InvalidRoot']);
    } finally {
      await stranger.stop();
    }
  }, 900_000);
});
