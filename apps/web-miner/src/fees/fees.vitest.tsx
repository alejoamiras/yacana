import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MOCK_TOKENS } from './mock';
import type { FeeFundingProvider, Phase, Quote, Token } from './provider';
import { FundingRun } from './run';

const USDC = MOCK_TOKENS.find((t) => t.chainId === 8453 && t.symbol === 'USDC') as Token;

const quoteFor = (amountIn: bigint): Quote => ({
  id: `q${amountIn}`,
  from: USDC,
  amountIn,
  feeJuiceOut: amountIn,
  feeJuiceMin: amountIn,
  costs: [],
  steps: (['swap', 'deposit', 'message', 'claim'] as const).map((phase) => ({
    phase,
    etaSeconds: 30,
    signs: false,
  })),
  expiresAt: Date.now() + 60_000,
});

/** A provider whose every answer the test gives by hand. */
function byHand() {
  const quotes: { amountIn: bigint; answer: (q: Quote) => void }[] = [];
  const runs: { phase: Phase; done: () => void; signal: AbortSignal }[] = [];
  const provider: FeeFundingProvider = {
    chains: async () => [],
    tokens: async () => [],
    quote: (_from, amountIn) => new Promise((answer) => quotes.push({ amountIn, answer })),
    run: (phase, _quote, _on, signal) =>
      new Promise((done) => runs.push({ phase, done: () => done(), signal })),
    feeJuiceBalance: async () => 0n,
  };
  return { provider, quotes, runs };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the funding runner', () => {
  test('one step at a time; an answer for an old amount, or after a reset, changes nothing', async () => {
    const { provider, quotes, runs } = byHand();
    const run = new FundingRun(provider);
    run.dispatch({ type: 'open' });
    run.dispatch({ type: 'choose', token: USDC });
    run.dispatch({ type: 'amount', amountIn: 25n });
    await vi.advanceTimersByTimeAsync(300);
    run.dispatch({ type: 'amount', amountIn: 30n });
    await vi.advanceTimersByTimeAsync(300);
    expect(quotes.map((q) => q.amountIn)).toEqual([25n, 30n]);
    quotes[0]?.answer(quoteFor(25n));
    await vi.advanceTimersByTimeAsync(0);
    expect(run.getState()).toMatchObject({ at: 'quote', amountIn: 30n, quote: null });
    quotes[1]?.answer(quoteFor(30n));
    await vi.advanceTimersByTimeAsync(0);
    expect(run.getState()).toMatchObject({ at: 'quote', quote: { amountIn: 30n } });

    run.confirm();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs.map((r) => r.phase)).toEqual(['swap']);
    runs[0]?.done();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.map((r) => r.phase)).toEqual(['swap', 'deposit']);

    run.dispatch({ type: 'reset' });
    expect(runs[1]?.signal.aborted).toBe(true);
    runs[1]?.done();
    await vi.advanceTimersByTimeAsync(0);
    expect(run.getState()).toEqual({ at: 'idle' });
    expect(runs).toHaveLength(2);
  });
});
