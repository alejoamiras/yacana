import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { feesCardAtom } from '../fees-gate';
import { MOCK_TIMING, MOCK_TOKENS, mockFunding, scriptFrom } from './mock';
import { OptionB } from './options/B';
import type { FeeFundingProvider, Phase, Quote, Token } from './provider';
import { FundingRun } from './run';

const USDC = MOCK_TOKENS.find((t) => t.chainId === 84532 && t.symbol === 'USDC') as Token;

const quoteFor = (amountIn: bigint): Quote => ({
  id: `q${amountIn}`,
  from: USDC,
  amountIn,
  feeJuiceOut: amountIn,
  feeJuiceMin: amountIn,
  claimMin: 0n,
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
const go = () => id('fees-go') as HTMLButtonElement;
const cardCounted = () => getDefaultStore().get(feesCardAtom);
/** Sepolia's USDC, 100 of it: a swap route of four steps, about 9.9 s of mock time. */
const TRADE_MS = 15_000;

/** B on a fresh mock; `remount` unmounts it and renders it again on the same runner, as a route change does. */
async function show(
  search = '',
  opts: { signedIn?: boolean; provider?: (p: FeeFundingProvider) => FeeFundingProvider } = {},
) {
  const mock = mockFunding(scriptFrom(search));
  const provider = opts.provider ? opts.provider(mock.provider) : mock.provider;
  const run = new FundingRun(provider);
  const ui = () => (
    <OptionB run={run} provider={provider} reads={mock.reads} signedIn={opts.signedIn ?? true} />
  );
  let view = render(ui());
  await tick(0);
  const remount = async () => {
    view.unmount();
    view = render(ui());
    await tick(0);
  };
  return { run, remount };
}

/** From the open picker: a search for "usd" across chains, a token, an amount, and the quote it brings. */
async function quote(token: string, amount: string) {
  await tick(0);
  fireEvent.change(id('fees-search'), { target: { value: 'usd' } });
  expect(screen.getByTestId('fees-token-84532-USDC')).toBeTruthy();
  fireEvent.click(id(token));
  fireEvent.change(id('fees-amount'), { target: { value: amount } });
  expect(go().disabled).toBe(true);
  await tick(300 + MOCK_TIMING.quote);
}

const sepoliaUsdc = async () => {
  await quote('fees-token-11155111-USDC', '100');
  expect(id('fees-quote').textContent).toContain('49.85 Fee Juice');
  expect(id('fees-quote').textContent).toContain('Visible on Ethereumyour wallet and the amount');
  expect(id('fees-claim-min').textContent).toContain('30 Fee Juice');
  expect(go().disabled).toBe(false);
};

describe('B on the mock', () => {
  test('the card before you mine; the dialog picks and quotes, the card carries the trade; dismissed, it goes', async () => {
    await show();
    expect(id('fees-card').textContent).toContain('Fund fees before you mine.');
    expect(cardCounted()).toBe(true);
    fireEvent.click(id('fees-entry'));
    await sepoliaUsdc();
    fireEvent.click(go());
    await tick(0);
    expect(screen.queryByTestId('fees-dialog')).toBeNull();
    expect(stateOf('swap')).toBe('signing');
    await tick(TRADE_MS);
    expect(id('fees-done').textContent).toContain('Fees ready: 49.85 Fee Juice.');
    // The account now holds more than a claim costs: the entry rule keeps the card away.
    fireEvent.click(id('fees-dismiss'));
    await tick(0);
    expect(screen.queryByTestId('fees-card')).toBeNull();
    expect(cardCounted()).toBe(false);
  });

  test('signed out with no stand-in, there is no card and the cockpit counts none', async () => {
    await show('', { signedIn: false });
    expect(screen.queryByTestId('fees-card')).toBeNull();
    expect(cardCounted()).toBe(false);
  });

  test('a token the mock never named still lists, quotes and confirms: the views assume no list', async () => {
    const ZZZ: Token = {
      chainId: 84532,
      address: `0x${'7a'.repeat(20)}`,
      symbol: 'ZZZ',
      name: 'Zed',
      decimals: 18,
      balance: 10n ** 21n,
    };
    await show('', { provider: (p) => ({ ...p, tokens: async (s) => [...(await p.tokens(s)), ZZZ] }) });
    fireEvent.click(id('fees-entry'));
    await tick(0);
    fireEvent.change(id('fees-search'), { target: { value: ZZZ.address } });
    fireEvent.click(id('fees-token-84532-ZZZ'));
    fireEvent.change(id('fees-amount'), { target: { value: '500' } });
    await tick(300 + MOCK_TIMING.quote);
    expect(id('fees-quote').textContent).toContain('about 124.5 Fee Juice');
    expect(go().disabled).toBe(false);
  });

  test('a quote below the claim minimum says so and cannot be confirmed', async () => {
    await show();
    fireEvent.click(id('fees-entry'));
    await quote('fees-token-11155111-USDC', '25');
    expect(id('fees-claim-min').className).toContain('text-warn');
    expect(id('amount-refusal').textContent).toBe('Too little to claim: at least 30 Fee Juice must arrive');
    expect(go().disabled).toBe(true);
  });
});

describe('what the flow keeps across views', () => {
  test('a quote left behind is dropped; one that ran out comes back with every decimal of its amount', async () => {
    const { run, remount } = await show('?fees-fail=expired');
    const weth = async () => {
      fireEvent.click(id('fees-entry'));
      await tick(0);
      fireEvent.change(id('fees-search'), { target: { value: 'weth' } });
      fireEvent.click(id('fees-token-11155111-WETH'));
      fireEvent.change(id('fees-amount'), { target: { value: '0.0200001' } });
      await tick(300 + MOCK_TIMING.quote);
      expect(id('fees-quote')).toBeTruthy();
    };
    await weth();
    await remount();
    expect(run.getState()).toEqual({ at: 'idle' });
    expect(screen.queryByTestId('fees-amount')).toBeNull();
    await weth();
    fireEvent.click(go());
    await tick(0);
    expect(id('fees-refreshed')).toBeTruthy();
    expect((id('fees-amount') as HTMLInputElement).value).toBe('0.0200001');
    expect(screen.queryByTestId('amount-refusal')).toBeNull();
    await tick(300 + MOCK_TIMING.quote);
    expect(go().disabled).toBe(false);
  });

  test('refused by the wallet says nothing moved; past the quote, the retry gets a new one and runs to done', async () => {
    await show('?fees-fail=rejected');
    fireEvent.click(id('fees-entry'));
    await sepoliaUsdc();
    fireEvent.click(go());
    await tick(MOCK_TIMING.sign);
    expect(id('fees-failure').textContent).toContain('Your wallet did not confirm.');
    expect(id('fees-card').textContent).toContain('Nothing has moved.');
    expect(stateOf('swap')).toBe('failed');
    expect(id('fees-retry').textContent).toBe('Try again');
    // Left past the quote's life, the retry asks for a new quote first, and the button says so.
    await tick(MOCK_TIMING.life);
    expect(id('fees-retry').textContent).toBe('Get a new quote');
    fireEvent.click(id('fees-retry'));
    await tick(300 + MOCK_TIMING.quote);
    expect(id('fees-refreshed')).toBeTruthy();
    fireEvent.click(go());
    await tick(TRADE_MS);
    expect(id('fees-done')).toBeTruthy();
  });

  test('a quote left to run out is replaced by a fresh one', async () => {
    const { run } = await show();
    fireEvent.click(id('fees-entry'));
    await sepoliaUsdc();
    const first = run.getState();
    expect(id('fees-countdown').textContent).toContain('new quote in 1:00');
    await tick(MOCK_TIMING.life - 1000);
    expect(id('fees-countdown').textContent).toContain('new quote in 0:01');
    await tick(1000);
    expect(screen.queryByTestId('fees-quote')).toBeNull();
    expect(go().disabled).toBe(true);
    await tick(300 + MOCK_TIMING.quote);
    const fresh = run.getState();
    expect(fresh.at === 'quote' && first.at === 'quote' && fresh.quote?.id !== first.quote?.id).toBe(true);
    expect(id('fees-countdown').textContent).toContain('new quote in 1:00');
  });
});
