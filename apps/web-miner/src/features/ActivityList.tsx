// The wallet's one list: every crossing, whichever way it goes, newest first. A crossing appears
// once and only once — an exit, a send-ahead and a deposit are the same kind of thing here — and a
// finished row folds after its week rather than disappearing, because a record of where money went
// is the only account the holder has.

import type { Crossing } from '@yacana/bridge/journal';
import { MAX_RECOVERY_BYTES } from '@yacana/bridge/recovery';
import { ActivityRow, Button, ExternalLink, type RowAction, Tile, TileHeader } from '@yacana/ui';
import { useAtom, useAtomValue } from 'jotai';
import { useState } from 'react';
import { bridgeRecord } from '../bridge/env';
import { type ActivityRowView, type ActivityView, activity } from '../bridge/rows';
import { l1Links, links } from '../explorer';
import { shortAddress } from '../lib/format';
import type { Session } from '../session';
import { bridgeAtom, claimingAtom, crossingProversAtom, journalAtom, nowAtom, rowStatesAtom } from '../state';
import { usePromisedTxProver } from './dialogs/use-tx-prover';
import { saveRecoveryFile } from './recovery';

/** The journal read for this refresh; the header's badge and the list read the same one. */
export function useActivity(): ActivityView {
  const journal = useAtomValue(journalAtom);
  const view = useAtomValue(bridgeAtom);
  const states = useAtomValue(rowStatesAtom);
  const now = useAtomValue(nowAtom);
  const claiming = useAtomValue(claimingAtom);
  const prover = usePromisedTxProver();
  const provers = useAtomValue(crossingProversAtom);
  return activity(journal, view, now, states, {
    ownVersion: import.meta.env.VITE_ROLLUP_VERSION,
    chainId: bridgeRecord()?.chainId,
    claiming,
    prover,
    provers,
  });
}

/**
 * What a row's action asks of the page: each of these opens a dialog. The private claim is not
 * here — it is one tap with nothing to confirm, so this list makes it itself.
 */
export interface RowActions {
  claimL1: (c: Crossing) => void;
  forward: (c: Crossing) => void;
  redeem: (c: Crossing) => void;
  again: (c: Crossing) => void;
  settings: () => void;
}

/** The links and dates behind Details: what a holder needs to chase a crossing without this page. */
function Details({ r }: { r: ActivityRowView }) {
  const c = r.c;
  return (
    <>
      {c.l1TxHash && (
        <ExternalLink href={l1Links.tx(c.l1TxHash)} full={c.l1TxHash}>
          Etherscan
        </ExternalLink>
      )}
      {c.block !== undefined && (
        <ExternalLink href={links.block(c.block)} full={String(c.block)}>
          block {c.block.toLocaleString('en-US')}
        </ExternalLink>
      )}
      {c.epoch !== undefined && <span>epoch {c.epoch}</span>}
      {c.claimTxHash && (
        <ExternalLink href={links.tx(c.claimTxHash)} full={c.claimTxHash}>
          claim
        </ExternalLink>
      )}
      {r.deadline && <span>can leave {r.deadline}</span>}
      {c.error && <span className="text-warn">{c.error}</span>}
    </>
  );
}

function Row({
  r,
  on,
  onClaim,
  error,
}: {
  r: ActivityRowView;
  on: RowActions;
  onClaim: (c: Crossing) => void;
  error?: string;
}) {
  const act = (kind: RowAction) => {
    if (kind === 'claim') onClaim(r.c);
    else if (kind === 'claim-l1') on.claimL1(r.c);
    else if (kind === 'forward') on.forward(r.c);
    else if (kind === 'redeem') on.redeem(r.c);
    else if (kind === 'again') on.again(r.c);
    else if (kind === 'settings') on.settings();
  };
  return (
    <ActivityRow
      kind={r.kind}
      title={r.title}
      meta={r.meta}
      signed={r.signed}
      line={r.line}
      collapsed={r.collapsed}
      onAction={act}
      details={<Details r={r} />}
      error={error ?? r.c.error}
      data-testid="crossing"
      data-state={r.c.state}
      data-kind={r.c.kind}
    />
  );
}

