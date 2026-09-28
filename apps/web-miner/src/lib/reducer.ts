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
  /** The line offers Retry: one more attempt of a win that waits (an unrecognised failure, three tries, a Stop). */
  retry?: boolean;
  /** `delivery-blocked`, once the pause is known: the wait for Ethereum's finality. */
  waitMinutes?: number;
  /** While a failed claim is recovered: what its line says (`claim-copy.ts`). */
  recover?: RecoverStep;
  /** The try under way or next, from 2. */
  attempt?: number;
  /** The epoch the win stays claimable in. */
  until?: bigint;
  /** `discarded` after a send had left: "before the claim landed". */
  sent?: true;
}

export type RecoverStep = 'anchor-pruned' | 'resend' | 'reprove' | 'lost' | 'checking' | 'spent' | 'stopped';

/** Claim attempts a win gets on its own; Start and Retry each add one more. */
export const TRIES = 3;

/**
 * A win whose claim failed while its ticket can still mint: mining waits on it. Its secret and its
 * sends are the controller's; this is the schedule.
 */
export interface Fore {
  lineId: number | null;
  epoch: bigint;
  /** Attempts made, each counted from the moment it starts building. */
  attempts: number;
  /** How the last attempt failed. */
  kind: ClaimFailure;
  /** A send of this ticket has left for the node. */
  sent: boolean;
  /** Attempts come by themselves; not after a failure nobody recognised. */
  auto: boolean;
  /** Stop: nothing is attempted until Start or Retry, and only Start mines again. */
  held: boolean;
  /** Start or Retry asked for one more attempt, even past the three. */
  more: boolean;
}

/** What a check found for the win mining waits on. */
export type Verdict = 'live' | 'open' | 'closed' | 'not-minted' | 'unknown';

export interface Recovery {
  fore: Fore | null;
  /** Sends of wins that can no longer mint are still watched. */
  watching: boolean;
  /** Checks since the last attempt or failure: the pace slows after five. */
  checks: number;
}

export const NO_RECOVERY: Recovery = { fore: null, watching: false, checks: 0 };

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
  recovery: Recovery;
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
  recovery: NO_RECOVERY,
};

/** A wall-clock stamp (`at`, ms since epoch) and a monotonic one (`t`, performance.now()). */
export interface Clock {
  at: number;
  t: number;
}

/** `t` is stamped by the controller's dispatch on every event that comes without one. */
export type Event = EventBody & { t?: number };

type EventBody =
  /** `user`: a Start the user asked for; the page's own restarts do not try a waiting win again. */
  | ({ type: 'start'; epoch: EpochInfo; user?: boolean } & Partial<Clock>)
  | { type: 'stop' }
  | ({ type: 'epoch'; epoch: EpochInfo; difficultyRatio?: number } & Partial<Clock>)
  | ({ type: 'attempt'; proveMs: number; score: number; win: boolean; bar: number; epoch?: number } & Clock)
  | { type: 'winner'; epoch: bigint; secretId: number; at?: number }
  | { type: 'sent'; txHash: string; expiresAt?: number; at?: number }
  | { type: 'included'; block: number; at?: number }
  | ({ type: 'claimed'; reward: string } & Omit<Minted, 'at'> & Partial<Clock>)
  /**
   * `stale`: the controller's verdict on a revert (the open epoch moved past the claimed one). A claim's
   * failure carries its `epoch`, its `attempt`, whether any send `sent`, and whether other wins are
   * `watching`; `lineId` names a recorded win's line when the failure is not the claim in hand's.
   */
  | ({
      type: 'failed';
      error: string;
      kind?: ClaimFailure;
      stale?: boolean;
      epoch?: bigint;
      attempt?: number;
      sent?: boolean;
      watching?: boolean;
      lineId?: number | null;
    } & Partial<Clock>)
  | { type: 'recovered'; at?: number }
  /** Retry on the waiting win's line: one more attempt, after a check. */
  | { type: 'retry'; at?: number }
  /** The recovery's timer; `blocked` while a pause, a switch or a rebuild holds the node. */
  | { type: 'due'; blocked: boolean }
  /** A pause or a switch ended: the check it held runs now. */
  | { type: 'unblocked' }
  /**
   * A check: the verdict on the waiting win (none while its attempt runs), whether sends are watched, and
   * whether a pause or a switch came meanwhile (its attempt then waits for `unblocked`).
   */
  | ({ type: 'checked'; verdict?: Verdict; watching: boolean; blocked?: boolean } & Partial<Clock>)
  /** A watched win that did not mint, as the checkpointed tip says. */
  | ({ type: 'not-minted'; lineId: number | null; sent: boolean; watching: boolean } & Partial<Clock>)
  /** A recorded win found in a block: its line ✓ and the win counted once; the claim in hand is untouched. */
  | ({ type: 'adopted'; lineId: number | null; fore: boolean; watching: boolean; reward: string } & Omit<
      Minted,
      'at'
    > &
      Partial<Clock>)
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
  | { type: 'discard'; reason: string }
  /** Arm the recovery's one timer. */
  | { type: 'retry-in'; ms: number }
  | { type: 'check' }
  /** Mining may go on: the win it waited on is settled. */
  | { type: 'resume' };

