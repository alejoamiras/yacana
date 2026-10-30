// B: a card over the cockpit, before Start. Picking and quoting happen in the dialog; on confirm the
// dialog closes and the card carries the trade, in the upgrade card's grammar.

import { Button, HeroCard, type HeroTone, Stepper } from '@yacana/ui';
import { type ReactNode, useState } from 'react';
import { TxDialog, useElapsed } from '../../features/dialogs/Frame';
import { duration } from '../../lib/format';
import { FEE_JUICE, failureCopy, fj, PICK_BODY, phaseLine, phaseName, retryLabel, tradeLine } from '../copy';
import { entryShows } from '../entry';
import type { Shown } from '../machine';
import { Choose } from '../parts/Choose';
import { useChains } from '../parts/TokenPicker';
import { type FundingRun, type OptionProps, useFunding } from '../run';
import { flight, trailItems, useCardCounted, useRequotes, useStanding } from '../views';

const CARD = 'md:col-span-2 xl:col-span-4';

function Entry({ run, onHow }: { run: FundingRun; onHow: () => void }) {
  return (
    <HeroCard
      className={CARD}
      eyebrow={`fees · ${FEE_JUICE.toLowerCase()}`}
      title="Fund fees before you mine."
      actions={
        <>
          <Button variant="uv" onClick={() => run.dispatch({ type: 'open' })} data-testid="fees-entry">
            Fund fees
          </Button>
          <Button variant="link" className="text-ink-2" onClick={onHow}>
            How it works
          </Button>
        </>
      }
      data-testid="fees-card"
    >
      A win counts only while its epoch is open, and an epoch can close before {FEE_JUICE} could arrive. Fund
      this account first: it takes a few minutes.
    </HeroCard>
  );
}

function face(s: Shown, requotes: boolean): { tone: HeroTone; title: ReactNode; line: string } {
  if (s.at === 'done')
    return {
      tone: 'ok',
      title: (
        <span data-testid="fees-done">
          Fees ready: {fj(s.received)} {FEE_JUICE}.
        </span>
      ),
      line: "This account can pay its own transactions' fees now.",
    };
  if (s.failure) {
    const { title, body } = failureCopy(s, s.failure, requotes);
    return { tone: 'bad', title: <span data-testid="fees-failure">{title}</span>, line: body };
  }
  const now = flight(s);
  const plan = s.quote.steps.find((x) => x.phase === now?.phase);
  if (!now || !plan) return { tone: 'uv', title: 'Funding fees.', line: '' };
  return {
    tone: now.status === 'late' ? 'warn' : 'uv',
    title: `${phaseName(now.phase, s.quote)}.`,
    line: phaseLine(now.status, plan),
  };
}

function Trade({ s, run }: { s: Shown; run: FundingRun }) {
  const elapsed = useElapsed(flight(s)?.since);
  const requotes = useRequotes(s);
  const { tone, title, line } = face(s, requotes);
  const stopped = s.at === 'trade' && s.failure !== null;
  return (
    <HeroCard
      className={CARD}
      tone={tone}
      eyebrow={`fees · ${tradeLine(s).toLowerCase()}`}
      aside={
        elapsed !== undefined && (
          <span className="font-mono text-xs text-ink-3">{duration(elapsed / 1000)}</span>
        )
      }
      title={title}
      trail={trailItems(s)}
      actions={
        stopped ? (
          <Button variant="uv" onClick={run.retry} data-testid="fees-retry">
            {retryLabel(requotes)}
          </Button>
        ) : s.at === 'done' ? (
          <Button variant="ghost" onClick={() => run.dispatch({ type: 'reset' })} data-testid="fees-dismiss">
            Dismiss
          </Button>
        ) : undefined
      }
      data-testid="fees-card"
    >
      {line}
    </HeroCard>
  );
}

const HOW: Parameters<typeof Stepper>[0]['steps'] = [
  {
    id: 'swap',
    label: `Swap for ${FEE_JUICE}`,
    state: 'pending',
    right: 'a wallet confirmation',
    detail: `Your token becomes ${FEE_JUICE} on Ethereum; from another chain it is bridged first. Paying in ${FEE_JUICE} skips this.`,
  },
  {
    id: 'deposit',
    label: 'Deposit on Ethereum',
    state: 'pending',
    right: 'a wallet confirmation',
    detail: 'The portal takes it and sends it to this account on Aztec.',
  },
  { id: 'message', label: 'Crossing to Aztec', state: 'pending', right: 'a few minutes' },
  {
    id: 'claim',
    label: 'Claim on Aztec',
    state: 'pending',
    detail: `This account claims its ${FEE_JUICE} privately, and the claim pays its own fee from it.`,
  },
];

export function OptionB({ run, provider, reads, signedIn }: OptionProps) {
  const s = useFunding(run);
  const chains = useChains(provider);
  const standing = useStanding(reads, s.at);
  const [how, setHow] = useState(false);
  const trading = s.at === 'trade' || s.at === 'done';
  const entry = !trading && standing !== undefined && entryShows(signedIn, standing);
  useCardCounted(trading || entry);
  return (
    <>
      {trading ? <Trade s={s} run={run} /> : entry && <Entry run={run} onHow={() => setHow(true)} />}
      <TxDialog
        open={s.at === 'pick' || s.at === 'quote'}
        onOpenChange={(o) => !o && run.dispatch({ type: 'reset' })}
        eyebrow="fees"
        title={s.at === 'quote' ? `Fund fees with ${s.token.symbol}.` : 'Fund fees.'}
        body={s.at === 'pick' ? PICK_BODY : undefined}
        data-testid="fees-dialog"
      >
        {(s.at === 'pick' || s.at === 'quote') && (
          <Choose run={run} provider={provider} chains={chains} s={s} />
        )}
      </TxDialog>
      <TxDialog
        open={how}
        onOpenChange={setHow}
        eyebrow="fees · how it works"
        title="What happens when you fund fees."
      >
        <Stepper explain steps={HOW} />
      </TxDialog>
    </>
  );
}