/** The journal as a file to keep, and a file brought back: a new device, or a browser that lost its storage. */
function Recovery({ session, account }: { session: Session; account: string }) {
  const [note, setNote] = useState<string>();
  const save = async () => {
    try {
      setNote(await saveRecoveryFile(session, account));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  const restore = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      if (f.size > MAX_RECOVERY_BYTES) throw new Error('that file is too large to be a recovery file');
      const n = (await session.bridge?.importRecovery(await f.text())) ?? 0;
      setNote(`${n} crossings restored`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-2xs text-ink-3">
      <Button
        size="sm"
        variant="link"
        className="font-mono text-2xs text-ink-3"
        onClick={() => void save()}
        data-testid="recovery-save"
      >
        save a recovery file
      </Button>
      <span aria-hidden>·</span>
      <label className="cursor-pointer underline underline-offset-3 hover:text-ink">
        restore from a file
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => void restore(e.currentTarget)}
          data-testid="recovery-input"
        />
      </label>
      {note && (
        <>
          <span aria-hidden>·</span>
          <span data-testid="recovery-note">{note}</span>
        </>
      )}
    </span>
  );
}

/**
 * Nothing has crossed yet. On a continuation the journal starts empty even when something is on its
 * way from the version before, so the page says where to look instead of implying there is nothing.
 */
function Empty({ continuation }: { continuation: boolean }) {
  return (
    <div
      className="rounded-[8px] border border-dashed border-line-2 px-4 py-[18px] text-center"
      data-testid="nothing-crossing"
    >
      <span className="label-mono">Nothing crossing yet.</span>
      <p className="mt-1.5 text-xs text-ink-3">Bridges and send-aheads show here, with where they are.</p>
      {continuation && (
        <p className="mt-2.5 text-xs text-ink-3" data-testid="continuation-hint">
          Sent ahead from an earlier version on another device? It shows here once Yacana forwards it; until
          then, restore its recovery file.
        </p>
      )}
    </div>
  );
}

export function ActivityList({
  session,
  account,
  on,
  continuation = false,
}: {
  session: Session;
  account: string;
  on: RowActions;
  continuation?: boolean;
}) {
  const record = bridgeRecord();
  const [claiming, setClaiming] = useAtom(claimingAtom);
  const [failed, setFailed] = useState<{ id: string; message: string }>();
  const claim = async (c: Crossing) => {
    if (claiming.has(c.id)) return;
    setClaiming((m) => new Map(m).set(c.id, Date.now()));
    setFailed(undefined);
    try {
      await session.bridge?.claim(c);
    } catch (e) {
      const message = e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e);
      setFailed({ id: c.id, message });
    } finally {
      setClaiming((m) => {
        const next = new Map(m);
        next.delete(c.id);
        return next;
      });
    }
  };
  const { rows, needsUser } = useActivity();
  return (
    <Tile className="md:col-span-2" data-testid="activity">
      <TileHeader
        aside={
          rows.length
            ? `${rows.length} · newest first${needsUser ? ` · ${needsUser} waiting for you` : ''}`
            : undefined
        }
      >
        activity
      </TileHeader>
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="journal">
          {rows.map((r) => (
            <Row
              key={r.c.id}
              r={r}
              on={on}
              onClaim={(c) => void claim(c)}
              error={failed?.id === r.c.id ? failed.message : undefined}
            />
          ))}
        </ul>
      ) : (
        <Empty continuation={continuation} />
      )}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
        <Recovery session={session} account={account} />
      </div>
      {record && (
        <p className="mt-2 font-mono text-2xs text-ink-3">
          YACA{' '}
          <ExternalLink href={l1Links.address(record.yaca)} full={record.yaca}>
            {shortAddress(record.yaca)}
          </ExternalLink>
          {' · portal '}
          <ExternalLink href={l1Links.address(record.portal)} full={record.portal}>
            {shortAddress(record.portal)}
          </ExternalLink>
        </p>
      )}
    </Tile>
  );
}
