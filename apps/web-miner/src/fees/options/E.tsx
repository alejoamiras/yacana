// E, all in the dialog: the entry opens the dialog on the connect screen, the picker lists the
// wallet's tokens first and every other supported one under "Not in this wallet", and the quote saves
// the recovery file as a beat of its own before "Fund fees".

import type { OptionProps } from '../run';
import { Card, EntryCard, FundButton, FundDialog, useFlow } from './flow';

export function OptionE(props: OptionProps) {
  const { run } = props;
  const flow = useFlow(props);
  const entry = <EntryCard actions={<FundButton onClick={() => run.dispatch({ type: 'open' })} />} />;
  return (
    <>
      <Card flow={flow} run={run} entry={entry} />
      <FundDialog
        flow={flow}
        run={run}
        layout="held-first"
        onConfirm={run.confirm}
        onSave={() => void run.save()}
        restore
      />
    </>
  );
}
