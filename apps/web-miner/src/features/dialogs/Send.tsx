// Send to an account. The address is judged when its field is left, not per keystroke; the
// unknown-recipient probe is advisory; the send re-validates the exact values it submits and uses
// nothing the probe saw.
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { Alert, AlertDescription, AmountField, ExternalLink, Note, Stepper, Textarea } from '@yacana/ui';
import { type ComponentProps, useRef, useState } from 'react';
import { links } from '../../explorer';
import { amount as fmt, shortAddress } from '../../lib/format';
import type { Session } from '../../session';
import {
  amountRefusal,
  type Draft,
  type Mode,
  recipientRefusal,
  review,
  type Snapshot,
} from '../withdraw-form';
import {
  Actions,
  AmountBelow,
  Foot,
  firstLine,
  Primary,
  Quiet,
  Row,
  Rows,
  seconds,
  TxDialog,
  useElapsed,
  useLive,
  useOnce,
  useOpening,
} from './Frame';
import { type ProvingWords, useOwnProvingWords, useProvingWords } from './use-tx-prover';

const SYM = PARAMS.TOKEN_SYMBOL;
const money = (raw: bigint) => `${fmt(raw, PARAMS.DECIMALS)} ${SYM}`;

type Step =
  | { kind: 'form' }
  | { kind: 'proving'; snap: Snapshot; since: number }
  | { kind: 'sent'; snap: Snapshot; block: number; txHash: string; provedMs: number };

const EMPTY: Draft = { to: '', amount: '', mode: 'private' };

