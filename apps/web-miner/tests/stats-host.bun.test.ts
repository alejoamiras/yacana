// The hosted Stats runtime's life over fake runtimes: a node switch disposes it the moment it begins,
// shown or hidden; its end brings a fresh one, started at once if Stats shows, at the next showing if not.
// Then when a hosted request may leave, and the path composed: the host, the stats runtime, the quiet
// client through the guard and the reader, against a JSON-RPC stand-in for the node.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { CHUNK, type ReadLimits, readEpochs, readSlot, type SlotTable } from '@yacana/miner-core/reader';
import type { StatsRuntime, StatsSources } from '@yacana/stats-view/runtime';
import { type Fixed, historyAtom, statusAtom } from '@yacana/stats-view/state';
import type { Connection } from '@yacana/web-kit/browser/connection';
import { currentNodeEndpoint, setNodeEndpoint, setOriginalFetch } from '@yacana/web-kit/browser/node-guard';
import { resetNodeHealth } from '@yacana/web-kit/browser/node-health';
import { createStore } from 'jotai';
import { claimBusy, createStatsHost, createTurns, hostedBusy, hostedRuntime } from '../src/routes/stats-host';
import { claimReadsAtom, type Endpoints, endpointsAtom, minerAtom } from '../src/state';

const A: Endpoints = { nodeUrl: 'http://a/', ethRpcUrl: 'http://rpc/', switching: false };
const B: Endpoints = { ...A, nodeUrl: 'http://b/' };

/** Each runtime made, with the endpoints it was made for and the calls it got. */
function hosted(first: Endpoints) {
  const store = createStore();
  store.set(endpointsAtom, first);
  const made: { e: Endpoints; calls: string[] }[] = [];
  const host = createStatsHost(store, (e) => {
    const calls: string[] = [];
    made.push({ e, calls });
    return {
      start: () => void calls.push('start'),
      stop: () => void calls.push('stop'),
      dispose: () => void calls.push('dispose'),
      showWindow: async () => {},
      poll: async () => {},
    } satisfies StatsRuntime;
  });
  const switchTo = (e: Endpoints) => {
    store.set(endpointsAtom, { ...e, switching: true });
    store.set(endpointsAtom, e);
  };
  return { store, made, host, switchTo };
}

describe('the hosted stats runtime', () => {
  test('a switch disposes it the moment it begins, shown or hidden', () => {
    for (const shown of [true, false]) {
      const { store, made, host } = hosted(A);
      if (shown) host.show();
      store.set(endpointsAtom, { ...A, switching: true });
      expect(
        made.map((m) => m.calls.at(-1)),
        String(shown),
      ).toEqual(['dispose']);
      expect(host.runtime()).toBeUndefined();
    }
  });

  test('its end brings a fresh one (a new node, the same pair, a rollback), started only while shown', () => {
    const { made, host, switchTo } = hosted(A);
    const hide = host.show();
    switchTo(B);
    switchTo(B);
    hide();
    switchTo(A);
    expect(made.map((m) => [m.e.nodeUrl, m.calls])).toEqual([
      ['http://a/', ['start', 'dispose']],
      ['http://b/', ['start', 'dispose']],
      ['http://b/', ['start', 'stop', 'dispose']],
      ['http://a/', []],
    ]);
    host.show();
    expect(made.at(-1)?.calls).toEqual(['start']);
  });

  test('an RPC change makes a fresh one at once; the same pair again keeps it; the last showing stops it', () => {
    const { store, made, host } = hosted(A);
    const first = host.show();
    const second = host.show();
    store.set(endpointsAtom, { ...A });
    store.set(endpointsAtom, { ...A, ethRpcUrl: 'http://rpc-2/' });
    first();
    expect(made.map((m) => m.calls)).toEqual([['start', 'start', 'dispose'], ['start']]);
    second();
    expect(made.at(-1)?.calls).toEqual(['start', 'stop']);
  });
});

