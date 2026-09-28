// One Stats instance over the host's store: the boot, the 30 s poll, the history fill, the bridge poller
// and the clock. It never points the fetch guard anywhere: the host sets the endpoints and hands it the
// clients. While stopped it arms nothing and starts nothing (a batch of reads already out runs to its end);
// after dispose() nothing it started publishes or persists.
import type { Node } from '@yacana/miner-core/reader';
import { type Connection, expectedDeployment, firstEpoch } from '@yacana/web-kit/browser/connection';
import { endpointFingerprint, quietNodeReads } from '@yacana/web-kit/browser/node-guard';
import { nodeHealth, waitTurn } from '@yacana/web-kit/browser/node-health';
import type { createStore, PrimitiveAtom } from 'jotai';
import type { PublicClient } from 'viem';
import { type BeatReads, type BeatSinks, bootBeats, pollBeats, windowBeat } from './beats';
import { bridgeRecord, bridgeSource } from './bridge';
import type { BridgeSnapshot } from './bridge-beat';
import { openReader, POLL_MS, type Reader } from './chain';
import { cacheKey, readCache, type StorageLike, writeCache } from './history-cache';
import { createFill, IDLE } from './history-fill';
import { readFixed } from './read-fixed';
import { readLotteryOf, readWindowRows } from './read-window';
import { createSerial } from './serial';
import {
  bridgeAtom,
  fillAtom,
  fixedAtom,
  type History,
  historyAtom,
  nowAtom,
  sinceOpenedAtom,
  slowAtom,
  statusAtom,
} from './state';
import { type EpochWindow, windowHeld } from './window';

export { POLL_MS } from './chain';
export type Store = ReturnType<typeof createStore>;

export interface StatsRuntimeOptions {
  store: Store;
  /** The endpoints this instance reads; a switch makes a new instance. */
  connection: Connection;
  node: Node;
  /** The L1 client for the bridge page, on a build with a bridge record. */
  eth?: PublicClient;
  /** The background history fill: the public page only. */
  fill: boolean;
  /** A chain read landed. */
  onFresh?: () => void;
  /** While true no read starts; one asked for meanwhile waits for it to clear. */
  yieldTo?: () => boolean;
}

export interface StatsRuntime {
  /** Idempotent: boots once, then the poll, the bridge poller and the clock. */
  start(): void;
  /** Idempotent: every timer cleared; no boot step or timer until start(). */
  stop(): void;
  /** Nothing this instance started publishes again. */
  dispose(): void;
  showWindow(w: EpochWindow): Promise<void>;
  poll(): Promise<void>;
}

/** What an instance reads through; the spec hands it fakes. */
export interface StatsSources {
  open: (connection: Connection, node: Node) => Promise<Reader>;
  reads: (r: Reader) => BeatReads;
  bridge: (eth: PublicClient) => (() => Promise<BridgeSnapshot>) | null;
}

const SOURCES: StatsSources = {
  open: openReader,
  reads: (r) => ({
    fixed: () => readFixed(r),
    rows: (from, to, open) => readWindowRows(r, from, to, open),
    lottery: () => readLotteryOf(r),
  }),
  bridge: (eth) => {
    const record = bridgeRecord();
    return record ? bridgeSource(record, eth) : null;
  },
};

const YIELD_RECHECK_MS = 1000;
/** Nothing under 300 ms: a beat that lands first never shows a skeleton; the ones still out at 300 ms do. */
const SLOW_MS = 300;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The browser's storage, or nothing where it throws (a locked-down context): the cache is optional. */
const storage = (): StorageLike | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

class Instance implements StatsRuntime {
  private readonly queue = createSerial();
  private readonly bridgeRead: (() => Promise<BridgeSnapshot>) | null;
  private readonly fillRun: ReturnType<typeof createFill> | null;
  readonly poll: () => Promise<void>;
  private reader: Reader | undefined;
  /** The cache key: the deployment and the node, so a switch starts a fresh history. */
  private key: string | undefined;
  private cacheMerged = false;
  private active = false;
  private disposed = false;
  private booting = false;
  /** A start() while a boot runs: that boot may be unwinding from the stop before it. */
  private bootAgain = false;
  private booted = false;
  /** Aborted by stop(): a boot waiting out a cooldown gives the wait up. */
  private running = new AbortController();
  private bridgeBusy = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private slowTimer: ReturnType<typeof setTimeout> | undefined;
  private yieldTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly waiting = new Set<(go: boolean) => void>();
  /** Window fetches queued or running: the fill yields to them. */
  private foreground = 0;
  /** Per window: not before this time (in flight, or failed — its error publish re-fires the ask at once). */
  private readonly askedUntil = new Map<string, number>();

