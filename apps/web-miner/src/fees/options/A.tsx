// A: a fees line under the balance, and the flow in the bridge dialogs' frame. Closing the dialog
// mid-trade leaves the trade running; the line names its phase, and reopening shows the same progress.

import { Alert, AlertDescription, AlertTitle, Stepper } from '@yacana/ui';
import { useState } from 'react';
import { Actions, Foot, Primary, Quiet, TxDialog, useElapsed } from '../../features/dialogs/Frame';
import { FEE_JUICE, failureCopy, fj, PICK_BODY, phaseName, retryLabel, tradeLine } from '../copy';
import type { Failure, Funding, Shown, Trade } from '../machine';
import { Choose } from '../parts/Choose';
import { Held } from '../parts/Held';
import { useChains } from '../parts/TokenPicker';
import { type FundingRun, type OptionProps, useFunding } from '../run';
import { flight, stepperSteps, useRequotes } from '../views';

function Progress({ s, run }: { s: Shown; run: FundingRun }) {
  const elapsed = useElapsed(flight(s)?.since);
  const failure = s.at === 'trade' ? s.failure : null;
  return (
    <>
      <p className="font-mono text-xs text-ink-3">{tradeLine(s)}</p>
      <Stepper steps={stepperSteps(s, elapsed)} />
      {s.at === 'trade' && s.failure && <Failed s={s} failure={s.failure} run={run} />}
      {s.at === 'done' ? (
        <p className="text-sm text-ink-2" data-testid="fees-done">
          This account holds {fj(s.received)} more {FEE_JUICE}.
        </p>
      ) : (
        !failure && <Foot>You can close this. The fees line under the balance says where it is.</Foot>
      )}
    </>
  );
}

function Failed({ s, failure, run }: { s: Trade; failure: Failure; run: FundingRun }) {
  const requotes = useRequotes(s);
  const { title, body } = failureCopy(s, failure, requotes);
  return (
    <>
      <Alert variant="bad" data-testid="fees-failure">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
      </Alert>
      <Actions>
        <Primary onClick={run.retry} data-testid="fees-retry">
          {retryLabel(requotes)}
        </Primary>
      </Actions>
    </>
  );
}

/** The line's middle: the held Fee Juice, or the trade's phase while one runs. */
function Standing({ s, provider, account }: { s: Funding } & Omit<OptionProps, 'run'>) {
  if (s.at !== 'trade')
    return (
      <>
        <Held key={s.at === 'done' ? 'landed' : 'before'} provider={provider} account={account} /> {FEE_JUICE}
      </>
    );
  const now = flight(s) ?? s.steps.find((x) => x.status === 'failed');
  if (!now) return <>funding</>;
  const name = phaseName(now.phase, s.quote).toLowerCase();
  return (
    <>{now.status === 'failed' ? `${name} · stopped` : now.status === 'late' ? `${name} · late` : name}</>
  );
}

const titleOf = (s: Funding): string => {
  if (s.at === 'quote') return `Fund fees with ${s.token.symbol}.`;
  if (s.at === 'trade') return s.failure ? 'Funding stopped.' : 'Funding fees.';
  if (s.at === 'done') return 'Fees ready.';
  return 'Fund fees.';
};

export function OptionA({ run, provider, account }: OptionProps) {
  const s = useFunding(run);
  const chains = useChains(provider);
  const [open, setOpen] = useState(false);
  const show = () => {
    if (s.at === 'done') run.dispatch({ type: 'reset' });
    if (s.at === 'idle' || s.at === 'done') run.dispatch({ type: 'open' });
    setOpen(true);
  };
  // Only a trade outlives the dialog: a pick or a quote left behind is dropped, and a finished trade is over.
  const close = () => {
    setOpen(false);
    if (s.at !== 'trade') run.dispatch({ type: 'reset' });
  };
  const asking = s.at === 'trade' && s.steps.some((x) => x.status === 'signing');
  return (
    <>
      <div className="flex items-center gap-3 border-t border-line pt-3 text-xs" data-testid="fees-line">
        <span className="label-mono">fees</span>
        <span className="min-w-0 flex-1 truncate font-mono text-ink-2">
          <Standing s={s} provider={provider} account={account} />
        </span>
        <Quiet onClick={show} data-testid="fees-entry">
          {s.at === 'trade' ? 'Show' : 'Fund fees'}
        </Quiet>
      </div>
      <TxDialog
        open={open}
        onOpenChange={(o) => !o && close()}
        eyebrow="fees"
        title={titleOf(s)}
        body={s.at === 'pick' ? PICK_BODY : undefined}
        locked={asking}
        data-testid="fees-dialog"
      >
        {(s.at === 'pick' || s.at === 'quote') && (
          <Choose run={run} provider={provider} chains={chains} s={s} />
        )}
        {(s.at === 'trade' || s.at === 'done') && <Progress s={s} run={run} />}
        {s.at === 'done' && (
          <Actions>
            <Primary variant="primary" onClick={close}>
              Done
            </Primary>
          </Actions>
        )}
      </TxDialog>
    </>
  );
}
