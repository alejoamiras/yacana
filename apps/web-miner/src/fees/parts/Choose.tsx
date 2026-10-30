import { Back } from '../../features/dialogs/Frame';
import type { Funding } from '../machine';
import type { Chain, Token } from '../provider';
import type { FundingRun } from '../run';
import { QuoteView } from './QuoteView';
import { type Holding, type Layout, TokenPicker } from './TokenPicker';

const same = (a: Token, b: Token) => a.chainId === b.chainId && a.address === b.address;

/** The picker, then the chosen token's amount and quote: the dialog screens every option shares. */
export function Choose({
  run,
  s,
  chains,
  holdings,
  layout,
  walletChain,
  onConfirm,
  onSave,
}: {
  run: FundingRun;
  s: Extract<Funding, { at: 'pick' | 'quote' }>;
  chains: readonly Chain[];
  holdings: readonly Holding[] | undefined;
  layout: Layout;
  walletChain?: number;
  /** The quote's "Fund fees": each option decides what a click does before the trade starts. */
  onConfirm: () => void;
  /** Given, the quote saves the recovery file as a beat of its own, and "Fund fees" waits for it. */
  onSave?: () => void;
}) {
  if (s.at === 'pick')
    return (
      <TokenPicker
        holdings={holdings}
        chains={chains}
        layout={layout}
        walletChain={walletChain}
        onChoose={(h) => run.dispatch({ type: 'choose', token: h.token })}
      />
    );
  const balance = holdings?.find((h) => same(h.token, s.token))?.balance ?? 0n;
  return (
    <>
      <Back onBack={() => run.dispatch({ type: 'back' })} />
      <QuoteView run={run} s={s} chains={chains} balance={balance} onConfirm={onConfirm} onSave={onSave} />
    </>
  );
}
