import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { ReactNode } from 'react';
import { sepolia } from 'viem/chains';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createConfig, http, mock, useAccount, WagmiProvider } from 'wagmi';
import { connect } from 'wagmi/actions';
import type { BridgeSession } from '../bridge/session';
import { feesCardAtom } from '../fees-gate';
import { bridgeSessionAtom } from '../state';
import { MOCK_CHAINS, MOCK_TIMING, MOCK_TOKENS, type MockFunding, mockFunding, scriptFrom } from './mock';
import { OptionB } from './options/B';
import { arranged, chainTabs, type Holding, searched } from './parts/TokenPicker';
import type { FeeFundingProvider, FundingReads, Phase, Quote, Token } from './provider';
import { type FundingRecord, newRecord, toFile } from './recovery';
import { FundingRun, NOT_FOUND } from './run';
import { FeesWallet, OWN_STORAGE_KEY } from './wallet';

const SCOPE = { chainId: '11155111', rollupVersion: '7' };
/** Settles in a microtask: WebCrypto's thread pool never answers under fake timers (recovery.test.ts derives the real one). */
const quickCommit = async (r: FundingRecord) => `0x${r.index.toString(16).padStart(64, '0')}`;
const runOn = (provider: FeeFundingProvider) => new FundingRun(provider, SCOPE, { commit: quickCommit });
/** A file whose text settles in a microtask: Node reads a Blob on its thread pool, which fake timers never wait for. */
const fileOf = (json: string) => Object.assign(new File([json], 'funding.json'), { text: async () => json });

const PAYER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as const;
/** wagmi's mock connector with one account, no RPC behind it, connected before the specs run. */
const connected = createConfig({
  chains: [sepolia],
  connectors: [mock({ accounts: [PAYER], features: { reconnect: true } })],
  transports: { [sepolia.id]: http('http://127.0.0.1:9') },
});
const queries = new QueryClient();
const withWallet = (ui: ReactNode) => (
  <WagmiProvider config={connected}>
    <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
  </WagmiProvider>
);
beforeAll(async () => {
  await connect(connected, { connector: connected.connectors[0] as (typeof connected.connectors)[number] });
});

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

type Resumed = Awaited<ReturnType<FeeFundingProvider['resume']>>;

/** A provider whose every answer the test gives by hand. */
function byHand() {
  const quotes: { amountIn: bigint; answer: (q: Quote) => void }[] = [];
  const runs: { phase: Phase; commit: string; done: () => void; signal: AbortSignal }[] = [];
  const resumes: { commit: string; answer: (r: Resumed) => void; signal: AbortSignal }[] = [];
  const provider: FeeFundingProvider = {
    chains: async () => [],
    tokens: async () => [],
    quote: (_from, amountIn) => new Promise((answer) => quotes.push({ amountIn, answer })),
    run: (phase, _quote, commit, _on, signal) =>
      new Promise((done) => runs.push({ phase, commit, done: () => done(), signal })),
    resume: ({ commit }, signal) => new Promise((answer) => resumes.push({ commit, answer, signal })),
  };
  return { provider, quotes, runs, resumes };
}

