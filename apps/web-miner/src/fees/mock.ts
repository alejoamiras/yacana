// The only provider behind the flow: static chains, tokens and rates, scripted delays, and failures
// and holds chosen from the page's query. It reaches no network and no wallet.

import {
  type Chain,
  type Cost,
  FEE_JUICE_DECIMALS,
  type FeeFundingProvider,
  FundingError,
  type Phase,
  type PhaseEvent,
  type Quote,
  type QuoteStep,
  type Token,
} from './provider';

export type MockFailure = 'none' | 'expired' | 'rejected' | 'late' | 'claim';
export type MockHold = 'sign' | Phase | null;

export interface MockScript {
  /** Injected once each: a retry after it succeeds. */
  readonly fail: MockFailure;
  /** A step that never finishes until aborted: `sign` holds the first wallet ask, a phase holds after its signature. */
  readonly hold: MockHold;
}

const FAILURES: readonly MockFailure[] = ['expired', 'rejected', 'late', 'claim'];
const HOLDS: readonly string[] = ['sign', 'swap', 'deposit', 'message', 'claim'];

/** `?fees-fail=` and `?fees-hold=` against closed vocabularies; anything else is none. */
export function scriptFrom(search: string): MockScript {
  const q = new URLSearchParams(search);
  const fail = q.get('fees-fail') ?? '';
  const hold = q.get('fees-hold') ?? '';
  return {
    fail: (FAILURES as readonly string[]).includes(fail) ? (fail as MockFailure) : 'none',
    hold: HOLDS.includes(hold) ? (hold as MockHold) : null,
  };
}

/** Milliseconds the mock takes; the quote's ETAs are the realistic ones the visitor reads. */
export const MOCK_TIMING = {
  quote: 700,
  life: 30_000,
  sign: 1200,
  swap: 1500,
  deposit: 1500,
  message: 2500,
  claim: 2000,
  /** With `fail=late`: the message reports late here and finishes at `lateDone`. */
  late: 1500,
  lateDone: 5000,
};
export type MockTiming = typeof MOCK_TIMING;

const ETHEREUM = 1;
export const MOCK_CHAINS: readonly Chain[] = [
  { id: ETHEREUM, name: 'Ethereum' },
  { id: 8453, name: 'Base' },
  { id: 42161, name: 'Arbitrum' },
];

const unit = (decimals: number) => 10n ** BigInt(decimals);
const token = (chainId: number, symbol: string, name: string, decimals: number, whole: number): Token => ({
  chainId,
  address: `0x${chainId.toString(16).padStart(4, '0')}${symbol.toLowerCase().padEnd(36, '0').slice(0, 36)}`,
  symbol,
  name,
  decimals,
  balance: (BigInt(Math.round(whole * 1000)) * unit(decimals)) / 1000n,
});

export const FEE_JUICE_SYMBOL = 'FJ';

export const MOCK_TOKENS: readonly Token[] = [
  token(ETHEREUM, 'ETH', 'Ether', 18, 0.42),
  token(ETHEREUM, 'USDC', 'USD Coin', 6, 180),
  token(ETHEREUM, FEE_JUICE_SYMBOL, 'Fee Juice', FEE_JUICE_DECIMALS, 40),
  token(8453, 'ETH', 'Ether', 18, 0.15),
  token(8453, 'USDC', 'USD Coin', 6, 64.5),
  token(42161, 'ETH', 'Ether', 18, 0.08),
  token(42161, 'USDC', 'USD Coin', 6, 25),
];

/** Fee Juice per whole token, in thousandths: the mock's rates, not prices. */
const RATE_MILLI: Readonly<Record<string, bigint>> = {
  ETH: 1_600_000n,
  USDC: 500n,
  [FEE_JUICE_SYMBOL]: 1000n,
};

const stepsFor = (from: Token): QuoteStep[] => {
  const deposit: QuoteStep[] = [
    { phase: 'deposit', etaSeconds: 30, signs: true },
    { phase: 'message', etaSeconds: 240, signs: false },
    { phase: 'claim', etaSeconds: 20, signs: false },
  ];
  if (from.symbol === FEE_JUICE_SYMBOL) return deposit;
  const swap: QuoteStep =
    from.chainId === ETHEREUM
      ? { phase: 'swap', etaSeconds: 30, signs: true, via: 'Uniswap' }
      : { phase: 'swap', etaSeconds: 120, signs: true, via: 'Across' };
  return [swap, ...deposit];
};

