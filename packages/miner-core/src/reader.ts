// Node-only reads shared by every surface (no wallet, no PXE): the boot check that the node
// serves the deployment the build was made for, and the epoch history straight from public
// storage through a precomputed slot table. No hashing here: a page must never pull bb.js in
// through this module (the table is derived in slots.ts, Bun-side).
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import type { createAztecNodeClient } from '@aztec/aztec.js/node';
import { EthAddress } from '@aztec/foundation/eth-address';
import type { ContractArtifact } from '@aztec/stdlib/abi';
import { PARAMS } from './generated/params.ts';

export type Node = ReturnType<typeof createAztecNodeClient>;
export type StorageLayout = ContractArtifact['storageLayout'];

/** `{ name: slotHex }` (the committed `fixtures/storage-layout.json`, the page's `layouts.json`) → a layout. */
export const layoutFromSlots = (slots: Record<string, string>): StorageLayout =>
  Object.fromEntries(Object.entries(slots).map(([name, slot]) => [name, { slot: Fr.fromString(slot) }]));

export interface Layouts {
  miner: StorageLayout;
  token: StorageLayout;
}

export const layoutsFromJson = (text: string): Layouts => {
  const j = JSON.parse(text) as Record<'miner' | 'token', Record<string, string>>;
  return { miner: layoutFromSlots(j.miner), token: layoutFromSlots(j.token) };
};

export interface ExpectedDeployment {
  chainId: bigint;
  rollupVersion: bigint;
  /** The L1 rollup contract, lower-case hex; with the chain id and the version it names the network. */
  rollupAddress: string;
  miner: AztecAddress;
  minerClassId: Fr;
  token: AztecAddress;
  tokenClassId: Fr;
}

export const fixedSlot = (layout: StorageLayout, name: string): Fr => {
  const slot = layout[name]?.slot;
  if (!slot) throw new Error(`storage layout lacks ${name}`);
  return slot;
};

/**
 * The chain, the rollup (version and L1 address), both instances, both classes, and the miner's
 * immutable `token` slot must match the build: a node that serves another deployment (or a fork
 * sharing addresses) is refused before any read. Answered by the node under test: a consistency
 * check, not an authentication of the chain.
 */
export async function assertDeployment(
  node: Node,
  expected: ExpectedDeployment,
  minerLayout: StorageLayout,
): Promise<void> {
  const [chainId, info] = await Promise.all([node.getChainId(), node.getNodeInfo()]);
  if (BigInt(chainId) !== expected.chainId)
    throw new Error(`node is on chain ${chainId}, this build expects ${expected.chainId}`);
  if (BigInt(info.rollupVersion) !== expected.rollupVersion)
    throw new Error(
      `node runs rollup version ${info.rollupVersion}, this build expects ${expected.rollupVersion}`,
    );
  const rollup = info.l1ContractAddresses.rollupAddress.toString().toLowerCase();
  if (rollup !== expected.rollupAddress.toLowerCase())
    throw new Error(`node serves rollup ${rollup}, this build expects ${expected.rollupAddress}`);
  for (const [name, address, classId] of [
    ['miner', expected.miner, expected.minerClassId],
    ['token', expected.token, expected.tokenClassId],
  ] as const) {
    const instance = await node.getContract(address);
    if (!instance) throw new Error(`no ${name} contract at ${address} on this node`);
    if (!instance.currentContractClassId.equals(classId))
      throw new Error(
        `${name} at ${address} has class ${instance.currentContractClassId}, this build expects ${classId}`,
      );
  }
  const bound = await node.getPublicStorageAt('latest', expected.miner, fixedSlot(minerLayout, 'token'));
  if (!bound.equals(expected.token.toField()))
    throw new Error(`the miner's bound token is ${bound}, this build expects ${expected.token}`);
}

