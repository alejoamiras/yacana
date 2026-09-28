// Drives the reducer: chain reads on a timer, the Worker for proving, the wallet for claims, the
// chain-view reset after a lost race.
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import type { TxEffect } from '@aztec/stdlib/tx';
import {
  claimFailureMessage,
  classifyClaimFailure,
  finalitySeconds,
  revertCause,
} from '@yacana/miner-core/claim-failure';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { difficulty } from '@yacana/miner-core/metrics';
import { deployDomain, ticketNullifier } from '@yacana/miner-core/proof';
import { newEpochSecret } from '@yacana/miner-core/secret';
import { readTip } from '@yacana/web-kit/browser/node';
import {
  markRead,
  nodeHealth,
  recordTip,
  subscribeNodeHealth,
  tipAgeS,
} from '@yacana/web-kit/browser/node-health';
import type { createStore } from 'jotai';
import { type Deployment, type Fee, readBalance, readEpoch, sendClaim, sendRoll } from './chain';
import { chime } from './chime';
import { absentAt, canMint, carrier, fate, type Landed, mintedBy, tipAt } from './claim-check';
import { amount } from './lib/format';
import { type Command, type Event, reduce, type Verdict } from './lib/reducer';
import {
  type ConsentHooks,
  type PrestoEndpoint,
  type ProverKind,
  prestoAtom,
  prestoSticky,
  txProvingAtom,
} from './presto';
import { settingsAtom } from './settings';
import { balanceAtom, claimsAtom, epochAtom, logAtom, minerAtom } from './state';
import type { FromWorker, MineJob, ToWorker } from './worker-protocol';

type Store = ReturnType<typeof createStore>;

const EPOCH_POLL_MS = 10_000;
/** A read that takes longer than this counts as failed: the RPC client has no deadline of its own. */
const READ_DEADLINE_MS = 30_000;
/** Failed reads for this long mean the node is gone, not slow. */
const OFFLINE_AFTER_MS = 60_000;
const MAX_CRASHES = 3;
/** The pause when the rollup's constants cannot be read either. */
const FALLBACK_FINALITY_S = 40 * 60;

export type PauseReason =
  | 'battery'
  | 'hidden'
  | 'withdraw'
  | 'offline'
  | 'behind'
  | 'lost-race'
  | 'switch'
  | 'bridge';

interface Prover {
  worker: Worker;
  ready: Promise<void>;
  generation: number;
}

export interface Rebound {
  deployment: Deployment;
  fee: Fee;
  /** False when the chain view could not be dropped and the old one was merely reopened. */
  rebuilt: boolean;
}

export interface MinerOptions {
  store: Store;
  spawnWorker: () => Worker;
  threads: number;
  /** Presto's endpoint when the page's probe found it worth asking; null proves in WASM as before. */
  presto?: PrestoEndpoint | null;
  /** Consent as it stands at each native message: nothing native is published or remembered without it. */
  consent: ConsentHooks;
  deployment: Deployment;
  account: AztecAddress;
  fee: Fee;
  chainId: bigint;
  rollupVersion: bigint;
  /** Rebuilds the key's chain view (wallet, account, deployment) after a lost race. */
  recover?: () => Promise<Rebound>;
  readDeadlineMs?: number;
  /** How long a recovery wait of `ms` really lasts: tests shorten it. */
  recoveryDelay?: (ms: number) => number;
}

type Ticket = {
  epoch: bigint;
  nonce: bigint;
  out: string;
  proofFields: string[];
  digest: string;
  secretId: number;
  prover: ProverKind;
};

/**
 * One send of a claim: past `expiresAt` (unix s, chain time) no block can take it. Null when the wallet
 * did not see it leave: live while pending, watched until it lands or reverts.
 */
interface Submission {
  hash: string;
  expiresAt: number | null;
}

/**
 * A win that failed to claim, kept apart from its secret (`secrets`): `ticket` while it can still mint,
 * null once its sends are only watched. Sends are append-only: no later failure erases one.
 */
interface WinRecord {
  ticket: Ticket | null;
  lineId: number | null;
  epoch: bigint;
  digest: string;
  prover: ProverKind;
  /** Siloed, as the nullifier tree holds it. */
  nullifier: string;
  attempts: number;
  submissions: Submission[];
  /** Decided at the checkpointed tip; a send still live is watched for a late revert. */
  notMinted?: true;
}

type Landing =
  | { kind: 'minted'; landed: Landed }
  | { kind: 'reverted'; hash: string }
  | { kind: 'open'; live: boolean; unknown: boolean };

const REWARD = `${amount(PARAMS.REWARD, PARAMS.DECIMALS)} ${PARAMS.TOKEN_SYMBOL}`;

/** What the E2E checks about the last minted claim: the effect as read, and the expected nullifier. */
export interface LastClaim {
  txHash: string;
  nullifiers: string[];
  noteHashes: string[];
  ticketNullifier: string;
  /** Who made the claimed winning proof. */
  prover: ProverKind;
}

const short = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-4)}`;

const deadline = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer from the node in ${ms / 1000} s`)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });

/**
 * The effect holds the tx-hash nullifier, the ticket's, the token's delivery nullifier and, on a
 * first contact, the registry's handshake nullifier and note; the ticket is matched by value, the
 * minted note is the first note hash.
 */
async function claimMarks(
  effect: TxEffect,
  digest: string,
  miner: AztecAddress,
  prover: ProverKind,
): Promise<LastClaim & { nullifier: string; noteHash: string; noteHashes: string[] }> {
  const ticket = (await ticketNullifier(Fr.fromString(digest), miner)).toString();
  const nullifiers = effect.nullifiers.map((n) => n.toString());
  const noteHashes = effect.noteHashes.map((n) => n.toString());
  return {
    txHash: effect.txHash.toString(),
    nullifiers,
    noteHashes,
    ticketNullifier: ticket,
    prover,
    nullifier: nullifiers.find((n) => n === ticket) ?? nullifiers[1] ?? '0x0',
    noteHash: noteHashes[0] ?? '0x0',
  };
}

export class MinerController {
  private readonly store: Store;
  private readonly spawnWorker: () => Worker;
  private threads: number;
  private presto: PrestoEndpoint | null;
  private readonly consent: ConsentHooks;
  private d: Deployment;
  private readonly account: AztecAddress;
  private fee: Fee;
  private readonly chainId: bigint;
  private readonly rollupVersion: bigint;
  private readonly recover: ((strict?: boolean) => Promise<Rebound>) | undefined;
  private readonly readDeadlineMs: number;