/** The route's take in the token (swap 0.3 %, a bridge 0.1 % more), and Ethereum's gas in ETH. */
const costsFor = (from: Token, amountIn: bigint): Cost[] => {
  const costs: Cost[] = [];
  if (from.symbol !== FEE_JUICE_SYMBOL) {
    const bps = from.chainId === ETHEREUM ? 30n : 40n;
    costs.push({
      label: from.chainId === ETHEREUM ? 'Swap' : 'Bridge and swap',
      amount: (amountIn * bps) / 10_000n,
      symbol: from.symbol,
      decimals: from.decimals,
    });
  }
  costs.push({ label: 'Gas on Ethereum', amount: 4n * unit(14), symbol: 'ETH', decimals: 18 });
  return costs;
};

const firstSigning = (quote: Quote): Phase | undefined => quote.steps.find((s) => s.signs)?.phase;

const abortError = () => new DOMException('aborted', 'AbortError');

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(abortError());
    });
  });

const never = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) return reject(abortError());
    signal.addEventListener('abort', () => reject(abortError()));
  });

const mockTx = (phase: Phase, n: number) =>
  `0x${phase.length.toString(16)}${n.toString(16).padStart(3, '0')}${'7e'.repeat(30)}`;

export function mockProvider(script: MockScript, timing: MockTiming = MOCK_TIMING): FeeFundingProvider {
  const spent = new Set<MockFailure>();
  let quotes = 0;
  let sends = 0;
  let received = 0n;
  /** True the first time the script's failure applies; never again, so a retry goes through. */
  const once = (f: MockFailure, applies: boolean): boolean => {
    if (script.fail !== f || !applies || spent.has(f)) return false;
    spent.add(f);
    return true;
  };

  const sign = async (phase: Phase, quote: Quote, on: (e: PhaseEvent) => void, signal: AbortSignal) => {
    const first = phase === firstSigning(quote);
    on({ kind: 'signing' });
    if (script.hold === 'sign' && first) await never(signal);
    await wait(timing.sign, signal);
    if (once('rejected', first)) throw new FundingError('rejected', 'The wallet did not confirm.');
    on({ kind: 'sent', tx: mockTx(phase, ++sends) });
  };

  const message = async (on: (e: PhaseEvent) => void, signal: AbortSignal) => {
    if (!once('late', true)) {
      if (script.hold === 'message') await never(signal);
      return wait(timing.message, signal);
    }
    await wait(timing.late, signal);
    on({ kind: 'late' });
    if (script.hold === 'message') await never(signal);
    await wait(timing.lateDone - timing.late, signal);
  };

  return {
    chains: async () => MOCK_CHAINS,
    tokens: async (chainId) => MOCK_TOKENS.filter((t) => t.chainId === chainId),
    async quote(from, amountIn, _recipient, signal) {
      await wait(timing.quote, signal);
      const costs = costsFor(from, amountIn);
      const kept = amountIn - (costs[0]?.symbol === from.symbol ? (costs[0]?.amount ?? 0n) : 0n);
      const out =
        (kept * (RATE_MILLI[from.symbol] ?? 0n) * unit(FEE_JUICE_DECIMALS)) / (1000n * unit(from.decimals));
      return {
        id: `q${++quotes}`,
        from,
        amountIn,
        feeJuiceOut: out,
        feeJuiceMin: (out * 99n) / 100n,
        costs,
        steps: stepsFor(from),
        expiresAt: Date.now() + timing.life,
      };
    },
    async run(phase, quote, on, signal) {
      if (once('expired', phase === quote.steps[0]?.phase))
        throw new FundingError('expired', 'The quote ran out before it was used.');
      const step = quote.steps.find((s) => s.phase === phase);
      if (step?.signs) await sign(phase, quote, on, signal);
      if (phase === 'message') return message(on, signal);
      if (script.hold === phase) await never(signal);
      await wait(timing[phase], signal);
      if (phase !== 'claim') return;
      if (once('claim', true)) throw new FundingError('failed', 'The claim did not go through.');
      received += quote.feeJuiceOut;
    },
    feeJuiceBalance: async () => received,
  };
}