  constructor(
    private readonly o: StatsRuntimeOptions,
    private readonly sources: StatsSources,
  ) {
    this.bridgeRead = o.eth ? sources.bridge(o.eth) : null;
    this.poll = this.queue.coalesced(() => this.pollOnce());
    this.fillRun = o.fill ? this.createFillRun() : null;
    // The store may hold another instance's reads (a switch): this one starts from nothing.
    const s = o.store;
    s.set(statusAtom, { phase: 'loading', step: 'connecting' });
    s.set(fixedAtom, null);
    s.set(historyAtom, null);
    s.set(fillAtom, IDLE);
    s.set(sinceOpenedAtom, null);
    s.set(slowAtom, false);
    s.set(bridgeAtom, this.bridgeRead ? { phase: 'loading' } : { phase: 'none' });
  }

  start(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    this.running = new AbortController();
    this.every(1000, () => this.put(nowAtom, Date.now()));
    if (!this.o.store.get(slowAtom)) this.slowTimer = setTimeout(() => this.put(slowAtom, true), SLOW_MS);
    if (this.booted) this.cadence(true);
    else this.boot();
    if (this.bridgeRead) {
      void this.readBridge();
      this.every(POLL_MS, () => void this.readBridge());
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.running.abort();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    clearTimeout(this.slowTimer);
    clearTimeout(this.yieldTimer);
    this.yieldTimer = undefined;
    for (const w of this.takeWaiting()) w(false);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  /** A window the visitor asked for that is not held: read at once, ahead of the fill. */
  showWindow(w: EpochWindow): Promise<void> {
    const key = `${w.from}-${w.to}`;
    if ((this.askedUntil.get(key) ?? 0) > Date.now()) return Promise.resolve();
    this.askedUntil.set(key, Number.POSITIVE_INFINITY);
    this.foreground++;
    return this.queue.serial(async () => {
      let failed = false;
      try {
        if (!(await this.free())) return;
        const fixed = this.o.store.get(fixedAtom);
        const history = this.o.store.get(historyAtom);
        if (this.reader && fixed && history && !windowHeld(history.rows, w, fixed.open))
          await windowBeat(this.sources.reads(this.reader), this.publish, { fixed, history }, w);
        failed = !!this.o.store.get(historyAtom)?.error;
      } finally {
        this.foreground--;
        // A failure waits for the poll cadence; the poll's publish re-fires the ask.
        this.askedUntil.set(key, failed ? Date.now() + POLL_MS : 0);
      }
    });
  }

  private live(): boolean {
    return this.active && !this.disposed;
  }

  private put<V>(a: PrimitiveAtom<V>, v: V): void {
    if (!this.disposed) this.o.store.set(a, v);
  }

  private every(ms: number, fn: () => void): void {
    if (this.live()) this.timers.push(setInterval(fn, ms));
  }

  private takeWaiting(): ((go: boolean) => void)[] {
    const all = [...this.waiting];
    this.waiting.clear();
    return all;
  }

  /** True once `yieldTo` lets a read start; false when this instance is stopped or disposed first. */
  private free(): Promise<boolean> {
    if (!this.live()) return Promise.resolve(false);
    if (!this.o.yieldTo?.()) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.waiting.add(resolve);
      this.yieldTimer ??= setTimeout(() => this.recheck(), YIELD_RECHECK_MS);
    });
  }

  private recheck(): void {
    this.yieldTimer = undefined;
    if (this.o.yieldTo?.()) this.yieldTimer = setTimeout(() => this.recheck(), YIELD_RECHECK_MS);
    else for (const w of this.takeWaiting()) w(true);
  }

  /** Each chain read that lands marks the node fresh for the host. */
  private readonly publish: BeatSinks = {
    fixed: (f) => {
      if (this.disposed) return;
      this.o.onFresh?.();
      this.o.store.set(fixedAtom, f);
      if (!this.o.store.get(sinceOpenedAtom))
        this.o.store.set(sinceOpenedAtom, { supply: f.supply, at: Date.now() });
    },
    history: (h) => {
      if (this.disposed) return;
      if (!h.error) this.o.onFresh?.();
      this.o.store.set(historyAtom, this.withCache(h));
    },
  };

  /** Never after dispose: the shared store may hold a successor's rows, which must not land under this key. */
  private persist(h: History, open: number): void {
    if (this.disposed) return;
    const s = storage();
    if (this.key && s && !h.error) writeCache(s, this.key, h.rows, open);
  }

  /** Beat two's first publish joins the cached rows under the read ones: the map draws whole at once. */
  private withCache(h: History): History {
    const fixed = this.o.store.get(fixedAtom);
    const s = storage();
    if (this.cacheMerged || h.error || !this.key || !s || !fixed) return h;
    this.cacheMerged = true;
    const cached = readCache(s, this.key, {
      launchAt: fixed.genesis.launchAt,
      now: Math.floor(Date.now() / 1000),
      open: fixed.open,
    });
    if (!cached) return h;
    const rows = new Map(cached);
    for (const [e, r] of h.rows) rows.set(e, r);
    return { ...h, rows };
  }

