// The miner's state machine, kept pure so the epoch-switch, secret-rotation and claim-outcome
// rules are unit tested without a Worker or a chain: the controller feeds it events, it says what
// to do next.
import { type ClaimFailure, revertCause } from '@yacana/miner-core/claim-failure';
import { difficulty } from '@yacana/miner-core/metrics';
import type { ClaimSpan, ProofLine, Sample } from '@yacana/ui';
import { epochOpened } from './words';

export interface EpochInfo {
  epoch: bigint;
  seed: bigint;
  target: bigint;
  openedAt: bigint;
  claims: number;
}

/** `recovering`: the chain view is being rebuilt after a lost race; `start` waits for it. */
export type Phase = 'idle' | 'mining' | 'claiming' | 'recovering';

/** How a claim ended; `refused` is the simulation's "epoch is not open" (nothing sent, nothing paid). */
export type ClaimOutcome = ClaimFailure | 'minted' | 'discarded';

/** What the win line carries after its "a win": the claim's step while it runs, then its outcome. */
export interface ClaimNote {
  step?: ClaimProgress['step'];
  /** Unix seconds; the sequencer drops the claim past this (the `sent` step's countdown). */
  expiresAt?: number;
  outcome?: ClaimOutcome;
  /** `reverted`: the epoch closed first — the chain read past it, or the miner's own message said so. */
  stale?: true;
  /** `reverted`: the reason the message gave, if any; `other`: the error's first line. */
  reason?: string;
  /** `other`: the ticket is retained and Retry can send it again. */
  retry?: boolean;
  /** `expired`: how long the node was given, from the send. */
  ttlMinutes?: number;
  /** `delivery-blocked`, once the pause is known: the wait for Ethereum's finality. */
  waitMinutes?: number;
}

export type LedgerLine = ProofLine & { id: number; claim?: ClaimNote };

/** The claim in flight: `proving` in-page, `sent` to the node (the TTL runs), `waiting` for its note. */
export interface ClaimProgress {
  step: 'proving' | 'sent' | 'waiting';
  /** Wall clock (ms) of the win: the one clock the chip and the line count from. */
  wonAt: number;
  /** Wall clock (ms) when the current step started. */
  since: number;
  /** Durations (ms) of the finished steps, in order. */
  done: number[];
  /** The win line this claim annotates; null when the win came without its attempt line. */
  lineId: number | null;
  txHash?: string;
  /** Unix seconds; the sequencer drops the claim past this. */
  expiresAt?: number;
}

/** What the chain saw of the last claim; kept until the next claim, shown fresh for MINTED_FRESH_MS. */
export interface Minted {
  block: number;
  txHash: string;
  nullifier: string;
  noteHash: string;
  /** How many note hashes the transaction carried (a first contact adds the handshake's). */
  noteHashes: number;
  /** The epoch's claim count before and after. */
  claims: [number, number];
  /** Wall clock (ms) of the mint; the acknowledgement's freshness runs from here. */
  at: number;
}

/** How long a mint counts as fresh: the slot shows its ✓ and the pill says minted for this long. */
export const MINTED_FRESH_MS = 10_000;
export const mintedFresh = (m: Minted | null, nowMs: number): boolean =>
  m !== null && nowMs - m.at < MINTED_FRESH_MS;

export type NoticeKind = 'reverted' | 'failed' | 'prover-dead' | 'offline' | 'behind' | 'paused';

/** The card under the loop. `until` (ms) is when a pause ends. */
export interface Notice {
  kind: NoticeKind;
  title: string;
  body: string;
  until?: number;
}

