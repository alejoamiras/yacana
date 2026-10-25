// Records one accepted claim of a deployment for the landing's ledger, from the transaction's own
// effect on the node: deployments/<profile>.example-claim.json (and, with --keep-effect, the effect
// as the unit test's fixture). The node must be the record's deployment (chain, rollup, contracts).
//   AZTEC_NODE_URL=… bun tools/deploy/scripts/record-example-claim.ts <txHash> [deployments/<profile>.json] [--keep-effect <file>]
import { resolve } from 'node:path';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { TxHash } from '@aztec-labs/stdlib/tx';
import {
  assertDeployment,
  expectedFromStrings,
  readOpenEpochNumber,
  TABLE_EPOCHS,
} from '@yacana/miner-core/reader';
import { loadLayouts } from '@yacana/miner-core/slots';
import { effectView, exampleClaimFromEffect, sponsorFeeLeaf } from '../src/example-claim.ts';

const repo = resolve(import.meta.dir, '../../..');
const args = process.argv.slice(2);
const keepAt = args.indexOf('--keep-effect');
const keep = keepAt >= 0 ? args.splice(keepAt, 2)[1] : undefined;
const [txHash, recordPath = 'deployments/testnet.json'] = args;
if (!txHash || !/^0x[0-9a-f]{64}$/i.test(txHash))
  throw new Error('usage: record-example-claim.ts <txHash> [record]');

const record = (await Bun.file(resolve(repo, recordPath)).json()) as {
  nodeUrl?: string;
  miner: string;
  token: string;
  minerClassId: string;
  tokenClassId: string;
  chainId: string;
  rollupVersion: string;
  rollupAddress: string;
};
const nodeUrl = process.env.AZTEC_NODE_URL ?? record.nodeUrl;
if (!nodeUrl) throw new Error('AZTEC_NODE_URL is not set and the record names no node');
const node = createAztecNodeClient(nodeUrl);
const layout = (await loadLayouts()).miner;
// The node answers for the record's chain, rollup and contracts, or nothing is recorded from it.
await assertDeployment(node, expectedFromStrings(record), layout);
const effect = await node.getTxEffect(TxHash.fromString(txHash));
if (!effect) throw new Error(`no effect for ${txHash} on ${nodeUrl}`);
const view = effectView(effect);
if (view.txHash.toLowerCase() !== txHash.toLowerCase())
  throw new Error(`the node returned the effect of ${view.txHash}, not ${txHash}`);
const open = await readOpenEpochNumber(node, AztecAddress.fromStringUnsafe(record.miner), layout);
if (!Number.isSafeInteger(open) || open < 0 || open >= TABLE_EPOCHS)
  throw new Error(`the node reports open epoch ${open}: not an epoch this deployment can have`);
const claim = await exampleClaimFromEffect(
  view,
  { miner: record.miner, chainId: record.chainId, rollupVersion: record.rollupVersion },
  layout,
  open,
  await sponsorFeeLeaf(),
);
const out = resolve(repo, recordPath.replace(/\.json$/, '.example-claim.json'));
await Bun.write(out, `${JSON.stringify(claim, null, 2)}\n`);
if (keep)
  await Bun.write(resolve(repo, keep), `${JSON.stringify({ identity: claim, effect: view }, null, 2)}\n`);
console.log(
  `${out}: epoch ${claim.epoch}, claims ${claim.claims[0]} → ${claim.claims[1]}, block ${claim.block}`,
);
