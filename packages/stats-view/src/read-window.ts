import { type EpochRow, readEpochs, readLottery } from '@yacana/miner-core/reader';
import type { Reader } from './chain';
import type { Lottery } from './state';
import { WINDOW } from './window';

/**
 * The rows of `[from, to]` with the one after `to` when the chain has it: the successor closes the
 * window's last row (its duration, its retarget), and it is held like any other row.
 */
export const readWindowRows = (r: Reader, from: number, to: number, open: number): Promise<EpochRow[]> =>
  readEpochs(r.node, r.miner, { from, to: Math.min(open, to + 1) }, r.load, {
    limits: { ...r.limits, maxEpochs: WINDOW + 1 },
  });

export const readLotteryOf = (r: Reader): Promise<Lottery> =>
  readLottery(r.node, r.miner, r.minerLayout, r.limits);
