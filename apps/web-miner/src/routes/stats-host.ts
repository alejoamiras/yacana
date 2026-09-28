// The miner's one Stats runtime, per endpoint pair, for the page's life. A node switch disposes it the
// moment it begins, shown or not, so nothing it started lands after the guard moves; the switch's end,
// whatever it kept, brings a fresh one: started at once if Stats shows, at its next showing if not.
import { DEFAULT_LIMITS, type ReadLimits } from '@yacana/miner-core/reader';
import { createStatsRuntime, type StatsRuntime, type StatsSources } from '@yacana/stats-view/runtime';
import type { Connection } from '@yacana/web-kit/browser/connection';
import { quietEthRpcClient } from '@yacana/web-kit/browser/eth-rpc';
import { quietNodeClient } from '@yacana/web-kit/browser/node';
import { currentNodeEndpoint, normaliseEndpoint } from '@yacana/web-kit/browser/node-guard';
import { nodeHealth, type Transport } from '@yacana/web-kit/browser/node-health';
import type { createStore } from 'jotai';
import { claimReadsAtom, type Endpoints, endpointsAtom, minerAtom } from '../state';

type Store = ReturnType<typeof createStore>;

const DEADLINE_MS = 10_000;
/** The client's deadline runs from when a request leaves; a reader's timer would also count its wait for a turn. */
const HOSTED_LIMITS: ReadLimits = { ...DEFAULT_LIMITS, timeoutMs: Number.POSITIVE_INFINITY };

export interface StatsHost {
  /** Stats is showing until the returned call; the runtime runs while any showing holds. */
  show(): () => void;
  runtime(): StatsRuntime | undefined;
}

/**
 * Whether hosted reads hold: a claim is out, the node is anything but ok, or the guard is not on their
 * node yet. Not merely a cooldown: past its deadline the next request through is its recovery, and that
 * must be one of the page's own, or the page's requests meanwhile get the synthetic answer.
 */
export const hostedBusy = (
  claiming: boolean,
  transport: Transport,
  guardNode: string | null,
  node: string,
): boolean => claiming || transport.kind !== 'ok' || guardNode !== normaliseEndpoint(node);

/**
 * The claim path reads the node: a claim out, the rebuild after a lost race, a check, or any read one of
 * them started that is still out.
 */
export const claimBusy = (store: Store): boolean => {
  const { phase } = store.get(minerAtom);
  return phase === 'claiming' || phase === 'recovering' || store.get(claimReadsAtom);
};

export interface Turns {
  /** Resolves when a request may leave; rejects once closed. */
  turn(): Promise<void>;
  show(): void;
  hide(): void;
  close(): void;
}

/**
 * When a request may leave: while shown and `busy()` is false. One asked for otherwise waits, checked every
 * `everyMs` while shown and parked without a timer while hidden; a close refuses it and every later one.
 */
export function createTurns(busy: () => boolean, everyMs = 1000): Turns {
  const waiting = new Set<{ go: () => void; no: (e: Error) => void }>();
  let shown = false;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const halt = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const check = () => {
    if (busy()) return;
    halt();
    for (const w of waiting) w.go();
    waiting.clear();
  };
  const arm = () => {
    if (shown && waiting.size > 0) timer ??= setInterval(check, everyMs);
  };
  return {
    turn: () => {
      if (closed) return Promise.reject(new Error('disposed'));
      if (shown && !busy()) return Promise.resolve();
      return new Promise((go, no) => {
        waiting.add({ go, no });
        arm();
      });
    },
    show: () => {
      shown = true;
      check();
      arm();
    },
    hide: () => {
      shown = false;
      halt();
    },
    close: () => {
      closed = true;
      halt();
      for (const w of waiting) w.no(new Error('disposed'));
      waiting.clear();
    },
  };
}

export interface HostedPage {
  store: Store;
  connection: Connection;
  /** The build has a bridge record: the bridge page reads Ethereum. */
  bridge: boolean;
}

/**
 * The runtime Stats runs on `e`: every read quiet, abandoned 10 s after it leaves. Each node request waits
 * its turn, none leaving while Stats is hidden or `hostedBusy` holds; an Ethereum batch waits for
 * `hostedBusy` only to start (a claim and the node's cooldown never touch the RPC). Its start, stop and
 * dispose show, hide and close the turns.
 */
export function hostedRuntime(e: Endpoints, page: HostedPage, sources?: StatsSources): StatsRuntime {
  const busy = () =>
    hostedBusy(claimBusy(page.store), nodeHealth().transport, currentNodeEndpoint(), e.nodeUrl);
  const turns = createTurns(busy);
  const runtime = createStatsRuntime(
    {
      store: page.store,
      connection: { ...page.connection, nodeUrl: e.nodeUrl, ethRpcUrl: e.ethRpcUrl },
      node: quietNodeClient(e.nodeUrl, DEADLINE_MS, turns.turn),
      eth: page.bridge ? quietEthRpcClient(e.ethRpcUrl, DEADLINE_MS) : undefined,
      fill: false,
      yieldTo: busy,
      limits: HOSTED_LIMITS,
    },
    sources,
  );
  return {
    start: () => {
      turns.show();
      runtime.start();
    },
    stop: () => {
      runtime.stop();
      turns.hide();
    },
    dispose: () => {
      turns.close();
      runtime.dispose();
    },
    showWindow: (w) => runtime.showWindow(w),
    poll: () => runtime.poll(),
  };
}

export function createStatsHost(store: Store, make: (e: Endpoints) => StatsRuntime): StatsHost {
  let current: { key: string; runtime: StatsRuntime } | undefined;
  let showing = 0;
  const follow = () => {
    const e = store.get(endpointsAtom);
    const key = e && !e.switching ? `${e.nodeUrl} ${e.ethRpcUrl}` : undefined;
    if (key === current?.key && key !== undefined) return;
    current?.runtime.dispose();
    current = e && key !== undefined ? { key, runtime: make(e) } : undefined;
    if (showing > 0) current?.runtime.start();
  };
  store.sub(endpointsAtom, follow);
  follow();
  return {
    show() {
      showing++;
      current?.runtime.start();
      return () => {
        if (--showing === 0) current?.runtime.stop();
      };
    },
    runtime: () => current?.runtime,
  };
}
