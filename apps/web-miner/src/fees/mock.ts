// The only provider behind the flow: static chains, tokens and rates, scripted delays, and failures
// and holds chosen from the page's query. It reaches no network and no wallet.

import {
  type Chain,
  type Cost,
  FEE_JUICE_DECIMALS,
  type FeeFundingProvider,
  FundingError,
  type FundingReads,
  type Phase,
  type PhaseEvent,
  type Quote,
  type QuoteStep,
  type Token,
} from './provider';

export type MockFailure = 'none' | 'expired' | 'rejected' | 'late' | 'claim';
export type MockHold = 'sign' | Phase | null;
/** What a restore finds: the deposit landed and the message on its way, nothing, or every step landed. */
export type MockResume = 'found' | 'missing' | 'claimed';

export interface MockScript {
  /** Injected once each: a retry after it succeeds. */
  readonly fail: MockFailure;
  /** `empty`: the wallet holds none of the tokens the mock routes. */
  readonly wallet: 'held' | 'empty';
  /** A step that never finishes until aborted: `sign` holds the first wallet ask, a phase holds after its signature. */
  readonly hold: MockHold;
  readonly resume: MockResume;
}

const FAILURES: readonly MockFailure[] = ['expired', 'rejected', 'late', 'claim'];
const HOLDS: readonly string[] = ['sign', 'swap', 'deposit', 'message', 'claim'];

/** `?fees-fail=`, `?fees-hold=`, `?fees-wallet=` and `?fees-resume=` against closed vocabularies; anything else is the default. */
export function scriptFrom(search: string): MockScript {
  const q = new URLSearchParams(search);
  const fail = q.get('fees-fail') ?? '';
  const hold = q.get('fees-hold') ?? '';
  const resume = q.get('fees-resume');
  return {
    fail: (FAILURES as readonly string[]).includes(fail) ? (fail as MockFailure) : 'none',
    wallet: q.get('fees-wallet') === 'empty' ? 'empty' : 'held',
    hold: HOLDS.includes(hold) ? (hold as MockHold) : null,
    resume: resume === 'missing' || resume === 'claimed' ? resume : 'found',
  };
}

