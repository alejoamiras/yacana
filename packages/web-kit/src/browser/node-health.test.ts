import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { makeFetch } from '@aztec/foundation/json-rpc/client';
import { NoRetryError } from '@aztec/foundation/retry';
import type { NodeRequestOutcome } from './node-guard.ts';

// The fake network the guard sits over: per-path behaviour, a call log, a delay per request.
const calls: string[] = [];
const network = async (input: RequestInfo | URL): Promise<Response> => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  calls.push(href);
  const url = new URL(href);
  const delay = Number(url.searchParams.get('delay') ?? 0);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  if (url.pathname.endsWith('/limited'))
    return new Response('{"error":{"message":"slow down"}}', {
      status: 429,
      headers: { 'retry-after': '1' },
    });
  if (url.pathname.endsWith('/down')) throw new TypeError('Failed to fetch');
  if (url.pathname.endsWith('/broken')) return new Response('oops', { status: 502 });
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: href }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

let guard: typeof import('./node-guard.ts');
let health: typeof import('./node-health.ts');
let node: typeof import('./node.ts');
const NODE = 'https://node.example/rpc';
// A fresh request by default: the store drops what started before the last reset or the cooldown,
// so a test that means a stale answer passes an old `startedAt` itself.
const outcome = (over: Partial<NodeRequestOutcome>): NodeRequestOutcome => ({
  endpoint: guard.normaliseEndpoint(NODE),
  startedAt: performance.now(),
  status: 200,
  latencyMs: 12,
  retryAfter: null,
  quiet: false,
  ...over,
});

beforeAll(async () => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://yacana.test/stats/'),
    configurable: true,
    writable: true,
  });
  globalThis.fetch = network as typeof fetch;
  guard = await import('./node-guard.ts');
  guard.installNodeGuard();
  guard.setOriginalFetch(network as typeof fetch);
  health = await import('./node-health.ts');
  health.startNodeHealth();
  node = await import('./node.ts');
});

beforeEach(() => {
  calls.length = 0;
  health.resetNodeHealth();
  guard.setNodeEndpoint(NODE, 1_000);
});

// The store and its gate outlive this file in a shared run: leave them healthy for the next suite.
afterAll(() => health.resetNodeHealth());

describe('parseRetryAfter', () => {
  test('a quiet failure never opens a cooldown; once one is on, a quiet answer counts like any other', () => {
    health.recordOutcome(outcome({ status: 429, retryAfter: '7', quiet: true }));
    health.recordOutcome(outcome({ status: 'network', quiet: true }));
    expect(health.nodeHealth().transport.kind).toBe('ok');
    health.setTransportForTests({
      kind: 'throttled',
      retryAt: Date.now() - 1,
      status: 429,
      backoffMs: 15_000,
    });
    health.recordOutcome(outcome({ status: 200, quiet: true }));
    expect(health.nodeHealth().transport.kind).toBe('ok');
  });

  test('delta-seconds and a future HTTP-date; garbage, the past and nothing are null', () => {
    const now = Date.parse('2026-09-08T12:00:00Z');
    expect(health.parseRetryAfter('7', now)).toBe(7);
    expect(health.parseRetryAfter(' 30 ', now)).toBe(30);
    expect(health.parseRetryAfter('Tue, 08 Sep 2026 12:00:45 GMT', now)).toBe(45);
    expect(health.parseRetryAfter('Tue, 08 Sep 2026 11:59:00 GMT', now)).toBeNull();
    expect(health.parseRetryAfter('soon', now)).toBeNull();
    expect(health.parseRetryAfter('-5', now)).toBeNull();
    expect(health.parseRetryAfter(null, now)).toBeNull();
  });
});

