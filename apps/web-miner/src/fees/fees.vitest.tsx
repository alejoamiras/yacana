import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MOCK_TIMING, MOCK_TOKENS, mockProvider, scriptFrom } from './mock';
import { OptionA } from './options/A';
import { OptionB } from './options/B';
import { OptionC } from './options/C';
import type { FeeFundingProvider, Phase, Quote, Token } from './provider';
import { FundingRun, type OptionProps } from './run';

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
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the funding runner', () => {
  test('one step at a time; an answer for an old amount, or from a trade since reset, changes nothing', async () => {
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
    // A new trade reaches the same phase before the old deposit answers: the answer must not finish the new one.
    run.dispatch({ type: 'open' });
    run.dispatch({ type: 'choose', token: USDC });
    run.dispatch({ type: 'amount', amountIn: 30n });
    await vi.advanceTimersByTimeAsync(300);
    quotes[2]?.answer(quoteFor(30n));
    await vi.advanceTimersByTimeAsync(0);
    run.confirm();
    await vi.advanceTimersByTimeAsync(0);
    runs[2]?.done();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.map((r) => r.phase)).toEqual(['swap', 'deposit', 'swap', 'deposit']);
    runs[1]?.done();
    await vi.advanceTimersByTimeAsync(0);
    const now = run.getState();
    expect(now.at === 'trade' && now.steps.map((x) => x.status)).toEqual(['done', 'running', 'todo', 'todo']);
    expect(runs).toHaveLength(4);
  });
});

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const id = (testId: string) => screen.getByTestId(testId);
const stateOf = (phase: Phase) => id(`fees-step-${phase}`).getAttribute('data-state');
/** Base's USDC, 25 of it: a swap route of four steps, about 9.9 s of mock time. */
const TRADE_MS = 15_000;

/** The option on a fresh mock; `remount` unmounts it and renders it again on the same runner, as a route change does. */
async function show(Option: (p: OptionProps) => React.ReactNode, search = '') {
  const provider = mockProvider(scriptFrom(search));
  const run = new FundingRun(provider);
  const ui = () => <Option run={run} provider={provider} account={`0x${'0'.repeat(60)}fee5`} />;
  let view = render(ui());
  await tick(0);
  const remount = async () => {
    view.unmount();
    view = render(ui());
    await tick(0);
  };
  return { run, remount };
}

/** From the open picker: Base, a search for "usd", USDC, 25, and the quote it brings. */
async function quoteUsdc() {
  fireEvent.click(screen.getByRole('radio', { name: 'Base' }));
  await tick(0);
  fireEvent.change(id('fees-search'), { target: { value: 'usd' } });
  expect(screen.queryByTestId('fees-token-ETH')).toBeNull();
  fireEvent.click(id('fees-token-USDC'));
  fireEvent.change(id('fees-amount'), { target: { value: '25' } });
  expect((id('fees-go') as HTMLButtonElement).disabled).toBe(true);
  await tick(300 + MOCK_TIMING.quote);
  expect(id('fees-quote').textContent).toContain('12.45 Fee Juice');
  expect(id('fees-quote').textContent).toContain(
    'Visible on Ethereumyour wallet, the amount and this account',
  );
}

