// When Ethereum last accepted a proof of a version: the timestamp of the block the Rollup's latest
// `L2ProofVerified` is in. The moment this page noticed a checkpoint move says nothing about when
// the proof landed, so the event is the only source. The chain is longer than one `eth_getLogs`
// allows, so the scan is spread over refreshes and reports an event only once every block up to the
// head has been read: one found with newer blocks still unread would date the last proof too early.
// `unknown` is that unfinished state, and the state of a floor that is only a guess; `none` is an
// absence, which only an exact floor can prove.
import { RollupAbi } from '@aztec-foundation/l1-artifacts/RollupAbi';
import type { Hex, PublicClient } from 'viem';
import { LOG_WINDOW, type LogClient } from './logs.ts';

export interface ProvenAt {
  /** Unix seconds of the block the proof was verified in. */
  at: bigint;
  checkpoint: bigint;
  block: bigint;
}

export type ProofReading = ProvenAt | 'unknown' | 'none';

export interface ProofReader {
  /**
   * One call at a time: the scan's progress is state carried across awaits, so two in flight would
   * each mark ranges read that neither finished. Its floor may rise between calls but never fall —
   * a wider range would leave a completed scan claiming blocks it never saw.
   */
  latestProvenAt(): Promise<ProofReading>;
}

export type ProofClient = LogClient & Pick<PublicClient, 'getBlock' | 'getBlockNumber'>;

export interface ProofFloor {
  block: bigint;
  /** Whether nothing below `block` can hold an event. A guess bounds the search; it never proves `none`. */
  exact: boolean;
}

export interface ProofScan {
  rollup: Hex;
  floor: () => Promise<ProofFloor>;
  /** Target `eth_getLogs` calls per `latestProvenAt`; the frontier pass may take one more. */
  budget?: number;
  /** Blocks re-read around the known event and behind the frontier each call: a reorg can move either. */
  overlap?: bigint;
}

type Log = { blockNumber: bigint; logIndex: number; args: { checkpointNumber: bigint } };

/**
 * The scan between calls. `scannedTo` is the highest block read, so `(scannedTo, head]` is unread.
 * `complete` says the search up to `scannedTo` is over: the walk stops at the first event it meets,
 * so blocks below that event stay unread on purpose — what is established is that nothing newer
 * than `known` sits under the frontier. `cursor` is an unfinished walk's next upper bound.
 */
interface ScanState {
  known?: ProvenAt;
  scannedTo: bigint;
  complete: boolean;
  cursor?: bigint;
}

const fresh = (): ScanState => ({ scannedTo: 0n, complete: false });

const newest = <T extends { blockNumber: bigint; logIndex: number }>(logs: readonly T[]): T | undefined =>
  logs.reduce<T | undefined>(
    (best, l) =>
      !best ||
      l.blockNumber > best.blockNumber ||
      (l.blockNumber === best.blockNumber && l.logIndex > best.logIndex)
        ? l
        : best,
    undefined,
  );

/** The window ending at `hi`, never reaching below the floor. */
const windowOf = (hi: bigint, floor: bigint) => (hi - LOG_WINDOW + 1n > floor ? hi - LOG_WINDOW + 1n : floor);
const clamp = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);

/** The chain reads the scan makes: a window of the Rollup's proof events, and one event's time. */
const chainReads = (client: ProofClient, rollup: Hex) => ({
  logs: (fromBlock: bigint, toBlock: bigint) =>
    client.getContractEvents({
      address: rollup,
      abi: RollupAbi,
      eventName: 'L2ProofVerified',
      fromBlock,
      toBlock,
      // Only logs whose data decodes in full: an event with a missing field is no event.
      strict: true,
    }) as Promise<readonly Log[]>,
  provenAt: async (log: Log): Promise<ProvenAt> => ({
    at: (await client.getBlock({ blockNumber: log.blockNumber })).timestamp,
    checkpoint: log.args.checkpointNumber,
    block: log.blockNumber,
  }),
});

type Reads = ReturnType<typeof chainReads>;

/**
 * The known event re-read around itself. It is gone when that window comes back empty or its newest
 * event is older than the known one — a reorg took it, so everything read since describes a chain
 * that no longer exists and the scan starts over.
 */
