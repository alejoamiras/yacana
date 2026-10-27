// The migration V5 → V6 in the runbook's order (H3): send-aheads on V5 wait while nothing later is
// registered; the flip; the transition observed; V5 retired on Ethereum and then on its own chain,
// after which no claim mints there; a send-ahead made after the flip still settles on V5 (H4); the
// old node stopped, V6 started, its miner deployed as V5's continuation and registered; a held
// send-ahead redeemed before V6 registered is nullified for good (H6); one K2 forwarded by the
// listed forwarder and one by the holder's own signature, none by a stranger (H11), all from the
// witness archive with the source node gone; every one claimed on V6; then a real claim on V6 at
// the epoch V5 left off.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { yacanaPortalAbi } from '@yacana/bridge/portal';
import { signForward, signRedeem } from '@yacana/bridge/signatures';
import { type ArchivedExit, forwardArgsFromArchive, readArchive } from '@yacana/bridge/witness';
import { archivePath, forwardAll } from '@yacana/deploy/bridge/forward';
import { type Operator, writeOpts } from '@yacana/deploy/bridge/operator';
import { pauseAll, unpause } from '@yacana/deploy/bridge/pause';
import { registerVersion } from '@yacana/deploy/bridge/register';
import { retireOnL1, retireOnL2 } from '@yacana/deploy/bridge/retire';
import { versionStatus } from '@yacana/deploy/bridge/status';
import { noteAllTransitions } from '@yacana/deploy/bridge/transition';
import { continuationOf, type Deployment } from '@yacana/deploy/deploy';
import { repoRoot } from '@yacana/localnet/toolchain';
import {
  type RigNode,
  type RigVersion,
  startUpgradeRig,
  type UpgradeRig,
} from '@yacana/localnet/upgrade-rig';
import { readOpenEpoch } from '@yacana/miner-core/epoch';
import type { WorkProver } from '@yacana/miner-core/work';
import { type Hex, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { errorName, revertName } from '../src/revert.ts';
import { balanceOf, claimFromL1, mineOnce, openUser, sendAhead, type User, workProver } from '../src/user.ts';
import { asForwarder, asStranger, deployBridge, deployMiner, type MinerOnRig } from '../src/yacana.ts';

const enabled = process.env.YACANA_RIG === '1';
/** Anvil accounts 3 and 4: an Ethereum recipient, and a stranger with no role on the portal. */
const RECIPIENT = privateKeyToAccount(
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
).address;
const STRANGER_KEY: Hex = '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a';

const reasonOf = (r: { reason: Hex }): string => errorName(r.reason);

describe.skipIf(!enabled)('the migration V5 → V6', () => {
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

  const settle = async () => {
    await rig.warpBy(72 * 5);
    await rig.prove();
  };
  const entries = () => readArchive(readFileSync(archivePath(v5.deployment.profile, archive), 'utf8'));

  test('H3 · H4 · H6 · H11: the whole migration', async () => {
    const V5 = BigInt(v5.deployment.rollupVersion);
    const portal = v5.deployment.bridge?.portal as Hex;
    const chainId = BigInt(v5.deployment.chainId);
    const slice = reward / 8n;
    // Three send-aheads before the flip (for the forwarder, for the holder's own signature, for an
    // early redeem) and one after it. The miner numbers exits in its own order; a crossing's secrets
    // are matched to its archive entry by the redeem address the send carried, never by that number.
    const sends = [
      await sendAhead(user, slice, 0),
      await sendAhead(user, slice, 1),
      await sendAhead(user, slice, 3),
    ];
    const entryOf = (s: (typeof sends)[number]) => {
      const key = s.secrets.redeemAddress.toString().toLowerCase();
      const e = entries().find((x) => x.recipientOrRedeemKey.toLowerCase() === key);
      if (!e) throw new Error(`send-ahead ${key} not archived`);
      return e;
    };
    const secretsOf = (redeemKey: string) => {
      const s = sends.find(
        (x) => x.secrets.redeemAddress.toString().toLowerCase() === redeemKey.toLowerCase(),
      );
      if (!s) throw new Error(`no send-ahead with redeem key ${redeemKey}`);
      return s.secrets;
    };
    await settle();
    const early = await forwardAll(forwarder, {
      source: v5.deployment,
      sourceNodeUrl: node5.nodeUrl,
      archive,
    });
    // The script holds every send-ahead until a target record names where they land; the portal
    // itself has no registered canonical to forward into yet.
    expect(early).toMatchObject({ forwarded: [], failed: [], refusedKind2: 'no target record' });
    expect(
      await revertName(
        forwarder.portal.simulate.forward(
          [V5, forwardArgsFromArchive(entries()[0] as ArchivedExit)],
          writeOpts(forwarder),
        ),
      ),
    ).toBe('NotForwardable');

    // The flip, observed; V5 retired on Ethereum, then on its own chain.
    const v6v: RigVersion = await rig.deployNext({ bump: 1n });
    await rig.flip(v6v);
    expect(await noteAllTransitions(v5.operator)).toEqual([1n]);
    expect((await versionStatus(v5.operator, V5)).flipAt).toBeGreaterThan(0n);
    // H4: a send-ahead after the flip, while V5 still settles.
    sends.push(await sendAhead(user, slice, 2));
    const sent = await retireOnL1(v5.operator, V5);
    await rig.nudge();
    await retireOnL2(user, portal, sent, 300);
    // Sent once: a rerun of the L1 step yields the same index from the log instead of a revert.
    expect(await retireOnL1(v5.operator, V5)).toMatchObject({ inboxIndex: sent.inboxIndex, resumed: true });
    expect(
      (await user.miner.methods.bridge_state().simulate({ from: user.from })) as { result: unknown[] },
    ).toMatchObject({ result: expect.arrayContaining([true]) });
    // No claim mints on a retired version: the miner's own refusal, not a prover or node failure.
    await expect(mineOnce(user, prover)).rejects.toThrow(/mining has ended on this version/);
    // The post-flip window: one more settled checkpoint on V5 carries the late send-ahead out.
    await settle();
    expect(
      (await forwardAll(forwarder, { source: v5.deployment, sourceNodeUrl: node5.nodeUrl, archive })).pending,
    ).toEqual([]);
    expect(
      entries()
        .map((e) => e.index)
        .sort(),
    ).toEqual([0, 1, 2, 3]);

    // H6: with no later version registered, the fourth is redeemed by its key alone.
    const held = entryOf(sends[2] as (typeof sends)[number]);
    const expiry = BigInt((await rig.publicClient.getBlock()).timestamp) + 3600n;
    const heldArgs = forwardArgsFromArchive(held);
    const redeemSig = await signRedeem(
      (sends[2] as (typeof sends)[number]).secrets.redeemKey,
      { chainId, portal, version: V5, expiry },
      heldArgs,
      RECIPIENT,
    );
    await rig.publicClient.waitForTransactionReceipt({
      hash: await forwarder.portal.write.redeem(
        [V5, heldArgs, RECIPIENT, expiry, redeemSig],
        writeOpts(forwarder),
      ),
    });
    expect(await v5.operator.yaca.read.balanceOf([RECIPIENT])).toBe(slice);

    // V5's continuation, read while its node still answers; then V5 paused and stopped, V6 started.
    const continuation = await continuationOf(v5.recordPath, 'node-only');
    await user.stop();
    await rig.stopNode();
    const node6 = await rig.startNode(v6v);
    const v6 = await deployMiner(rig, node6, v5.deployment.bridge as never, { continuation });
    await registerVersion(v6.operator);
    expect((await versionStatus(v6.operator, BigInt(v6.deployment.rollupVersion))).registryIndex).toBe(1n);

    // H11: a stranger's forward fails on the portal; the script refuses a target whose miner differs.
    const stranger = await asStranger(rig, v5, STRANGER_KEY);
    const strangerReport = await forwardAll(stranger, {
      source: v5.deployment,
      archive,
      fromArchive: true,
      target: v6.deployment,
    });
    expect(strangerReport.forwarded).toEqual([]);
    // No signature at all: the portal refuses on the (zero) expiry before it recovers a signer.
    expect(new Set(strangerReport.failed.map(reasonOf))).toEqual(new Set(['SignatureExpired']));
    const impostor: Deployment = { ...v6.deployment, miner: v5.deployment.miner };
    const refused = await forwardAll(forwarder, {
      source: v5.deployment,
      archive,
      fromArchive: true,
      target: impostor,
    });
    expect(refused.refusedKind2).toBe('the live miner is not the announced one');
    expect(refused.forwarded).toEqual([]);

    // The holder forwards one with the redeem key's signature, from any account; the forwarder does the rest.
    const one = entryOf(sends[1] as (typeof sends)[number]);
    const V6 = BigInt(v6.deployment.rollupVersion);
    // H9's other half: pauseAll reaches every registered version, not the record's alone.
    await pauseAll(v6.operator, 60n);
    expect((await versionStatus(v6.operator, V5)).paused).toBe(true);
    expect((await versionStatus(v6.operator, V6)).paused).toBe(true);
    for (const v of [V5, V6]) await unpause(v6.operator, v);
    const forwardExpiry = BigInt((await rig.publicClient.getBlock()).timestamp) + 3600n;
    const signed = {
      ...forwardArgsFromArchive(one),
      expiry: forwardExpiry,
      sig: await signForward(
        (sends[1] as (typeof sends)[number]).secrets.redeemKey,
        { chainId, portal, version: V5, expiry: forwardExpiry },
        forwardArgsFromArchive(one),
        V6,
      ),
    };
    const oneReceipt = await rig.publicClient.waitForTransactionReceipt({
      hash: await stranger.portal.write.forward([V5, signed], writeOpts(stranger)),
    });
    const [oneForwarded] = parseEventLogs({
      abi: yacanaPortalAbi,
      eventName: 'Forwarded',
      logs: oneReceipt.logs,
    });
    if (!oneForwarded) throw new Error('the signed forward emitted no Forwarded event');
    const rest = await forwardAll(forwarder, {
      source: v5.deployment,
      archive,
      fromArchive: true,
      target: v6.deployment,
    });
    expect(rest.forwarded.length).toBe(2);
    expect(rest.forwarded.map((f) => f.index)).not.toContain(one.index);
    expect(rest.failed).toEqual([]);
    // The redeemed one is nullified for good.
    expect(
      await forwardAll(forwarder, {
        source: v5.deployment,
        archive,
        fromArchive: true,
        target: v6.deployment,
      }),
    ).toMatchObject({
      forwarded: [],
      failed: [],
    });
    const inbound = (await versionStatus(v6.operator, V6)).inbound;
    expect(inbound).toBe(3n * slice);

    // Every forwarded send-ahead is claimed on V6 with the V5 secrets, to a V6 address chosen now.
    await rig.nudge();
    const user6 = await openUser(v6.deployment, node6.nodeUrl);
    try {
      const arrivals = [
        { index: one.index, inboxIndex: oneForwarded.args.inboxIndex },
        ...rest.forwarded.map((f) => ({ index: f.index, inboxIndex: f.inboxIndex })),
      ];
      const archived = entries();
      for (const a of arrivals) {
        const entry = archived.find((e) => e.index === a.index);
        if (!entry) throw new Error(`exit ${a.index} not archived`);
        const secrets = secretsOf(entry.recipientOrRedeemKey);
        await claimFromL1(user6, slice, secrets.secret, secrets.secretHash, a.inboxIndex, user6.from, 300);
      }
      expect(await balanceOf(user6)).toBe(3n * slice);
      // The schedule continued: V6's open epoch is the one after V5's last, and a real claim mints on it.
      expect((await readOpenEpoch(user6.miner, user6.from)).epoch).toBe(continuation.firstEpoch);
      await mineOnce(user6, prover);
      expect(await balanceOf(user6)).toBe(3n * slice + reward);
    } finally {
      await user6.stop();
    }
  }, 1_800_000);
});