describe('the three options on the mock', () => {
  test('A: the balance line, the dialog, a trade to done, and the line reads the Fee Juice', async () => {
    await show(OptionA);
    expect(id('fees-line').textContent).toContain('none Fee Juice');
    fireEvent.click(id('fees-entry'));
    await quoteUsdc();
    fireEvent.click(id('fees-go'));
    await tick(TRADE_MS);
    expect(id('fees-done').textContent).toContain('12.45 more Fee Juice');
    for (const phase of ['swap', 'deposit', 'message', 'claim'] as const) expect(stateOf(phase)).toBe('done');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await tick(0);
    expect(id('fees-held').textContent).toContain('12.45');
  });

  test('B: the card before you mine; the dialog picks and quotes, the card carries the trade', async () => {
    await show(OptionB);
    expect(id('fees-card').textContent).toContain('Fund fees before you mine.');
    fireEvent.click(id('fees-entry'));
    await quoteUsdc();
    fireEvent.click(id('fees-go'));
    await tick(0);
    expect(screen.queryByTestId('fees-dialog')).toBeNull();
    expect(stateOf('swap')).toBe('signing');
    await tick(TRADE_MS);
    expect(id('fees-done').textContent).toContain('Fees ready: 12.45 Fee Juice.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(id('fees-entry')).toBeTruthy();
  });

  test('C: the Settings tile; the picker in a popover, the quote inline, the timeline to done', async () => {
    await show(OptionC);
    expect(id('fees-held').textContent).toContain('none');
    fireEvent.click(id('fees-entry'));
    await quoteUsdc();
    // Choosing the same token again keeps the amount and its quote.
    fireEvent.click(id('fees-entry'));
    fireEvent.click(screen.getByRole('radio', { name: 'Base' }));
    await tick(0);
    fireEvent.click(id('fees-token-USDC'));
    await tick(0);
    expect((id('fees-go') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(id('fees-go'));
    await tick(TRADE_MS);
    expect(id('fees-done').textContent).toContain('Fees ready: 12.45 Fee Juice.');
    expect(id('fees-held').textContent).toContain('12.45');
  });
});

describe('what the options share', () => {
  test('a quote left behind is dropped; one that ran out comes back with every decimal of its amount', async () => {
    const { run, remount } = await show(OptionC, '?fees-fail=expired');
    const ethOnBase = async () => {
      fireEvent.click(id('fees-entry'));
      fireEvent.click(screen.getByRole('radio', { name: 'Base' }));
      await tick(0);
      fireEvent.click(id('fees-token-ETH'));
      fireEvent.change(id('fees-amount'), { target: { value: '0.0000001' } });
      await tick(300 + MOCK_TIMING.quote);
      expect(id('fees-quote')).toBeTruthy();
    };
    await ethOnBase();
    await remount();
    expect(run.getState()).toEqual({ at: 'idle' });
    expect(screen.queryByTestId('fees-amount')).toBeNull();
    await ethOnBase();
    fireEvent.click(id('fees-go'));
    await tick(0);
    expect(id('fees-refreshed')).toBeTruthy();
    expect((id('fees-amount') as HTMLInputElement).value).toBe('0.0000001');
    expect(screen.queryByTestId('amount-refusal')).toBeNull();
    await tick(300 + MOCK_TIMING.quote);
    expect((id('fees-go') as HTMLButtonElement).disabled).toBe(false);
  });

  test('A refused by the wallet says nothing moved; past the quote, the retry gets a new one and runs to done', async () => {
    await show(OptionA, '?fees-fail=rejected');
    fireEvent.click(id('fees-entry'));
    await quoteUsdc();
    fireEvent.click(id('fees-go'));
    await tick(MOCK_TIMING.sign);
    expect(id('fees-failure').textContent).toContain('Your wallet did not confirm.Nothing has moved.');
    expect(stateOf('swap')).toBe('failed');
    expect(id('fees-retry').textContent).toBe('Try again');
    // Left past the quote's life, the retry asks for a new quote first, and the button says so.
    await tick(MOCK_TIMING.life);
    expect(id('fees-retry').textContent).toBe('Get a new quote');
    fireEvent.click(id('fees-retry'));
    await tick(300 + MOCK_TIMING.quote);
    expect(id('fees-refreshed')).toBeTruthy();
    fireEvent.click(id('fees-go'));
    await tick(TRADE_MS);
    expect(id('fees-done')).toBeTruthy();
  });

  test('a quote left to run out is replaced by a fresh one', async () => {
    const { run } = await show(OptionA);
    fireEvent.click(id('fees-entry'));
    await quoteUsdc();
    const first = run.getState();
    expect(id('fees-countdown').textContent).toContain('new quote in 0:30');
    await tick(MOCK_TIMING.life - 1000);
    expect(id('fees-countdown').textContent).toContain('new quote in 0:01');
    await tick(1000);
    expect(screen.queryByTestId('fees-quote')).toBeNull();
    expect((id('fees-go') as HTMLButtonElement).disabled).toBe(true);
    await tick(300 + MOCK_TIMING.quote);
    const fresh = run.getState();
    expect(fresh.at === 'quote' && first.at === 'quote' && fresh.quote?.id !== first.quote?.id).toBe(true);
    expect(id('fees-countdown').textContent).toContain('new quote in 0:30');
  });

  test("A's dialog cannot close while the wallet asks; closed mid-trade and reopened, it shows the same progress", async () => {
    await show(OptionA);
    fireEvent.click(id('fees-entry'));
    await quoteUsdc();
    fireEvent.click(id('fees-go'));
    await tick(0);
    expect(stateOf('swap')).toBe('signing');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    // Swap and deposit land after 5.4 s; the crossing runs to 7.9 s.
    await tick(6_000);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await tick(0);
    expect(screen.queryByTestId('fees-dialog')).toBeNull();
    expect(id('fees-line').textContent).toContain('crossing to aztec');
    fireEvent.click(within(id('fees-line')).getByTestId('fees-entry'));
    expect(id('fees-entry').textContent).toContain('Show');
    expect([stateOf('swap'), stateOf('deposit'), stateOf('message')]).toEqual(['done', 'done', 'running']);
  });
});