describe('nextTransport', () => {
  const now = 1_000_000;
  test('a 429 with a header takes it, clamped to [5 s, 120 s]; without one the backoff doubles to 60 s', () => {
    const ok = { kind: 'ok', latencyMs: 1 } as const;
    expect(health.nextTransport(ok, { type: '429', retryAfterS: 7 }, now)).toMatchObject({
      retryAt: now + 7_000,
    });
    expect(health.nextTransport(ok, { type: '429', retryAfterS: 1 }, now)).toMatchObject({
      retryAt: now + 5_000,
    });
    expect(health.nextTransport(ok, { type: '429', retryAfterS: 900 }, now)).toMatchObject({
      retryAt: now + 120_000,
    });
    let t = health.nextTransport(ok, { type: '429', retryAfterS: null }, now);
    expect(t).toMatchObject({ kind: 'throttled', backoffMs: 15_000 });
    t = health.nextTransport(t, { type: '429', retryAfterS: null }, now);
    expect(t).toMatchObject({ backoffMs: 30_000 });
    t = health.nextTransport(t, { type: '429', retryAfterS: null }, now);
    t = health.nextTransport(t, { type: '429', retryAfterS: null }, now);
    expect(t).toMatchObject({ backoffMs: 60_000, retryAt: now + 60_000 });
  });

  test('a failure is silence with its own deadline, 20 s doubling to 60 s, keeping its first moment', () => {
    let t = health.nextTransport({ kind: 'ok', latencyMs: 1 }, { type: 'failed' }, now);
    expect(t).toMatchObject({ kind: 'silent', since: now, backoffMs: 20_000, retryAt: now + 20_000 });
    t = health.nextTransport(t, { type: 'failed' }, now + 20_000);
    expect(t).toMatchObject({ since: now, backoffMs: 40_000 });
    t = health.nextTransport(t, { type: 'failed' }, now + 60_000);
    expect(t).toMatchObject({ backoffMs: 60_000 });
    expect(health.nextTransport(t, { type: 'ok', latencyMs: 3 }, now + 70_000)).toEqual({
      kind: 'ok',
      latencyMs: 3,
    });
  });
});

describe('the store', () => {
  test('classify: 429 carries its header, another 4xx is an answer, 5xx and deaths are failures', () => {
    expect(health.classify(outcome({ status: 429, retryAfter: '7' }))).toEqual({
      type: '429',
      retryAfterS: 7,
    });
    expect(health.classify(outcome({ status: 400 }))).toEqual({ type: 'ok', latencyMs: 12 });
    expect(health.classify(outcome({ status: 502 })).type).toBe('failed');
    expect(health.classify(outcome({ status: 'timeout' })).type).toBe('failed');
    expect(health.classify(outcome({ status: 'network' })).type).toBe('failed');
  });

  test('three opaque failures inside a window read as a throttle; a success in between resets the count', () => {
    health.recordOutcome(outcome({ status: 'network' }));
    health.recordOutcome(outcome({ status: 'network' }));
    expect(health.nodeHealth().transport.kind).toBe('silent');
    health.recordOutcome(outcome({ status: 200, startedAt: performance.now() })); // a fresh answer
    health.recordOutcome(outcome({ status: 'network' }));
    health.recordOutcome(outcome({ status: 'network' }));
    expect(health.nodeHealth().transport.kind).toBe('silent');
    health.recordOutcome(outcome({ status: 'network' }));
    expect(health.nodeHealth().transport.kind).toBe('throttled');
  });

  test('an outcome that started before a reset is dropped (A → B → A, a late answer from the first A)', () => {
    const before = performance.now();
    health.resetNodeHealth();
    health.recordOutcome(outcome({ status: 429, retryAfter: '5', startedAt: before }));
    expect(health.nodeHealth().transport.kind).toBe('ok');
    health.recordOutcome(outcome({ status: 429, retryAfter: '5', startedAt: performance.now() }));
    expect(health.nodeHealth().transport.kind).toBe('throttled');
  });

  test('markRead ages independently of the transport', () => {
    health.markRead(1234);
    health.recordOutcome(outcome({ status: 429 }));
    expect(health.nodeHealth()).toMatchObject({ lastReadAt: 1234, transport: { kind: 'throttled' } });
    health.recordOutcome(outcome({ status: 200, startedAt: performance.now() }));
    expect(health.nodeHealth()).toMatchObject({ lastReadAt: 1234, transport: { kind: 'ok' } });
  });

  test('an outcome from an endpoint that is no longer the page’s is dropped', async () => {
    guard.setNodeEndpoint('https://node.example/broken', 1_000);
    const stale = fetch('https://node.example/broken');
    guard.setNodeEndpoint(NODE, 1_000);
    await (await stale).text();
    expect(health.nodeHealth().transport.kind).toBe('ok');
  });
});