describe('when a hosted request may leave', () => {
  const ok = { kind: 'ok', latencyMs: 5 } as const;
  const cooling = {
    kind: 'throttled',
    retryAt: Date.now() + 60_000,
    status: 429,
    backoffMs: 60_000,
  } as const;
  // The deadline passed and no recovery is out: the next request through the gate would be it.
  const recoverable = { ...cooling, retryAt: Date.now() - 1 };

  test('never while a claim is out, while the node is anything but ok, or until the guard is on its node', () => {
    const cases: [boolean, Parameters<typeof hostedBusy>[1], string | null][] = [
      [false, ok, 'http://a/'],
      [true, ok, 'http://a/'],
      [false, cooling, 'http://a/'],
      [false, recoverable, 'http://a/'],
      [false, ok, null],
      [false, ok, 'http://b/'],
    ];
    expect(cases.map(([claim, t, guard]) => hostedBusy(claim, t, guard, 'http://a'))).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  test('the claim path holds them while a claim is out, during the rebuild and while its reads are out', () => {
    const store = createStore();
    const at = (phase: 'idle' | 'mining' | 'claiming' | 'recovering', check = false) => {
      store.set(minerAtom, { ...store.get(minerAtom), phase });
      store.set(claimReadsAtom, check);
      return claimBusy(store);
    };
    expect([
      at('idle'),
      at('mining'),
      at('claiming'),
      at('recovering'),
      at('idle', true),
      at('mining', true),
    ]).toEqual([false, false, true, true, true, true]);
  });

  test('at once while shown and free; a waiting one is checked only while shown; a close refuses', async () => {
    let busy = false;
    let checks = 0;
    const turns = createTurns(() => {
      checks++;
      return busy;
    }, 5);
    let through = 0;
    const ask = () => turns.turn().then(() => void through++);
    const parked = ask();
    await Bun.sleep(40);
    expect([through, checks]).toEqual([0, 0]);
    busy = true;
    turns.show();
    await Bun.sleep(40);
    expect(through).toBe(0);
    expect(checks).toBeGreaterThan(1);
    turns.hide();
    const hidden = checks;
    await Bun.sleep(40);
    expect(checks).toBe(hidden);
    busy = false;
    turns.show();
    await parked;
    await ask();
    expect(through).toBe(2);
    busy = true;
    const waiting = turns.turn();
    turns.close();
    await expect(waiting).rejects.toThrow('disposed');
    await expect(turns.turn()).rejects.toThrow('disposed');
  });
});

interface Call {
  id: number | string;
  method: string;
}
type Reader = Awaited<ReturnType<StatsSources['open']>>;

const NODE = 'http://node.test/';
const ONE = `0x${'0'.repeat(63)}1`;
const FIXED = {
  open: 60,
  block: { number: 1, timestamp: 1000 },
  supply: 1n,
  genesis: { target: 1n, seed: 0n, launchAt: 0 },
  readAt: 0,
} as unknown as Fixed;
const TABLE: SlotTable = {
  first: 0,
  epochs: Array.from({ length: CHUNK }, (_, e) => new Fr(1000 + e)),
  claims: Array.from({ length: CHUNK }, (_, e) => new Fr(5000 + e)),
};
const CONNECTION: Connection = {
  nodeUrl: NODE,
  ethRpcUrl: 'http://rpc.test/',
  miner: '0x01',
  token: '0x02',
  firstEpoch: 0,
};

describe('hosted reads composed', () => {
  // The guard's pass-through and node slot belong to the realm: every suite in this process shares them.
  type Realm = Record<symbol, { original: typeof fetch } | undefined>;
  let saved: { original: typeof fetch; node: string | null } | undefined;
  beforeEach(() => {
    const guard = (globalThis as unknown as Realm)[Symbol.for('yacana.node-guard')];
    saved = { original: guard?.original ?? fetch, node: currentNodeEndpoint() };
    resetNodeHealth();
  });
  afterEach(() => {
    if (saved) setOriginalFetch(saved.original);
    setNodeEndpoint(saved?.node ?? null, 120_000);
  });

  /** The node stand-in: every slot holds 1; the request numbered `holdAt` waits for `release`. */
  function node(holdAt: number) {
    const sent: number[] = [];
    let release: (() => void) | undefined;
    setOriginalFetch((async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Call | Call[];
      const calls = Array.isArray(body) ? body : [body];
      sent.push(calls.length);
      if (sent.length === holdAt)
        await new Promise<void>((go) => {
          release = go;
        });
      const out = calls.map((c) => ({
        jsonrpc: '2.0',
        id: c.id,
        result: c.method === 'aztec_getPublicStorageAt' ? ONE : null,
      }));
      return Response.json(Array.isArray(body) ? out : out[0]);
    }) as typeof fetch);
    setNodeEndpoint(NODE, 120_000);
    return { sent, held: () => release !== undefined, release: () => release?.() };
  }

  /** A host over the real hosted runtime; the beats read through the reader it opens, with its limits. */
  function page() {
    const store = createStore();
    store.set(endpointsAtom, { nodeUrl: NODE, ethRpcUrl: CONNECTION.ethRpcUrl, switching: false });
    const opened: (ReadLimits | undefined)[] = [];
    const sources: StatsSources = {
      open: async (_c, n, limits) => {
        opened.push(limits);
        return {
          node: n,
          miner: AztecAddress.fromBigIntUnsafe(1n),
          load: async () => TABLE,
          limits,
        } as unknown as Reader;
      },
      reads: (r) => ({
        fixed: async () => {
          await readSlot(r.node, r.miner, new Fr(1n), r.limits);
          return FIXED;
        },
        rows: (from, to, open) =>
          readEpochs(r.node, r.miner, { from, to: Math.min(open, to + 1) }, r.load, {
            limits: { ...r.limits, maxEpochs: 49 },
          }),
        lottery: async () => ({ mix: 0n, reveals: 0 }),
      }),
      bridge: () => null,
    };
    const host = createStatsHost(store, (e) =>
      hostedRuntime(e, { store, connection: CONNECTION, bridge: false }, sources),
    );
    const setPhase = (phase: 'idle' | 'claiming') => store.set(minerAtom, { ...store.get(minerAtom), phase });
    return { store, host, opened, setPhase };
  }

  async function until(what: string, cond: () => boolean): Promise<void> {
    const end = Date.now() + 5_000;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await Bun.sleep(10);
    }
  }

  test('a claim begun mid-batch holds the rest of it, nothing sent, and the batch lands after it', async () => {
    const wire = node(2);
    const { store, host, opened, setPhase } = page();
    const hide = host.show();
    await until('the batch', wire.held);
    setPhase('claiming');
    wire.release();
    await Bun.sleep(1_300);
    expect(wire.sent).toHaveLength(2);
    expect(store.get(statusAtom).phase).toBe('loading');
    setPhase('idle');
    await until('the rows', () => store.get(historyAtom)?.rows.size === 48);
    expect(store.get(statusAtom).phase).toBe('ready');
    expect(store.get(historyAtom)?.error).toBeUndefined();
    // No reader's timer counts the wait for a turn: the client's deadline starts when a request leaves.
    expect(opened).toEqual([expect.objectContaining({ timeoutMs: Number.POSITIVE_INFINITY })]);
    hide();
    store.set(endpointsAtom, null);
  });

  test('a hide mid-batch parks the rest until Stats shows again; a switch refuses what waits', async () => {
    const wire = node(2);
    const shownAgain = page();
    let hide = shownAgain.host.show();
    await until('the batch', wire.held);
    hide();
    wire.release();
    await Bun.sleep(1_300);
    expect(wire.sent).toHaveLength(2);
    hide = shownAgain.host.show();
    await until('the rows', () => shownAgain.store.get(historyAtom)?.rows.size === 48);
    expect(shownAgain.store.get(statusAtom).phase).toBe('ready');
    hide();
    shownAgain.store.set(endpointsAtom, null);

    const again = node(2);
    const switched = page();
    switched.host.show();
    await until('the batch', again.held);
    switched.setPhase('claiming');
    again.release();
    await Bun.sleep(100);
    switched.store.set(endpointsAtom, { nodeUrl: NODE, ethRpcUrl: CONNECTION.ethRpcUrl, switching: true });
    switched.setPhase('idle');
    await Bun.sleep(1_300);
    expect(again.sent).toHaveLength(2);
    expect(switched.store.get(statusAtom).phase).toBe('loading');
  });
});
