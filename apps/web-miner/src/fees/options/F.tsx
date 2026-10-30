// F, one tap: "Fund fees" asks the one announced wallet at once and opens on the picker (several open
// the dialog's list), the picker tabs the wallet's tokens by chain, its own chain first, and "Fund
// fees" on the quote saves the recovery file and starts the trade in one click.

import type { OptionProps } from '../run';
import { useOneWallet } from '../wallet';
import { Card, CardRestore, EntryCard, FundButton, FundDialog, useFlow } from './flow';

export function OptionF(props: OptionProps) {
  const { run } = props;
  const flow = useFlow(props);
  const one = useOneWallet();
  const open = () => run.dispatch({ type: 'open' });
  const fund = () => (flow.account.address || !one ? open() : void one().then(open));
  const entry = (
    <EntryCard actions={<FundButton onClick={fund} />}>
      <CardRestore run={run} />
    </EntryCard>
  );
  return (
    <>
      <Card flow={flow} run={run} entry={entry} />
      <FundDialog flow={flow} run={run} layout="by-chain" onConfirm={() => void run.saveAndConfirm()} />
    </>
  );
}
