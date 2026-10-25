// The epoch the cockpit shows before an account is open: read from public storage through the slot
// table (the stats page's path, no account and no simulation) and written to `epochAtom` until the
// controller's first read takes the atom over. A write is dropped once the poll is stopped, or when
// the atom already holds a newer epoch, so a late public read can never overwrite fresher claims.
import type { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { readEpochs, readOpenEpochNumber } from '@yacana/miner-core/reader';
import { readTip } from '@yacana/web-kit/browser/node';
import { markRead, recordTip } from '@yacana/web-kit/browser/node-health';
import { chunkLoader } from '@yacana/web-kit/browser/slots';
import type { createStore } from 'jotai';
import type { EpochInfo } from './lib/reducer';
import { epochAtom } from './state';

type Store = ReturnType<typeof createStore>;
type ReaderArgs = Parameters<typeof readOpenEpochNumber>;

export const PUBLIC_EPOCH_POLL_MS = 30_000;

export interface PublicEpochPoll {
  /** Reads at once, then every interval; a no-op while running. */
  start(): void;
  /** The handover: nothing already out lands after this; resolves once a read that was out has settled. */
  stop(): Promise<void>;
  /** One read now (the one in flight, if any); resolves when it settled. */
  tick(): Promise<void>;
}

/** The open epoch's public facts, the way the stats page reads them. */
export function publicEpochReader(
  node: ReaderArgs[0],
  miner: AztecAddress,
  layout: ReaderArgs[2],
  load = chunkLoader(),
): () => Promise<EpochInfo> {
  return async () => {
    const open = await readOpenEpochNumber(node, miner, layout);
    const [row] = await readEpochs(node, miner, { from: open, to: open }, load, { withSeed: true });
    if (!row || row.seed === undefined) throw new Error(`epoch ${open} is beyond the slot table`);
    // The tip rides the epoch read; it is the health store's, so its failure is not the epoch's.
    await readTip(node).then(recordTip, () => {});
    return {
      epoch: BigInt(open),
      seed: row.seed,
      target: row.target,
      openedAt: BigInt(row.openedAt),
      claims: row.claims,
    };
  };
}

export function startPublicEpoch(
  store: Store,
  read: () => Promise<EpochInfo>,
  opts: { intervalMs?: number; log?: (line: string) => void } = {},
): PublicEpochPoll {
  let timer: ReturnType<typeof setInterval> | undefined;
  /** The current run's read, for coalescing ticks. */
  let inflight: Promise<void> | undefined;
  /** Every read still out, across restarts: `stop()` drains them all. */
  const outstanding = new Set<Promise<void>>();
  // Bumped by start and stop: a read that was out across either writes nothing.
  let generation = 0;
  const run = async (gen: number) => {
    try {
      const info = await read();
      if (gen !== generation) return;
      const prev = store.get(epochAtom);
      if (prev && info.epoch < prev.epoch) return;
      store.set(epochAtom, info);
      markRead();
    } catch (e) {
      opts.log?.(`public epoch: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const tick = (): Promise<void> => {
    if (!timer) return Promise.resolve();
    if (!inflight) {
      const p: Promise<void> = run(generation).finally(() => {
        outstanding.delete(p);
        if (inflight === p) inflight = undefined;
      });
      outstanding.add(p);
      inflight = p;
    }
    return inflight;
  };
  return {
    start() {
      if (timer) return;
      generation++;
      // A read still out from before the stop is not this run's: the first tick reads afresh.
      inflight = undefined;
      timer = setInterval(() => void tick(), opts.intervalMs ?? PUBLIC_EPOCH_POLL_MS);
      void tick();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
        generation++;
      }
      return Promise.all(outstanding).then(() => {});
    },
    tick,
  };
}
