// The bridge for one local run, as every browser e2e wants it: the portal and YACA deployed
// against the network's real Registry, the deployment's version registered on the portal, the
// operators key listed as a forwarder, the record with its bridge block on disk for the operator
// functions. Anvil's account 1 pays and operates.
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { NODE_MAX_BATCH } from '@yacana/miner-core/node-client';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { deployL1 } from '../../scripts/l1-deploy.ts';
import type { BridgeRecord, Deployment } from '../deploy.ts';
import { openOperator } from './operator.ts';
import { noteRegistryIndex, registerVersion, setForwarder } from './register.ts';

/** Anvil account 1: the portal's operators and the run's listed forwarder. */
export const RUN_OPERATORS_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const repo = resolve(import.meta.dir, '../../../..');

/** The portal and YACA against the node's real Registry, before the miner is deployed with the portal's address. */
export async function deployBridgeForRun(nodeUrl: string, l1RpcUrl: string): Promise<BridgeRecord> {
  const info = await createAztecNodeClient(nodeUrl, { maxBatchSize: NODE_MAX_BATCH }).getNodeInfo();
  return deployL1({
    rpcUrl: l1RpcUrl,
    key: RUN_OPERATORS_KEY,
    registry: info.l1ContractAddresses.registryAddress.toString() as Hex,
    operators: privateKeyToAccount(RUN_OPERATORS_KEY).address,
  });
}

/**
 * The record with its bridge block at `recordFile` (repo-relative), the version registered, the
 * operators key a forwarder; `archiveFile` (repo-relative) is emptied for the run's witnesses.
 */
export async function registerForRun(
  deployed: Deployment,
  bridge: BridgeRecord,
  l1RpcUrl: string,
  files: { recordFile: string; archiveFile?: string },
): Promise<void> {
  writeFileSync(resolve(repo, files.recordFile), `${JSON.stringify({ ...deployed, bridge }, null, 2)}\n`);
  if (files.archiveFile) rmSync(resolve(repo, files.archiveFile), { force: true });
  const op = await openOperator({ record: files.recordFile, rpcUrl: l1RpcUrl, key: RUN_OPERATORS_KEY });
  noteRegistryIndex(op, (await registerVersion(op)).index);
  await setForwarder(op, privateKeyToAccount(RUN_OPERATORS_KEY).address, true);
}
