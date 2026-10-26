// The hero tile's reads: the open epoch, the twelve epochs before it, the supply and the block;
// genesis and the lottery in launch mode. One deadline per request and no transport retries, like
// the stats page; a failure keeps the last numbers.
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import {
  assertDeployment,
  DEFAULT_LIMITS,
  type EpochRow,
  epochExists,
  expectedFromStrings,
  linkRows,
  type Node,
  readEpochs,
  readGenesis,
  readLatestBlock,
  readLottery,
  readOpenEpochNumber,
  readTotalSupply,
  type SlotLoader,
  type StorageLayout,
} from '@yacana/miner-core/reader';
import { type Connection, expectedDeployment } from '@yacana/web-kit/browser/connection';
import { nodeClient } from '@yacana/web-kit/browser/node';
import { setNodeEndpoint } from '@yacana/web-kit/browser/node-guard';
import { chunkLoader, fetchLayouts } from '@yacana/web-kit/browser/slots';

/** Closed epochs shown before the open one. */
export const HISTORY = 12;
export const POLL_MS = 60_000;

export interface Reader {
  node: Node;
  miner: AztecAddress;
  token: AztecAddress;
  minerLayout: StorageLayout;
  tokenLayout: StorageLayout;
  load: SlotLoader;
  /** The chain's first epoch (0, or a continuation's start): the history never reaches below it. */
  first: number;
}

export interface Live {
  /** Ascending, contiguous, the open epoch last; empty when `historyError` says why. */
  rows: EpochRow[];
  historyError?: string;
  open: number;
  supply: bigint;
  block: { number: number; timestamp: number };
  readAt: number;
}

export interface Launch {
  genesis: { target: bigint; seed: bigint; launchAt: number };
  lottery: { mix: bigint; reveals: number };
}

export async function openReader(connection: Connection): Promise<Reader> {
  setNodeEndpoint(connection.nodeUrl, DEFAULT_LIMITS.timeoutMs);
  const node = nodeClient(connection.nodeUrl);
  const layout = await fetchLayouts();
  const expected = expectedDeployment();
  await assertDeployment(
    node,
    expectedFromStrings({
      chainId: expected.chainId.toString(),
      rollupVersion: expected.rollupVersion.toString(),
      rollupAddress: expected.rollupAddress,
      miner: connection.miner,
      minerClassId: expected.minerClassId,
      token: connection.token,
      tokenClassId: expected.tokenClassId,
    }),
    layout.miner,
  );
  return {
    node,
    miner: AztecAddress.fromStringUnsafe(connection.miner),
    token: AztecAddress.fromStringUnsafe(connection.token),
    minerLayout: layout.miner,
    tokenLayout: layout.token,
    load: chunkLoader(),
    first: connection.firstEpoch,
  };
}

/** The open epoch's read runs beside the history's lanes; together they stay within the default bound. */
const HISTORY_LIMITS = { ...DEFAULT_LIMITS, concurrency: DEFAULT_LIMITS.concurrency - 1 };

async function readRows(r: Reader, open: number): Promise<EpochRow[]> {
  const from = Math.max(r.first, open - HISTORY);
  const [history, current] = await Promise.all([
    from < open
      ? readEpochs(r.node, r.miner, { from, to: open - 1 }, r.load, { limits: HISTORY_LIMITS })
      : Promise.resolve([]),
    readEpochs(r.node, r.miner, { from: open, to: open }, r.load),
  ]);
  // Linked as one list: the last history row closes against the open epoch.
  return linkRows([...history, ...current]);
}

/** The fixed slots publish even when the rows cannot be read (a chunk that did not load, a lying node). */
export async function readLive(r: Reader): Promise<Live> {
  const [open, block, supply] = await Promise.all([
    readOpenEpochNumber(r.node, r.miner, r.minerLayout),
    readLatestBlock(r.node),
    readTotalSupply(r.node, r.token, r.tokenLayout),
  ]);
  const fixed = { open, supply, block, readAt: Date.now() };
  try {
    return { ...fixed, rows: await readRows(r, open) };
  } catch (e) {
    return { ...fixed, rows: [], historyError: e instanceof Error ? e.message : String(e) };
  }
}

export const readLaunch = async (r: Reader): Promise<Launch> => {
  const [genesis, lottery] = await Promise.all([
    readGenesis(r.node, r.miner, r.minerLayout),
    readLottery(r.node, r.miner, r.minerLayout),
  ]);
  return { genesis, lottery };
};

/** Whether `launch()` has opened epoch 0. */
export const readLaunched = (r: Reader): Promise<boolean> => epochExists(r.node, r.miner, 0, r.load);