  private secrets = new Map<number, string>();
  private nextNonce = new Map<string, bigint>();
  /** The Worker's winner, until the claim it starts takes it. */
  private pending: Ticket | null = null;
  /** The win claimed now or waited on: mining waits while its ticket can still mint. */
  private fore: WinRecord | null = null;
  /** Wins that can no longer mint whose sends may still land or revert. */
  private watches: WinRecord[] = [];
  private checking: Promise<void> | undefined;
  private recheck = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly recoveryDelay: (ms: number) => number;
  /** Bumped by a switch and by dispose: a check begun before either acts on nothing it read. */
  private holds = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** The e2e canary's fault: the next claim goes out with a bound public input altered. */
  private tamperNext = false;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private domain: string | undefined;
  private prover: Prover;
  private generations = 0;
  private crashes = 0;
  /** Bumped per user Stop: work queued behind a Start (the Presto probe) checks it before acting. */
  private stops = 0;
  private refreshing: Promise<void> = Promise.resolve();
  /** The chain reads behind the refreshes and the checks, settled past their deadlines: what a switch drains. */
  private inflightRead: Promise<void> = Promise.resolve();
  /** True from the drain through the rebuild of a node switch: the poll must not read across it. */
  private switching = false;
  /** True once disposed: a read still in flight from a cancelled or replaced controller writes nothing. */
  private disposed = false;
  /** Node operations outside the poll and the claim (a roll, a withdrawal), for the drain to await. */
  private ops: Promise<void> = Promise.resolve();
  /** Bumped per refresh; a read that outlived its deadline must not write over a newer one. */
  private reads = 0;
  private lastRead = Date.now();
  private offline = false;
  /** The store's last verdict acted on: the node behind the rollup pauses mining like silence does. */
  private behind = false;
  private unsubscribeHealth: (() => void) | undefined;
  /** Bumped when the chain view starts being replaced: a read begun on the old one publishes nothing. */
  private views = 0;
  /** When the chain view was last rebuilt; a block that survives a rebuild gets the pause instead. */
  private rebuiltAt: number | null = null;
  /** A rebuilt view that has not been read yet: Start reads it before anything mines. */
  private unread = false;
  private reading: Promise<void> | undefined;
  /** Why mining is paused by the page itself (not the user); it resumes when the reason clears. */
  private pausedBy = new Set<PauseReason>();
  private resumeWhenClear = false;
  /** A Stop since the last start: nothing the page runs by itself resumes mining; only Start clears it. */
  private stopped = false;
  /** The rebuild under way follows a watched win's revert that interrupted no mining: its end resumes none. */
  private idleRebuild = false;
  /** A resume whose read failed, as the `stops` count it was owed at: the next good poll carries it out. */
  private resumeOnRead: number | null = null;
  private retired = false;
  lastClaim: LastClaim | undefined;

  constructor(o: MinerOptions) {
    this.store = o.store;
    this.spawnWorker = o.spawnWorker;
    this.threads = o.threads;
    this.presto = o.presto ?? null;
    this.consent = o.consent;
    this.d = o.deployment;
    this.account = o.account;
    this.fee = o.fee;
    this.chainId = o.chainId;
    this.rollupVersion = o.rollupVersion;
    this.recover = o.recover;
    this.readDeadlineMs = o.readDeadlineMs ?? READ_DEADLINE_MS;
    this.recoveryDelay = o.recoveryDelay ?? ((ms) => ms);
    this.prover = this.attach();
  }

