// C: a fees tile in Settings. The Fee Juice figure, then the form inline (the picker in a popover, the
// quote as an amount block); once confirmed, the form gives way to a timeline of the phases.

import {
  Button,
  Kpi,
  Note,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tile,
  TileHeader,
  Timeline,
} from '@yacana/ui';
import { useState } from 'react';
import { useElapsed } from '../../features/dialogs/Frame';
import { FEE_JUICE, failureCopy, fj, retryLabel, tradeLine } from '../copy';
import type { Funding, Shown } from '../machine';
import { Held } from '../parts/Held';
import { QuoteView } from '../parts/QuoteView';
import { TokenPicker, useChains } from '../parts/TokenPicker';
import type { Chain, FeeFundingProvider, Token } from '../provider';
import { type FundingRun, type OptionProps, useFunding } from '../run';
import { flight, timelineItems, useRequotes } from '../views';

const tokenKey = (t: Token) => `${t.chainId}:${t.address}`;

function Form({
  s,
  run,
  provider,
  chains,
}: {
  s: Extract<Funding, { at: 'idle' | 'pick' | 'quote' }>;
  run: FundingRun;
  provider: FeeFundingProvider;
  chains: readonly Chain[];
}) {
  const [picking, setPicking] = useState(false);
  // The machine picks one token at a time: another choice goes back through the picker state first, and
  // the same one changes nothing (a fresh choice would drop the amount the field still shows).
  const choose = (token: Token) => {
    setPicking(false);
    if (s.at === 'quote' && tokenKey(s.token) === tokenKey(token)) return;
    if (s.at === 'idle') run.dispatch({ type: 'open' });
    if (s.at === 'quote') run.dispatch({ type: 'back' });
    run.dispatch({ type: 'choose', token });
  };
  return (
    <>
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <Button variant={s.at === 'quote' ? 'ghost' : 'uv'} className="self-start" data-testid="fees-entry">
            {s.at === 'quote' ? `${s.token.symbol} · change` : 'Fund fees'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px]">
          <TokenPicker provider={provider} chains={chains} onChoose={choose} />
        </PopoverContent>
      </Popover>
      {s.at === 'quote' && (
        <QuoteView key={tokenKey(s.token)} run={run} s={s} chains={chains} block onConfirm={run.confirm} />
      )}
    </>
  );
}

function Progress({ s, run }: { s: Shown; run: FundingRun }) {
  const elapsed = useElapsed(flight(s)?.since);
  const requotes = useRequotes(s);
  const copy = s.at === 'trade' && s.failure ? failureCopy(s, s.failure, requotes) : null;
  return (
    <>
      <p className="font-mono text-xs text-ink-3">{tradeLine(s)}</p>
      <Timeline items={timelineItems(s, elapsed)} />
      {copy && (
        <Note tone="bad" title={<span data-testid="fees-failure">{copy.title}</span>}>
          {copy.body}{' '}
          <Button variant="uv" size="sm" className="mt-2" onClick={run.retry} data-testid="fees-retry">
            {retryLabel(requotes)}
          </Button>
        </Note>
      )}
      {s.at === 'done' && (
        <Note
          tone="ok"
          title={
            <span data-testid="fees-done">
              Fees ready: {fj(s.received)} {FEE_JUICE}.
            </span>
          }
        >
          This account can pay its own transactions' fees now.{' '}
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => run.dispatch({ type: 'reset' })}>
            Fund more
          </Button>
        </Note>
      )}
    </>
  );
}

export function OptionC({ run, provider, account }: OptionProps) {
  const s = useFunding(run);
  const chains = useChains(provider);
  return (
    <Tile className="md:col-span-2" data-testid="fees-tile">
      <TileHeader aside="what pays this account's own transactions">fees</TileHeader>
      <div className="grid gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <Kpi
          label={FEE_JUICE.toLowerCase()}
          value={<Held key={s.at === 'done' ? 'landed' : 'before'} provider={provider} account={account} />}
          sub="the sponsor pays today"
        />
        <div className="flex min-w-0 flex-col gap-3">
          {s.at === 'trade' || s.at === 'done' ? (
            <Progress s={s} run={run} />
          ) : (
            <Form s={s} run={run} provider={provider} chains={chains} />
          )}
        </div>
      </div>
    </Tile>
  );
}
