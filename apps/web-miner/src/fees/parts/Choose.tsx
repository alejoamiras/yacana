import { Back } from '../../features/dialogs/Frame';
import type { Funding } from '../machine';
import type { Chain } from '../provider';
import type { OptionProps } from '../run';
import { QuoteView } from './QuoteView';
import { TokenPicker } from './TokenPicker';

export function Choose({
  run,
  provider,
  chains,
  s,
}: Pick<OptionProps, 'run' | 'provider'> & {
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
