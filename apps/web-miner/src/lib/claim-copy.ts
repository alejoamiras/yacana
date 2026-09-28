// What a win line says after "a win": the claim's step while it runs, then one of the outcomes.

import type { ClaimStep, WinNote } from '@yacana/ui';
import { clockMinutes } from '@yacana/web-kit/browser/format';
import { PROVING, type ProverKind } from '../presto';
import { type ClaimNote, type ClaimProgress, TRIES } from './reducer';

/** The chip's word for a step: the reducer's `waiting` is the user's "in a block". */
export const chipStep = (step: ClaimProgress['step']): ClaimStep =>
  step === 'waiting' ? 'in a block' : step;

const running = (c: ClaimNote, nowMs: number, prover: ProverKind): string => {
  if (c.step === 'sent') {
    const left = c.expiresAt === undefined ? null : c.expiresAt - nowMs / 1000;
    return left === null || left <= 0
      ? 'claiming: sent to the node'
      : `claiming: sent to the node · drops in ${clockMinutes(left)} if no block takes it`;
  }
  if (c.step === 'waiting') return 'claiming: in a block · syncing the note';
  return PROVING[prover].claim;
};

const tryOf = (n: number | undefined): string =>
  n !== undefined && n <= TRIES ? `try ${n} of ${TRIES}` : 'one more try';

/** A failed claim's line while it is recovered: why, and what comes next. */
const recovering = (c: ClaimNote): string | undefined => {
  switch (c.recover) {
    case 'anchor-pruned':
      return `the node dropped the block it was reading · proving again, ${tryOf(c.attempt)}`;
    case 'resend':
      return `it didn’t land · sending again, ${tryOf(c.attempt)}`;
    case 'reprove':
      return `the claim failed · proving again, ${tryOf(c.attempt)}`;
    case 'lost':
      return 'the node lost sight of it · checking the chain for your claim';
    case 'checking':
      return 'checking the chain for your claim';
    case 'spent':
      return `couldn’t claim after ${TRIES} tries: the node keeps dropping blocks · the win stays claimable until epoch ${c.until} closes`;
    case 'stopped':
      return `stopped · the win stays claimable until epoch ${c.until} closes`;
    default:
      return undefined;
  }
};

const ended = (c: ClaimNote): string => {
  switch (c.outcome) {
    case 'reverted':
      return `didn't land: ${
        c.stale
          ? 'the epoch closed first'
          : c.reason === undefined
            ? 'it reverted'
            : `it reverted (${c.reason})`
      } · the sponsor paid, your proof is unspent · re-syncing, about a minute`;
    case 'delivery-blocked':
      return c.waitMinutes === undefined
        ? "didn't land: an earlier reverted claim blocks this account · re-syncing, about a minute"
        : `didn't land: an earlier reverted claim blocks this account · claims wait for Ethereum's finality, about ${c.waitMinutes} min`;
    case 'other':
      return `claim failed: ${c.reason ?? 'unknown'} · mining paused`;
    default:
      return `not claimed: the epoch closed before the claim ${c.sent ? 'landed' : 'went out'}`;
  }
};

/** A claim with no outcome yet: why it is tried again and what comes next, until an attempt is sent and its steps speak for it. */
function openNote(c: ClaimNote, nowMs: number, prover: ProverKind): WinNote | undefined {
  const recover = c.step === 'sent' || c.step === 'waiting' ? undefined : recovering(c);
  if (recover) return { text: recover, tone: c.retry ? 'warn' : 'uv', ...(c.retry && { action: 'Retry' }) };
  return c.step ? { text: running(c, nowMs, prover), tone: 'uv' } : undefined;
}

/** The note for the ledger; none once the claim minted (the ✓ line under it says so). `prover` is who proves the claim under way. */
export function winNote(
  c: ClaimNote | undefined,
  nowMs: number,
  prover: ProverKind = 'wasm',
): WinNote | undefined {
  if (!c || c.outcome === 'minted') return undefined;
  if (c.outcome === undefined) return openNote(c, nowMs, prover);
  if (c.outcome === 'discarded') return { text: ended(c), tone: 'dim' };
  return { text: ended(c), tone: 'warn', ...(c.retry && { action: 'Retry' }) };
}

type Settlement = 'pending' | 'settled' | 'pruned' | undefined;

/** A minted line's settlement, after the block: settling until its epoch is proven, then final, or pruned with it. */
export const settlementSuffix = (settled: Settlement): string | undefined =>
  settled === 'pending'
    ? 'settling'
    : settled === 'settled'
      ? 'final'
      : settled === 'pruned'
        ? 'pruned: its epoch was never proven'
        : undefined;

export const settlementTitle = (settled: Settlement): string | undefined =>
  settled === 'pending' ? 'Final once its epoch is proven.' : undefined;
