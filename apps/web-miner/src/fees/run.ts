// Drives the machine against a provider, one tab-wide instance: a dialog closed mid-trade, or a
// route left and come back to, finds the same trade. A provider's answer counts only while the
// request that asked for it is the current one.

import { useEffect, useSyncExternalStore } from 'react';
import { firstLine } from '../features/dialogs/Frame';
import { type Funding, type FundingEvent, next, reduce } from './machine';
import { type FeeFundingProvider, FundingError } from './provider';

const QUOTE_DEBOUNCE_MS = 300;

const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export class FundingRun {
  private state: Funding = { at: 'idle' };
  private readonly listeners = new Set<() => void>();
  private step: AbortController | null = null;
  private quoting: AbortController | null = null;
  private quoteTimer: ReturnType<typeof setTimeout> | undefined;
  private lapseTimer: ReturnType<typeof setTimeout> | undefined;
  /** The Aztec account the Fee Juice is for: the open account, or a flagged build's stand-in. */
  recipient = '';

  constructor(
    private readonly provider: FeeFundingProvider,
    private readonly now: () => number = Date.now,
  ) {}

  readonly getState = (): Funding => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch(e: FundingEvent): void {
    if (e.type === 'reset') this.cancel();
    const s = reduce(this.state, e);
    if (s === this.state) return;
    this.state = s;
    for (const l of this.listeners) l();
    this.follow(s);
  }

  /** Confirm and retry read the clock here, so a view never passes its own. */
  confirm = () => this.dispatch({ type: 'confirm', now: this.now() });
  retry = () => this.dispatch({ type: 'retry', now: this.now() });

  private cancel(): void {
    this.step?.abort();
    this.step = null;
    this.quoting?.abort();
    this.quoting = null;
    clearTimeout(this.quoteTimer);
    clearTimeout(this.lapseTimer);
  }

  private follow(s: Funding): void {
    if (s.at === 'quote') this.followQuote(s);
    else {
      clearTimeout(this.quoteTimer);
      clearTimeout(this.lapseTimer);
    }
    const phase = next(s);
    if (phase && s.at === 'trade') this.start(phase, s.quote);
  }

  private followQuote(s: Extract<Funding, { at: 'quote' }>): void {
    clearTimeout(this.lapseTimer);
    if (s.quote) {
      const id = s.quote.id;
      this.lapseTimer = setTimeout(
        () => this.dispatch({ type: 'lapse', id }),
        Math.max(0, s.quote.expiresAt - this.now()),
      );
      return;
    }
    // A new amount, token or lapse: whatever was being asked for no longer applies.
    clearTimeout(this.quoteTimer);
    this.quoting?.abort();
    this.quoting = null;
    if (s.amountIn === null || s.error) return;
    const { token, amountIn } = s;
    this.quoteTimer = setTimeout(() => {
      const ctl = new AbortController();
      this.quoting = ctl;
      this.provider.quote(token, amountIn, this.recipient, ctl.signal).then(
        (quote) => this.quoting === ctl && this.settleQuote({ type: 'quoted', quote }),
        (e) =>
          this.quoting === ctl &&
          !aborted(e) &&
          this.settleQuote({ type: 'quoteFailed', message: firstLine(e) }),
      );
    }, QUOTE_DEBOUNCE_MS);
  }

  private settleQuote(e: FundingEvent): void {
    this.quoting = null;
    this.dispatch(e);
  }

  private start(
    phase: Parameters<FeeFundingProvider['run']>[0],
    quote: Parameters<FeeFundingProvider['run']>[1],
  ) {
    const ctl = new AbortController();
    this.step = ctl;
    this.dispatch({ type: 'started', phase, now: this.now() });
    const current = () => this.step === ctl;
    this.provider
      .run(phase, quote, (event) => current() && this.dispatch({ type: 'step', phase, event }), ctl.signal)
      .then(
        () => {
          if (!current()) return;
          this.step = null;
          this.dispatch({ type: 'stepDone', phase });
        },
        (e) => {
          if (!current() || aborted(e)) return;
          this.step = null;
          const reason = e instanceof FundingError ? e.reason : 'failed';
          this.dispatch({ type: 'stepFailed', phase, reason, message: firstLine(e) });
        },
      );
  }
}

export interface OptionProps {
  run: FundingRun;
  provider: FeeFundingProvider;
  /** The Aztec account the Fee Juice is for. */
  account: string;
}

/** The runner's state for a view. A pick or a quote the view leaves is dropped, so nothing re-quotes off screen. */
export function useFunding(run: FundingRun): Funding {
  useEffect(
    () => () => {
      const { at } = run.getState();
      if (at === 'pick' || at === 'quote') run.dispatch({ type: 'reset' });
    },
    [run],
  );
  return useSyncExternalStore(run.subscribe, run.getState);
}