function How({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const option = (value: Mode, label: string) => (
    <label
      className={`relative cursor-pointer rounded-[6px] px-3 py-1.5 text-[12.5px] has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-uv ${mode === value ? 'bg-panel-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
    >
      {/* The input covers its segment invisibly: it is what a click, a tap or a test lands on. */}
      <input
        type="radio"
        name="how"
        value={value}
        checked={mode === value}
        onChange={() => onChange(value)}
        className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0"
      />
      {label}
    </label>
  );
  return (
    <div className="flex items-center justify-between gap-4 text-[13px]">
      <span className="text-ink-2">How</span>
      <div
        role="radiogroup"
        aria-label="how to send"
        className="inline-flex gap-0.5 rounded-[8px] border border-line-2 p-0.5"
      >
        {option('private', 'Privately')}
        {option('public', 'Publicly')}
      </div>
    </div>
  );
}

/** Under How: what a public send exposes, or an address nothing on the chain knows as an account. */
function Warnings({ draft, unknown }: { draft: Draft; unknown: boolean }) {
  if (draft.mode === 'public')
    return (
      <Note title="This will be public." tone="warn" data-testid="public-warning">
        {draft.to.trim() ? shortAddress(draft.to.trim()) : 'The address'} receives{' '}
        {draft.amount.trim() || 'the amount'} {SYM} into a public balance. The amount and the address are
        readable by anyone.
      </Note>
    );
  if (unknown)
    return (
      <Note
        title="Nothing on the chain knows that address as an account."
        tone="warn"
        data-testid="unknown-recipient"
      >
        Sent privately, it could never be read there. Confirm the address with the recipient before sending.
      </Note>
    );
  return null;
}

/** What leaving the address field learns: the refusal, else whether the chain knows the address. */
async function probeRecipient(
  session: Session,
  self: string,
  draft: Draft,
): Promise<{ refusal: string | null; unknown: boolean }> {
  const refusal = await recipientRefusal(draft.to, self);
  if (refusal !== null || draft.to.trim() === '' || draft.mode === 'public')
    return { refusal, unknown: false };
  // Advisory only: an unknown address still sends, once the user has confirmed it.
  const known = await session
    .recipientKnown(AztecAddress.fromStringUnsafe(draft.to.trim()))
    .catch(() => true);
  return { refusal: null, unknown: !known };
}

function Form({
  session,
  self,
  balance,
  onSend,
  onCancel,
}: {
  session: Session;
  self: string;
  balance: bigint;
  onSend: (snap: Snapshot) => void;
  onCancel: () => void;
}) {
  const { busy, once } = useOnce();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [toRefusal, setToRefusal] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string>();
  const probe = useRef(0);
  const amountLine = amountRefusal(draft.amount, balance, PARAMS.DECIMALS);
  const [tried, setTried] = useState(false);
  const touchedAmount = draft.amount !== '' || tried;
  const left = async () => {
    const mine = ++probe.current;
    const r = await probeRecipient(session, self, draft);
    if (mine !== probe.current) return;
    setToRefusal(r.refusal);
    setUnknown(r.unknown);
  };
  const submit = () =>
    once(async () => {
      setError(undefined);
      setTried(true);
      const to = await recipientRefusal(draft.to, self);
      setToRefusal(to);
      if (to !== null || amountLine !== null) return;
      try {
        onSend(await review(draft, self, balance, PARAMS.DECIMALS));
      } catch (e) {
        setError(firstLine(e));
      }
    });
  const how = draft.mode === 'private' ? 'privately' : 'publicly';
  const invalid = (touchedAmount && amountLine !== null) || toRefusal !== null;
  return (
    <>
      {error && (
        <Alert variant="bad" data-testid="withdraw-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <AmountField
        id="withdraw-amount"
        value={draft.amount}
        onChange={(amount) => setDraft({ ...draft, amount })}
        unit={SYM}
        max={fmt(balance, PARAMS.DECIMALS, PARAMS.DECIMALS)}
        invalid={touchedAmount && amountLine !== null}
        below={<AmountBelow line={touchedAmount ? amountLine : null} balance={money(balance)} />}
        disabled={busy}
        data-testid="withdraw-amount"
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="withdraw-to" className="label-mono">
          to
        </label>
        <Textarea
          id="withdraw-to"
          value={draft.to}
          onChange={(e) => {
            setDraft({ ...draft, to: e.target.value });
            setToRefusal(null);
            setUnknown(false);
          }}
          onBlur={() => void left()}
          rows={2}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={toRefusal !== null || undefined}
          disabled={busy}
          className="min-h-0 resize-none text-xs leading-[1.4] break-all"
          data-testid="withdraw-to"
        />
        {toRefusal && (
          <span className="font-mono text-2xs text-bad" data-testid="to-refusal">
            {toRefusal}
          </span>
        )}
      </div>
      <How mode={draft.mode} onChange={(mode) => setDraft({ ...draft, mode })} />
      <Warnings draft={draft} unknown={unknown} />
      <Rows>
        <Row label="Fee">none · Yacana sponsors it</Row>
        <Row label="Visible">
          {draft.mode === 'private' ? 'nothing; a private transfer' : 'the amount and the address, to anyone'}
        </Row>
      </Rows>
      <Actions quiet={<Quiet onClick={onCancel}>Cancel</Quiet>} below={useProvingWords().line}>
        <Primary disabled={busy || invalid} onClick={() => void submit()} data-testid="withdraw-send">
          Send{draft.amount.trim() && amountLine === null ? ` ${draft.amount.trim()} ${SYM}` : ''} {how}
        </Primary>
      </Actions>
    </>
  );
}

function Proving({ snap, since, words }: { snap: Snapshot; since: number; words: ProvingWords }) {
  const elapsed = useElapsed(since);
  return (
    <>
      <Stepper
        data-testid="withdraw-proving"
        steps={[
          {
            id: 'prove',
            label: 'Proving privately',
            state: 'active',
            right: elapsed === undefined ? undefined : seconds(elapsed),
            detail: words.detail,
          },
          {
            id: 'send',
            label: `Sent ${snap.mode === 'private' ? 'privately' : 'publicly'}`,
            state: 'pending',
          },
        ]}
      />
      <Foot>{words.foot}</Foot>
    </>
  );
}

function Sent({
  step,
  balance,
  onDone,
}: {
  step: Extract<Step, { kind: 'sent' }>;
  balance: bigint;
  onDone: () => void;
}) {
  const to = step.snap.to.toString();
  const how = step.snap.mode === 'private' ? 'privately' : 'publicly';
  return (
    <div className="flex flex-col gap-4" data-testid="withdraw-sent">
      <Stepper
        steps={[
          { id: 'prove', label: 'Proved privately', state: 'done', right: seconds(step.provedMs) },
          {
            id: 'send',
            label: 'Sent',
            state: 'done',
            right: (
              <ExternalLink href={links.block(step.block)} full={String(step.block)} data-testid="sent-block">
                block {step.block.toLocaleString('en-US')}
              </ExternalLink>
            ),
            detail: `${step.snap.display} ${SYM} to ${shortAddress(to)}, ${how}. Your balance: ${money(balance)}.`,
          },
        ]}
      />
      <Foot>
        Final once its epoch is proven, usually within the hour.{' '}
        <ExternalLink
          href={links.tx(step.txHash)}
          full={step.txHash}
          className="text-uv-2"
          data-testid="sent-tx"
        >
          transaction
        </ExternalLink>
      </Foot>
      <Actions>
        <Primary variant="primary" onClick={onDone}>
          Done
        </Primary>
      </Actions>
    </div>
  );
}

/** The wallet's Send: the form, the proof, the receipt. The send uses the reviewed snapshot only. */
function SendRun({
  session,
  self,
  balance,
  open,
  onOpenChange,
}: {
  session: Session;
  self: string;
  balance: bigint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [error, setError] = useState<string>();
  const live = useLive(open);
  const proving = useOwnProvingWords();
  const close = () => onOpenChange(false);
  const send = async (snap: Snapshot) => {
    if (!live()) return;
    proving.reset();
    const since = Date.now();
    setError(undefined);
    setStep({ kind: 'proving', snap, since });
    try {
      const sent = await session.withdraw(snap, proving.said);
      setStep({ kind: 'sent', snap, ...sent, provedMs: Date.now() - since });
    } catch (e) {
      setError(firstLine(e));
      setStep({ kind: 'form' });
    }
  };
  const title =
    step.kind === 'form'
      ? 'Send to an account.'
      : step.kind === 'proving'
        ? `Sending ${step.snap.display} ${SYM}.`
        : `${step.snap.display} ${SYM} sent.`;
  return (
    <TxDialog
      open={open}
      onOpenChange={(o) => !o && close()}
      eyebrow="send"
      title={title}
      locked={step.kind === 'proving'}
      data-testid="withdraw-dialog"
    >
      {error && step.kind === 'form' && (
        <Alert variant="bad" data-testid="withdraw-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {step.kind === 'form' && (
        <Form session={session} self={self} balance={balance} onSend={(s) => void send(s)} onCancel={close} />
      )}
      {step.kind === 'proving' && <Proving snap={step.snap} since={step.since} words={proving.words} />}
      {step.kind === 'sent' && <Sent step={step} balance={balance} onDone={close} />}
    </TxDialog>
  );
}

/** The wallet's Send, one run per opening. */
export function SendDialog(props: ComponentProps<typeof SendRun>) {
  return <SendRun key={useOpening(props.open)} {...props} />;
}
