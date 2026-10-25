// Amends an existing deployment record with the L1 rollup address its node reports; deployments
// made from now on record it themselves. One read from the record's own node, refused if the
// node's chain id or rollup version differ from the record's.
//
//   bun tools/deploy/scripts/record-rollup-address.ts [deployments/<profile>.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import type { Deployment } from '../src/deploy.ts';

const path = resolve(process.argv[2] ?? 'deployments/testnet.json');
const record = JSON.parse(readFileSync(path, 'utf8')) as Partial<Deployment> & Record<string, unknown>;
if (!record.nodeUrl) throw new Error(`${path} has no nodeUrl`);
const node = createAztecNodeClient(process.env.AZTEC_NODE_URL ?? record.nodeUrl);
const [chainId, info] = await Promise.all([node.getChainId(), node.getNodeInfo()]);
if (String(chainId) !== record.chainId)
  throw new Error(`the node is on chain ${chainId}, the record says ${record.chainId}`);
if (String(info.rollupVersion) !== record.rollupVersion)
  throw new Error(
    `the node runs rollup version ${info.rollupVersion}, the record says ${record.rollupVersion}`,
  );
const rollupAddress = info.l1ContractAddresses.rollupAddress.toString();
if (record.rollupAddress && record.rollupAddress !== rollupAddress)
  throw new Error(
    `the record already names rollup ${record.rollupAddress}, the node reports ${rollupAddress}`,
  );
// Keep the key order stable: the address sits with the other identity fields.
const out: Record<string, unknown> = {};
for (const [k, v] of Object.entries(record)) {
  out[k] = v;
  if (k === 'rollupVersion') out.rollupAddress = rollupAddress;
}
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${path}: rollupAddress ${rollupAddress}`);