/** Every file the page downloaded: its name and its blob. */
const downloads: { name: string; blob: Blob }[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  downloads.length = 0;
  let last: Blob | undefined;
  // jsdom has neither blob URLs nor downloads: the anchor's click records what would have been saved.
  URL.createObjectURL = (b: Blob) => {
    last = b;
    return 'blob:fees';
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (last) downloads.push({ name: this.download, blob: last });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the funding runner', () => {
  test('one step at a time; an answer for an old amount, or from a trade since reset, changes nothing', async () => {
    const { provider, quotes, runs } = byHand();
    const run = runOn(provider);
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

    await run.saveAndConfirm();
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
    await run.saveAndConfirm();
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

  test("a restore runs no landed step, under the file's commitment; a reset while it resolves leaves idle", async () => {
    const { provider, runs, resumes } = byHand();
    const run = runOn(provider);
    const record = newRecord(SCOPE, { token: USDC, amountIn: 30n }, 0, 7);
    const file = () => fileOf(JSON.stringify(toFile(record)));
    const found = { quote: quoteFor(30n), landed: ['swap', 'deposit'] as Phase[] };
    const dropped = run.restore(file());
    await vi.advanceTimersByTimeAsync(0);
    run.dispatch({ type: 'reset' });
    expect(resumes[0]?.signal.aborted).toBe(true);
    resumes[0]?.answer(found);
    expect(await dropped).toBeNull();
    expect(run.getState()).toEqual({ at: 'idle' });

    const resumed = run.restore(file());
    await vi.advanceTimersByTimeAsync(0);
    resumes[1]?.answer(found);
    expect(await resumed).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.map((r) => [r.phase, r.commit])).toEqual([['message', await quickCommit(record)]]);
    expect(resumes[1]?.commit).toBe(await quickCommit(record));
  });
});

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const id = (testId: string) => screen.getByTestId(testId);
const stateOf = (phase: Phase) => id(`fees-step-${phase}`).getAttribute('data-state');
const go = () => id('fees-go') as HTMLButtonElement;
const cardCounted = () => getDefaultStore().get(feesCardAtom);
/** Sepolia's USDC, 100 of it: a swap route of four steps, about 9.9 s of mock time. */
const TRADE_MS = 15_000;
/** The mock's tokens and the wallet's balances of them are read once the view mounts. */
const holdingsRead = () => tick(MOCK_TIMING.quote);

/** B on a fresh mock, connected; `remount` unmounts it and renders it again on the same runner, as a route change does. */
async function show(
  search = '',
  opts: {
    signedIn?: boolean;
    provider?: (p: FeeFundingProvider) => FeeFundingProvider;
    reads?: (r: FundingReads) => FundingReads;
  } = {},
) {
  const mock: MockFunding = mockFunding(scriptFrom(search));
  const provider = opts.provider ? opts.provider(mock.provider) : mock.provider;
  const reads = opts.reads ? opts.reads(mock.reads) : mock.reads;
  const run = runOn(provider);
  const ui = () =>
    withWallet(<OptionB run={run} provider={provider} reads={reads} signedIn={opts.signedIn ?? true} />);
  let view = render(ui());
  await holdingsRead();
  const remount = async () => {
    view.unmount();
    view = render(ui());
    await holdingsRead();
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
    };
    await show('', {
      provider: (p) => ({ ...p, tokens: async (s) => [...(await p.tokens(s)), ZZZ] }),
      reads: (r) => ({
        ...r,
        balances: async (owner, tokens, s) => {
          const read = await r.balances(owner, tokens, s);
          return tokens.map((t, i) => (t === ZZZ ? 10n ** 21n : (read[i] ?? 0n)));
        },
      }),
    });
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

describe('the wallet and its tokens', () => {
  const HELD = [
    '11155111:DAI',
    '11155111:FJ',
    '11155111:LINK',
    '11155111:USDC',
    '11155111:WETH',
    '84532:USDC',
  ];
  const keys = (hs: readonly Holding[]) => hs.map((h) => `${h.token.chainId}:${h.token.symbol}`);
  const holdings = async () => {
    const { reads } = mockFunding(scriptFrom(''), { ...MOCK_TIMING, quote: 0 });
    const read = reads.balances(PAYER, MOCK_TOKENS, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    const balances = await read;
    return MOCK_TOKENS.map((token, i) => ({ token, balance: balances[i] ?? 0n }));
  };

  test('every ordering lists the held supported tokens; a search reaches the unheld after them', async () => {
    const hs = await holdings();
    expect(keys(arranged(MOCK_CHAINS, hs, 'one-list').held)).toEqual(HELD);
    expect(arranged(MOCK_CHAINS, hs, 'one-list').rest).toEqual([]);
    const first = arranged(MOCK_CHAINS, hs, 'held-first');
    expect(keys(first.held)).toEqual(HELD);
    expect(first.rest).toHaveLength(hs.length - HELD.length);
    expect(chainTabs(MOCK_CHAINS, hs, 84532).map((c) => c.id)).toEqual([84532, 11155111]);
    expect(keys(arranged(MOCK_CHAINS, hs, 'by-chain', 84532).held)).toEqual(['84532:USDC']);
    expect(keys(arranged(MOCK_CHAINS, hs, 'by-chain', 11155111).held)).toEqual(HELD.slice(0, 5));
    const found = searched(MOCK_CHAINS, hs, 'usd');
    expect(keys(found.slice(0, 2))).toEqual(['11155111:USDC', '84532:USDC']);
    expect(keys(found.slice(2))).toContain('11155111:USDT');
    expect(found.slice(2).every((h) => h.balance === 0n)).toBe(true);
  });

  test('the picker asks the wallet only about routed tokens; an unheld one is found but cannot be chosen', async () => {
    const asked: Token[][] = [];
    await show('', {
      reads: (r) => ({
        ...r,
        balances: (o, tokens, s) => {
          asked.push([...tokens]);
          return r.balances(o, tokens, s);
        },
      }),
    });
    expect(asked).toEqual([[...MOCK_TOKENS]]);
    fireEvent.click(id('fees-entry'));
    await tick(0);
    expect(id('fees-token-11155111-DAI').getAttribute('data-held')).toBe('true');
    expect(screen.getByText('Not in this wallet')).toBeTruthy();
    fireEvent.change(id('fees-search'), { target: { value: 'usdt' } });
    const usdt = id('fees-token-11155111-USDT') as HTMLButtonElement;
    expect(usdt.disabled).toBe(true);
    expect(usdt.textContent).toContain('not in this wallet');
  });

  test('a wallet holding none of them says so, and search still shows what would', async () => {
    await show('?fees-wallet=empty');
    fireEvent.click(id('fees-entry'));
    await tick(0);
    expect(id('fees-picker-empty').textContent).toBe(
      'This wallet holds nothing that buys Fee Juice. Search to see what does.',
    );
    fireEvent.change(id('fees-search'), { target: { value: 'usdc' } });
    expect((id('fees-token-84532-USDC') as HTMLButtonElement).disabled).toBe(true);
  });

  test("the flow moves to a bridge session's config and reads its account; its own store never holds it", async () => {
    const Probe = () => <span data-testid="probe">{useAccount().address ?? 'none'}</span>;
    render(
      <FeesWallet chainId={sepolia.id}>
        <Probe />
      </FeesWallet>,
    );
    await tick(0);
    expect(id('probe').textContent).toBe('none');
    try {
      act(() => getDefaultStore().set(bridgeSessionAtom, { config: connected } as unknown as BridgeSession));
      await tick(0);
      expect(id('probe').textContent).toBe(PAYER);
      const own = Object.keys(localStorage).filter((k) => k.startsWith(OWN_STORAGE_KEY));
      for (const k of own) expect(localStorage.getItem(k)?.toLowerCase()).not.toContain(PAYER.toLowerCase());
    } finally {
      act(() => getDefaultStore().set(bridgeSessionAtom, null));
    }
  });
});

/** Loads `json` at the entry's file input and lets the mock's resume answer. */
async function load(json: string) {
  const input = id('fees-restore') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [fileOf(json)], configurable: true });
  fireEvent.change(input);
  await tick(0);
  await tick(MOCK_TIMING.quote);
}

describe('the recovery file', () => {
  test('B saves it on Fund fees; on a fresh page it resumes at the message and runs to done', async () => {
    await show();
    fireEvent.click(id('fees-entry'));
    await sepoliaUsdc();
    fireEvent.click(go());
    await tick(0);
    expect(stateOf('swap')).toBe('signing');
    const [first] = downloads;
    expect(first?.name).toMatch(/^yacana-fees-11155111-\d+\.json$/);
    const saved = await (first as { blob: Blob }).blob.text();
    // No account and no secret: the index is all the file binds.
    expect(Object.keys(JSON.parse(saved)).sort()).toEqual([
      'chainId',
      'createdAt',
      'hint',
      'index',
      'kind',
      'rollupVersion',
      'v',
    ]);
    fireEvent.click(id('fees-save-again'));
    await tick(0);
    expect(downloads.map((d) => d.name)).toEqual([first?.name, first?.name]);

    cleanup();
    await show();
    await load(saved);
    expect([stateOf('swap'), stateOf('deposit'), stateOf('message')]).toEqual(['done', 'done', 'running']);
    await tick(TRADE_MS);
    expect(id('fees-done').textContent).toContain('Fees ready: 49.85 Fee Juice.');
  });

  test('a file for another network, or one no deposit carries, says why and leaves the entry', async () => {
    await show('?fees-resume=missing');
    const record = toFile(newRecord(SCOPE, { token: USDC, amountIn: 100n * 10n ** 6n }, 0, 3));
    await load(JSON.stringify({ ...record, chainId: '1' }));
    expect(id('fees-restore-error').textContent).toContain('The file is for another network.');
    await load(JSON.stringify(record));
    expect(id('fees-restore-error').textContent).toContain(NOT_FOUND);
    expect(id('fees-entry')).toBeTruthy();
  });

  test('a file whose every step landed is done at once', async () => {
    await show('?fees-resume=claimed');
    await load(JSON.stringify(toFile(newRecord(SCOPE, { token: USDC, amountIn: 10n ** 8n }, 0, 3))));
    expect(id('fees-done')).toBeTruthy();
  });
});
