// Yacana on the rig: the portal and YACA on the rig's anvil against its real Registry, a miner +
// token on whichever version's node is live, and the operator that drives them — every bridge
// action below goes through the operator script's own functions, so the cases exercise what the
// runbook says to run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { yacanaPortalAbi } from '@yacana/bridge/portal';
import { type Operator, openOperator } from '@yacana/deploy/bridge/operator';
import {
  type BridgeRecord,
  type Deployment,
  type DeployOverrides,
  deployYacana,
} from '@yacana/deploy/deploy';
import { deployL1 } from '@yacana/deploy/scripts/l1-deploy';
import { repoRoot } from '@yacana/localnet/toolchain';
import type { RigNode, UpgradeRig } from '@yacana/localnet/upgrade-rig';
import { createWalletClient, getContract, type Hex, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

/** Anvil account 2: the listed forwarder, distinct from the operators (account 1) and the publisher (0). */
export const FORWARDER_KEY: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
export const FORWARDER = privateKeyToAccount(FORWARDER_KEY).address;
/** Every other proof wins: the cases mine once, for a balance, not for the schedule. */
export const EASY_TARGET = 1n << 127n;

/** The portal + YACA on the rig's chain, the rig's signer as operators, account 2 listed as forwarder. */
export async function deployBridge(rig: UpgradeRig): Promise<BridgeRecord> {
  const bridge = await deployL1({
    rpcUrl: rig.l1RpcUrl,
    key: rig.signerKey,
    registry: rig.registry.toString() as Hex,
    operators: rig.signer.address,
  });
  const operators = createWalletClient({
    account: rig.signer,
    chain: foundry,
    transport: http(rig.l1RpcUrl),
  });
  const portal = getContract({ address: bridge.portal as Hex, abi: yacanaPortalAbi, client: operators });
  const hash = await portal.write.setForwarder([FORWARDER, true]);
  await rig.publicClient.waitForTransactionReceipt({ hash });
  return bridge;
}

export interface MinerOnRig {
  deployment: Deployment;
  /** Relative to the repo root: what the operator script and the harness both open. */
  recordPath: string;
  operator: Operator;
  deployerSecret: Fr;
}

/**
 * A Yacana deployment on the live node's version, its record written under the run dir with the
 * bridge block, and an operator opened on it with the rig's signer.
 */
export async function deployMiner(
  rig: UpgradeRig,
  node: RigNode,
  bridge: BridgeRecord,
  overrides: Pick<DeployOverrides, 'continuation' | 'launchAt'> = {},
): Promise<MinerOnRig> {
  const deployerSecret = Fr.random();
  const deployment = await deployYacana(node.nodeUrl, deployerSecret, Fr.random(), {
    initialTarget: EASY_TARGET,
    portal: EthAddress.fromString(bridge.portal),
    ...overrides,
  });
  const dir = join(rig.runRoot, 'records');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `v${deployment.rollupVersion}.json`);
  const record: Deployment = { ...deployment, bridge };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  const recordPath = relative(repoRoot, file);
  const operator = await openOperator({ record: recordPath, rpcUrl: rig.l1RpcUrl, key: rig.signerKey });
  return { deployment: record, recordPath, operator, deployerSecret };
}

/** The same record opened under the forwarder's key: what a forward is signed with. */
export const asForwarder = (rig: UpgradeRig, m: MinerOnRig): Promise<Operator> =>
  openOperator({ record: m.recordPath, rpcUrl: rig.l1RpcUrl, key: FORWARDER_KEY });

/** The record opened with a key that is neither operators nor forwarder: a stranger. */
export const asStranger = (rig: UpgradeRig, m: MinerOnRig, key: Hex): Promise<Operator> =>
  openOperator({ record: m.recordPath, rpcUrl: rig.l1RpcUrl, key });