export interface MinerState {
  phase: Phase;
  /** The epoch the Worker is (or was last) mining, with the secret generated for it. */
  job: { epoch: bigint; seed: bigint; target: bigint; secretId: number } | null;
  /** Monotonic id of the current secret; a new epoch always gets a new one. */
  secretId: number;
  /** Tickets tried in the current epoch and in this session. */
  tickets: number;
  proofs: number;
  /** Prove durations of the last attempts, newest last, for the rate readout. */
  recent: number[];
  /** Best score of the current epoch, if any attempt was made. */
  best: number | null;
  /** Every attempt of the last SAMPLE_SPAN_MS, oldest first (the score loop). */
  samples: Sample[];
  /** The claims of the same window, oldest first, on the samples' clock: the chart draws them under the ticks. */
  claimSpans: ClaimSpan[];
  /** performance.now() of the last winning proof, for the bar flash. */
  winAt: number | null;
  /** When the user's Start began this run of mining (wall clock; the chart's clock); null once stopped. */
  since: number | null;
  sinceT: number | null;
  /** Newest first, at most LEDGER lines. */
  ledger: LedgerLine[];
  /** The id of the last win's line: the claim that follows annotates it. */
  winLineId: number | null;
  wins: number;
  claim: ClaimProgress | null;
  /** Stop pressed while the claim runs: it finishes, mining does not resume after it. */
  stopping: boolean;
  minted: Minted | null;
  notice: Notice | null;
  /** The node's own pauses in force: the notice shown is the one still standing when the other clears. */
  nodePause: { offlineSince: number | null; behindAgeS: number | null };
  /** Set once the prover is abandoned (start failure or repeated crashes): only a reload helps. */
  proverDead: boolean;
}

export const initial: MinerState = {
  phase: 'idle',
  job: null,
  secretId: 0,
  tickets: 0,
  proofs: 0,
  recent: [],
  best: null,
  samples: [],
  claimSpans: [],
  winAt: null,
  since: null,
  sinceT: null,
  ledger: [],
  winLineId: null,
  wins: 0,
  claim: null,
  stopping: false,
  minted: null,
  notice: null,
  nodePause: { offlineSince: null, behindAgeS: null },
  proverDead: false,
};

/** A wall-clock stamp (`at`, ms since epoch) and a monotonic one (`t`, performance.now()). */
export interface Clock {
  at: number;
  t: number;
}

/** `t` is stamped by the controller's dispatch on every event that comes without one. */
export type Event = EventBody & { t?: number };

type EventBody =
  | ({ type: 'start'; epoch: EpochInfo } & Partial<Clock>)
  | { type: 'stop' }
  | ({ type: 'epoch'; epoch: EpochInfo; difficultyRatio?: number } & Partial<Clock>)
  | ({ type: 'attempt'; proveMs: number; score: number; win: boolean; bar: number; epoch?: number } & Clock)
  | { type: 'winner'; epoch: bigint; secretId: number; at?: number }
  | { type: 'sent'; txHash: string; expiresAt?: number; at?: number }
  | { type: 'included'; block: number; at?: number }
  | ({ type: 'claimed'; reward: string } & Omit<Minted, 'at'> & Partial<Clock>)
  /** `stale`: the controller's verdict on a revert (the open epoch moved past the claimed one). */
  | ({ type: 'failed'; error: string; kind?: ClaimFailure; stale?: boolean } & Partial<Clock>)
  | { type: 'recovered'; at?: number }
  /** A claim that failed at proving, submitted again from idle (the e2e canary's control). */
  | { type: 'retry'; at?: number }
  /** A retained claim found in a block after all: the claim's steps resume at `included`, nothing is sent. */
  | { type: 'reconciled'; at?: number }
  /** The honest pause after a recovery that did not unblock the key. */
  | { type: 'paused'; until: number; at?: number }
  | { type: 'offline'; since: number }
  | { type: 'online' }
  /** The node answers but lags the rollup on L1; `ageS` is its tip's age. */
  | { type: 'behind'; ageS: number }
  | { type: 'caught-up' }
  | { type: 'prover-dead'; error: string };

export type Command =
  | { type: 'mine'; epoch: bigint; seed: bigint; target: bigint; secretId: number }
  | { type: 'halt' }
  | { type: 'submit' }
  | { type: 'discard'; reason: string };

const RECENT = 20;
const LEDGER = 200;
/** Three minutes of proofs: the calm loop's window, about thirty samples at six seconds a proof. */
export const SAMPLE_SPAN_MS = 180_000;