describe('bannerState', () => {
  const now = 10_000_000;
  const rest = { tip: null, l1: null, deploymentOk: null, behind: false } as const;
  test('throttled and silent carry their countdown; stale is a read older than the threshold; ok is nothing', () => {
    expect(
      health.bannerState(
        { ...rest, transport: { kind: 'ok', latencyMs: 1 }, lastReadAt: now - 1_000 },
        now,
        60_000,
      ),
    ).toBeNull();
    expect(
      health.bannerState(
        {
          ...rest,
          transport: { kind: 'throttled', retryAt: now + 12_400, status: 429, backoffMs: 15_000 },
          lastReadAt: now - 40_000,
        },
        now,
        60_000,
      ),
    ).toEqual({ kind: 'throttled', ageS: 40, retryInS: 13 });
    expect(
      health.bannerState(
        {
          ...rest,
          transport: { kind: 'silent', since: now - 25_000, retryAt: now + 5_000, backoffMs: 20_000 },
          lastReadAt: null,
        },
        now,
        60_000,
      ),
    ).toEqual({ kind: 'silent', ageS: 25, retryInS: 5 });
    expect(
      health.bannerState(
        { ...rest, transport: { kind: 'ok', latencyMs: 1 }, lastReadAt: now - 75_000 },
        now,
        60_000,
      ),
    ).toEqual({
      kind: 'stale',
      ageS: 75,
      retryInS: null,
    });
    expect(
      health.bannerState({ ...rest, transport: { kind: 'ok', latencyMs: 1 }, lastReadAt: null }, now, 60_000),
    ).toBeNull();
  });
});

describe('the gate', () => {
  test('a 429 starts a cooldown; during it the node’s requests get a synthetic 429 and no network call', async () => {
    guard.setNodeEndpoint('https://node.example/limited', 1_000);
    await (await fetch('https://node.example/limited')).text();
    expect(health.nodeHealth().transport).toMatchObject({ kind: 'throttled' });
    calls.length = 0;
    const res = await fetch('https://node.example/limited');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { message: 'the node is rate-limiting this page' } });
    expect(calls).toEqual([]);
    // The SDK's transport makes one call and rejects; the node client built on it rejects once.
    const rpc = makeFetch([], false);
    await expect(rpc('https://node.example/limited', { method: 'x' })).rejects.toBeInstanceOf(NoRetryError);
    expect(calls).toEqual([]);
    // Synthetic answers are not outcomes: the deadline did not move.
    const { retryAt } = health.nodeHealth().transport as { retryAt: number };
    await fetch('https://node.example/limited');
    expect((health.nodeHealth().transport as { retryAt: number }).retryAt).toBe(retryAt);
  });

  test('a success in flight when the throttle was observed does not clear it; a later one does', () => {
    health.recordOutcome(outcome({ status: 429, retryAfter: '5' })); // cooldown observed = performance.now()
    const observed = performance.now();
    health.recordOutcome(outcome({ status: 200, startedAt: observed - 5_000 })); // sent before the throttle
    expect(health.nodeHealth().transport.kind).toBe('throttled');
    health.recordOutcome(outcome({ status: 200, startedAt: performance.now() })); // sent after it
    expect(health.nodeHealth().transport.kind).toBe('ok');
  });

  test('at the deadline exactly one caller reaches the network; the others wait for its outcome', async () => {
    // The query is part of the endpoint's identity, so the slow variant is the endpoint here.
    guard.setNodeEndpoint('https://node.example/rpc?delay=40', 1_000);
    health.setTransportForTests({
      kind: 'throttled',
      retryAt: Date.now() - 1,
      status: 429,
      backoffMs: 5_000,
    });
    calls.length = 0;
    const [a, b, c] = await Promise.all([
      fetch('https://node.example/rpc?delay=40'),
      fetch('https://node.example/rpc?delay=40'),
      fetch('https://node.example/rpc?delay=40'),
    ]);
    expect(calls.length).toBe(1);
    expect([a.status, b.status, c.status].sort()).toEqual([200, 429, 429]);
    await Promise.all([a.text(), b.text(), c.text()]);
    expect(health.nodeHealth().transport.kind).toBe('ok');
    calls.length = 0;
    await (await fetch('https://node.example/rpc?delay=40')).text();
    expect(calls.length).toBe(1);
  });

  test('waitTurn resolves at the deadline, when a recovery in flight settles, or at once on abort', async () => {
    guard.setNodeEndpoint('https://node.example/rpc?delay=50', 1_000);
    health.setTransportForTests({
      kind: 'throttled',
      retryAt: Date.now() + 60_000,
      status: 429,
      backoffMs: 60_000,
    });
    const gaveUp = new AbortController();
    const abandoned = health.waitTurn(gaveUp.signal);
    gaveUp.abort();
    await abandoned;
    health.setTransportForTests({ kind: 'throttled', retryAt: Date.now() + 40, status: 429, backoffMs: 40 });
    const t0 = Date.now();
    await health.waitTurn();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    // A probe takes the network; a waiter must not resolve until it settles.
    const probe = fetch('https://node.example/rpc?delay=50');
    await new Promise((r) => setTimeout(r, 5));
    let resolved = false;
    const waiter = health.waitTurn().then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);
    await (await probe).text();
    await waiter;
    expect(resolved).toBe(true);
    expect(health.nodeHealth().transport.kind).toBe('ok');
  });

  test('a stale answer that started before the recovery does not release its lock', async () => {
    // A cooldown whose deadline has passed: the first request through is the recovery.
    guard.setNodeEndpoint('https://node.example/rpc?delay=60', 1_000);
    health.setTransportForTests({
      kind: 'throttled',
      retryAt: Date.now() - 1,
      status: 429,
      backoffMs: 5_000,
    });
    const recovery = fetch('https://node.example/rpc?delay=60'); // admitted, on the network
    await new Promise((r) => setTimeout(r, 5));
    // An obsolete success from before this recovery arrives first; it must not free the gate.
    health.recordOutcome({
      endpoint: guard.normaliseEndpoint('https://node.example/rpc?delay=60'),
      startedAt: -1,
      status: 200,
      quiet: false,
      latencyMs: 1,
      retryAfter: null,
    });
    const blocked = await fetch('https://node.example/rpc?delay=60');
    expect(blocked.status).toBe(429); // still synthetic: the recovery is the only one on the network
    await (await recovery).text();
    expect(health.nodeHealth().transport.kind).toBe('ok');
  });

  test('silence gates too: a 5xx starts a cooldown answered with a synthetic 503', async () => {
    guard.setNodeEndpoint('https://node.example/broken', 1_000);
    await (await fetch('https://node.example/broken')).text();
    expect(health.nodeHealth().transport.kind).toBe('silent');
    calls.length = 0;
    const res = await fetch('https://node.example/broken');
    expect(res.status).toBe(503);
    expect(calls).toEqual([]);
  });
});