/** Milliseconds the mock takes; the quote's ETAs are the realistic ones the visitor reads. */
export const MOCK_TIMING = {
  quote: 700,
  life: 60_000,
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

const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
export const MOCK_CHAINS: readonly Chain[] = [
  { id: SEPOLIA, name: 'Sepolia' },
  { id: BASE_SEPOLIA, name: 'Base Sepolia' },
];

const unit = (decimals: number) => 10n ** BigInt(decimals);
const hexOf = (text: string) =>
  Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('');
/** A real-shaped address, unique per chain and symbol: the chain id, then the symbol's bytes. */
const token = (chainId: number, symbol: string, name: string, decimals: number): Token => ({
  chainId,
  address: `0x${chainId.toString(16).padStart(6, '0')}${hexOf(symbol).padEnd(34, '0').slice(0, 34)}`,
  symbol,
  name,
  decimals,
});

export const FEE_JUICE_SYMBOL = 'FJ';

/** What any wallet holds in the mock, in whole tokens, by chain and symbol. */
const HELD: Readonly<Record<string, number>> = {
  [`${SEPOLIA}:USDC`]: 180,
  [`${SEPOLIA}:${FEE_JUICE_SYMBOL}`]: 40,
  [`${SEPOLIA}:WETH`]: 0.42,
  [`${SEPOLIA}:DAI`]: 25,
  [`${SEPOLIA}:LINK`]: 12,
  [`${BASE_SEPOLIA}:USDC`]: 64.5,
};

/** Symbol, name and decimals of the tokens the mock routes on Sepolia, after Fee Juice: a token list, not a pick. */
const SEPOLIA_LIST: readonly (readonly [string, string, number])[] = [
  ['USDC', 'USD Coin', 6],
  ['USDT', 'Tether USD', 6],
  ['DAI', 'Dai Stablecoin', 18],
  ['WETH', 'Wrapped Ether', 18],
  ['WBTC', 'Wrapped BTC', 8],
  ['LINK', 'ChainLink Token', 18],
  ['UNI', 'Uniswap', 18],
  ['AAVE', 'Aave', 18],
  ['COMP', 'Compound', 18],
  ['MKR', 'Maker', 18],
  ['SNX', 'Synthetix Network Token', 18],
  ['CRV', 'Curve DAO Token', 18],
  ['LDO', 'Lido DAO Token', 18],
  ['ENS', 'Ethereum Name Service', 18],
  ['GRT', 'The Graph', 18],
  ['BAL', 'Balancer', 18],
  ['SUSHI', 'SushiSwap', 18],
  ['YFI', 'yearn.finance', 18],
  ['1INCH', '1inch', 18],
  ['ZRX', '0x Protocol Token', 18],
  ['BAT', 'Basic Attention Token', 18],
  ['MANA', 'Decentraland', 18],
  ['SAND', 'The Sandbox', 18],
  ['APE', 'ApeCoin', 18],
  ['SHIB', 'Shiba Inu', 18],
  ['PEPE', 'Pepe', 18],
  ['MATIC', 'Polygon', 18],
  ['ARB', 'Arbitrum', 18],
  ['OP', 'Optimism', 18],
  ['RPL', 'Rocket Pool', 18],
  ['RETH', 'Rocket Pool ETH', 18],
  ['STETH', 'Lido Staked Ether', 18],
  ['CBETH', 'Coinbase Wrapped Staked ETH', 18],
  ['FRAX', 'Frax', 18],
  ['LUSD', 'Liquity USD', 18],
  ['GNO', 'Gnosis', 18],
  ['BNT', 'Bancor Network Token', 18],
  ['KNC', 'Kyber Network Crystal', 18],
  ['LRC', 'Loopring', 18],
  ['STORJ', 'Storj', 8],
  ['UMA', 'UMA', 18],
  ['NMR', 'Numeraire', 18],
  ['OXT', 'Orchid', 18],
  ['REN', 'Republic Token', 18],
  ['ANKR', 'Ankr', 18],
  ['CHZ', 'Chiliz', 18],
  ['ENJ', 'Enjin Coin', 18],
  ['IMX', 'Immutable X', 18],
  ['INJ', 'Injective', 18],
  ['LPT', 'Livepeer', 18],
  ['QNT', 'Quant', 18],
  ['RNDR', 'Render Token', 18],
  ['AMP', 'Amp', 18],
  ['AXS', 'Axie Infinity', 18],
  ['CVC', 'Civic', 8],
  ['DYDX', 'dYdX', 18],
  ['FET', 'Fetch.ai', 18],
  ['PAXG', 'Paxos Gold', 18],
];

const held = (t: Token): bigint =>
  (BigInt(Math.round((HELD[`${t.chainId}:${t.symbol}`] ?? 0) * 1000)) * unit(t.decimals)) / 1000n;

export const MOCK_TOKENS: readonly Token[] = [
  token(SEPOLIA, FEE_JUICE_SYMBOL, 'Fee Juice', FEE_JUICE_DECIMALS),
  ...SEPOLIA_LIST.map(([symbol, name, decimals]) => token(SEPOLIA, symbol, name, decimals)),
  token(BASE_SEPOLIA, 'USDC', 'USD Coin', 6),
];

/** Fee Juice per whole token, in thousandths: the mock's rates, not prices. */
const RATE_MILLI: Readonly<Record<string, bigint>> = {
  WETH: 1_600_000n,
  STETH: 1_600_000n,
  RETH: 1_700_000n,
  CBETH: 1_650_000n,
  WBTC: 30_000_000n,
  USDC: 500n,
  USDT: 500n,
  DAI: 500n,
  FRAX: 500n,
  LUSD: 500n,
  [FEE_JUICE_SYMBOL]: 1000n,
};
/** Every other routed token buys at this rate. */
const RATE_ELSE = 250n;

/** The least Fee Juice a claim on Aztec takes, as on the real provider's testnet. */
export const CLAIM_MIN = 30n * unit(FEE_JUICE_DECIMALS);
/** One win claim's fee, what the entry rule compares the private balance against. */
export const CLAIM_COST = 18n * unit(FEE_JUICE_DECIMALS - 1);

const stepsFor = (from: Token): QuoteStep[] => {
  const deposit: QuoteStep[] = [
    { phase: 'deposit', etaSeconds: 30, signs: true },
    { phase: 'message', etaSeconds: 240, signs: false },
    { phase: 'claim', etaSeconds: 20, signs: false },
  ];
  if (from.symbol === FEE_JUICE_SYMBOL) return deposit;
  const swap: QuoteStep =
    from.chainId === SEPOLIA
      ? { phase: 'swap', etaSeconds: 30, signs: true, via: 'Uniswap' }
      : { phase: 'swap', etaSeconds: 120, signs: true, via: 'Across' };
  return [swap, ...deposit];
};

/** The route's take in the token (swap 0.3 %, a bridge 0.1 % more), and Ethereum's gas in ETH. */
const costsFor = (from: Token, amountIn: bigint): Cost[] => {
  const costs: Cost[] = [];
  if (from.symbol !== FEE_JUICE_SYMBOL) {
    const bps = from.chainId === SEPOLIA ? 30n : 40n;
    costs.push({
      label: from.chainId === SEPOLIA ? 'Swap' : 'Bridge and swap',
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

/** The quote the mock gives for a token and an amount. */
function priced(from: Token, amountIn: bigint, id: string, expiresAt: number): Quote {
  const costs = costsFor(from, amountIn);
  const kept = amountIn - (costs[0]?.symbol === from.symbol ? (costs[0]?.amount ?? 0n) : 0n);
  const out =
    (kept * (RATE_MILLI[from.symbol] ?? RATE_ELSE) * unit(FEE_JUICE_DECIMALS)) /
    (1000n * unit(from.decimals));
  return {
    id,
    from,
    amountIn,
    feeJuiceOut: out,
    feeJuiceMin: (out * 99n) / 100n,
    claimMin: CLAIM_MIN,
    costs,
    steps: stepsFor(from),
    expiresAt,
  };
}

const COMMIT = /^0x[0-9a-f]{64}$/;

const mockTx = (phase: Phase, n: number) =>
  `0x${phase.length.toString(16)}${n.toString(16).padStart(3, '0')}${'7e'.repeat(30)}`;

export interface MockFunding {
  provider: FeeFundingProvider;
  reads: FundingReads;
}

/** The provider and the page's own reads, sharing one pretend chain: a finished claim raises the private balance. */
export function mockFunding(script: MockScript, timing: MockTiming = MOCK_TIMING): MockFunding {
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

  const provider: FeeFundingProvider = {
    chains: async () => MOCK_CHAINS,
    tokens: async () => MOCK_TOKENS,
    async quote(from, amountIn, _payer, signal) {
      await wait(timing.quote, signal);
      return priced(from, amountIn, `q${++quotes}`, Date.now() + timing.life);
    },
    async run(phase, quote, commit, on, signal) {
      if (!COMMIT.test(commit)) throw new FundingError('failed', 'No commitment to deposit to.');
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
    async resume({ hint }, signal) {
      await wait(timing.quote, signal);
      if (script.resume === 'missing') return null;
      const quote = priced(hint.token, hint.amountIn, `r${++quotes}`, Date.now() + timing.life);
      const all = script.resume === 'claimed';
      if (all) received += quote.feeJuiceOut;
      const landed = quote.steps.map((s) => s.phase).filter((p) => all || p === 'swap' || p === 'deposit');
      return { quote, landed };
    },
  };
  const reads: FundingReads = {
    async balances(_owner, tokens, signal) {
      await wait(timing.quote, signal);
      return tokens.map((t) => (script.wallet === 'empty' ? 0n : held(t)));
    },
    standing: async () => ({ sponsored: false, privateFeeJuice: received, claimCost: CLAIM_COST }),
  };
  return { provider, reads };
}
