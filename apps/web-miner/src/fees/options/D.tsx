// D, the wallet on the card: the entry connects before any dialog (several wallets open the dialog on
// their list), the picker lists the wallet's own tokens across chains, and the recovery file is the
// trail's first stop after confirm.

import { Button } from '@yacana/ui';
import { WalletChip } from '../../features/dialogs/Wallet';
import type { OptionProps } from '../run';
import { useOneWallet } from '../wallet';
import { Card, CardRestore, EntryCard, FundButton, FundDialog, useFlow } from './flow';

export function OptionD(props: OptionProps) {
  const { run } = props;
  const flow = useFlow(props);
  const one = useOneWallet();
  const open = () => run.dispatch({ type: 'open' });
  const connected = flow.account.address !== undefined;
  const entry = (
    <EntryCard
      actions={
        connected ? (
          <FundButton onClick={open} />
        ) : (
          <Button variant="uv" onClick={() => (one ? void one() : open())} data-testid="fees-connect">
            Connect wallet
          </Button>
        )
      }
    >
      {connected && <WalletChip />}
      <CardRestore run={run} />
    </EntryCard>
  );
  return (
    <>
      <Card flow={flow} run={run} entry={entry} />
      <FundDialog flow={flow} run={run} layout="one-list" onConfirm={run.confirm} />
    </>
  );
}
