// K3 — YACA on Ethereum comes back to Aztec: a holder deposits into the live version naming the
// version they reviewed and a deadline, the message becomes consumable on the next blocks, the
// claim mints privately to an address chosen at claim time (H2); once deposits close, the next
// one is refused.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { relative } from 'node:path';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { yacanaPortalAbi } from '@yacana/bridge/portal';
import { portalReader } from '@yacana/bridge/portal-reader';
import { forwardAll } from '@yacana/deploy/bridge/forward';
import type { Operator } from '@yacana/deploy/bridge/operator';
import { closeDeposits } from '@yacana/deploy/bridge/pause';
import { registerVersion } from '@yacana/deploy/bridge/register';
import { versionStatus } from '@yacana/deploy/bridge/status';
import { repoRoot } from '@yacana/localnet/toolchain';
import { type RigNode, startUpgradeRig, type UpgradeRig } from '@yacana/localnet/upgrade-rig';
import type { WorkProver } from '@yacana/miner-core/work';
import { createWalletClient, getContract, type Hex, http, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { errorName, revertName } from '../src/revert.ts';
import {
  balanceOf,
  claimFromL1,
  crossing,
  exitToL1,
  mineOnce,
  openUser,
  type User,
  workProver,
} from '../src/user.ts';
import { asForwarder, deployBridge, deployMiner, type MinerOnRig } from '../src/yacana.ts';

const enabled = process.env.YACANA_RIG === '1';
/** Anvil account 3: the YACA holder on Ethereum. */
const HOLDER_KEY = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';

describe.skipIf(!enabled)('a deposit from Ethereum (H2)', () => {
  let rig: UpgradeRig;
  let node: RigNode;
  let v5: MinerOnRig;
  let user: User;
  let prover: WorkProver;
  let forwarder: Operator;
  let reward: bigint;
  const holder = privateKeyToAccount(HOLDER_KEY);

  beforeAll(async () => {
    rig = await startUpgradeRig();
    node = rig.node as RigNode;
    const bridge = await deployBridge(rig);
    v5 = await deployMiner(rig, node, bridge);
    await registerVersion(v5.operator);
    forwarder = await asForwarder(rig, v5);
    user = await openUser(v5.deployment, node.nodeUrl);
    prover = await workProver();
    reward = await mineOnce(user, prover);
    // YACA on Ethereum to deposit: one exit, settled and forwarded.
    await exitToL1(user, reward / 2n, EthAddress.fromString(holder.address), 0);
    await rig.warpBy(72 * 5);
    await rig.prove();
    const archive = relative(repoRoot, `${rig.runRoot}/witnesses.jsonl`);
    const report = await forwardAll(forwarder, {
      source: v5.deployment,
      sourceNodeUrl: node.nodeUrl,
      archive,
    });
    expect(report.failed.map((f) => errorName(f.reason))).toEqual([]);
    expect(report.forwarded.length).toBe(1);
  }, 900_000);

  afterAll(async () => {
    await prover?.destroy();
    await user?.stop();
    await rig?.teardown();
  });

  test('a deposit lands on the version it named and is claimed to an address chosen at claim time', async () => {
    const version = BigInt(v5.deployment.rollupVersion);
    const amount = reward / 4n;
    const wallet = createWalletClient({ account: holder, chain: foundry, transport: http(rig.l1RpcUrl) });
    const portal = getContract({
      address: v5.deployment.bridge?.portal as `0x${string}`,
      abi: yacanaPortalAbi,
      client: { public: rig.publicClient, wallet },
    });
    // The depositor's secret comes from their own wallet master on this version, like any crossing.
    const secrets = await crossing(user, 7);
    const deadline = BigInt((await rig.publicClient.getBlock()).timestamp) + 3600n;
    const hash = await portal.write.deposit([
      amount,
      `0x${secrets.secretHash.toBuffer().toString('hex')}`,
      version,
      deadline,
    ]);
    const receipt = await rig.publicClient.waitForTransactionReceipt({ hash });
    const [deposited] = parseEventLogs({ abi: yacanaPortalAbi, eventName: 'Deposited', logs: receipt.logs });
    if (!deposited) throw new Error('no Deposited event');
    expect(deposited.args.amount).toBe(amount);
    // What the page's landing scan reads from the same log: the deposit, with who made it.
    const bridge = v5.operator.record.bridge;
    const found = await portalReader(rig.publicClient, {
      portal: bridge.portal as Hex,
      registry: bridge.registry as Hex,
      deployBlock: BigInt(bridge.deployBlock ?? 0),
    }).arrivals();
    expect(found.deposited).toEqual([
      expect.objectContaining({ sender: holder.address, amount, inboxIndex: deposited.args.inboxIndex }),
    ]);
    expect(await v5.operator.yaca.read.balanceOf([holder.address])).toBe(reward / 2n - amount);
    // H8: what exists on Ethereum is what left Aztec minus what went back, and the headroom follows.
    const after = await versionStatus(v5.operator, version);
    expect(after.inbound).toBe(amount);
    expect(after.exited).toBe(reward / 2n);
    expect(await v5.operator.yaca.read.totalSupply()).toBe(after.exited - after.inbound);
    expect(after.headroom).toBe(after.cap + after.inbound - after.exited);

    // The message is in the Inbox; the next blocks make it consumable, then the claim mints.
    await rig.nudge();
    const before = await balanceOf(user);
    await claimFromL1(user, amount, secrets.secret, secrets.secretHash, deposited.args.inboxIndex);
    expect(await balanceOf(user)).toBe(before + amount);
    // The same message cannot be claimed twice.
    await expect(
      claimFromL1(user, amount, secrets.secret, secrets.secretHash, deposited.args.inboxIndex),
    ).rejects.toThrow();

    // A stale review (a deadline in the past) and a closed door are both refused before any burn.
    expect(
      await revertName(
        portal.simulate.deposit([1n, `0x${'00'.repeat(32)}`, version, deadline - 7200n], { account: holder }),
      ),
    ).toBe('DeadlineExpired');
    await closeDeposits(v5.operator, version);
    expect(
      await revertName(
        portal.simulate.deposit([1n, `0x${'00'.repeat(32)}`, version, deadline], { account: holder }),
      ),
    ).toBe('DepositsAreClosed');
  }, 900_000);
});