const clock = (at?: number): string => new Date(at ?? Date.now()).toISOString().slice(11, 19);
/** Seconds as the chip says them: minutes from a minute and a half. */
export const ageWord = (s: number): string => (s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`);
const now = (at?: number): number => at ?? Date.now();

let lineId = 0;
const line = (state: MinerState, l: ProofLine): LedgerLine[] =>
  [{ ...l, id: ++lineId }, ...state.ledger].slice(0, LEDGER);

/**
 * The win line `id` with `note` merged over what it carried (`fresh`: replacing it, a claim sent
 * again); a line already out of the window is left alone.
 */
const annotate = (state: MinerState, id: number | null, note: ClaimNote, fresh = false): LedgerLine[] =>
  id === null
    ? state.ledger
    : state.ledger.map((l) => (l.id === id ? { ...l, claim: fresh ? note : { ...l.claim, ...note } } : l));

/** The claim's outcome on its win line, or — a win that came without its line — a ✗ line of its own. */
function outcomeLine(state: MinerState, lineId: number | null, note: ClaimNote, at?: number): LedgerLine[] {
  if (lineId !== null && state.ledger.some((l) => l.id === lineId)) return annotate(state, lineId, note);
  const text =
    note.outcome === 'discarded'
      ? 'not claimed'
      : `claim ${note.outcome}${note.reason ? `: ${note.reason}` : ''}`;
  return line(state, { kind: 'failed', time: clock(at), text });
}

function startJob(state: MinerState, epoch: EpochInfo): [MinerState, Command[]] {
  const secretId = state.secretId + 1;
  const job = { epoch: epoch.epoch, seed: epoch.seed, target: epoch.target, secretId };
  // Start rotates the secret and drops the retained claim: no line may offer to send it again.
  const ledger = withoutRetry(state.ledger);
  return [{ ...state, phase: 'mining', job, secretId, notice: null, ledger }, [{ type: 'mine', ...job }]];
}

/** The ledger with no Retry on offer: only the claim retained now may be sent again. */
const withoutRetry = (ledger: LedgerLine[], except: number | null = null): LedgerLine[] =>
  ledger.map((l) =>
    l.claim?.retry && l.id !== except ? { ...l, claim: { ...l.claim, retry: undefined } } : l,
  );

function attempt(state: MinerState, e: Extract<Event, { type: 'attempt' }>): MinerState {
  const tickets = state.tickets + 1;
  const best = state.best === null || e.score > state.best ? e.score : state.best;
  const samples = [
    ...state.samples.filter((s) => e.t - s.t <= SAMPLE_SPAN_MS),
    {
      t: e.t,
      score: e.score,
      bar: e.bar,
      win: e.win,
      ...(e.epoch !== undefined && { epoch: e.epoch }),
      n: tickets,
      proveMs: e.proveMs,
      at: e.at,
    },
  ];
  const l: ProofLine = e.win
    ? { kind: 'win', time: clock(e.at), n: tickets, score: e.score, proveMs: e.proveMs }
    : {
        kind: 'attempt',
        time: clock(e.at),
        n: tickets,
        score: e.score,
        proveMs: e.proveMs,
        best: e.score === best,
      };
  const ledger = line(state, l);
  return {
    ...state,
    tickets,
    proofs: state.proofs + 1,
    recent: [...state.recent, e.proveMs].slice(-RECENT),
    best,
    samples,
    winAt: e.win ? e.t : state.winAt,
    ledger,
    winLineId: e.win ? (ledger[0]?.id ?? null) : state.winLineId,
  };
}

function epochSwitch(state: MinerState, e: Extract<Event, { type: 'epoch' }>): [MinerState, Command[]] {
  // A new epoch while mining: the in-flight nonce is worthless and the secret rotates with it.
  // The running job is halted first; the Worker starts the replacement once it has stopped.
  if (state.job?.epoch === e.epoch.epoch) return [state, []];
  const opened = {
    ...state,
    tickets: 0,
    best: null,
    ledger: line(state, {
      kind: 'epoch',
      time: clock(e.at),
      text: epochOpened(e.epoch.epoch, difficulty(e.epoch.target), e.difficultyRatio),
    }),
  };
  if (state.phase !== 'mining') return [opened, []];
  const [next, commands] = startJob(opened, e.epoch);
  return [next, [{ type: 'halt' }, ...commands]];
}

/** A claim from the win `at`, annotating the last win line; the previous mint's acknowledgement goes. */
function claiming(state: MinerState, at: number | undefined): [MinerState, Command[]] {
  const t = now(at);
  const claim: ClaimProgress = { step: 'proving', wonAt: t, since: t, done: [], lineId: state.winLineId };
  return [
    {
      ...state,
      phase: 'claiming',
      claim,
      minted: null,
      notice: null,
      stopping: false,
      ledger: annotate(state, claim.lineId, { step: 'proving' }, true),
    },
    [{ type: 'submit' }],
  ];
}

function winner(state: MinerState, e: Extract<Event, { type: 'winner' }>): [MinerState, Command[]] {
  // Only a winner for the job that is still current gets submitted; a stale one is discarded.
  if (state.phase !== 'mining' || !state.job) return [state, []];
  if (e.epoch !== state.job.epoch || e.secretId !== state.job.secretId)
    return [
      { ...state, ledger: outcomeLine(state, state.winLineId, { outcome: 'discarded' }, e.at) },
      [{ type: 'discard', reason: 'won against a closed epoch' }],
    ];
  return claiming(state, e.at);
}

/** Moves the claim to its next step, closing the elapsed time of the current one. */
function advance(
  state: MinerState,
  step: ClaimProgress['step'],
  at: number | undefined,
  patch: Partial<ClaimProgress> = {},
): MinerState {
  if (!state.claim) return state;
  const t = now(at);
  const done = [...state.claim.done, Math.max(0, t - state.claim.since)];
  const claim = { ...state.claim, ...patch, step, since: t, done };
  const ttl =
    step === 'sent' && claim.expiresAt
      ? { ttlMinutes: Math.max(1, Math.round((claim.expiresAt - t / 1000) / 60)) }
      : {};
  return {
    ...state,
    claim,
    ledger: annotate(state, claim.lineId, { step, expiresAt: claim.expiresAt, ...ttl }),
  };
}

function claimed(state: MinerState, e: Extract<Event, { type: 'claimed' }>): MinerState {
  const { type: _, reward, at, t: __, ...rest } = e;
  const minted: Minted = { ...rest, at: now(at) };
  // The win line's step ends with the ✓ line under it.
  const settled = { ...state, ledger: annotate(state, state.claim?.lineId ?? null, { outcome: 'minted' }) };
  return {
    ...settled,
    phase: 'idle',
    job: null,
    wins: state.wins + 1,
    claim: null,
    stopping: false,
    minted,
    ledger: line(settled, {
      kind: 'minted',
      time: clock(at),
      text: `${reward}, privately`,
      links: { block: e.block, tx: e.txHash },
    }),
  };
}

/** The recovering banner: the cause for a stale claim, the brief's plain sentence otherwise. */
const RECOVERING: Record<'stale' | 'other', string> = {
  stale:
    'A claim reverted: someone closed the epoch first. Re-syncing this account from the chain; mining resumes in about a minute.',
  other: 'Re-syncing this account from the chain; mining resumes in about a minute.',
};

/** A revert is stale by the message, or by the controller's reading of the chain when the message says nothing. */
const staleRevert = (e: Extract<Event, { type: 'failed' }>): boolean =>
  e.kind === 'reverted' && (e.stale ?? revertCause(e.error).stale);

/** What the win line says of a failed claim. */
function failureNote(e: Extract<Event, { type: 'failed' }> & { kind: ClaimFailure }): ClaimNote {
  if (e.kind === 'reverted') {
    if (staleRevert(e)) return { outcome: 'reverted', stale: true };
    const cause = revertCause(e.error);
    return { outcome: 'reverted', ...(!cause.stale && cause.reason && { reason: cause.reason }) };
  }
  if (e.kind === 'other') return { outcome: 'other', reason: e.error, retry: true };
  return { outcome: e.kind };
}

function failed(state: MinerState, e: Extract<Event, { type: 'failed' }>): [MinerState, Command[]] {
  const lineId = state.claim?.lineId ?? null;
  // A failure that is not a claim's (the rebuilt view's read): the card under the loop and a ✗ line.
  if (!e.kind) {
    const notice: Notice = { kind: 'failed', title: 'claim failed', body: e.error };
    return [
      {
        ...state,
        claim: null,
        stopping: false,
        phase: 'idle',
        job: null,
        notice,
        ledger: line(state, { kind: 'failed', time: clock(e.at), text: e.error }),
      },
      [{ type: 'halt' }],
    ];
  }
  const note = failureNote({ ...e, kind: e.kind });
  // A failure retained for Retry replaces any earlier one: the older lines lose the link.
  const ledger = outcomeLine(
    note.retry ? { ...state, ledger: withoutRetry(state.ledger) } : state,
    lineId,
    note,
    e.at,
  );
  const base = { ...state, claim: null, stopping: false, job: null, ledger };
  if (e.kind === 'expired' || e.kind === 'refused') return [{ ...base, phase: 'idle' }, []];
  if (e.kind === 'reverted' || e.kind === 'delivery-blocked') {
    const stale = staleRevert(e);
    const notice: Notice = {
      kind: 'reverted',
      title: 'lost a race',
      body: RECOVERING[stale ? 'stale' : 'other'],
    };
    return [{ ...base, phase: 'recovering', notice }, []];
  }
  // `other`: mining stays paused with the ticket retained; the line offers Retry.
  return [{ ...base, phase: 'idle' }, [{ type: 'halt' }]];
}

/**
 * The claims on the chart, kept by what happened to `claim` rather than by event name, so every path that
 * ends a claim closes its span: null → a claim opens one (from the win, when a win caused it), a claim →
 * null closes it (`minted` only for `claimed`). A reconciliation also settles the earlier span of the same
 * win, whose transaction did land. Spans leave with the samples' window.
 */
function spansAfter(prev: MinerState, next: MinerState, event: Event): ClaimSpan[] {
  const t = event.t;
  // No clock, no span: the reducer reads no time of its own, and the controller stamps every event.
  if (t === undefined) return next.claimSpans;
  let spans = next.claimSpans;
  if (prev.claim === null && next.claim !== null) {
    const id = next.claim.lineId;
    const earlier = event.type === 'reconciled' && id !== null;
    spans = [
      ...spans.map((c) => (earlier && c.id === id ? { ...c, outcome: 'minted' as const } : c)),
      { id, t0: event.type === 'winner' ? (next.winAt ?? t) : t, t1: null },
    ];
  } else if (prev.claim !== null && next.claim === null) {
    const outcome = event.type === 'claimed' ? ('minted' as const) : ('failed' as const);
    spans = spans.map((c) => (c.t1 === null ? { ...c, t1: t, outcome } : c));
  }
  const kept = spans.filter((c) => c.t1 === null || t - c.t1 <= SAMPLE_SPAN_MS);
  return kept.length === spans.length ? spans : kept;
}

export function reduce(state: MinerState, event: Event): [MinerState, Command[]] {
  const [next, commands] = step(state, event);
  const claimSpans = spansAfter(state, next, event);
  return [claimSpans === next.claimSpans ? next : { ...next, claimSpans }, commands];
}

function step(state: MinerState, event: Event): [MinerState, Command[]] {
  switch (event.type) {
    case 'start': {
      if (state.phase !== 'idle' || state.proverDead) return [state, []];
      // The resume after a claim comes through here too: the run's start is kept until a Stop.
      const since = state.since === null ? { since: now(event.at), sinceT: event.t ?? null } : {};
      return startJob({ ...state, ...since }, event.epoch);
    }
    case 'prover-dead':
      return [
        {
          ...state,
          phase: 'idle',
          job: null,
          claim: null,
          notice: { kind: 'prover-dead', title: 'stopped · reload the page', body: event.error },
          proverDead: true,
        },
        [],
      ];
    case 'stop':
      // The submission cannot be abandoned: the claim finishes, marked, and mining does not resume after it.
      if (state.phase === 'claiming') return [{ ...state, stopping: true }, []];
      return [
        { ...state, phase: 'idle', job: null, since: null, sinceT: null },
        state.phase === 'idle' ? [] : [{ type: 'halt' }],
      ];
    case 'retry':
      return state.phase === 'idle' ? claiming(state, event.at) : [state, []];
    case 'reconciled':
      return state.phase === 'idle' ? [claiming(state, event.at)[0], []] : [state, []];
    case 'epoch':
      return epochSwitch(state, event);
    case 'attempt':
      return [attempt(state, event), []];
    case 'winner':
      return winner(state, event);
    case 'sent':
      return [advance(state, 'sent', event.at, { txHash: event.txHash, expiresAt: event.expiresAt }), []];
    case 'included':
      return [advance(state, 'waiting', event.at), []];
    case 'claimed':
      return [claimed(state, event), []];
    case 'failed':
      return failed(state, event);
    case 'recovered':
      return [
        {
          ...state,
          phase: 'idle',
          ledger: line(state, {
            kind: 'epoch',
            time: clock(event.at),
            text: 'chain view rebuilt · notes recovered',
          }),
          notice: standingNotice(state.nodePause),
        },
        [],
      ];
    case 'paused': {
      const notice: Notice = {
        kind: 'paused',
        title: 'claims paused',
        body: `Claims from this account wait until the reverted one is final on Ethereum. Mining resumes about ${clock(event.until).slice(0, 5)}.`,
        until: event.until,
      };
      // The blocked claim's line learns the wait now that it is known.
      const waitMinutes = Math.max(1, Math.round((event.until - now(event.at)) / 60_000));
      const ledger = state.ledger.map((l) =>
        l.id === state.winLineId && l.claim?.outcome === 'delivery-blocked'
          ? { ...l, claim: { ...l.claim, waitMinutes } }
          : l,
      );
      return [{ ...state, phase: 'idle', notice, ledger }, []];
    }
    case 'offline':
    case 'online':
    case 'behind':
    case 'caught-up':
      return [nodeNotice(state, event), []];
  }
}

type NodeEvent = Extract<Event, { type: 'offline' | 'online' | 'behind' | 'caught-up' }>;

const offlineNotice = (since: number): Notice => ({
  kind: 'offline',
  title: 'node unreachable',
  body: `No answer from the node since ${clock(since)}. Mining is paused; it resumes when the node answers.`,
});

const behindNotice = (ageS: number): Notice => ({
  kind: 'behind',
  title: 'node behind',
  body: `The node answers, but its chain is ${ageWord(ageS)} old. Mining is paused; it resumes when the node catches up.`,
});

const nextPause = (p: MinerState['nodePause'], event: NodeEvent): MinerState['nodePause'] => ({
  offlineSince: event.type === 'offline' ? event.since : event.type === 'online' ? null : p.offlineSince,
  behindAgeS: event.type === 'behind' ? event.ageS : event.type === 'caught-up' ? null : p.behindAgeS,
});

/** The notice of the node pause still in force, silence first; null when none is. */
const standingNotice = (p: MinerState['nodePause']): Notice | null =>
  p.offlineSince !== null
    ? offlineNotice(p.offlineSince)
    : p.behindAgeS !== null
      ? behindNotice(p.behindAgeS)
      : null;

/** The node's own notices: silence and a lag each raise one; one clearing shows the other if it still stands. */
function nodeNotice(state: MinerState, event: NodeEvent): MinerState {
  const nodePause = nextPause(state.nodePause, event);
  if (event.type === 'offline') return { ...state, nodePause, notice: offlineNotice(event.since) };
  if (event.type === 'behind') return { ...state, nodePause, notice: behindNotice(event.ageS) };
  // A clearing touches only the node's own notices.
  const own = state.notice?.kind === 'offline' || state.notice?.kind === 'behind';
  return own ? { ...state, nodePause, notice: standingNotice(nodePause) } : { ...state, nodePause };
}
