import { describe, expect, test } from 'vitest';
import { type Funding, type FundingEvent, next, reduce } from './machine';
import { FEE_JUICE_SYMBOL, MOCK_TOKENS, scriptFrom } from './mock';
import type { Phase, Quote, Token } from './provider';

const byName = (chainId: number, symbol: string): Token => {
  const t = MOCK_TOKENS.find((x) => x.chainId === chainId && x.symbol === symbol);
  if (!t) throw new Error(`no mock ${symbol} on ${chainId}`);
  return t;
};
const USDC = byName(8453, 'USDC');
const FJ = byName(1, FEE_JUICE_SYMBOL);
const T0 = 1_000_000;

const quoteOf = (from: Token, phases: Phase[]): Quote => ({
  id: `q-${from.symbol}`,
  from,
  amountIn: 25n,
  feeJuiceOut: 12n,
  feeJuiceMin: 11n,
  costs: [],
  steps: phases.map((phase) => ({ phase, etaSeconds: 30, signs: phase === 'swap' || phase === 'deposit' })),
  expiresAt: T0 + 30_000,
});
const SWAP = quoteOf(USDC, ['swap', 'deposit', 'message', 'claim']);
const DIRECT = quoteOf(FJ, ['deposit', 'message', 'claim']);

const run = (events: FundingEvent[], from: Funding = { at: 'idle' }): Funding => events.reduce(reduce, from);

/** Open, pick, quote and confirm before the quote expires: the trade at its first step. */
const confirmed = (q: Quote): Funding =>
  run([
    { type: 'open' },
    { type: 'choose', token: q.from },
    { type: 'amount', amountIn: q.amountIn },
    { type: 'quoted', quote: q },
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

  test('the mock reads its switches from a closed vocabulary, anything else as none', () => {
    expect(scriptFrom('?fees=b&fees-fail=claim&fees-hold=message')).toEqual({
      fail: 'claim',
      hold: 'message',
    });
    expect(scriptFrom('?fees-hold=sign')).toEqual({ fail: 'none', hold: 'sign' });
    for (const hostile of [
      '?fees-fail=<img src=x onerror=alert(1)>',
      '?fees-fail=none&fees-hold=__proto__',
      '?fees-fail=CLAIM&fees-hold=Message',
      '?fees-fail=&fees-hold=',
      '',
    ])
      expect(scriptFrom(hostile), hostile).toEqual({ fail: 'none', hold: null });
  });
});
