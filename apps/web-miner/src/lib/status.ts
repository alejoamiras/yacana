import type { Status } from '@yacana/ui';
import { attemptScheduled, type MinerState, mintedFresh } from './reducer';

/** One pill for the whole page: a page-side pause reads as paused, a fresh mint as minted. */
export const pillStatus = (m: MinerState, nowMs = Date.now()): Status => {
  const paused = m.notice?.kind === 'offline' || m.notice?.kind === 'behind' || m.notice?.kind === 'paused';
  if (m.proverDead || m.phase === 'recovering' || paused) return 'paused';
  if (attemptScheduled(m)) return 'claiming';
  if (m.phase === 'idle' && mintedFresh(m.minted, nowMs)) return 'minted';
  return m.phase;
};
