// The bridge page's read: the portal over the Ethereum RPC, with the extras the page draws (YACA's
// supply, every crossing's event with its block's time). A deployment without a portal has nothing to
// read; extras that fail leave the sentences standing.

import { scanLogs } from '@yacana/bridge/logs';
import { yacaAbi, yacanaPortalAbi } from '@yacana/bridge/portal';
import { portalReader } from '@yacana/bridge/portal-reader';
import type { BridgeRecord } from '@yacana/bridge/record';
import type { Hex, PublicClient } from 'viem';
import {
  type BridgeExtras,
  type BridgeSnapshot,
  type FlowEvent,
  readBridge,
  sampleBlocks,
} from './bridge-beat';

/** Blocks whose time is read; the rest are placed between their neighbours. */
const BLOCK_TIMES = 120;

export const bridgeRecord = (): BridgeRecord | null =>
  import.meta.env.VITE_BRIDGE ? (JSON.parse(import.meta.env.VITE_BRIDGE) as BridgeRecord) : null;

interface RawEvent {
  kind: FlowEvent['kind'];
  version: bigint;
  amount: bigint;
  block: bigint;
}

/** The time of every block in `blocks`: read for at most BLOCK_TIMES of them, the others placed between the read ones. */
async function blockTimes(client: PublicClient, blocks: bigint[]): Promise<Map<bigint, number>> {
  const sorted = [...new Set(blocks)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const picked = sampleBlocks(sorted, BLOCK_TIMES);
  const read = new Map<bigint, number>();
  await Promise.all(
    picked.map(async (b) => read.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp))),
  );
  const out = new Map<bigint, number>();
  for (const b of sorted) {
    const known = read.get(b);
    if (known !== undefined) {
      out.set(b, known);
      continue;
    }
    const before = picked.filter((p) => p < b).at(-1) as bigint;
    const after = picked.find((p) => p > b) as bigint;
    const [t0, t1] = [read.get(before) as number, read.get(after) as number];
    out.set(b, Math.round(t0 + ((t1 - t0) * Number(b - before)) / Number(after - before)));
  }
  return out;
}

async function readExtras(client: PublicClient, record: BridgeRecord): Promise<BridgeExtras> {
  const portal = { address: record.portal as Hex, abi: yacanaPortalAbi };
  const fromBlock = BigInt(record.deployBlock ?? 0);
  const toBlock = await client.getBlockNumber({ cacheTime: 0 });
  const [yacaSupply, forwarded, deposited, redeemed] = await Promise.all([
    client.readContract({ address: record.yaca as Hex, abi: yacaAbi, functionName: 'totalSupply' }),
    scanLogs(client, { ...portal, eventName: 'Forwarded', fromBlock, toBlock }),
    scanLogs(client, { ...portal, eventName: 'Deposited', fromBlock, toBlock }),
    scanLogs(client, { ...portal, eventName: 'Redeemed', fromBlock, toBlock }),
  ]);
  const raw: RawEvent[] = [
    ...forwarded.map((l) => ({
      kind: (l.args.kind === 2 ? 'send' : 'exit') as FlowEvent['kind'],
      version: l.args.version,
      amount: l.args.amount,
      block: l.blockNumber,
    })),
    ...deposited.map((l) => ({
      kind: 'deposit' as const,
      version: l.args.version,
      amount: l.args.amount,
      block: l.blockNumber,
    })),
    ...redeemed.map((l) => ({
      kind: 'redeem' as const,
      version: l.args.version,
      amount: l.args.amount,
      block: l.blockNumber,
    })),
  ];
  const times = await blockTimes(
    client,
    raw.map((e) => e.block),
  );
  const events = raw
    .map((e) => ({ kind: e.kind, version: e.version, amount: e.amount, at: times.get(e.block) ?? 0 }))
    .sort((a, b) => a.at - b.at);
  return { yacaSupply, events, lastCrossingAt: events.length ? (events.at(-1) as FlowEvent).at : null };
}

/** One read of the portal and its extras through `client`. */
export function bridgeSource(record: BridgeRecord, client: PublicClient): () => Promise<BridgeSnapshot> {
  const reader = portalReader(client, {
    portal: record.portal as Hex,
    registry: record.registry as Hex,
    deployBlock: BigInt(record.deployBlock ?? 0),
  });
  return async () => {
    const snapshot = await readBridge(reader);
    const extras = await readExtras(client, record).catch(() => undefined);
    return extras ? { ...snapshot, extras } : snapshot;
  };
}
