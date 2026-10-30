import { describe, expect, test } from 'vitest';
import { type Funding, type FundingEvent, next, reduce } from './machine';
import { FEE_JUICE_SYMBOL, MOCK_TOKENS, scriptFrom } from './mock';
import type { Phase, Quote, Token } from './provider';
import { newRecord, type Saved } from './recovery';

const byName = (chainId: number, symbol: string): Token => {
  const t = MOCK_TOKENS.find((x) => x.chainId === chainId && x.symbol === symbol);
  if (!t) throw new Error(`no mock ${symbol} on ${chainId}`);
  return t;
};
const USDC = byName(84532, 'USDC');
const FJ = byName(11155111, FEE_JUICE_SYMBOL);
const T0 = 1_000_000;

const quoteOf = (from: Token, phases: Phase[]): Quote => ({
  id: `q-${from.symbol}`,
  from,
  amountIn: 25n,
  feeJuiceOut: 12n,
  feeJuiceMin: 11n,
  claimMin: 10n,
  costs: [],
  steps: phases.map((phase) => ({ phase, etaSeconds: 30, signs: phase === 'swap' || phase === 'deposit' })),
  expiresAt: T0 + 30_000,
});
const SWAP = quoteOf(USDC, ['swap', 'deposit', 'message', 'claim']);
const DIRECT = quoteOf(FJ, ['deposit', 'message', 'claim']);

const run = (events: FundingEvent[], from: Funding = { at: 'idle' }): Funding => events.reduce(reduce, from);

const SCOPE = { chainId: '11155111', rollupVersion: '7' };
const savedOf = (token: Token, amountIn: bigint, index = 1): Saved => ({
  record: newRecord(SCOPE, { token, amountIn }, T0, index),
  commit: `0x${index.toString(16).padStart(64, '0')}`,
});

/** Open, pick, quote, save and confirm before the quote expires: the trade at its first step. */
const confirmed = (q: Quote): Funding =>
  run([
    { type: 'open' },
    { type: 'choose', token: q.from },
    { type: 'amount', amountIn: q.amountIn },
    { type: 'quoted', quote: q },
    { type: 'saved', saved: savedOf(q.from, q.amountIn), now: T0 },
    { type: 'confirm', now: T0 },
  ]);

/** Starts and finishes whatever `next` names, until it names nothing; the phases in the order they ran. */
function drive(s: Funding, fail?: { phase: Phase; reason: 'failed' | 'expired' }): [Funding, Phase[]] {
  const ran: Phase[] = [];
  for (let phase = next(s); phase; phase = next(s)) {
    ran.push(phase);
    s = reduce(s, { type: 'started', phase, now: T0 });
    s =
      fail?.phase === phase
        ? reduce(s, { type: 'stepFailed', phase, reason: fail.reason, message: 'no' })
        : reduce(s, { type: 'stepDone', phase });
    if (fail?.phase === phase) fail = undefined;
  }
  return [s, ran];
}

const statuses = (s: Funding) => (s.at === 'trade' ? s.steps.map((x) => `${x.phase}:${x.status}`) : s.at);