/** Parses the build's deployment identity; every field must be a well-formed hex value. */
export const expectedFromStrings = (s: {
  chainId: string;
  rollupVersion: string;
  rollupAddress: string;
  miner: string;
  minerClassId: string;
  token: string;
  tokenClassId: string;
}): ExpectedDeployment => ({
  chainId: BigInt(s.chainId),
  rollupVersion: BigInt(s.rollupVersion),
  rollupAddress: EthAddress.fromString(s.rollupAddress).toString(),
  miner: AztecAddress.fromStringUnsafe(s.miner),
  minerClassId: Fr.fromString(s.minerClassId),
  token: AztecAddress.fromStringUnsafe(s.token),
  tokenClassId: Fr.fromString(s.tokenClassId),
});

/** One closed or open epoch as public storage records it; `duration`/`retarget`/`closedBy` need the next one. */
export interface EpochRow {
  epoch: number;
  target: bigint;
  openedAt: number;
  claims: number;
  /** Only when asked for (a fourth read per epoch). */
  seed?: bigint;
  /** Seconds until the next epoch opened; null for the open one. */
  duration: number | null;
  /** target[e + 1] / target[e]; null for the open one. */
  retarget: number | null;
  /** An epoch that closed with fewer than N claims was closed by roll(). */
  closedBy: 'claims' | 'roll' | null;
}

/** The map slots of `epochs[e]` and `claims[e]` for CHUNK consecutive epochs from `first`. */
export interface SlotTable {
  first: number;
  epochs: Fr[];
  claims: Fr[];
}

export type SlotLoader = (chunk: number) => Promise<SlotTable>;

export interface ReadLimits {
  /** Reads in flight at once. */
  concurrency: number;
  /** Each read's deadline from when it is asked for; `Infinity` for none, where the client bounds its requests. */
  timeoutMs: number;
  /** Epochs per `readEpochs` call. */
  maxEpochs: number;
}

export const CHUNK = 512;
/** Epochs the generated slot table covers: 2.5 years of testnet epochs, 30 of mainnet's. */
export const TABLE_EPOCHS = 512 * CHUNK;
export const DEFAULT_LIMITS: ReadLimits = { concurrency: 8, timeoutMs: 10_000, maxEpochs: 96 };

const U128 = (1n << 128n) - 1n;
/** The last unix second a `Date` can hold (8.64e15 ms); a u64 goes far past it. */
const MAX_UNIX = 8_640_000_000_000n;

/** A chain timestamp the pages will hand to `Date`: anything larger is a lying node, not a time. */
export function assertTimestamp(what: string, value: bigint): bigint {
  if (value > MAX_UNIX) throw new Error(`${what} ${value} is not a timestamp`);
  return value;
}

/** The node's latest block: its number and slot time (unix s), the timestamp checked like every other. */
export async function readLatestBlock(node: Node): Promise<{ number: number; timestamp: number }> {
  const data = await node.getBlockData('latest');
  if (!data) throw new Error('the node has no latest block');
  const g = data.header.globalVariables;
  return {
    number: Number(g.blockNumber),
    timestamp: Number(assertTimestamp('the latest block', BigInt(g.timestamp))),
  };
}

/** What the contract can have written; anything else is a node lying or a wrong slot, not data. */
function checkRow(e: number, target: bigint, openedAt: bigint, claims: bigint): void {
  if (target < 1n || target > U128) throw new Error(`epoch ${e}: target ${target} is not a u128 above zero`);
  assertTimestamp(`epoch ${e}: opened_at`, openedAt);
  if (claims > BigInt(PARAMS.N)) throw new Error(`epoch ${e}: ${claims} claims, more than N`);
}

export const slotTableToJson = (t: SlotTable): string =>
  JSON.stringify({
    first: t.first,
    epochs: t.epochs.map((f) => f.toString()),
    claims: t.claims.map((f) => f.toString()),
  });