  private createFillRun(): ReturnType<typeof createFill> {
    return createFill({
      // Quiet: a page the fill asks for never opens a cooldown (the fill stops itself on the first failure).
      rows: (from, to, open) => {
        const r = this.reader;
        return r
          ? quietNodeReads(() => this.sources.reads(r).rows(from, to, open))
          : Promise.reject(new Error('no reader'));
      },
      held: () => {
        const fixed = this.o.store.get(fixedAtom);
        const history = this.o.store.get(historyAtom);
        return fixed && history ? { open: fixed.open, history } : null;
      },
      publish: this.publish.history,
      transport: () => nodeHealth().transport.kind,
      foreground: () => this.foreground > 0,
      // A page queued behind the poll runs after it: a stop, a dispose or a yield may have come meanwhile.
      serial: (page) =>
        this.queue.serial(() => (this.live() && !this.o.yieldTo?.() ? page() : Promise.resolve())),
      persist: (h, open) => this.persist(h, open),
      onState: (s) => this.put(fillAtom, s),
      first: firstEpoch(),
    });
  }

  /** The poll's cadence with the fill behind it; a page shown again reads at once. */
  private cadence(now: boolean): void {
    this.every(POLL_MS, () => {
      void this.poll();
      void this.fillTick();
    });
    if (now) void this.poll();
    void this.fillTick();
  }

  private fillTick(): Promise<void> | undefined {
    if (!this.fillRun || !this.live() || this.o.yieldTo?.()) return;
    return this.fillRun.tick();
  }

  /** A failure marks the node unreachable and keeps the last view; an answer clears it. */
  private async pollOnce(): Promise<void> {
    const fixed = this.o.store.get(fixedAtom);
    if (!this.reader || !fixed || !(await this.free())) return;
    try {
      const held = { fixed, history: this.o.store.get(historyAtom) };
      await pollBeats(this.sources.reads(this.reader), this.publish, held, firstEpoch());
      if (this.o.store.get(statusAtom).phase === 'unreachable') this.put(statusAtom, { phase: 'ready' });
    } catch (e) {
      if (this.o.store.get(statusAtom).phase !== 'unreachable')
        this.put(statusAtom, { phase: 'unreachable', since: Date.now(), error: message(e) });
    }
  }

  private async cacheKeyFor(): Promise<string | undefined> {
    try {
      const expected = expectedDeployment();
      return cacheKey({
        chainId: expected.chainId.toString(),
        rollupAddress: expected.rollupAddress,
        miner: this.o.connection.miner,
        endpoint: await endpointFingerprint(this.o.connection.nodeUrl),
      });
    } catch {
      return undefined;
    }
  }

  private boot(): void {
    if (this.booting) {
      this.bootAgain = true;
      return;
    }
    this.booting = true;
    this.bootAgain = false;
    void this.bootSteps().finally(() => {
      this.booting = false;
      if (this.bootAgain && this.live() && !this.booted) this.boot();
    });
  }

  /**
   * Each step goes on only while the instance is started and current; a start() after a stop picks the
   * boot up again. A boot that fails because the node is throttled or silent waits for its turn and retries.
   */
  private async bootSteps(): Promise<void> {
    this.key ??= await this.cacheKeyFor();
    if (!(await this.free())) return;
    try {
      if (!this.reader) {
        this.put(statusAtom, { phase: 'loading', step: 'checking the deployment' });
        this.reader = await this.sources.open(this.o.connection, this.o.node);
        if (!(await this.free())) return;
      }
      this.put(statusAtom, { phase: 'loading', step: 'reading the chain' });
      const fixed = await bootBeats(this.sources.reads(this.reader), this.publish, firstEpoch());
      this.booted = true;
      this.put(statusAtom, { phase: 'ready' });
      const history = this.o.store.get(historyAtom);
      if (history) this.persist(history, fixed.open);
      this.cadence(false);
    } catch (e) {
      this.put(statusAtom, { phase: 'error', message: message(e) });
      if (nodeHealth().transport.kind === 'ok') return;
      await waitTurn(this.running.signal);
      if (this.live()) return this.bootSteps();
    }
  }

  private async readBridge(): Promise<void> {
    if (!this.bridgeRead || this.bridgeBusy) return;
    this.bridgeBusy = true;
    if (!(await this.free())) {
      this.bridgeBusy = false;
      // The stop that cancelled this wait may have been followed at once by a start that found it busy.
      if (this.live()) void this.readBridge();
      return;
    }
    try {
      const snapshot = await this.bridgeRead();
      this.put(bridgeAtom, { phase: 'ready', snapshot, unreachable: false });
    } catch (e) {
      const held = this.o.store.get(bridgeAtom);
      this.put(
        bridgeAtom,
        held.phase === 'ready' ? { ...held, unreachable: true } : { phase: 'error', message: message(e) },
      );
    } finally {
      this.bridgeBusy = false;
    }
  }
}

export const createStatsRuntime = (o: StatsRuntimeOptions, sources: StatsSources = SOURCES): StatsRuntime =>
  new Instance(o, sources);
