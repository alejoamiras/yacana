// What the flow says. No ✦ anywhere: nothing here proves.

import { amount } from '../lib/format';
import { type Failure, landed, type Shown, type StepStatus, type Trade } from './machine';
import { FEE_JUICE_DECIMALS, type Phase, type Quote, type QuoteStep } from './provider';

export const FEE_JUICE = 'Fee Juice';

export const PICK_BODY = `Pick what you pay with. It becomes ${FEE_JUICE}, which pays for this account's transactions.`;

export const fj = (raw: bigint): string => amount(raw, FEE_JUICE_DECIMALS, 2);

export const tokenAmount = (raw: bigint, decimals: number): string => amount(raw, decimals, 6);

/** A step's name in a list: the swap names what it swaps. */
export const phaseName = (phase: Phase, quote: Quote): string =>
  ({
    swap: `Swap ${quote.from.symbol} for ${FEE_JUICE}`,
    deposit: 'Deposit on Ethereum',
    message: 'Crossing to Aztec',
    claim: 'Claim on Aztec',
  })[phase];

/** A step's station on a trail or a timeline. */
export const STATION: Readonly<Record<Phase, string>> = {
  swap: 'swap',
  deposit: 'deposit',
  message: 'crossing',
  claim: 'claim',
};

const RUNNING: Readonly<Record<Phase, (step: QuoteStep) => string>> = {
  swap: (step) => `${step.via ?? 'The route'} turns it into ${FEE_JUICE} on Ethereum.`,
  deposit: () => `The portal takes the ${FEE_JUICE} and sends it to Aztec.`,
  message: () => 'Aztec picks the deposit up. This takes a few minutes.',
  claim: () => `This account claims its ${FEE_JUICE} privately; the claim pays its own fee from it.`,
};

export function phaseLine(status: StepStatus, step: QuoteStep): string {
  if (status === 'signing') return 'Confirm in your wallet.';
  if (status !== 'late') return RUNNING[step.phase](step);
  return step.phase === 'message'
    ? 'Taking longer than usual. Nothing is lost: the deposit waits until Aztec picks it up.'
    : 'Taking longer than usual. Nothing is lost.';
}

const KEPT: Readonly<Record<Phase, string>> = {
  swap: `The ${FEE_JUICE} from the swap is in your wallet on Ethereum.`,
  deposit: 'The deposit is in, held for this account.',
  message: `Aztec holds the ${FEE_JUICE} for this account.`,
  claim: `The ${FEE_JUICE} is this account's.`,
};

/** What a failure leaves where it was: the last step that finished, or nothing moved. */
function kept(s: Trade): string {
  const last = [...s.steps].reverse().find((x) => x.status === 'done');
  return landed(s) && last ? KEPT[last.phase] : 'Nothing has moved.';
}

export const retryLabel = (requotes: boolean): string => (requotes ? 'Get a new quote' : 'Try again');

/** A failure as the visitor reads it: what happened, what was not lost, the one thing to do. */
export function failureCopy(s: Trade, f: Failure, requotes: boolean): { title: string; body: string } {
  const what =
    f.reason === 'rejected'
      ? 'Your wallet did not confirm.'
      : f.reason === 'expired'
        ? 'The quote ran out.'
        : `${phaseName(f.phase, s.quote)} did not go through.`;
  const todo = requotes
    ? 'The quote ran out meanwhile: get a new one to go on.'
    : f.phase === 'claim' && f.reason === 'failed'
      ? 'Try again to claim it.'
      : f.reason === 'rejected'
        ? 'Try again to ask it once more.'
        : 'Try again to carry on.';
  return { title: what, body: `${kept(s)} ${todo}` };
}

/** Seconds from confirm to Fee Juice, the quote's steps end to end. */
export const arrivesIn = (quote: Quote): number => quote.steps.reduce((a, x) => a + x.etaSeconds, 0);

export const confirmations = (quote: Quote): string => {
  const n = quote.steps.filter((x) => x.signs).length;
  return `${n} ${n === 1 ? 'confirmation' : 'confirmations'} in your wallet`;
};

/** The trade's figure line: "25 USDC → about 12.45 Fee Juice". */
export const tradeLine = (s: Shown): string =>
  `${tokenAmount(s.quote.amountIn, s.quote.from.decimals)} ${s.quote.from.symbol} → about ${fj(s.quote.feeJuiceOut)} ${FEE_JUICE}`;