export function slotTableFromJson(text: string, chunk: number): SlotTable {
  const j = JSON.parse(text) as { first?: unknown; epochs?: unknown; claims?: unknown };
  const hexes = (v: unknown): Fr[] => {
    if (!Array.isArray(v) || v.length !== CHUNK) throw new Error(`slot chunk ${chunk} is malformed`);
    return v.map((h) => Fr.fromString(String(h)));
  };
  if (j.first !== chunk * CHUNK) throw new Error(`slot chunk ${chunk} is malformed`);
  return { first: j.first, epochs: hexes(j.epochs), claims: hexes(j.claims) };
}

// A timer armed with `Infinity` fires at once: an infinite deadline arms none.
const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Number.isFinite(ms)
    ? new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${what}: no answer in ${ms / 1000} s`)), ms);
        p.then(resolve, reject).finally(() => clearTimeout(t));
      })
    : p;

/**
 * `fn` over `items`, at most `concurrency` calls of it in flight, results in order. The first
 * failure stops the hand-out; the calls in flight finish before it is thrown, so nothing of a
 * failed batch is still running when the caller hears of it.
 */
async function pooled<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failure: { error: unknown } | undefined;
  const lane = async () => {
    for (let i = next++; i < items.length && !failure; i = next++) {
      try {
        out[i] = await fn(items[i] as T);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  if (failure) throw failure.error;
  return out;
}

export const readSlot = (node: Node, contract: AztecAddress, slot: Fr, limits: ReadLimits): Promise<Fr> =>
  withTimeout(
    node.getPublicStorageAt('latest', contract, slot),
    limits.timeoutMs,
    `slot ${slot.toString().slice(0, 10)}`,
  );

/** Whether `epoch` exists on chain: its target is written when it opens, zero before `launch()`. */
export async function epochExists(
  node: Node,
  miner: AztecAddress,
  epoch: number,
  load: SlotLoader,
  limits = DEFAULT_LIMITS,
): Promise<boolean> {
  const table = await load(Math.floor(epoch / CHUNK));
  const slot = table.epochs[epoch - table.first];
  if (!slot) throw new Error(`epoch ${epoch} is beyond the slot table`);
  return (await readSlot(node, miner, slot, limits)).toBigInt() > 0n;
}

export const readOpenEpochNumber = async (
  node: Node,
  miner: AztecAddress,
  layout: StorageLayout,
  limits = DEFAULT_LIMITS,
): Promise<number> =>
  Number((await readSlot(node, miner, fixedSlot(layout, 'open_epoch'), limits)).toBigInt());

/** Chunks covering `[from, to]`, loaded once each; an epoch beyond the table throws. */
async function slotsFor(
  range: { from: number; to: number },
  load: SlotLoader,
): Promise<Map<number, SlotTable>> {
  if (range.to >= TABLE_EPOCHS)
    throw new Error(`epoch ${range.to} is beyond the slot table (${TABLE_EPOCHS} epochs)`);
  const chunks = new Map<number, SlotTable>();
  for (let c = Math.floor(range.from / CHUNK); c <= Math.floor(range.to / CHUNK); c++)
    chunks.set(c, await load(c));
  return chunks;
}

/**
 * Epochs `[from, to]` (inclusive, ascending; capped at `limits.maxEpochs`), three reads each
 * (`target`, `opened_at`, `claims`), plus `seed` when asked; the reads of one epoch go one at a
 * time, so `concurrency` bounds the requests in flight. Each row's `duration`, `retarget` and
 * `closedBy` come from its successor *in the result*: include one epoch past the range you need,
 * or link the rows yourself (`linkRows`) once you hold the successor.
 */
export async function readEpochs(
  node: Node,
  miner: AztecAddress,
  range: { from: number; to: number },
  load: SlotLoader,
  opts: { withSeed?: boolean; limits?: ReadLimits } = {},
): Promise<EpochRow[]> {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const from = Math.max(0, range.from);
  const to = Math.min(range.to, from + limits.maxEpochs - 1);
  if (to < from) return [];
  const chunks = await slotsFor({ from, to }, load);
  const epochs = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const rows = await pooled(epochs, limits.concurrency, async (e): Promise<EpochRow> => {
    const table = chunks.get(Math.floor(e / CHUNK)) as SlotTable;
    const base = (table.epochs[e - table.first] as Fr).toBigInt();
    const read = async (slot: Fr) => (await readSlot(node, miner, slot, limits)).toBigInt();
    // EpochParams is packed as [target, seed, opened_at].
    const target = await read(new Fr(base));
    const openedAt = await read(new Fr(base + 2n));
    const claims = await read(table.claims[e - table.first] as Fr);
    const seed = opts.withSeed ? await read(new Fr(base + 1n)) : undefined;
    checkRow(e, target, openedAt, claims);
    return {
      epoch: e,
      target,
      openedAt: Number(openedAt),
      claims: Number(claims),
      ...(seed !== undefined && { seed }),
      duration: null,
      retarget: null,
      closedBy: null,
    };
  });
  return linkRows(rows);
}

/** Fills each row's closing facts from its successor; the last row stays open. */
export function linkRows(rows: EpochRow[]): EpochRow[] {
  return rows.map((row, i) => {
    const next = rows[i + 1];
    if (!next || next.epoch !== row.epoch + 1)
      return { ...row, duration: null, retarget: null, closedBy: null };
    return {
      ...row,
      duration: next.openedAt - row.openedAt,
      retarget: Number((next.target * 1_000_000n) / row.target) / 1_000_000,
      closedBy: row.claims >= PARAMS.N ? 'claims' : 'roll',
    };
  });
}

export const readTotalSupply = async (
  node: Node,
  token: AztecAddress,
  layout: StorageLayout,
  limits = DEFAULT_LIMITS,
): Promise<bigint> => (await readSlot(node, token, fixedSlot(layout, 'total_supply'), limits)).toBigInt();

/** Genesis is packed as [target, seed, launch_at]. */
export async function readGenesis(
  node: Node,
  miner: AztecAddress,
  layout: StorageLayout,
  limits = DEFAULT_LIMITS,
): Promise<{ target: bigint; seed: bigint; launchAt: number }> {
  const base = fixedSlot(layout, 'genesis').toBigInt();
  const [target, seed, launchAt] = await Promise.all(
    [0n, 1n, 2n].map((i) => readSlot(node, miner, new Fr(base + i), limits)),
  );
  const at = assertTimestamp('genesis: launch_at', (launchAt as Fr).toBigInt());
  return { target: (target as Fr).toBigInt(), seed: (seed as Fr).toBigInt(), launchAt: Number(at) };
}

export async function readLottery(
  node: Node,
  miner: AztecAddress,
  layout: StorageLayout,
  limits = DEFAULT_LIMITS,
): Promise<{ mix: bigint; reveals: number }> {
  const [mix, reveals] = await Promise.all([
    readSlot(node, miner, fixedSlot(layout, 'launch_mix'), limits),
    readSlot(node, miner, fixedSlot(layout, 'launch_reveals'), limits),
  ]);
  return { mix: mix.toBigInt(), reveals: Number(reveals.toBigInt()) };
}

/** The row shape as JSON: bigints travel as hex strings (`bun run epoch:stats -- --json`). */
export const rowsToJson = (rows: readonly EpochRow[]): string =>
  `${JSON.stringify(
    rows.map((r) => ({
      ...r,
      target: `0x${r.target.toString(16)}`,
      ...(r.seed !== undefined && { seed: `0x${r.seed.toString(16)}` }),
    })),
    null,
    2,
  )}\n`;

export const rowsFromJson = (text: string): EpochRow[] =>
  (JSON.parse(text) as (Omit<EpochRow, 'target' | 'seed'> & { target: string; seed?: string })[]).map(
    ({ target, seed, ...r }) => ({
      ...r,
      target: BigInt(target),
      ...(seed !== undefined && { seed: BigInt(seed) }),
    }),
  );
