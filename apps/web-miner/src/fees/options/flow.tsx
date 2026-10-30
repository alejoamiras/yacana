// What the three options share: a card over the cockpit before Start, picking and quoting in the
// dialog, and on confirm the card carrying the trade as a trail that stays through a trip to
// Settings. The options differ only in where the wallet connects, how the tokens are listed, when
// the recovery file is saved and where a file is loaded.

import { Button, HeroCard, type HeroTone, Stepper } from '@yacana/ui';
import { type ReactNode, useState } from 'react';
import { TxDialog, useElapsed } from '../../features/dialogs/Frame';
import { ConnectWallet, WalletChip } from '../../features/dialogs/Wallet';
import { duration } from '../../lib/format';
import {
  CONNECT_BODY,
  FEE_JUICE,
  failureCopy,
  fj,
  PICK_BODY,
  phaseLine,
  phaseName,
  retryLabel,
  tradeLine,
} from '../copy';
import { entryShows } from '../entry';
import type { Funding, Shown } from '../machine';
import { Choose } from '../parts/Choose';
import { Restore } from '../parts/Restore';
import { type Layout, useChains, useHoldings } from '../parts/TokenPicker';
import { type FundingRun, type OptionProps, useFunding } from '../run';
import { flight, trailItems, unsaved, useCardCounted, useRequotes, useStanding } from '../views';
import { usePayer } from '../wallet';

const CARD = 'md:col-span-2 xl:col-span-4';

/** The runner's state, the wallet and its tokens, and whether a card is drawn at all. */
export function useFlow({ run, provider, reads, signedIn }: OptionProps) {
  const s = useFunding(run);
  const chains = useChains(provider);
  const account = usePayer(run);
  const holdings = useHoldings(provider, reads, account.address);
  const standing = useStanding(reads, s.at);
  const trading = s.at === 'trade' || s.at === 'done';
  const entry = !trading && standing !== undefined && entryShows(signedIn, standing);
  useCardCounted(trading || entry);
  return { s, chains, account, holdings, trading, entry };
}

export type Flow = ReturnType<typeof useFlow>;

const HOW: Parameters<typeof Stepper>[0]['steps'] = [
  {
    id: 'file',
    label: 'Save a recovery file',
    state: 'pending',
    detail: 'It brings this funding back if this browser loses it. It holds no secret and names no account.',
  },
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

/** Before you mine: the entry, with the option's own actions and, under the copy, what it adds. */
export function EntryCard({ actions, children }: { actions: ReactNode; children?: ReactNode }) {
  const [how, setHow] = useState(false);
  return (
    <>
      <HeroCard
        className={CARD}
        eyebrow={`fees · ${FEE_JUICE.toLowerCase()}`}
        title="Fund fees before you mine."
        actions={
          <>
            {actions}
            <Button variant="link" className="text-ink-2" onClick={() => setHow(true)}>
              How it works
            </Button>
          </>
        }
        data-testid="fees-card"
      >
        A win counts only while its epoch is open, and an epoch can close before {FEE_JUICE} could arrive.
        Fund this account first: it takes a few minutes.
        {children}
      </HeroCard>
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

/** "Fund fees": opens the dialog. */
export function FundButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="uv" onClick={onClick} data-testid="fees-entry">
      Fund fees
    </Button>
  );
}

export const CardRestore = ({ run }: { run: FundingRun }) => (
  <Restore run={run} label="Resume from a file" className="mt-3" />
);

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
  if (unsaved(s))
    return {
      tone: 'uv',
      title: 'Save your recovery file.',
      line: 'Nothing moves until it is saved: it brings this funding back if this browser loses it.',
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

function tradeActions(s: Shown, run: FundingRun, requotes: boolean): ReactNode {
  if (s.at === 'done')
    return (
      <Button variant="ghost" onClick={() => run.dispatch({ type: 'reset' })} data-testid="fees-dismiss">
        Dismiss
      </Button>
    );
  if (unsaved(s))
    return (
      <Button variant="uv" onClick={() => void run.save()} data-testid="fees-save">
        Save recovery file
      </Button>
    );
  // No browser tells a page whether a download was kept: until the claim lands, it can be saved again.
  const again = (
    <Button
      variant="link"
      className="text-ink-2"
      onClick={() => void run.save()}
      data-testid="fees-save-again"
    >
      Save the file again
    </Button>
  );
  if (!s.failure) return again;
  return (
    <>
      <Button variant="uv" onClick={run.retry} data-testid="fees-retry">
        {retryLabel(requotes)}
      </Button>
      {again}
    </>
  );
}

/** After confirm: the trade on the card's trail, in the upgrade card's grammar. */
export function TradeCard({ s, run }: { s: Shown; run: FundingRun }) {
  const elapsed = useElapsed(flight(s)?.since);
  const requotes = useRequotes(s);
  const { tone, title, line } = face(s, requotes);
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
      actions={tradeActions(s, run, requotes)}
      data-testid="fees-card"
    >
      {line}
    </HeroCard>
  );
}

/** The card the flow draws now: the trade, the entry, or nothing. */
export function Card({ flow, run, entry }: { flow: Flow; run: FundingRun; entry: ReactNode }) {
  const { s } = flow;
  if (s.at === 'trade' || s.at === 'done') return <TradeCard s={s} run={run} />;
  return flow.entry ? entry : null;
}

const choosing = (s: Funding): s is Extract<Funding, { at: 'pick' | 'quote' }> =>
  s.at === 'pick' || s.at === 'quote';

/**
 * The 440 px dialog: the connect screen while no wallet is connected, then the chip, the picker and
 * the quote. `restore` loads a file under the connect screen and the picker; `onSave` makes the save
 * the quote's own beat before "Fund fees".
 */
export function FundDialog({
  flow,
  run,
  layout,
  onConfirm,
  onSave,
  restore = false,
}: {
  flow: Flow;
  run: FundingRun;
  layout: Layout;
  onConfirm: () => void;
  onSave?: () => void;
  restore?: boolean;
}) {
  const { s, account } = flow;
  const reset = () => run.dispatch({ type: 'reset' });
  const loads = restore && s.at === 'pick' && (
    <Restore run={run} label="Resuming a funding? Load its file" className="mt-1" />
  );
  return (
    <TxDialog
      open={choosing(s)}
      onOpenChange={(o) => !o && reset()}
      eyebrow="fees"
      title={s.at === 'quote' ? `Fund fees with ${s.token.symbol}.` : 'Fund fees.'}
      body={!account.address ? CONNECT_BODY : s.at === 'pick' ? PICK_BODY : undefined}
      data-testid="fees-dialog"
    >
      {choosing(s) &&
        (account.address ? (
          <>
            <WalletChip />
            <Choose
              run={run}
              s={s}
              chains={flow.chains}
              holdings={flow.holdings}
              layout={layout}
              walletChain={account.chainId}
              onConfirm={onConfirm}
              onSave={onSave}
            />
            {loads}
          </>
        ) : (
          <>
            <ConnectWallet onCancel={reset} />
            {loads}
          </>
        ))}
    </TxDialog>
  );
}