describe('quiet work', () => {
  test("the quiet client's 429 opens no cooldown; the page's own client's does", async () => {
    const LIMITED = 'https://node.example/limited';
    guard.setNodeEndpoint(LIMITED, 1_000);
    await expect(node.quietNodeClient(LIMITED, 10_000).getBlockNumber()).rejects.toThrow();
    expect(health.nodeHealth().transport.kind).toBe('ok');
    await expect(node.nodeClient(LIMITED).getBlockNumber()).rejects.toThrow();
    expect(health.nodeHealth().transport.kind).toBe('throttled');
  });

  test('a quiet request leaves only on its turn, and not at all when the turn is refused', async () => {
    let release: () => void = () => {};
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = node.quietNodeClient(NODE, 10_000, () => turn).getBlockNumber();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual([]);
    release();
    await read.catch(() => {}); // the fake's answer is not a block number; the request is what counts
    expect(calls).toEqual([NODE]);
    const refused = node.quietNodeClient(NODE, 10_000, () => Promise.reject(new Error('disposed')));
    await expect(refused.getBlockNumber()).rejects.toThrow('disposed');
    expect(calls).toEqual([NODE]);
  });

  test('a quiet failure that started before a cooldown leaves it as it was; a quiet probe after it ends it', async () => {
    const early = performance.now();
    await new Promise((r) => setTimeout(r, 2));
    health.recordOutcome(outcome({ status: 429, retryAfter: '7' }));
    const cooling = health.nodeHealth().transport;
    health.recordOutcome(outcome({ status: 'network', quiet: true, startedAt: early }));
    expect(health.nodeHealth().transport).toEqual(cooling);
    health.recordOutcome(outcome({ status: 200, quiet: true }));
    expect(health.nodeHealth().transport.kind).toBe('ok');
  });
});