async function confirm(s: ScanState, r: Reads, over: bigint, floor: bigint, head: bigint) {
  const k = s.known as ProvenAt;
  const hi = clamp(k.block + over, floor, head);
  const top = newest(await r.logs(clamp(k.block - over, floor, hi), hi));
  if (!top || top.blockNumber < k.block) return false;
  s.known = await r.provenAt(top);
  if (hi > s.scannedTo) s.scannedTo = hi;
  return true;
}

/** Windows towards the head, in order, under `spend` calls: each one read moves the frontier up. */
async function forward(s: ScanState, r: Reads, from: bigint, head: bigint, spend: number) {
  let lo = from;
  for (let spent = 0; lo <= head && spent < spend; spent++) {
    const hi = lo + LOG_WINDOW - 1n < head ? lo + LOG_WINDOW - 1n : head;
    const top = newest(await r.logs(lo, hi));
    // The first window reaches back behind the frontier, where an event older than the known one
    // can sit: only one from the same block or newer may replace it.
    if (top && (!s.known || top.blockNumber >= s.known.block)) s.known = await r.provenAt(top);
    if (hi > s.scannedTo) s.scannedTo = hi;
    lo = hi + 1n;
  }
}

/**
 * Newest-first from the head towards the floor, the cursor carrying the walk into the next call.
 * The first event it meets is the range's newest, because every block above it was read on the way
 * down; the floor reached without one leaves the range complete and empty.
 */
async function walkDown(s: ScanState, r: Reads, floor: ProofFloor, head: bigint, spend: number) {
  s.cursor ??= head;
  let hi = s.cursor;
  let found: Log | undefined;
  let spent = 0;
  for (; spent < spend && hi >= floor.block && !found; spent++) {
    const lo = windowOf(hi, floor.block);
    found = newest(await r.logs(lo, hi));
    // The first window of a walk is the highest block it will read; the rest are below it.
    if (hi > s.scannedTo) s.scannedTo = hi;
    if (!found) hi = lo - 1n;
  }
  if (found) s.known = await r.provenAt(found);
  if (found || hi < floor.block) {
    s.complete = true;
    s.cursor = undefined;
  } else s.cursor = hi;
  return spent;
}

/** What the scan can say: an event only once the range it read reaches the head. */
const answer = (s: ScanState, floor: ProofFloor, head: bigint): ProofReading => {
  if (!s.complete || s.scannedTo < head) return 'unknown';
  if (s.known) return s.known;
  return floor.exact ? 'none' : 'unknown';
};

/**
 * A head that retreated took blocks with it, so progress above it is progress over nothing — and an
 * unfinished walk's progress is worth nothing at all: it read the chain that is gone, and finishing
 * on it would name an event the latest without having read what now sits above it. A finished scan
 * survives a retreat because the next call re-reads the known event and the frontier behind it.
 */
const clampTo = (s: ScanState, head: bigint): ScanState => {
  if (s.known && s.known.block > head) return fresh();
  if (head < s.scannedTo && !s.complete) return fresh();
  if (s.scannedTo > head) s.scannedTo = head;
  if (s.cursor !== undefined && s.cursor > head) s.cursor = head;
  return s;
};

export function proofReader(client: ProofClient, scan: ProofScan): ProofReader {
  const budget = scan.budget ?? 4;
  const over = scan.overlap ?? 12n;
  const r = chainReads(client, scan.rollup);
  let s = fresh();

  return {
    async latestProvenAt() {
      const [head, floor] = await Promise.all([client.getBlockNumber({ cacheTime: 0 }), scan.floor()]);
      if (floor.block > head) return 'unknown';
      s = clampTo(s, head);
      let spend = budget;
      if (s.complete && s.known) {
        const still = await confirm(s, r, over, floor.block, head);
        spend -= 1;
        if (!still) s = fresh();
      }
      if (!s.complete) spend -= await walkDown(s, r, floor, head, spend);
      // A walk that just found its event falls through to here rather than answering: the frontier
      // is what proves nothing newer arrived while it was walking. One call is always left for it,
      // even when that overruns the budget — starving it would leave the frontier behind for ever.
      if (s.complete)
        await forward(s, r, clamp(s.scannedTo - over + 1n, floor.block, head), head, Math.max(1, spend));
      return answer(s, floor, head);
    },
  };
}
