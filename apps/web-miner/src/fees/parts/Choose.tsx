import { useEffect, useState } from 'react';
import { Back } from '../../features/dialogs/Frame';
import { fj } from '../copy';
import type { Funding } from '../machine';
import type { Chain, FeeFundingProvider } from '../provider';
import type { FundingRun } from '../run';
import { QuoteView } from './QuoteView';
import { TokenPicker } from './TokenPicker';

/** What every option hands its parts: the tab's runner, its provider, and the account the Fee Juice is for. */
export interface OptionProps {
  run: FundingRun;
  provider: FeeFundingProvider;
  account: string;
}

/**
 * The account's Fee Juice as a figure: "none", or "12.45". Keyed by its owner on whether a trade has
 * landed, so it reads again when one does.
 */
export function Held({ provider, account }: Omit<OptionProps, 'run'>) {
  const [held, setHeld] = useState<bigint>();
  useEffect(() => {
    const ctl = new AbortController();
    provider.feeJuiceBalance(account, ctl.signal).then(
      (v) => !ctl.signal.aborted && setHeld(v),
      () => {},
    );
    return () => ctl.abort();
  }, [provider, account]);
  return <span data-testid="fees-held">{held === undefined ? '…' : held === 0n ? 'none' : fj(held)}</span>;
}

/** The picker, then the quote with the way back to it: the dialog screens A and B share. */
export function Choose({
  run,
  provider,
  chains,
  s,
}: Omit<OptionProps, 'account'> & {
  chains: readonly Chain[];
  s: Extract<Funding, { at: 'pick' | 'quote' }>;
}) {
  if (s.at === 'pick')
    return (
      <TokenPicker
        provider={provider}
        chains={chains}
        onChoose={(token) => run.dispatch({ type: 'choose', token })}
      />
    );
  return (
    <>
      <Back onBack={() => run.dispatch({ type: 'back' })} />
      <QuoteView run={run} s={s} chains={chains} onConfirm={run.confirm} />
    </>
  );
}
