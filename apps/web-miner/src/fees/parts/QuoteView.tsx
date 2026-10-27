import { Alert, AlertDescription, AmountBlock, AmountField, Note } from '@yacana/ui';
import { useEffect, useState } from 'react';
import { Actions, AmountBelow, Primary, Row, Rows } from '../../features/dialogs/Frame';
import { amountRefusal, parseAmount } from '../../features/withdraw-form';
import { clockMinutes, duration } from '../../lib/format';
import { arrivesIn, confirmations, FEE_JUICE, fj, tokenAmount } from '../copy';
import type { Funding } from '../machine';
import type { Chain, Quote } from '../provider';
import type { FundingRun } from '../run';

type Quoting = Extract<Funding, { at: 'quote' }>;

/** Unix ms, ticking each second while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const now = useNow(true);
  return <span data-testid="fees-countdown">new quote in {clockMinutes((expiresAt - now) / 1000)}</span>;
}

/** What funding makes public: the row and the note the bridge's own dialog has for its deposit. */
function Visible() {
  return (
    <>
      <Row label="Visible on Ethereum">your wallet, the amount and this account</Row>
      <Note title="When this account pays its own fees, each transaction shows it as the payer.">
        Today the sponsor still pays every transaction here; funding changes nothing about that yet.
      </Note>
    </>
  );
}

function QuoteRows({ quote, block }: { quote: Quote; block: boolean }) {
  return (
    <div className="flex flex-col gap-3" data-testid="fees-quote">
      {block && (
        <AmountBlock
          value={`≈ ${fj(quote.feeJuiceOut)}`}
          unit={FEE_JUICE}
          aside={`at least ${fj(quote.feeJuiceMin)}`}
          tone="quiet"
        />
      )}
      <Rows>
        {!block && (
          <Row label="You get" sub={`at least ${fj(quote.feeJuiceMin)}`}>
            about {fj(quote.feeJuiceOut)} {FEE_JUICE}
          </Row>
        )}
        {quote.costs.map((c) => (
          <Row key={c.label} label={c.label}>
            {tokenAmount(c.amount, c.decimals)} {c.symbol}
          </Row>
        ))}
        <Row label="Arrives" sub={confirmations(quote)}>
          in about {duration(arrivesIn(quote))}
        </Row>
        <Visible />
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
  block = false,
  onConfirm,
}: {
  run: FundingRun;
  s: Quoting;
  chains: readonly Chain[];
  /** The figure the visitor gets as a big amount block, rather than a summary row. */
  block?: boolean;
  onConfirm: () => void;
}) {
  const { token } = s;
  const [text, setText] = useState(() =>
    s.amountIn === null ? '' : tokenAmount(s.amountIn, token.decimals),
  );
  const line = amountRefusal(text, token.balance, token.decimals);
  const edit = (t: string) => {
    setText(t);
    const ok = amountRefusal(t, token.balance, token.decimals) === null;
    run.dispatch({ type: 'amount', amountIn: ok ? parseAmount(t, token.decimals) : null });
  };
  const chain = chains.find((c) => c.id === token.chainId)?.name ?? `chain ${token.chainId}`;
  const balance = `${tokenAmount(token.balance, token.decimals)} ${token.symbol} on ${chain}`;
  return (
    <>
      <AmountField
        id="fees-amount"
        value={text}
        onChange={edit}
        unit={token.symbol}
        max={tokenAmount(token.balance, token.decimals)}
        invalid={text !== '' && line !== null}
        below={<AmountBelow line={text !== '' ? line : null} balance={balance} />}
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
        <QuoteRows quote={s.quote} block={block} />
      ) : (
        s.amountIn !== null && !s.error && <p className="text-xs text-ink-3">Getting a quote…</p>
      )}
      <Actions below={s.quote ? <Countdown expiresAt={s.quote.expiresAt} /> : undefined}>
        <Primary disabled={!s.quote} onClick={onConfirm} data-testid="fees-go">
          Fund fees
        </Primary>
      </Actions>
    </>
  );
}
