// Epoch history of a deployment read straight from public storage (no wallet, no PXE), through
// the same reader the stats page uses: per epoch its target, opening time, claim count, duration,
// retarget ratio and what closed it.
//   AZTEC_NODE_URL=… bun tools/deploy/scripts/epoch-stats.ts [deployments/<profile>.json] [--json out.json]
import { resolve } from 'node:path';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { PROFILE } from '@yacana/miner-core/generated/params';
import { difficulty } from '@yacana/miner-core/metrics';
import { NODE_MAX_BATCH } from '@yacana/miner-core/node-client';
import {
  DEFAULT_LIMITS,
  type EpochRow,
  linkRows,
  readEpochs,
  readOpenEpochNumber,
  rowsToJson,
} from '@yacana/miner-core/reader';
import { deriveSlotTable, loadLayouts } from '@yacana/miner-core/slots';

const repo = resolve(import.meta.dir, '../../..');

/**
 * Every epoch from the first (0, or where a continuation started: it has none before) to the open
 * one, oldest first; the slots are derived here, not fetched.
 */
export async function epochStats(nodeUrl: string, minerAddress: string, first = 0): Promise<EpochRow[]> {
  const node = createAztecNodeClient(nodeUrl, { maxBatchSize: NODE_MAX_BATCH });
  const miner = AztecAddress.fromStringUnsafe(minerAddress);
  const layout = (await loadLayouts()).miner;
  const open = await readOpenEpochNumber(node, miner, layout);
  const load = (chunk: number) => deriveSlotTable(layout, chunk);
  const rows: EpochRow[] = [];
  for (let from = first; from <= open; from += DEFAULT_LIMITS.maxEpochs)
    rows.push(...(await readEpochs(node, miner, { from, to: open }, load)));
  // Linked once whole: a batch boundary must not leave an epoch looking open.
  return linkRows(rows);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
  const file = args.find((a) => a.endsWith('.json') && a !== jsonOut) ?? `deployments/${PROFILE}.json`;
  const deployment = (await Bun.file(resolve(repo, file)).json()) as {
    miner: string;
    nodeUrl: string;
    continuation?: { firstEpoch: string };
  };
  const nodeUrl = process.env.AZTEC_NODE_URL ?? deployment.nodeUrl;
  const rows = await epochStats(nodeUrl, deployment.miner, Number(deployment.continuation?.firstEpoch ?? 0));
  console.log('epoch  claims  opened_at (UTC)       duration  retarget  difficulty  closed by');
  for (const r of rows) {
    const opened = new Date(r.openedAt * 1000).toISOString().slice(0, 19);
    const dur = r.duration === null ? '   open' : `${String(r.duration).padStart(6)} s`;
    const rt = r.retarget === null ? '      –' : `×${r.retarget.toFixed(3)}`;
    console.log(
      `${String(r.epoch).padStart(5)}  ${String(r.claims).padStart(6)}  ${opened}  ${dur}  ${rt}  ${difficulty(r.target).toFixed(1).padStart(10)}  ${r.closedBy ?? '–'}`,
    );
  }
  if (jsonOut) await Bun.write(resolve(jsonOut), rowsToJson(rows));
}
