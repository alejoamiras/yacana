// Drives the machine against a provider, one tab-wide instance: a dialog closed mid-trade, or a
// route left and come back to, finds the same trade. A provider's answer counts only while the
// request that asked for it is the current one.

import { useEffect, useSyncExternalStore } from 'react';
import { firstLine } from '../features/dialogs/Frame';
import { saveJson } from '../lib/download';
import { type Funding, type FundingEvent, next, reduce } from './machine';
import { type FeeFundingProvider, FundingError, type FundingHint, type FundingReads } from './provider';
import {
  commitOf,
  type FundingRecord,
  type FundingScope,
  fileName,
  MAX_RECORD_BYTES,
  newRecord,
  parseRecord,
  RecordRefused,
  type Saved,
  STAND_IN_MASTER,
  TOO_LARGE,
  toFile,
} from './recovery';

const QUOTE_DEBOUNCE_MS = 300;

const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export const NOT_FOUND = 'No deposit carries this file’s funding: nothing was sent for it, or not yet.';

export interface RunOptions {
  readonly now?: () => number;
  /** The commitment a record binds its deposit to; the master's derivation unless a spec passes its own. */
  readonly commit?: (r: FundingRecord) => Promise<string>;
}

/** The token and amount a save would bind to, where the state has both. */
function pairOf(s: Funding): FundingHint | null {
  if (s.at === 'quote') return s.amountIn === null ? null : { token: s.token, amountIn: s.amountIn };
  return s.at === 'trade' ? { token: s.quote.from, amountIn: s.quote.amountIn } : null;
}

const samePair = (a: FundingHint | null, b: FundingHint) =>
  a !== null &&
  a.amountIn === b.amountIn &&
  a.token.chainId === b.token.chainId &&
  a.token.address === b.token.address;

export class FundingRun {
  private state: Funding = { at: 'idle' };
  private readonly listeners = new Set<() => void>();
  private step: AbortController | null = null;
  private quoting: AbortController | null = null;
  private quoteTimer: ReturnType<typeof setTimeout> | undefined;
  private lapseTimer: ReturnType<typeof setTimeout> | undefined;
  private restoring: AbortController | null = null;
  private readonly now: () => number;
  private readonly commit: (r: FundingRecord) => Promise<string>;
  /** The connected Ethereum wallet, the one that pays; quotes are asked for it. */
  payer = '';

  constructor(
    private readonly provider: FeeFundingProvider,
    private readonly scope: FundingScope,
    options: RunOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.commit = options.commit ?? ((r) => commitOf(STAND_IN_MASTER, r));
  }

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

  /**
   * Downloads the funding's recovery file and marks it saved. A funding already saved downloads the
   * same record again; a token or amount changed while its commitment derived downloads nothing.
   */
  save = async (): Promise<void> => {
    const s = this.state;
    const pair = pairOf(s);
    if (!pair) return;
    let saved = (s.at === 'quote' || s.at === 'trade') && s.saved;
    if (!saved) {
      const record = newRecord(this.scope, pair, this.now());
      saved = { record, commit: await this.commit(record) };
      if (!samePair(pairOf(this.state), pair)) return;
    }
    saveJson(fileName(saved.record), toFile(saved.record));
    this.dispatch({ type: 'saved', saved });
  };

  /** Saves, then confirms what was saved: one click for both. */
  saveAndConfirm = async (): Promise<void> => {
    await this.save();
    const s = this.state;
    if (s.at === 'quote' && s.saved) this.confirm();
  };

  /**
   * Resumes the funding a recovery file names, from idle or the picker. Resolves to the line saying
   * why it could not, or null: resumed, or superseded by a reset or another restore.
   */
  restore = async (file: Blob): Promise<string | null> => {
    this.restoring?.abort();
    const ctl = new AbortController();
    this.restoring = ctl;
    const current = () => this.restoring === ctl;
    try {
      if (file.size > MAX_RECORD_BYTES) throw new RecordRefused(TOO_LARGE);
      const record = parseRecord(await file.text(), this.scope);
      const saved: Saved = { record, commit: await this.commit(record) };
      const found = current()
        ? await this.provider.resume({ commit: saved.commit, hint: record.hint }, ctl.signal)
        : null;
      if (!current()) return null;
      this.restoring = null;
      if (!found) return NOT_FOUND;
      this.dispatch({ type: 'restored', quote: found.quote, landed: found.landed, saved });
      return null;
    } catch (e) {
      if (!current() || aborted(e)) return null;
      this.restoring = null;
      return firstLine(e);
    }
  };

  private cancel(): void {
    this.restoring?.abort();
    this.restoring = null;
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
    if (phase && s.at === 'trade' && s.saved) this.start(phase, s.quote, s.saved.commit);
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
      this.provider.quote(token, amountIn, this.payer, ctl.signal).then(
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
    commit: string,
  ) {
    const ctl = new AbortController();
    this.step = ctl;
    this.dispatch({ type: 'started', phase, now: this.now() });
    const current = () => this.step === ctl;
    this.provider
      .run(
        phase,
        quote,
        commit,
        (event) => current() && this.dispatch({ type: 'step', phase, event }),
        ctl.signal,
      )
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
  reads: FundingReads;
  /** The page is signed in, or a flagged build stands in an account. */
  signedIn: boolean;
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