describe('standing', () => {
  const now = 1_000_000_000;
  const tip = (checkpoint: number) => ({ block: checkpoint * 4, checkpoint, timestamp: now / 1000 - 12 });
  test('unknown until the deployment is checked, a tip read and a fresh L1 sample seen; then healthy', () => {
    expect(health.standing(health.nodeHealth(), now)).toBe('unknown');
    health.markDeployment(true);
    health.recordTip(tip(10), now);
    expect(health.standing(health.nodeHealth(), now)).toBe('unknown');
    expect(health.recordL1({ pendingCheckpoint: 11, head: 100 }, now)).toBe(true);
    expect(health.standing(health.nodeHealth(), now)).toBe('healthy');
    expect(health.tipAgeS(health.nodeHealth(), now)).toBe(12);
  });
  test('behind past the tolerance; a stale or missing L1 keeps the verdict; a caught-up tip clears it', () => {
    health.markDeployment(true);
    health.recordTip(tip(10), now);
    health.recordL1({ pendingCheckpoint: 11, head: 100 }, now);
    expect(health.standing(health.nodeHealth(), now)).toBe('healthy');
    health.recordL1({ pendingCheckpoint: 12, head: 101 }, now);
    expect(health.standing(health.nodeHealth(), now)).toBe('behind');
    // Sixty-one seconds on, L1 is stale: the lag is known, not cleared.
    expect(health.standing(health.nodeHealth(), now + 61_000)).toBe('behind');
    health.recordTip(tip(11), now + 61_000);
    expect(health.nodeHealth().behind).toBe(true);
    // A fresh sample with the node caught up clears it.
    health.recordL1({ pendingCheckpoint: 12, head: 102 }, now + 62_000);
    expect(health.standing(health.nodeHealth(), now + 62_000)).toBe('healthy');
  });
  test('an L1 sample whose head did not move is a cached answer and does not count', () => {
    health.markDeployment(true);
    health.recordTip(tip(10), now);
    health.recordL1({ pendingCheckpoint: 11, head: 100 }, now);
    expect(health.recordL1({ pendingCheckpoint: 15, head: 100 }, now + 15_000)).toBe(false);
    expect(health.standing(health.nodeHealth(), now + 15_000)).toBe('healthy');
  });
  test('the transport’s word wins while the node is not answering; a reset forgets everything', () => {
    health.markDeployment(true);
    health.recordTip(tip(10), now);
    health.recordL1({ pendingCheckpoint: 20, head: 100 }, now);
    expect(health.standing(health.nodeHealth(), now)).toBe('behind');
    health.setTransportForTests({ kind: 'silent', since: now, retryAt: now + 20_000, backoffMs: 20_000 });
    expect(health.standing(health.nodeHealth(), now)).toBe('silent');
    health.resetNodeHealth();
    expect(health.nodeHealth()).toMatchObject({ tip: null, l1: null, deploymentOk: null, behind: false });
  });
  test('a tip observed long ago is no observation: unknown, and no verdict from it', () => {
    health.markDeployment(true);
    health.recordTip(tip(10), now);
    health.recordL1({ pendingCheckpoint: 11, head: 100 }, now);
    expect(health.standing(health.nodeHealth(), now)).toBe('healthy');
    // The poll keeps answering but the tip read keeps failing: ninety-one seconds on, the tip is stale.
    expect(health.recordL1({ pendingCheckpoint: 20, head: 101 }, now + 91_000)).toBe(true);
    expect(health.nodeHealth().behind).toBe(false);
    expect(health.standing(health.nodeHealth(), now + 91_000)).toBe('unknown');
  });
  test('an RPC change forgets the head baseline but keeps the verdict until a fresh sample', () => {
    health.markDeployment(true);
    health.recordTip(tip(10), now);
    // A lying RPC's enormous head would otherwise refuse every honest sample after it.
    health.recordL1({ pendingCheckpoint: 20, head: 1_000_000 }, now);
    expect(health.standing(health.nodeHealth(), now)).toBe('behind');
    health.resetL1();
    expect(health.nodeHealth().behind).toBe(true);
    expect(health.recordL1({ pendingCheckpoint: 11, head: 100 }, now + 1_000)).toBe(true);
    expect(health.standing(health.nodeHealth(), now + 1_000)).toBe('healthy');
  });
});