  /**
   * Spawns a Worker and starts its prover. Messages from a superseded generation are ignored, so
   * a crashed Worker's late events cannot touch the state of its replacement.
   */
  private attach(): Prover {
    const generation = ++this.generations;
    const worker = this.spawnWorker();
    let initialised = false;
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        if (this.generations !== generation) return;
        if (e.data.type === 'ready') {
          initialised = true;
          resolve();
        }
        if (e.data.type === 'error') {
          reject(new Error(e.data.message));
          if (!initialised) return this.abandonProver(`prover failed to start: ${e.data.message}`);
        }
        this.onWorker(e.data);
      };
      worker.onerror = (e) => {
        reject(new Error(e.message));
        if (this.generations !== generation) return;
        if (!initialised) return this.abandonProver(`prover failed to start: ${e.message}`);
        this.replaceProver(`worker crashed: ${e.message}`);
      };
    });
    ready.catch(() => {});
    worker.postMessage({ type: 'init', threads: this.threads, presto: this.presto } satisfies ToWorker);
    return { worker, ready, generation };
  }

  /** A crash after a successful start is replaced, a bounded number of times per page lifetime. */
  private replaceProver(reason: string) {
    this.prover.worker.terminate();
    this.clearPrestoView();
    this.dispatch({ type: 'failed', error: reason });
    this.log(reason);
    if (++this.crashes >= MAX_CRASHES) return this.abandonProver('prover keeps crashing; reload the page');
    this.prover = this.attach();
  }

  /** What the page knows of the Worker's Presto is that Worker's: a new or a dead one leaves none of it behind. */
  private clearPrestoView() {
    this.store.set(prestoAtom, (s) => ({
      ...s,
      selected: null,
      active: null,
      phase: undefined,
      fallbackReason: undefined,
    }));
  }

  /**
   * Terminal: a failure before the prover ever became ready would repeat identically, and a prover
   * that keeps crashing is not worth another Worker. The reducer refuses `start` from here on.
   */
  private abandonProver(reason: string) {
    this.prover.worker.terminate();
    this.generations++;
    this.clearPrestoView();
    this.dispatch({ type: 'prover-dead', error: reason });
    this.log(reason);
  }

  /** Prover readiness for callers that must not race the init handshake; rejects on init failure. */
  ready(): Promise<void> {
    return this.prover.ready;
  }

  /** Test hook: makes the Worker throw, which takes the same path as any real crash. */
  crashProver() {
    this.prover.worker.postMessage({ type: 'crash' } satisfies ToWorker);
  }

  tamperNextClaim() {
    this.tamperNext = true;
  }

  log(line: string) {
    this.store.set(logAtom, (l) => [...l.slice(-199), `${new Date().toISOString().slice(11, 19)} ${line}`]);
  }

  async begin() {
    this.domain = (
      await deployDomain(this.chainId, this.rollupVersion, this.d.miner.address.toField(), PARAMS.VERSION)
    ).toString();
    await this.refresh();
    this.timer = setInterval(() => void this.poll(), EPOCH_POLL_MS);
    this.unsubscribeHealth = subscribeNodeHealth(() => this.onHealth());
    this.onHealth();
  }

  /** The store's `behind` verdict in and out: a pause of its own, released when the node catches up. */
  private onHealth() {
    const h = nodeHealth();
    if (h.behind === this.behind || this.disposed) return;
    this.behind = h.behind;
    if (h.behind) {
      this.log('node behind the rollup: mining paused');
      this.pause('behind');
      this.dispatch({ type: 'behind', ageS: tipAgeS(h, Date.now()) ?? 0 });
      return;
    }
    this.log('node caught up with the rollup');
    this.dispatch({ type: 'caught-up' });
    this.release('behind');
  }

  /** The node's tip beside the refresh, for the Settings row; a node that cannot say is not a failed refresh. */
  private async sampleTip() {
    const view = this.views;
    try {
      const tip = await readTip(this.d.node);
      // A read that began on a view since replaced (a switch, a rebuild) says nothing about the node in use.
      if (view === this.views && !this.disposed) recordTip(tip);
    } catch {
      /* the refresh is the health signal; the tip is what the row shows */
    }
  }

  /** Ends the timers and the Worker; the page (or a failed boot) owns nothing of this afterwards. */
  dispose() {
    this.disposed = true;
    this.holds++;
    if (this.timer) clearInterval(this.timer);
    this.unsubscribeHealth?.();
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    clearTimeout(this.recoveryTimer);
    this.generations++;
    this.prover.worker.terminate();
    this.clearPrestoView();
  }

  /** The version was flipped away from: mining stops and no start — the user's or the loop's own — resumes it. */
  retire() {
    this.retired = true;
    this.stop();
  }

  /**
   * Under a page-side pause the intent is kept: mining starts when the last reason clears. `user` is a
   * Start the user asked for: with a win waiting it is one more attempt; the page's own restarts leave it.
   */
  start(user = true) {
    if (this.retired || this.disposed) return;
    this.stopped = false;
    this.idleRebuild = false;
    if (this.pausedBy.size) {
      this.resumeWhenClear = true;
      // The release restarts nothing a win waits on: the user's Start is heard now, its attempt waits for the release.
      if (user && this.store.get(minerAtom).recovery.fore) this.dispatch({ type: 'retry', at: Date.now() });
      return;
    }
    if (this.unread) return void this.readRebuilt();
    const epoch = this.store.get(epochAtom);
    if (epoch) this.dispatch({ type: 'start', epoch, user, at: Date.now(), t: performance.now() });
  }

  /** Idle now; during a claim the phase stays `claiming` (the submission cannot be abandoned). Nothing in flight resumes mining. */
  stop() {
    this.stops++;
    this.resumeWhenClear = false;
    this.stopped = true;
    this.dispatch({ type: 'stop' });
  }

  get stopCount(): number {
    return this.stops;
  }

  /**
   * Power, or Presto's endpoint: the Worker finishes the proof in flight, rebuilds the prover and
   * resumes at the next nonce. `force` rebuilds under an unchanged config — a Retry after the Worker
   * gave up on native, which only a rebuild brings back.
   */
  reconfigure(threads: number, presto: PrestoEndpoint | null = this.presto, opts?: { force?: boolean }) {
    const sameEndpoint = JSON.stringify(presto) === JSON.stringify(this.presto);
    if (sameEndpoint && threads === this.threads && !opts?.force) return;
    // Presto's own speed setting decides its threads: a thread change while the Worker proves
    // natively is kept for the next browser build instead of rebuilding a prover for nothing.
    if (sameEndpoint && !opts?.force && presto !== null && prestoSticky(this.store.get(prestoAtom))) {
      this.threads = threads;
      this.post({ type: 'threads', threads });
      this.log(`prover: ${threads} threads kept for the browser prover; Presto decides its own`);
      return;
    }
    this.threads = threads;
    this.presto = presto;
    this.post({ type: 'reconfigure', threads, presto });
    this.log(`prover: ${threads} threads${presto ? `, Presto at ${presto.host}:${presto.port}` : ''}`);
  }

  get currentPresto(): PrestoEndpoint | null {
    return this.presto;
  }

  get currentThreads(): number {
    return this.threads;
  }

  get deployment(): Deployment {
    return this.d;
  }

  get address(): AztecAddress {
    return this.account;
  }

  get feeSettings(): Fee {
    return this.fee;
  }

  /**
   * A page-side pause (battery, hidden tab, …): stops now, restarts by itself once every reason
   * clears. A claim or a rebuild in flight is left to finish; the restart they would have made
   * waits with the pause, unless Stop was pressed during the claim.
   */
  pause(reason: PauseReason) {
    const phase = this.store.get(minerAtom).phase;
    this.pausedBy.add(reason);
    if (phase === 'idle') return;
    if (phase === 'mining') this.dispatch({ type: 'stop' });
    this.resumeWhenClear = this.resumes();
  }

  release(reason: PauseReason) {
    this.pausedBy.delete(reason);
    if (this.pausedBy.size) return;
    this.dispatch({ type: 'unblocked' });
    if (!this.resumeWhenClear) return;
    this.resumeWhenClear = false;
    this.start(false);
  }

  /**
   * Re-reads the open epoch and the balance. Refreshes are serialised and an older epoch never
   * overwrites a newer one, so a slow poll cannot restart mining on stale parameters. A read past
   * the deadline fails the refresh; if it lands after a newer refresh began, it writes nothing.
   */
  refresh(): Promise<void> {
    const run = this.refreshing.then(() => {
      const gen = ++this.reads;
      const read = this.readChain(gen);
      // A read that outlives its deadline floats while the next refresh starts; the drain must still
      // await it, so accumulate rather than overwrite. Settled entries drop out on their own.
      const tracked = read.catch(() => {});
      this.inflightRead = Promise.all([this.inflightRead, tracked]).then(() => {});
      return deadline(read, this.readDeadlineMs);
    });
    this.refreshing = run.catch(() => {});
    return run;
  }

  /** The timer's refresh: a node silent for a minute pauses mining, its first answer resumes it. */
  private async poll() {
    // A rebuild swaps the deployment under the reads; its failures say nothing about the node. A
    // switch drains and rebuilds; a poll across it would read on the wrong node or race the rebuild.
    if (this.switching || this.store.get(minerAtom).phase === 'recovering') return;
    try {
      await this.refresh();
      this.lastRead = Date.now();
      markRead(this.lastRead);
      void this.sampleTip();
      this.resumeAfterRead();
      if (!this.offline) return;
      this.offline = false;
      this.log('node reachable again');
      this.dispatch({ type: 'online' });
      this.release('offline');
    } catch (e) {
      this.log(`refresh: ${claimFailureMessage(e)}`);
      if (this.offline || Date.now() - this.lastRead < OFFLINE_AFTER_MS) return;
      this.offline = true;
      this.log('node unreachable for a minute: mining paused');
      this.pause('offline');
      this.dispatch({ type: 'offline', since: this.lastRead });
    }
  }

  private async readChain(gen: number) {
    const epoch = await readEpoch(this.d, this.account);
    const previous = this.store.get(epochAtom);
    // A read that outlived dispose (a cancelled open, a replaced controller) belongs to no one now.
    if (this.disposed || gen !== this.reads || (previous && epoch.epoch < previous.epoch)) return;
    this.store.set(epochAtom, epoch);
    if (previous && previous.epoch !== epoch.epoch) {
      this.log(`epoch ${epoch.epoch} opened (target ${epoch.target.toString(16)})`);
      this.dispatch({
        type: 'epoch',
        epoch,
        difficultyRatio: difficulty(epoch.target) / difficulty(previous.target),
        at: Date.now(),
      });
    }
    const balance = await readBalance(this.d, this.account);
    if (gen === this.reads && !this.disposed) this.store.set(balanceAtom, balance);
  }

  /** Anyone may close an epoch that stayed open for T_MAX; the miner does it so mining resumes. */
  async roll() {
    await this.track(async () => {
      this.log('rolling the epoch (T_MAX reached)');
      await sendRoll(this.d, this.account, this.fee);
      await this.refresh();
    });
  }

  /**
   * Runs an operation that talks to the node outside the poll and the claim (a roll, a withdrawal).
   * The drain waits for it, and none may start across a switch: it would be sent on one node and
   * confirmed on another.
   */
  track<T>(op: () => Promise<T>): Promise<T> {
    if (this.switching)
      return Promise.reject(new Error('a node switch is underway; try again when it is done'));
    const run = op();
    this.ops = Promise.all([
      this.ops,
      run.then(
        () => {},
        () => {},
      ),
    ]).then(() => {});
    return run;
  }

  private dispatch(event: Event) {
    // One clock for the chart: most events arrive with a wall clock or nothing, and a claim's span needs both ends.
    const stamped = event.t === undefined ? { ...event, t: performance.now() } : event;
    const [state, commands] = reduce(this.store.get(minerAtom), stamped);
    this.store.set(minerAtom, state);
    for (const c of commands) this.execute(c);
  }

  private execute(c: Command) {
    switch (c.type) {
      case 'mine': {
        const secret = newEpochSecret().toString();
        // Only the current secret is kept: mining resumes only once no win waits on its own.
        this.secrets.clear();
        this.secrets.set(c.secretId, secret);
        const key = `${c.epoch}:${c.secretId}`;
        const job: MineJob = {
          epoch: c.epoch,
          seed: `0x${c.seed.toString(16)}`,
          domain: this.domain ?? '0x0',
          secret,
          target: c.target,
          secretId: c.secretId,
          recipient: this.account.toString(),
          startNonce: this.nextNonce.get(key) ?? 1n,
        };
        this.post({ type: 'mine', job });
        this.log(`mining epoch ${c.epoch} with a fresh secret`);
        return;
      }
      case 'halt':
        this.post({ type: 'stop' });
        return;
      case 'submit':
        void this.submit();
        return;
      case 'discard':
        this.log(`discarded a winning ticket: ${c.reason}`);
        this.pending = null;
        return;
      case 'retry-in':
        return this.arm(c.ms);
      case 'check':
        void this.check();
        return;
      case 'resume':
        return this.resume();
    }
  }

  /**
   * Mining goes on after a settled win, on the epoch open now: only after a good read (the atom may still
   * hold the epoch that closed), and never after a Stop since the last start — a Retry claims the win, only
   * Start mines again.
   */
  private resume() {
    if (this.stopped) return;
    const stops = this.stops;
    void this.refresh().then(
      () => {
        if (stops === this.stops) this.start(false);
      },
      () => {
        this.resumeOnRead = stops;
      },
    );
  }

  private resumeAfterRead() {
    const owed = this.resumeOnRead;
    this.resumeOnRead = null;
    if (owed === this.stops) this.start(false);
  }

  /**
   * Behind `ready`. A native config is judged again when it is sent, not when it was queued: a
   * revoke meanwhile must not be undone by a rebuild that was already waiting.
   */
  private post(m: ToWorker) {
    const prover = this.prover;
    void prover.ready.then(
      () =>
        prover.worker.postMessage(
          m.type === 'reconfigure' && m.presto && !this.nativeAllowed() ? { ...m, presto: null } : m,
        ),
      () => {},
    );
  }

  private onWorker(m: FromWorker) {
    switch (m.type) {
      case 'attempt':
        this.dispatch({
          type: 'attempt',
          proveMs: m.proveMs,
          score: m.score,
          win: m.win,
          bar: difficulty(m.target),
          epoch: Number(m.epoch),
          at: Date.now(),
          t: performance.now(),
        });
        return;
      case 'winner':
        this.log(
          `ticket wins after ${m.attempts} proofs (nonce ${m.nonce}, ${m.prover === 'presto' ? 'native' : 'browser'})`,
        );
        this.pending = {
          epoch: m.epoch,
          nonce: m.nonce,
          out: m.out,
          proofFields: m.proofFields,
          digest: m.digest,
          secretId: m.secretId,
          prover: m.prover,
        };
        // The claim it starts takes the ticket at once; a winner the reducer turned away leaves none behind.
        this.dispatch({ type: 'winner', epoch: m.epoch, secretId: m.secretId, at: Date.now() });
        this.pending = null;
        return;
      case 'stopped':
        this.nextNonce.set(`${m.epoch}:${m.secretId}`, m.nextNonce);
        return;
      case 'error':
        if (this.generations === this.prover.generation) this.replaceProver(`worker: ${m.message}`);
        return;
      default:
        this.onProverMessage(m);
    }
  }

  /** What the Worker says of its prover; nothing native passes without consent. */
  private onProverMessage(
    m: Extract<FromWorker, { type: 'ready' | 'prover' | 'presto-phase' | 'native-verified' }>,
  ) {
    switch (m.type) {
      case 'ready':
        // A fresh prover: whatever the previous one settled on is gone with it. A native one built
        // before a revoke reached the Worker is already forced local there: WASM is the truth.
        this.store.set(prestoAtom, (s) => ({
          ...s,
          selected: m.prover === 'presto' && !this.nativeAllowed() ? 'wasm' : m.prover,
          active: null,
          phase: undefined,
          fallbackReason: undefined,
        }));
        return;
      case 'prover':
        if (m.kind === 'presto' && !this.nativeAllowed()) return;
        if (m.sticky) this.log(`proving in the browser from now on: ${m.reason}`);
        if (m.sticky && m.reason === 'invalid-proof') this.consent.forget();
        this.store.set(prestoAtom, (s) => ({
          ...s,
          active: m.kind,
          phase: undefined,
          fallbackReason: m.sticky ? m.reason : s.fallbackReason,
        }));
        return;
      case 'presto-phase':
        if (this.nativeAllowed()) this.store.set(prestoAtom, (s) => ({ ...s, phase: m.phase }));
        return;
      case 'native-verified':
        if (this.nativeAllowed()) this.consent.promote();
        return;
    }
  }

  /** Native may be shown and remembered: the Worker was handed Presto, and consent still stands. */
  private nativeAllowed(): boolean {
    return this.presto !== null && this.consent.allowed();
  }

  /**
   * Consent withdrawn: the Worker is told first (it acts between the awaits of the proof in
   * flight), then rebuilt without the endpoint. Nothing native from it is published from here on.
   * The revoke goes straight to the Worker, never behind `ready`: queued there, a `mine` waiting on
   * a held initialization would reach a native prover first.
   */
  revoke(): void {
    this.prover.worker.postMessage({ type: 'revoke' } satisfies ToWorker);
    this.reconfigure(this.threads, null);
  }

  /** The win the next attempt is for: the Worker's fresh winner becomes the one mining waits on. */
  private async recordFor(): Promise<WinRecord | null> {
    const p = this.pending;
    if (!p) return this.fore;
    this.pending = null;
    const lineId = this.store.get(minerAtom).claim?.lineId ?? null;
    const nullifier = (await ticketNullifier(Fr.fromString(p.digest), this.d.miner.address)).toString();
    this.fore = {
      ticket: p,
      lineId,
      epoch: p.epoch,
      digest: p.digest,
      prover: p.prover,
      nullifier,
      attempts: 0,
      submissions: [],
    };
    return this.fore;
  }

  /** Each send with the expiry its transaction carries: the browser's clock cannot stand in for the chain's. */
  private recordSend(rec: WinRecord, hash: string, expiresAt: number | undefined) {
    if (rec.submissions.some((s) => s.hash === hash)) return;
    rec.submissions.push({ hash, expiresAt: expiresAt ?? null });
  }

  /** One attempt: the fresh win's first, or the waiting win's next. */
  private async submit() {
    const rec = await this.recordFor();
    const ticket = rec?.ticket;
    const secret = ticket && this.secrets.get(ticket.secretId);
    if (!rec || !ticket || !secret) return this.dispatch({ type: 'failed', error: 'no pending ticket' });
    rec.attempts++;
    let out = ticket.out;
    if (this.tamperNext) {
      // The lowest bit of `out`: the ticket, the epoch and the nullifier stay valid, only the proof's
      // public inputs no longer match it — which simulation cannot see and real proving must. The
      // record keeps the ticket as it was, so a Retry sends it restored.
      out = `0x${(BigInt(out) ^ 1n).toString(16).padStart(64, '0')}`;
      this.tamperNext = false;
      this.log('e2e: this claim goes out with a bound public input altered');
    }
    this.log(`claiming in epoch ${ticket.epoch}, attempt ${rec.attempts}: proving the claim in-page…`);
    this.store.set(txProvingAtom, null);
    try {
      const args = { ...ticket, out, secret, recipient: this.account };
      const sent = await sendClaim(this.d, this.account, this.fee, args, {
        said: (prover) => this.store.set(txProvingAtom, prover),
        sent: (tx) => this.recordSend(rec, tx.txHash, tx.expiresAt),
      });
      this.recordSend(rec, sent.txHash, sent.expiresAt);
      const ttl = sent.expiresAt
        ? `expires ${new Date(sent.expiresAt * 1000).toISOString().slice(11, 19)}`
        : 'expiry unknown';
      this.log(`claim ${short(sent.txHash)} sent (${ttl})`);
      this.dispatch({ type: 'sent', txHash: sent.txHash, expiresAt: sent.expiresAt, at: Date.now() });
      const { block, effect } = await sent.wait();
      await this.minted(rec, sent.txHash, block, effect);
    } catch (e) {
      await this.attemptFailed(rec, e);
    } finally {
      this.store.set(txProvingAtom, null);
    }
  }

  /** The claim is in a block: its marks, the balance, the ledger's ✓, the device's record of it. */
  private async minted(rec: WinRecord, txHash: string, block: number, effect: TxEffect) {
    if (this.fore === rec) this.fore = null;
    const before = this.store.get(epochAtom)?.claims ?? 0;
    this.dispatch({ type: 'included', block, at: Date.now() });
    const marks = await claimMarks(effect, rec.digest, this.d.miner.address, rec.prover);
    this.lastClaim = marks;
    await this.refresh();
    this.log(`claim mined in block ${block}: +${REWARD}`);
    this.remember(rec.epoch, block, txHash, marks.nullifier);
    this.dispatch({
      type: 'claimed',
      block,
      reward: REWARD,
      txHash,
      nullifier: marks.nullifier,
      noteHash: marks.noteHash,
      noteHashes: marks.noteHashes.length,
      claims: [before, before + 1],
      at: Date.now(),
    });
    this.announceWin(block);
    this.resumeAfterClaim();
  }

  /** The device's record of a win, once per nullifier. */
  private remember(epoch: bigint, block: number, txHash: string, nullifier: string) {
    this.store.set(claimsAtom, (c) =>
      c.some((x) => x.nullifier === nullifier)
        ? c
        : [...c, { epoch, block, at: Date.now(), txHash, nullifier, settled: 'pending' }],
    );
  }

  /**
   * An attempt that did not mint. A revert or a blocked delivery ends the win (its other sends stay
   * watched); anything else keeps it waiting for a check, whatever this attempt's failure says.
   */
  private async attemptFailed(rec: WinRecord, e: unknown) {
    const kind = classifyClaimFailure(e);
    if (kind === 'reverted' || kind === 'delivery-blocked') {
      // A revert is the send just made; a blocked delivery failed before sending.
      const reverted = kind === 'reverted' ? rec.submissions.at(-1)?.hash : undefined;
      this.end(rec, reverted);
      return this.claimFailed(e, rec.epoch);
    }
    this.fore = rec;
    const message = claimFailureMessage(e);
    this.log(`claim failed (${kind}, attempt ${rec.attempts}): ${message}`);
    this.dispatch({
      type: 'failed',
      error: message,
      kind,
      epoch: rec.epoch,
      attempt: rec.attempts,
      sent: rec.submissions.length > 0,
      watching: this.watches.length > 0,
      at: Date.now(),
    });
  }

  /** A revert or a blocked delivery ends the win: its secret goes, and its sends but `gone` are watched until dead or landed. */
  private end(rec: WinRecord, gone?: string) {
    if (rec.ticket) this.secrets.delete(rec.ticket.secretId);
    this.forget(rec);
    const submissions = rec.submissions.filter((s) => s.hash !== gone);
    if (submissions.length) this.watches.push({ ...rec, ticket: null, submissions });
  }

  /** The ticket can no longer mint: its secret goes, and the win is watched, sent or not, until the checkpointed tip decides it. */
  private letGo(rec: WinRecord): WinRecord {
    if (rec.ticket) this.secrets.delete(rec.ticket.secretId);
    this.forget(rec);
    const w = { ...rec, ticket: null };
    this.watches.push(w);
    return w;
  }

  private forget(rec: WinRecord) {
    if (this.fore === rec) this.fore = null;
    this.watches = this.watches.filter((w) => w !== rec);
  }

  /** The ledger's Retry (and the canary's control): one more attempt of the waiting win, after a check. */
  retryPendingClaim(): Promise<boolean> {
    if (this.retired || !this.fore || this.store.get(minerAtom).phase !== 'idle')
      return Promise.resolve(false);
    this.dispatch({ type: 'retry', at: Date.now() });
    return Promise.resolve(true);
  }

  /** The recovery's one timer: each arming replaces the last. */
  private arm(ms: number) {
    clearTimeout(this.recoveryTimer);
    if (this.disposed) return;
    this.recoveryTimer = setTimeout(
      () => this.dispatch({ type: 'due', blocked: this.blocked() }),
      this.recoveryDelay(ms),
    );
  }

  /** A pause, a switch or a rebuild holds the node: a check waits for its end (`unblocked`, `recovered`). */
  private blocked(): boolean {
    return (
      this.pausedBy.size > 0 ||
      this.switching ||
      this.disposed ||
      this.store.get(minerAtom).phase === 'recovering'
    );
  }

  /** A read that cannot answer in time is `unknown`, like one that fails; the drain still waits for it. */
  private read<T>(p: Promise<T>): Promise<T | 'unknown'> {
    this.inflightRead = Promise.all([this.inflightRead, p.catch(() => {})]).then(() => {});
    return deadline(p, this.readDeadlineMs).catch(() => 'unknown' as const);
  }

  /** One check of every recorded win, one check at a time; the drain of a switch waits for it. */
  private check(): Promise<void> {
    if (this.checking) {
      // The check running may have read before what asks now (a release, a Retry): one more follows it.
      this.recheck = true;
      return this.checking;
    }
    this.checking = this.track(() => this.checkAll())
      .catch(() => {})
      .finally(() => {
        this.checking = undefined;
        if (!this.recheck) return;
        this.recheck = false;
        void this.check();
      });
    return this.checking;
  }

  private async checkAll() {
    if (this.blocked()) return;
    const holds = this.holds;
    const stale = () => holds !== this.holds || this.disposed;
    const watches = [...this.watches];
    // The waiting win's own attempt, while it runs, answers for it.
    const fore = this.store.get(minerAtom).phase === 'claiming' ? null : this.fore;
    const verdict = fore ? await this.inspect(fore, stale) : undefined;
    // A win let go is no longer the controller's: the reducer hears it whatever came meanwhile.
    const released = verdict === 'closed' || verdict === 'not-minted';
    for (const w of watches) {
      if (stale()) break;
      await this.watch(w, stale);
    }
    if (stale() && !released) return;
    this.dispatch({
      type: 'checked',
      ...(verdict !== undefined && verdict !== 'done' && { verdict }),
      watching: this.watches.length > 0,
      blocked: this.blocked(),
      at: Date.now(),
    });
  }

  /** Whether a send of the win landed: by its own receipt, else by the block holding its nullifier. */
  private async landing(rec: WinRecord): Promise<Landing> {
    const fates = await Promise.all(rec.submissions.map((s) => this.read(fate(this.d, s.hash))));
    for (const [i, f] of fates.entries()) {
      const landed = mintedBy(f, rec.submissions[i]?.hash ?? '', rec.nullifier);
      if (landed) return { kind: 'minted', landed };
    }
    const where = await this.read(carrier(this.d, rec.nullifier));
    if (typeof where === 'object') return { kind: 'minted', landed: where };
    const reverted = rec.submissions.find((_, i) => fates[i] === 'reverted');
    if (reverted) return { kind: 'reverted', hash: reverted.hash };
    const pending = rec.submissions.filter((_, i) => fates[i] === 'pending');
    // The chain's time: a browser clock running ahead would call a pending send dead and send again beside it.
    const now = pending.length ? await this.read(tipAt(this.d, 'latest')) : 'unknown';
    return {
      kind: 'open',
      live: pending.some((s) => now === 'unknown' || s.expiresAt === null || s.expiresAt > now),
      unknown: where === 'unknown' || fates.includes('unknown'),
    };
  }

  /**
   * The waiting win against the chain, in an order that never sends a landed claim again: landed,
   * reverted, the ticket's own lifetime (read now), a send still live, and only then a new attempt.
   */
  private async inspect(rec: WinRecord, stale: () => boolean): Promise<Verdict | 'done'> {
    const l = await this.landing(rec);
    if (stale()) return 'unknown';
    if (l.kind === 'minted') return this.adopt(rec, l.landed, true).then(() => 'done' as const);
    if (l.kind === 'reverted') return this.revertOf(rec, l.hash, true, stale).then(() => 'done' as const);
    const mint = await this.read(canMint(this.d, rec.epoch, 'latest'));
    if (stale() || mint === 'unknown') return 'unknown';
    if (mint) return l.live ? 'live' : l.unknown ? 'unknown' : 'open';
    return (await this.notMinted(this.letGo(rec), l, stale)) ? 'not-minted' : 'closed';
  }

  /**
   * Not minted, decided at the checkpointed tip: the ticket cannot mint there and its nullifier is absent
   * there. Never across a switch or dispose: the caller's line must go out with the decision.
   */
  private async notMinted(rec: WinRecord, l: Landing, stale: () => boolean): Promise<boolean> {
    if (l.kind !== 'open' || l.unknown) return false;
    const [mint, absent] = await Promise.all([
      this.read(canMint(this.d, rec.epoch, 'checkpointed')),
      this.read(absentAt(this.d, rec.nullifier, 'checkpointed')),
    ]);
    if (stale() || mint !== false || absent !== true) return false;
    rec.notMinted = true;
    if (!rec.submissions.length) this.forget(rec);
    return true;
  }

  /** A watched win: adopted if a send landed, its revert recovered, let go once every send is dead. */
  private async watch(w: WinRecord, stale: () => boolean) {
    const l = await this.landing(w);
    if (stale()) return;
    if (l.kind === 'minted') return this.adopt(w, l.landed, false);
    if (l.kind === 'reverted') return this.revertOf(w, l.hash, false, stale);
    if (!w.notMinted && (await this.notMinted(w, l, stale)))
      this.dispatch({
        type: 'not-minted',
        lineId: w.lineId,
        sent: w.submissions.length > 0,
        watching: this.watches.length > 0,
        at: Date.now(),
      });
    if (!w.notMinted || l.unknown) return;
    const tip = await this.read(tipAt(this.d, 'checkpointed'));
    if (tip !== 'unknown' && w.submissions.every((s) => s.expiresAt !== null && s.expiresAt < tip))
      this.forget(w);
  }

  /**
   * A recorded win found in a block, settled once: consumed before settling, put back with its sends
   * if settling fails, so a later check tries again.
   */
  private async adopt(rec: WinRecord, at: Landed, fore: boolean) {
    this.forget(rec);
    try {
      const before = this.store.get(epochAtom)?.claims ?? 0;
      const marks = await claimMarks(at.effect, rec.digest, this.d.miner.address, rec.prover);
      this.lastClaim = marks;
      this.log(`claim ${short(at.txHash)} was in block ${at.block} after all`);
      await this.refresh();
      if (rec.ticket) this.secrets.delete(rec.ticket.secretId);
      this.remember(rec.epoch, at.block, at.txHash, marks.nullifier);
      this.dispatch({
        type: 'adopted',
        lineId: rec.lineId,
        fore,
        watching: this.watches.length > 0,
        reward: REWARD,
        block: at.block,
        txHash: at.txHash,
        nullifier: marks.nullifier,
        noteHash: marks.noteHash,
        noteHashes: marks.noteHashes.length,
        claims: [before, before + 1],
        at: Date.now(),
      });
      this.announceWin(at.block);
    } catch (e) {
      this.log(
        `claim ${short(at.txHash)} is in block ${at.block}; settling it failed (${claimFailureMessage(e)})`,
      );
      if (fore) this.fore = rec;
      else this.watches.push(rec);
    }
  }

  /**
   * A recorded send reverted in a block: once no claim is in flight the win ends there and the revert's
   * recovery runs. Mining comes back after it only where it would have gone on: it was running, or it
   * waited on this win and no Stop came since. A pause, a switch or dispose meanwhile leaves the win for
   * the next check.
   */
  private async revertOf(rec: WinRecord, hash: string, fore: boolean, stale: () => boolean) {
    // Read before the wait: from its end to the failure nothing may yield, or a win found meanwhile would
    // claim beside the rebuild.
    const closed = await this.epochClosedSince(rec.epoch);
    await this.claimSettled();
    if (stale() || this.blocked()) return;
    this.end(rec, hash);
    const m = this.store.get(minerAtom);
    const waited = fore && m.recovery.fore !== null && !m.recovery.fore.held;
    this.idleRebuild = !(m.phase === 'mining' || waited);
    await this.claimFailed(new Error(`claim ${short(hash)} reverted in a block`), rec.epoch, {
      lineId: rec.lineId,
      closed,
    });
  }

  /** Never an amount: the notification and the tab are the only things another app can read. */
  private announceWin(block: number) {
    const settings = this.store.get(settingsAtom);
    if (settings.sound) chime();
    if (settings.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted')
      new Notification('Yacana · claim minted', {
        body: `A claim from this account landed in block ${block.toLocaleString('en-US')}.`,
        tag: 'yacana-claim',
      });
  }

  /** A claim's end or a rebuild's: mining goes on unless a Stop came since the last start or the rebuild interrupted none. */
  private resumeAfterClaim() {
    const resumes = this.resumes();
    this.idleRebuild = false;
    if (resumes) this.start(false);
  }

  private resumes(): boolean {
    return !this.stopped && !this.idleRebuild;
  }

  /**
   * A revert or a blocked delivery: the line says so, then the chain view is rebuilt (or claims wait for
   * L1 finality). A revert whose message names no cause (a mined revert's receipt carries none on 5.2.0)
   * is taken as stale when the chain's open epoch has moved past `epoch`: a reading, not proof, so a
   * message that does name a reason is never overridden by it. `recorded` is a recorded win's revert: its
   * line, and its epoch as the caller read it.
   */
  private async claimFailed(
    e: unknown,
    epoch: bigint,
    recorded?: { lineId: number | null; closed: boolean },
  ) {
    const kind = classifyClaimFailure(e);
    const message = claimFailureMessage(e);
    this.log(`claim failed (${kind}): ${message}`);
    const cause = kind === 'reverted' ? revertCause(message) : null;
    const stale =
      cause === null
        ? undefined
        : cause.stale || (!cause.reason && (recorded ? recorded.closed : await this.epochClosedSince(epoch)));
    if (stale && !cause?.stale)
      this.log(`the claim is taken as stale: epoch ${epoch} is closed now and the revert named no reason`);
    this.dispatch({
      type: 'failed',
      error: message,
      kind,
      stale,
      watching: this.watches.length > 0,
      ...(recorded && { lineId: recorded.lineId }),
      at: Date.now(),
    });
    // A delivery still blocked after a rebuild is the PXE waiting for L1: only time helps.
    const rebuilt = this.rebuiltAt !== null && Date.now() - this.rebuiltAt < (await this.finalityMs());
    if (kind === 'delivery-blocked' && rebuilt) return this.pauseUntilFinal();
    await this.rebuildChainView();
  }

  /** Whether the open epoch has moved past `epoch`; false when the node cannot say. */
  private async epochClosedSince(epoch: bigint): Promise<boolean> {
    try {
      return (await readEpoch(this.d, this.account)).epoch > epoch;
    } catch {
      return false;
    }
  }

  /**
   * Waits for whatever is talking to the node to finish: the refresh in flight and a claim being
   * sent. What the node switch needs before the client moves, so no operation straddles two.
   */
  async drain(): Promise<void> {
    this.switching = true;
    this.holds++;
    await this.refreshing.catch(() => {});
    await this.inflightRead.catch(() => {});
    await this.claimSettled();
    await this.reading?.catch(() => {});
    await this.ops;
    await this.inflightRead.catch(() => {}); // a read the rebuild or an operation started meanwhile
    // A lost-race rebuild that failed while we waited left no prover: the switch must not go on and
    // report success over a dead account (the caller turns this into the boot error).
    if (this.store.get(minerAtom).proverDead)
      throw new Error(
        'the prover was abandoned while the switch waited; only a reload recovers this account',
      );
  }

  /**
   * Resolves once no claim is being sent. `pause` deliberately lets a claim in flight finish, so
   * anything that needs the wallet's next send to be its own — the bridge's operations, the node
   * switch — waits here after pausing. A claim can fail into a lost-race rebuild, which is part of
   * it; both phases settle to idle (recovered / paused / prover-dead).
   */
  async claimSettled(): Promise<void> {
    const busy = () => {
      const phase = this.store.get(minerAtom).phase;
      return phase === 'claiming' || phase === 'recovering';
    };
    while (busy()) await new Promise((r) => setTimeout(r, 100));
  }

  /** The switch is over (rebuilt or failed): the poll may read again. */
  endSwitch(): void {
    this.switching = false;
    this.dispatch({ type: 'unblocked' });
  }

  /** A switch that could rebuild from neither node: no working wallet, only a reload helps. */
  giveUp(reason: string): void {
    this.abandonProver(reason);
  }

  /**
   * The node changed under the handle: the chain view built from the old one is dropped and rebuilt
   * from the new one through the lost-race path, then read before mining resumes.
   */
  async rebuildForNewNode(): Promise<void> {
    // The old node's numbers are not this node's: cleared, so the first read is published whatever
    // epoch it reports (the regression guard compares against the same node only).
    this.store.set(epochAtom, null);
    this.store.set(balanceAtom, null);
    await this.rebuildChainView('the node changed: rebuilding this account’s chain view from it…', true);
  }

  /**
   * Drops and rebuilds the chain view. If the drop fails but the view could be reopened, the
   * account is still blocked and waits for finality on the reopened view; if nothing could be
   * reopened, the page has no working wallet and only a reload helps.
   */
  private async rebuildChainView(
    why = 'lost a race: rebuilding this account’s chain view from the chain…',
    strict = false,
  ) {
    this.log(why);
    this.views++;
    let rebound: Rebound;
    try {
      if (!this.recover) throw new Error('no recovery available');
      rebound = await this.recover(strict);
    } catch (e) {
      this.log(`rebuild failed: ${claimFailureMessage(e)}`);
      // A node switch rethrows and decides for itself: the former node is tried before the prover
      // is given up. Anything else abandons the prover here (only a reload recovers).
      if (strict) throw e;
      this.abandonProver(`the chain view could not be rebuilt: ${claimFailureMessage(e)}`);
      return;
    }
    this.d = rebound.deployment;
    this.fee = rebound.fee;
    if (!rebound.rebuilt) {
      this.log('the chain view could not be dropped; reopened as it was');
      return this.pauseUntilFinal();
    }
    this.rebuiltAt = Date.now();
    this.unread = true;
    await this.readRebuilt(strict);
  }

  /**
   * The first read of a rebuilt view syncs the fresh PXE: the notes come back before mining
   * resumes. Until it succeeds nothing is known to be recovered, and Start retries it; one read
   * at a time, so a second Start cannot restart mining behind a Stop.
   */
  private readRebuilt(strict = false): Promise<void> {
    this.reading ??= this.readRebuiltOnce(strict).finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  }

  private async readRebuiltOnce(strict = false) {
    try {
      await this.refresh();
    } catch (e) {
      this.log(`the rebuilt chain view could not be read: ${claimFailureMessage(e)}`);
      // A node switch's first read is part of the switch: its failure surfaces to the switch, which
      // tries the former node before the prover is given up.
      if (strict) throw e;
      return this.dispatch({
        type: 'failed',
        error: `the chain view was rebuilt but the node did not answer (${claimFailureMessage(e)}); press Start to read it again`,
        at: Date.now(),
      });
    }
    this.unread = false;
    this.lastRead = Date.now();
    this.dispatch({ type: 'recovered', at: Date.now() });
    this.log('chain view rebuilt');
    // A lost race resumes the miner it interrupted unless a Stop came since; under a pause (a node switch)
    // the release decides, so a switch made while idle does not start mining on its own.
    if (this.pausedBy.size) this.idleRebuild = false;
    else this.resumeAfterClaim();
  }

  private async finalityMs(): Promise<number> {
    const seconds = await this.d.node
      .getL1Constants()
      .then(finalitySeconds)
      .catch(() => FALLBACK_FINALITY_S);
    return seconds * 1000;
  }

  /** The honest fallback: claims wait for L1 finality of the reverted one, then mining resumes. */
  private async pauseUntilFinal() {
    const until = Date.now() + (await this.finalityMs());
    this.log(`claims paused until ${new Date(until).toISOString().slice(11, 19)}`);
    this.pausedBy.add('lost-race');
    this.resumeWhenClear = this.resumes();
    this.idleRebuild = false;
    this.dispatch({ type: 'paused', until, at: Date.now() });
    this.pauseTimer = setTimeout(() => this.release('lost-race'), until - Date.now());
  }
}
