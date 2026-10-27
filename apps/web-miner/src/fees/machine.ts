// The flow as a pure reducer: no clock of its own (`now` rides in the events that need it), no I/O.
// Invariants: a done step never leaves `done`; at most one step is in flight; `done` follows the
// quote's last step.

import type { FailureReason, Phase, PhaseEvent, Quote, Token } from './provider';

export type StepStatus = 'todo' | 'signing' | 'running' | 'late' | 'done' | 'failed';

export interface StepState {
  readonly phase: Phase;
  readonly status: StepStatus;
  /** Unix ms the step started, for the elapsed time beside it. */
  readonly since?: number;
  readonly tx?: string;
}

export interface Failure {
  readonly phase: Phase;
  readonly reason: FailureReason;
  readonly message: string;
}

export type Funding =
  | { readonly at: 'idle' }
  | { readonly at: 'pick' }
  | {
      readonly at: 'quote';
      readonly token: Token;
      readonly amountIn: bigint | null;
      readonly quote: Quote | null;
      /** The last quote ran out before it was used: the next one comes with a note saying so. */
      readonly refreshed: boolean;
      readonly error: string | null;
    }
  | {
      readonly at: 'trade';
      readonly quote: Quote;
      readonly steps: readonly StepState[];
      readonly failure: Failure | null;
    }
  | { readonly at: 'done'; readonly quote: Quote; readonly received: bigint };

export type FundingEvent =
  | { readonly type: 'open' }
  | { readonly type: 'choose'; readonly token: Token }
  | { readonly type: 'amount'; readonly amountIn: bigint | null }
  | { readonly type: 'quoted'; readonly quote: Quote }
  | { readonly type: 'quoteFailed'; readonly message: string }
  /** A shown quote reached its expiry unused; `id` keeps a late timer from dropping its successor. */
  | { readonly type: 'lapse'; readonly id: string }
  | { readonly type: 'back' }
  | { readonly type: 'confirm'; readonly now: number }
  | { readonly type: 'started'; readonly phase: Phase; readonly now: number }
  | { readonly type: 'step'; readonly phase: Phase; readonly event: PhaseEvent }
  | { readonly type: 'stepDone'; readonly phase: Phase }
  | {
      readonly type: 'stepFailed';
      readonly phase: Phase;
      readonly reason: FailureReason;
      readonly message: string;
    }
  | { readonly type: 'retry'; readonly now: number }
  | { readonly type: 'reset' };

export const IN_FLIGHT: ReadonlySet<StepStatus> = new Set(['signing', 'running', 'late']);

export const inFlight = (s: Funding): boolean =>
  s.at === 'trade' && s.steps.some((x) => IN_FLIGHT.has(x.status));

/** Some step finished: money moved, so the quote no longer governs what happens next. */
export const landed = (s: Funding): boolean => s.at === 'trade' && s.steps.some((x) => x.status === 'done');

/** The phase the runner must start now, if any. */
export function next(s: Funding): Phase | null {
  if (s.at !== 'trade' || s.failure || inFlight(s)) return null;
  return s.steps.find((x) => x.status === 'todo')?.phase ?? null;
}

const requote = (quote: Quote, refreshed: boolean): Funding => ({
  at: 'quote',
  token: quote.from,
  amountIn: quote.amountIn,
  quote: null,
  refreshed,
  error: null,
});

const sameToken = (a: Token, b: Token) => a.chainId === b.chainId && a.address === b.address;

type Trade = Extract<Funding, { at: 'trade' }>;

const withStep = (s: Trade, phase: Phase, patch: (x: StepState) => StepState | null): Funding => {
  let changed = false;
  const steps = s.steps.map((x) => {
    if (x.phase !== phase) return x;
    const y = patch(x);
    if (!y) return x;
    changed = true;
    return y;
  });
  return changed ? { ...s, steps } : s;
};

function onStep(s: Trade, phase: Phase, event: PhaseEvent): Funding {
  return withStep(s, phase, (x) => {
    if (!IN_FLIGHT.has(x.status)) return null;
    if (event.kind === 'signing') return { ...x, status: 'signing' };
    if (event.kind === 'sent') return { ...x, status: 'running', tx: event.tx };
    return { ...x, status: 'late' };
  });
}

function onDone(s: Trade, phase: Phase): Funding {
  const t = withStep(s, phase, (x) => (IN_FLIGHT.has(x.status) ? { ...x, status: 'done' } : null));
  if (t.at !== 'trade' || !t.steps.every((x) => x.status === 'done')) return t;
  return { at: 'done', quote: t.quote, received: t.quote.feeJuiceOut };
}

function onFailed(s: Trade, e: Extract<FundingEvent, { type: 'stepFailed' }>): Funding {
  const step = s.steps.find((x) => x.phase === e.phase);
  if (!step || !IN_FLIGHT.has(step.status)) return s;
  if (e.reason === 'expired' && !landed(s)) return requote(s.quote, true);
  const failed = withStep(s, e.phase, (x) => ({ ...x, status: 'failed' }));
  return { ...(failed as Trade), failure: { phase: e.phase, reason: e.reason, message: e.message } };
}

function onRetry(s: Trade, now: number): Funding {
  if (!s.failure) return s;
  if (!landed(s) && now >= s.quote.expiresAt) return requote(s.quote, true);
  const again = withStep(s, s.failure.phase, (x) => ({ phase: x.phase, status: 'todo' }));
  return { ...(again as Trade), failure: null };
}

function inQuote(s: Extract<Funding, { at: 'quote' }>, e: FundingEvent): Funding {
  switch (e.type) {
    case 'amount':
      return e.amountIn === s.amountIn
        ? s
        : { ...s, amountIn: e.amountIn, quote: null, refreshed: false, error: null };
    case 'quoted':
      return sameToken(e.quote.from, s.token) && e.quote.amountIn === s.amountIn
        ? { ...s, quote: e.quote, error: null }
        : s;
    case 'quoteFailed':
      return { ...s, quote: null, error: e.message };
    case 'lapse':
      return s.quote?.id === e.id ? { ...s, quote: null } : s;
    case 'back':
      return { at: 'pick' };
    case 'confirm':
      if (!s.quote) return s;
      if (e.now >= s.quote.expiresAt) return requote(s.quote, true);
      return {
        at: 'trade',
        quote: s.quote,
        steps: s.quote.steps.map((x) => ({ phase: x.phase, status: 'todo' })),
        failure: null,
      };
    default:
      return s;
  }
}

function inTrade(s: Trade, e: FundingEvent): Funding {
  switch (e.type) {
    case 'started':
      return next(s) === e.phase
        ? withStep(s, e.phase, (x) => ({ ...x, status: 'running', since: e.now }))
        : s;
    case 'step':
      return onStep(s, e.phase, e.event);
    case 'stepDone':
      return onDone(s, e.phase);
    case 'stepFailed':
      return onFailed(s, e);
    case 'retry':
      return onRetry(s, e.now);
    default:
      return s;
  }
}

export function reduce(s: Funding, e: FundingEvent): Funding {
  if (e.type === 'reset') return { at: 'idle' };
  switch (s.at) {
    case 'idle':
      return e.type === 'open' ? { at: 'pick' } : s;
    case 'pick':
      if (e.type === 'choose')
        return { at: 'quote', token: e.token, amountIn: null, quote: null, refreshed: false, error: null };
      return e.type === 'back' ? { at: 'idle' } : s;
    case 'quote':
      return inQuote(s, e);
    case 'trade':
      return inTrade(s, e);
    case 'done':
      return s;
  }
}