const RECENT = 20;
const LEDGER = 200;
/** Before the second attempt and before the third. */
const GAP_MS = [5_000, 30_000];
const CHECK_MS = 15_000;
const SLOW_CHECK_MS = 60_000;
const QUICK_CHECKS = 5;
/** Failures a waiting win comes back from; a revert or a blocked delivery ends it. */
const RECOVERABLE = new Set<ClaimFailure>([
  'anchor-pruned',
  'lost',
  'landed-elsewhere',
  'expired',
  'refused',
  'other',
]);
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
  // Mining starts only with no win waiting: no line may still offer Retry.
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

/** A claim from `at` on the win line `lineId` (`note` rides on its first step); the previous mint's acknowledgement goes. */
function claiming(
  state: MinerState,
  at: number | undefined,
  lineId = state.winLineId,
  note: ClaimNote = {},
): [MinerState, Command[]] {
  const t = now(at);
  const claim: ClaimProgress = { step: 'proving', wonAt: t, since: t, done: [], lineId };
  return [
    {
      ...state,
      phase: 'claiming',
      claim,
      minted: null,
      notice: null,
      stopping: false,
      ledger: annotate(state, claim.lineId, { step: 'proving', ...note }, true),
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
  return { ...state, claim, ledger: annotate(state, claim.lineId, { step, expiresAt: claim.expiresAt }) };
}

function claimed(state: MinerState, e: Extract<Event, { type: 'claimed' }>): MinerState {
  const { type: _, reward, at, t: __, ...rest } = e;
  const minted: Minted = { ...rest, at: now(at) };
  // The win line's step ends with the ✓ line under it.
  const settled = { ...state, ledger: annotate(state, state.claim?.lineId ?? null, { outcome: 'minted' }) };
  const fore = state.recovery.fore?.lineId === state.claim?.lineId ? null : state.recovery.fore;
  return {
    ...settled,
    phase: 'idle',
    job: null,
    wins: state.wins + 1,
    claim: null,
    stopping: false,
    minted,
    recovery: { ...state.recovery, fore },
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

type Failed = Extract<Event, { type: 'failed' }>;
type FailedClaim = Failed & { kind: ClaimFailure };

/** The line gets `note` in place of what it said; only one line offers Retry. */
const noteLine = (state: MinerState, id: number | null, note: ClaimNote): LedgerLine[] =>
  annotate({ ...state, ledger: note.retry ? withoutRetry(state.ledger) : state.ledger }, id, note, true);

/** What the waiting win's line says between checks. */
function waitingNote(f: Fore): ClaimNote {
  if (f.held) return { recover: 'stopped', until: f.epoch, retry: true };
  if (!f.more && f.attempts >= TRIES) return { recover: 'spent', until: f.epoch, retry: true };
  if (f.kind === 'anchor-pruned') return { recover: 'anchor-pruned', attempt: f.attempts + 1 };
  return { recover: f.kind === 'lost' ? 'lost' : 'checking' };
}

/** The next check while anything is left to look at: 15 s apart, 60 s once five changed nothing. */
function schedule(s: MinerState, extra: Command[] = []): [MinerState, Command[]] {
  if (!s.recovery.fore && !s.recovery.watching) return [s, extra];
  const ms = s.recovery.checks < QUICK_CHECKS ? CHECK_MS : SLOW_CHECK_MS;
  return [s, [...extra, { type: 'retry-in', ms }]];
}

const pending = (s: MinerState): boolean => s.recovery.fore !== null || s.recovery.watching;

/** An attempt failed while its ticket may still mint: the win waits, its line says why, and a check follows. */
function recoverFrom(state: MinerState, e: FailedClaim): [MinerState, Command[]] {
  const prev = state.recovery.fore;
  const fore: Fore = {
    lineId: state.claim?.lineId ?? prev?.lineId ?? null,
    epoch: e.epoch ?? prev?.epoch ?? state.job?.epoch ?? 0n,
    attempts: e.attempt ?? (prev?.attempts ?? 0) + 1,
    kind: e.kind,
    sent: e.sent ?? prev?.sent ?? false,
    auto: e.kind !== 'other',
    held: state.stopping,
    more: false,
  };
  const note: ClaimNote =
    e.kind === 'other' ? { outcome: 'other', reason: e.error, retry: true } : waitingNote(fore);
  return [
    {
      ...state,
      phase: 'idle',
      claim: null,
      stopping: false,
      job: null,
      recovery: { fore, watching: e.watching ?? state.recovery.watching, checks: 0 },
      ledger: noteLine(state, fore.lineId, note),
    },
    [{ type: 'halt' }, { type: 'retry-in', ms: GAP_MS[fore.attempts - 1] ?? CHECK_MS }],
  ];
}

/** A recorded win's send reverted in a block: its line says so, and the revert's recovery runs as a claim's would. */
function recordReverted(
  state: MinerState,
  e: FailedClaim & { lineId: number | null },
): [MinerState, Command[]] {
  const f = state.recovery.fore;
  const notice: Notice = {
    kind: 'reverted',
    title: 'lost a race',
    body: RECOVERING[staleRevert(e) ? 'stale' : 'other'],
  };
  return [
    {
      ...state,
      phase: 'recovering',
      job: null,
      notice,
      recovery: {
        ...state.recovery,
        fore: f?.lineId === e.lineId ? null : f,
        watching: e.watching ?? state.recovery.watching,
      },
      ledger: noteLine(state, e.lineId, failureNote(e)),
    },
    state.phase === 'mining' ? [{ type: 'halt' }] : [],
  ];
}

function failed(state: MinerState, e: Failed): [MinerState, Command[]] {
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
  const claim = { ...e, kind: e.kind };
  if (e.lineId !== undefined) return recordReverted(state, { ...claim, lineId: e.lineId });
  if (RECOVERABLE.has(e.kind)) return recoverFrom(state, claim);
  // A revert or a blocked delivery ends the win: the rebuild runs, its sends stay watched.
  const notice: Notice = {
    kind: 'reverted',
    title: 'lost a race',
    body: RECOVERING[staleRevert(e) ? 'stale' : 'other'],
  };
  return [
    {
      ...state,
      claim: null,
      stopping: false,
      job: null,
      phase: 'recovering',
      notice,
      ledger: outcomeLine(state, lineId, failureNote(claim), e.at),
      recovery: { ...state.recovery, fore: null, watching: e.watching ?? state.recovery.watching },
    },
    [],
  ];
}

/** One more attempt of the waiting win: its line says why, and the claim runs again. */
function tryAgain(state: MinerState, f: Fore, at?: number): [MinerState, Command[]] {
  const n = f.attempts + 1;
  const recover: RecoverStep = f.kind === 'anchor-pruned' ? 'anchor-pruned' : f.sent ? 'resend' : 'reprove';
  const [next, commands] = claiming({ ...state, ledger: withoutRetry(state.ledger) }, at, f.lineId, {
    recover,
    attempt: n,
  });
  return [
    { ...next, recovery: { ...state.recovery, fore: { ...f, attempts: n, more: false }, checks: 0 } },
    commands,
  ];
}

/** The waiting win can no longer mint: its line says so, mining may go on, its sends stay watched. */
function released(state: MinerState, f: Fore, v: 'closed' | 'not-minted'): [MinerState, Command[]] {
  const note: ClaimNote =
    v === 'closed'
      ? { recover: 'checking' }
      : { outcome: 'discarded', ...(f.sent && { sent: true as const }) };
  const s = {
    ...state,
    recovery: { ...state.recovery, fore: null },
    ledger: noteLine(state, f.lineId, note),
  };
  return schedule(s, f.held ? [] : [{ type: 'resume' }]);
}

/** What a check says to the waiting win's line when nothing is attempted: an unrecognised failure's stays. */
function lineAfterCheck(f: Fore, v: Verdict): ClaimNote | null {
  if (!f.auto) return null;
  const w = waitingNote(f);
  if (w.retry) return w;
  return v === 'live' || v === 'unknown' ? { recover: f.kind === 'lost' ? 'lost' : 'checking' } : w;
}

function checked(state: MinerState, e: Extract<Event, { type: 'checked' }>): [MinerState, Command[]] {
  const f = state.recovery.fore;
  const next = {
    ...state,
    recovery: { ...state.recovery, watching: e.watching, checks: state.recovery.checks + 1 },
  };
  if (!f || !e.verdict) return schedule(next);
  if (e.verdict === 'closed' || e.verdict === 'not-minted') return released(next, f, e.verdict);
  if (e.verdict === 'open' && !e.blocked && !f.held && (f.more || (f.auto && f.attempts < TRIES)))
    return tryAgain(next, f, e.at);
  const note = lineAfterCheck(f, e.verdict);
  return schedule(note ? { ...next, ledger: noteLine(next, f.lineId, note) } : next);
}

/** Stop while a win waits: nothing is attempted or resumed until Start or Retry, and its line offers Retry. */
function hold(state: MinerState): MinerState {
  const f = state.recovery.fore;
  if (!f || f.held) return state;
  const fore = { ...f, held: true, more: false };
  return {
    ...state,
    recovery: { ...state.recovery, fore },
    ledger: f.auto ? noteLine(state, f.lineId, waitingNote(fore)) : state.ledger,
  };
}

/** Start or Retry on a waiting win: one more attempt once a check says its ticket can still mint. */
const goAgain = (state: MinerState, f: Fore): [MinerState, Command[]] => [
  { ...state, recovery: { ...state.recovery, fore: { ...f, held: false, more: true } } },
  [{ type: 'check' }],
];

/** A recorded win found in a block, counted once: its line ✓ and the ✓ line, the claim in hand untouched. */
function adopted(state: MinerState, e: Extract<Event, { type: 'adopted' }>): [MinerState, Command[]] {
  const { type: _, lineId, fore: wasFore, watching, reward, at, t: __, ...rest } = e;
  if (lineId !== null && state.ledger.find((l) => l.id === lineId)?.claim?.outcome === 'minted')
    return [state, []];
  const f = state.recovery.fore;
  const settled = { ...state, ledger: annotate(state, lineId, { outcome: 'minted' }, true) };
  const next: MinerState = {
    ...settled,
    wins: state.wins + 1,
    minted: state.claim ? state.minted : { ...rest, at: now(at) },
    recovery: { ...state.recovery, fore: wasFore ? null : f, watching },
    ledger: line(settled, {
      kind: 'minted',
      time: clock(at),
      text: `${reward}, privately`,
      links: { block: e.block, tx: e.txHash },
    }),
  };
  return schedule(next, wasFore && f && !f.held ? [{ type: 'resume' }] : []);
}

/** A waiting win's next attempt comes by itself: the cockpit offers Stop, not Start. */
export const attemptScheduled = (m: MinerState): boolean => {
  const f = m.recovery.fore;
  return m.phase === 'idle' && f !== null && !f.held && (f.more || (f.auto && f.attempts < TRIES));
};

/** Where the cockpit's button says Stop, and Space stops: mining, a claim in flight, an attempt on its way. */
export const offersStop = (m: MinerState): boolean =>
  m.phase === 'mining' || m.phase === 'claiming' || attemptScheduled(m);

/**
 * The claims on the chart, kept by what happened to `claim` rather than by event name, so every path that
 * ends a claim closes its span: null → a claim opens one (from the win, when a win caused it), a claim →
 * null closes it (`minted` only for `claimed`). An adoption settles the win's last span, whose send did
 * land. Spans leave with the samples' window.
 */
function spansAfter(prev: MinerState, next: MinerState, event: Event): ClaimSpan[] {
  const t = event.t;
  // No clock, no span: the reducer reads no time of its own, and the controller stamps every event.
  if (t === undefined) return next.claimSpans;
  let spans = next.claimSpans;
  if (event.type === 'adopted' && event.lineId !== null && next !== prev) {
    const last = spans.findLastIndex((c) => c.id === event.lineId && c.t1 !== null);
    spans = spans.map((c, i) => (i === last ? { ...c, outcome: 'minted' as const } : c));
  }
  if (prev.claim === null && next.claim !== null) {
    spans = [
      ...spans,
      { id: next.claim.lineId, t0: event.type === 'winner' ? (next.winAt ?? t) : t, t1: null },
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

function start(state: MinerState, event: Extract<Event, { type: 'start' }>): [MinerState, Command[]] {
  if (state.phase !== 'idle' || state.proverDead) return [state, []];
  const f = state.recovery.fore;
  if (f) return event.user ? goAgain(state, f) : [state, []];
  // The resume after a claim comes through here too: the run's start is kept until a Stop.
  const since = state.since === null ? { since: now(event.at), sinceT: event.t ?? null } : {};
  return startJob({ ...state, ...since }, event.epoch);
}

function stop(state: MinerState): [MinerState, Command[]] {
  // The submission cannot be abandoned: the claim finishes, marked, and mining does not resume after it.
  if (state.phase === 'claiming') return [{ ...state, stopping: true }, []];
  return [
    { ...hold(state), phase: 'idle', job: null, since: null, sinceT: null },
    state.phase === 'idle' ? [] : [{ type: 'halt' }],
  ];
}

type RecoveryEvent = Extract<
  Event,
  { type: 'retry' | 'due' | 'unblocked' | 'checked' | 'not-minted' | 'adopted' }
>;

/** The waiting win's and the watched ones' events: Retry, the timer, the end of a pause, what a check found. */
function recoveryStep(state: MinerState, event: RecoveryEvent): [MinerState, Command[]] {
  switch (event.type) {
    case 'retry': {
      const f = state.recovery.fore;
      return state.phase === 'idle' && f ? goAgain(state, f) : [state, []];
    }
    case 'due':
      return [state, pending(state) && !event.blocked ? [{ type: 'check' }] : []];
    case 'unblocked':
      return [state, pending(state) ? [{ type: 'check' }] : []];
    case 'checked':
      return checked(state, event);
    case 'not-minted':
      return schedule({
        ...state,
        recovery: { ...state.recovery, watching: event.watching },
        ledger: noteLine(state, event.lineId, {
          outcome: 'discarded',
          ...(event.sent && { sent: true as const }),
        }),
      });
    case 'adopted':
      return adopted(state, event);
  }
}

function step(state: MinerState, event: Event): [MinerState, Command[]] {
  switch (event.type) {
    case 'start':
      return start(state, event);
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
      return stop(state);
    case 'retry':
    case 'due':
    case 'unblocked':
    case 'checked':
    case 'not-minted':
    case 'adopted':
      return recoveryStep(state, event);
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
        pending(state) ? [{ type: 'check' }] : [],
      ];
    case 'paused':
      return [claimsPaused(state, event), []];
    case 'offline':
    case 'online':
    case 'behind':
    case 'caught-up':
      return [nodeNotice(state, event), []];
  }
}

function claimsPaused(state: MinerState, event: Extract<Event, { type: 'paused' }>): MinerState {
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
  return { ...state, phase: 'idle', notice, ledger };
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
