import { Alert, AlertDescription, AmountField, cn, Note } from '@yacana/ui';
import { useEffect, useState } from 'react';
import { Actions, AmountBelow, Primary, Row, Rows } from '../../features/dialogs/Frame';
import { amountRefusal, parseAmount } from '../../features/withdraw-form';
import { amount, clockMinutes, duration } from '../../lib/format';
import { arrivesIn, confirmations, FEE_JUICE, fj, tokenAmount } from '../copy';
import type { Funding } from '../machine';
import type { Chain, Quote } from '../provider';
import type { FundingRun } from '../run';

type Quoting = Extract<Funding, { at: 'quote' }>;

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const now = useNow();
  return <span data-testid="fees-countdown">new quote in {clockMinutes((expiresAt - now) / 1000)}</span>;
}

/** Short of the claim minimum: the least the route may deliver would not cover a claim on Aztec. */
const short = (quote: Quote) => quote.feeJuiceMin < quote.claimMin;

function QuoteRows({ quote }: { quote: Quote }) {
  return (
    <div className="flex flex-col gap-3" data-testid="fees-quote">
      <Rows>
        <Row label="You get" sub={`at least ${fj(quote.feeJuiceMin)}`}>
          about {fj(quote.feeJuiceOut)} {FEE_JUICE}
        </Row>
        {quote.costs.map((c) => (
          <Row key={c.label} label={c.label}>
            {tokenAmount(c.amount, c.decimals)} {c.symbol}
          </Row>
        ))}
        <Row label="Claim on Aztec">paid from what arrives</Row>
        <Row label="Least to claim" className={cn(short(quote) && 'text-warn')} data-testid="fees-claim-min">
          {fj(quote.claimMin)} {FEE_JUICE}
        </Row>
        <Row label="Arrives" sub={confirmations(quote)}>
          in about {duration(arrivesIn(quote))}
        </Row>
        <Row label="Visible on Ethereum">your wallet and the amount</Row>
      </Rows>
    </div>
  );
}

/**
 * The amount and its quote. The amount is the visitor's text; the machine holds the parsed value, and a
 * quote counts only for the token and amount it was asked for.
 */
export function QuoteView({
  run,
  s,
  chains,
  balance,
  onConfirm,
}: {
  run: FundingRun;
  s: Quoting;
  chains: readonly Chain[];
  /** What the connected wallet holds of the token. */
  balance: bigint;
  onConfirm: () => void;
}) {
  const { token } = s;
  // Editable figures keep every decimal: a shortened one would re-parse to another amount than the quoted.
  const exact = (raw: bigint) => amount(raw, token.decimals, token.decimals);
  const [text, setText] = useState(() => (s.amountIn === null ? '' : exact(s.amountIn)));
  const below =
    s.quote && short(s.quote)
      ? `Too little to claim: at least ${fj(s.quote.claimMin)} ${FEE_JUICE} must arrive`
      : null;
  const line = amountRefusal(text, balance, token.decimals) ?? below;
  const edit = (t: string) => {
    setText(t);
    const ok = amountRefusal(t, balance, token.decimals) === null;
    run.dispatch({ type: 'amount', amountIn: ok ? parseAmount(t, token.decimals) : null });
  };
  const chain = chains.find((c) => c.id === token.chainId)?.name ?? `chain ${token.chainId}`;
  const held = `${tokenAmount(balance, token.decimals)} ${token.symbol} on ${chain}`;
  return (
    <>
      <AmountField
        id="fees-amount"
        value={text}
        onChange={edit}
        unit={token.symbol}
        max={exact(balance)}
        invalid={text !== '' && line !== null}
        below={<AmountBelow line={text !== '' ? line : null} balance={held} />}
        data-testid="fees-amount"
      />
      {s.refreshed && (
        <Note tone="warn" title="The last quote ran out before it was used." data-testid="fees-refreshed">
          This one is new. Nothing moved; check it and go on.
        </Note>
      )}
      {s.error && (
        <Alert variant="bad" data-testid="fees-quote-error">
          <AlertDescription>{s.error}</AlertDescription>
        </Alert>
      )}
      {s.quote ? (
        <QuoteRows quote={s.quote} />
      ) : (
        s.amountIn !== null && !s.error && <p className="text-xs text-ink-3">Getting a quote…</p>
      )}
      <Actions below={s.quote ? <Countdown expiresAt={s.quote.expiresAt} /> : undefined}>
        <Primary disabled={!s.quote || short(s.quote)} onClick={onConfirm} data-testid="fees-go">
          Fund fees
        </Primary>
      </Actions>
    </>
  );
}
