// What the fee-funding flow asks of whoever turns a token into Fee Juice. Provisional: only the mock
// stands behind it. A real provider also owes receipts it can reconcile after a lost broadcast, the
// deposit's claim secret journaled before the L1 transaction, and the claim as the wallet's own
// transaction; none of that is modelled here.

export type Phase = 'swap' | 'deposit' | 'message' | 'claim';

export interface Chain {
  readonly id: number;
  readonly name: string;
}

export interface Token {
  readonly chainId: number;
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

export interface Cost {
  readonly label: string;
  readonly amount: bigint;
  readonly symbol: string;
  readonly decimals: number;
}

export interface QuoteStep {
  readonly phase: Phase;
  readonly etaSeconds: number;
  /** The step asks the visitor's L1 wallet to sign. */
  readonly signs: boolean;
  /** Who carries the step, when someone other than the portal does: a DEX or a bridge. */
  readonly via?: string;
}

export interface Quote {
  readonly id: string;
  readonly from: Token;
  readonly amountIn: bigint;
  /** Fee Juice, 18 decimals: what the route expects to deliver, and the least it may deliver. */
  readonly feeJuiceOut: bigint;
  readonly feeJuiceMin: bigint;
  /** The least Fee Juice a claim on Aztec takes: a route that may deliver less must not be confirmed. */
  readonly claimMin: bigint;
  readonly costs: readonly Cost[];
  /** In the order they run; a deposit of Fee Juice itself has no swap. */
  readonly steps: readonly QuoteStep[];
  /** Unix ms. */
  readonly expiresAt: number;
}

/** What a recovery file says it funded: display only, since nothing in the file authenticates. */
export interface FundingHint {
  readonly token: Token;
  readonly amountIn: bigint;
}

export type PhaseEvent = { kind: 'signing' } | { kind: 'sent'; tx: string } | { kind: 'late' };

export type FailureReason = 'rejected' | 'expired' | 'failed';

export class FundingError extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'FundingError';
  }
}

export interface FeeFundingProvider {
  chains(signal: AbortSignal): Promise<readonly Chain[]>;
  /** Every token it turns into Fee Juice, on every chain: no size or set may be assumed. */
  tokens(signal: AbortSignal): Promise<readonly Token[]>;
  /** `payer` is the Ethereum wallet. The Aztec account is never sent: nothing the provider sees names it. */
  quote(from: Token, amountIn: bigint, payer: string, signal: AbortSignal): Promise<Quote>;
  /**
   * Resolves when the step is done; rejects with a FundingError. Running a failed step again is the
   * retry. `commit` is what the deposit commits to, so `resume` finds the funding from its file.
   */
  run(
    phase: Phase,
    quote: Quote,
    commit: string,
    on: (e: PhaseEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  /**
   * The funding a commitment names, as the chain has it, with the steps that already landed; null when
   * no deposit carries it. A real provider reads the commitment and ignores the hint; one with no
   * chain behind it rebuilds the funding from the hint.
   */
  resume(
    saved: { commit: string; hint: FundingHint },
    signal: AbortSignal,
  ): Promise<{ quote: Quote; landed: readonly Phase[] } | null>;
}

/** Fee Juice figures, 18 decimals, and whether the network pays every fee itself. */
export interface Standing {
  readonly sponsored: boolean;
  /** The account's private Fee Juice: what its own claims pay from. */
  readonly privateFeeJuice: bigint;
  /** One win claim's fee. */
  readonly claimCost: bigint;
}

/** What the page reads for itself, never through the provider. */
export interface FundingReads {
  /** The wallet's balance of each token, in order, read on the token's own chain. */
  balances(owner: string, tokens: readonly Token[], signal: AbortSignal): Promise<readonly bigint[]>;
  standing(signal: AbortSignal): Promise<Standing>;
}

/** Fee Juice's decimals on both sides of the portal. */
export const FEE_JUICE_DECIMALS = 18;