describe('the fee-funding machine', () => {
  test('a swap route and a direct deposit run every step, in order, to done', () => {
    const [swapped, swapRan] = drive(confirmed(SWAP));
    expect(swapRan).toEqual(['swap', 'deposit', 'message', 'claim']);
    expect(swapped).toEqual({ at: 'done', quote: SWAP, received: 12n });
    const [direct, directRan] = drive(confirmed(DIRECT));
    expect(directRan).toEqual(['deposit', 'message', 'claim']);
    expect(direct.at).toBe('done');
    // Nothing runs before the confirm, and a started step is not started twice.
    const quoted = run([
      { type: 'open' },
      { type: 'choose', token: USDC },
      { type: 'amount', amountIn: 25n },
    ]);
    expect(next(quoted)).toBeNull();
    const started = reduce(confirmed(SWAP), { type: 'started', phase: 'swap', now: T0 });
    expect(next(started)).toBeNull();
    expect(reduce(started, { type: 'started', phase: 'swap', now: T0 + 1 })).toBe(started);
  });

  test('a failed claim retries only the claim; no finished step runs again', () => {
    const [failed, ran] = drive(confirmed(SWAP), { phase: 'claim', reason: 'failed' });
    expect(ran).toEqual(['swap', 'deposit', 'message', 'claim']);
    expect(statuses(failed)).toEqual(['swap:done', 'deposit:done', 'message:done', 'claim:failed']);
    expect(next(failed)).toBeNull();
    // Long after the quote expired: money has moved, so the retry continues instead of re-quoting.
    const again = reduce(failed, { type: 'retry', now: T0 + 3_600_000 });
    expect(statuses(again)).toEqual(['swap:done', 'deposit:done', 'message:done', 'claim:todo']);
    const [done, reran] = drive(again);
    expect(reran).toEqual(['claim']);
    expect(done.at).toBe('done');
    // A late answer for a finished step changes nothing.
    expect(reduce(again, { type: 'stepFailed', phase: 'swap', reason: 'failed', message: 'x' })).toBe(again);
  });

  test('an expired quote before anything lands asks for a fresh one; after the swap lands, a retry continues', () => {
    const [expired] = drive(confirmed(SWAP), { phase: 'swap', reason: 'expired' });
    expect(expired).toMatchObject({ at: 'quote', token: USDC, amountIn: 25n, quote: null, refreshed: true });
    // Confirming a quote at or past its expiry re-quotes too.
    const late = run([
      { type: 'open' },
      { type: 'choose', token: USDC },
      { type: 'amount', amountIn: 25n },
      { type: 'quoted', quote: SWAP },
    ]);
    expect(reduce(late, { type: 'confirm', now: SWAP.expiresAt })).toMatchObject({
      at: 'quote',
      refreshed: true,
    });
    // The quote ran out at the deposit, after the swap landed: no re-quote (the swap would run twice); the
    // deposit fails in place, and retrying past expiry runs it again.
    const [ranOut] = drive(confirmed(SWAP), { phase: 'deposit', reason: 'expired' });
    expect(statuses(ranOut)).toEqual(['swap:done', 'deposit:failed', 'message:todo', 'claim:todo']);
    const again = reduce(ranOut, { type: 'retry', now: SWAP.expiresAt + 1 });
    expect(next(again)).toBe('deposit');
    // Before anything landed, the same retry past expiry re-quotes.
    const [rejected] = drive(confirmed(SWAP), { phase: 'swap', reason: 'failed' });
    expect(reduce(rejected, { type: 'retry', now: SWAP.expiresAt })).toMatchObject({
      at: 'quote',
      refreshed: true,
    });
    // A quote for an amount since changed is not shown.
    const changed = reduce(late, { type: 'amount', amountIn: 30n });
    expect(reduce(changed, { type: 'quoted', quote: SWAP })).toBe(changed);
  });

  test('a quote that may deliver less than a claim takes cannot be confirmed', () => {
    const quoted = (q: Quote) =>
      run([
        { type: 'open' },
        { type: 'choose', token: q.from },
        { type: 'amount', amountIn: q.amountIn },
        { type: 'quoted', quote: q },
      ]);
    const short = quoted({ ...SWAP, claimMin: SWAP.feeJuiceMin + 1n });
    expect(reduce(short, { type: 'confirm', now: T0 })).toBe(short);
    expect(next(short)).toBeNull();
    // At exactly the minimum it goes.
    const enough = quoted({ ...SWAP, claimMin: SWAP.feeJuiceMin });
    expect(reduce(enough, { type: 'confirm', now: T0 }).at).toBe('trade');
  });

  test('a late step shows late, then done', () => {
    let s = reduce(confirmed(DIRECT), { type: 'started', phase: 'deposit', now: T0 });
    s = reduce(s, { type: 'stepDone', phase: 'deposit' });
    s = reduce(s, { type: 'started', phase: 'message', now: T0 });
    s = reduce(s, { type: 'step', phase: 'message', event: { kind: 'late' } });
    expect(statuses(s)).toEqual(['deposit:done', 'message:late', 'claim:todo']);
    expect(next(s)).toBeNull();
    s = reduce(s, { type: 'stepDone', phase: 'message' });
    expect(statuses(s)).toEqual(['deposit:done', 'message:done', 'claim:todo']);
    // A late report for a step not in flight is ignored.
    expect(reduce(s, { type: 'step', phase: 'message', event: { kind: 'late' } })).toBe(s);
  });

  test('no step starts before the file is saved; a save made after the confirm starts the first', () => {
    const unsaved = run([
      { type: 'open' },
      { type: 'choose', token: USDC },
      { type: 'amount', amountIn: 25n },
      { type: 'quoted', quote: SWAP },
      { type: 'confirm', now: T0 },
    ]);
    expect(statuses(unsaved)).toEqual(['swap:todo', 'deposit:todo', 'message:todo', 'claim:todo']);
    expect(next(unsaved)).toBeNull();
    // A save for another amount does not count for this trade.
    expect(reduce(unsaved, { type: 'saved', saved: savedOf(USDC, 30n), now: T0 })).toBe(unsaved);
    expect(next(reduce(unsaved, { type: 'saved', saved: savedOf(USDC, 25n), now: T0 }))).toBe('swap');
    // Saved only after the quote ran out: nothing has moved, so it is asked again, the save kept.
    const saved = savedOf(USDC, 25n);
    expect(reduce(unsaved, { type: 'saved', saved, now: SWAP.expiresAt })).toMatchObject({
      at: 'quote',
      refreshed: true,
      saved,
    });
  });

  test('another token or amount clears the save; a refreshed quote for the same pair keeps it', () => {
    const saved = savedOf(USDC, 25n);
    const quoted = run([
      { type: 'open' },
      { type: 'choose', token: USDC },
      { type: 'amount', amountIn: 25n },
      { type: 'quoted', quote: SWAP },
      { type: 'saved', saved, now: T0 },
    ]);
    expect(quoted).toMatchObject({ saved });
    // A funding binds to its first save: another record for the same pair does not replace it.
    expect(reduce(quoted, { type: 'saved', saved: savedOf(USDC, 25n, 2), now: T0 })).toBe(quoted);
    expect(reduce(quoted, { type: 'lapse', id: SWAP.id })).toMatchObject({ quote: null, saved });
    expect(reduce(quoted, { type: 'confirm', now: SWAP.expiresAt })).toMatchObject({
      refreshed: true,
      saved,
    });
    expect(reduce(quoted, { type: 'amount', amountIn: 30n })).toMatchObject({ saved: null });
    expect(run([{ type: 'back' }, { type: 'choose', token: FJ }], quoted)).toMatchObject({ saved: null });
  });

  test('a restore with the deposit landed starts at the message; with every step landed it is done', () => {
    const saved = savedOf(USDC, 25n, 9);
    const resumed = reduce(
      { at: 'idle' },
      { type: 'restored', quote: SWAP, landed: ['swap', 'deposit'], saved },
    );
    expect(statuses(resumed)).toEqual(['swap:done', 'deposit:done', 'message:todo', 'claim:todo']);
    const [done, ran] = drive(resumed);
    expect(ran).toEqual(['message', 'claim']);
    expect(done.at).toBe('done');
    // A landed step means every step before it landed too: none of them runs again.
    const partial = reduce({ at: 'idle' }, { type: 'restored', quote: SWAP, landed: ['deposit'], saved });
    expect(statuses(partial)).toEqual(['swap:done', 'deposit:done', 'message:todo', 'claim:todo']);
    const claimed = reduce(
      { at: 'pick' },
      { type: 'restored', quote: SWAP, landed: ['swap', 'deposit', 'message', 'claim'], saved },
    );
    expect(claimed).toEqual({ at: 'done', quote: SWAP, received: 12n });
    // A trade under way is not replaced by a file.
    const trading = confirmed(SWAP);
    expect(reduce(trading, { type: 'restored', quote: DIRECT, landed: ['deposit'], saved })).toBe(trading);
  });

  test('the mock reads its switches from a closed vocabulary, anything else as none', () => {
    expect(scriptFrom('?fees=b&fees-fail=claim&fees-hold=message&fees-wallet=empty')).toEqual({
      fail: 'claim',
      wallet: 'empty',
      hold: 'message',
      resume: 'found',
    });
    expect(scriptFrom('?fees-hold=sign&fees-resume=claimed')).toEqual({
      fail: 'none',
      wallet: 'held',
      hold: 'sign',
      resume: 'claimed',
    });
    for (const hostile of [
      '?fees-fail=<img src=x onerror=alert(1)>',
      '?fees-fail=none&fees-hold=__proto__',
      '?fees-fail=CLAIM&fees-hold=Message',
      '?fees-fail=&fees-hold=&fees-wallet=EMPTY&fees-resume=Missing',
      '',
    ])
      expect(scriptFrom(hostile), hostile).toEqual({
        fail: 'none',
        wallet: 'held',
        hold: null,
        resume: 'found',
      });
  });
});
