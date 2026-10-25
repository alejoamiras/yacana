// bun: the live node switch against a fake worker, fake contracts and a fake handle. The rebuild
// is injected (`recover`); what is checked is the order — pause, drain, the handle moved and the
// guard's endpoint with it, the rebuild from the new node, mining resumed on the rebuilt view.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import type { SwitchableNode } from '@yacana/web-kit/browser/node';
import { createStore } from 'jotai';
import type { Deployment, Fee } from '../src/chain.ts';
import { MinerController, type Rebound } from '../src/controller.ts';
import { balanceAtom, epochAtom, minerAtom } from '../src/state.ts';
import type { FromWorker, ToWorker } from '../src/worker-protocol.ts';

/** Consent as the controller tests need it: in force, with nothing to remember. */
const OPEN = { allowed: () => true, promote() {}, forget() {} };

/**
 * Controllers a test makes, disposed with it: an undisposed one keeps polling the node after its
 * test is over, and its errors land on whichever file bun runs next.
 */
const live: MinerController[] = [];
const controllerFor = (opts: ConstructorParameters<typeof MinerController>[0]): MinerController => {
  const c = new MinerController(opts);
  live.push(c);
  return c;
};
afterEach(() => {
  for (const c of live.splice(0)) c.dispose();
});

let boot: typeof import('../src/boot.ts');
let guard: typeof import('@yacana/web-kit/browser/node-guard');

class FakeWorker {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: ToWorker[] = [];
  postMessage(m: ToWorker) {
    this.sent.push(m);
    if (m.type === 'init')
      queueMicrotask(() => this.emit({ type: 'ready', threads: 1, initMs: 0, prover: 'wasm' }));
  }
  terminate() {}
  emit(m: FromWorker) {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }
}

const sim = (result: unknown) => ({ simulate: async () => ({ result }) });

/** A deployment whose balance read can be held open, to prove the drain waits for it. */
const fakeDeployment = (balance: () => Promise<bigint>): Deployment =>
  ({
    node: { getL1Constants: async () => ({ slotDuration: 36, epochDuration: 32, proofSubmissionEpochs: 1 }) },
    miner: {
      address: AztecAddress.fromBigIntUnsafe(7n),
      methods: {
        open_epoch: () => sim(3n),
        epoch_params: () => sim({ target: 1n << 122n, seed: 7n, opened_at: 0n }),
        claims_in: () => sim(1n),
      },
    },
    token: {
      methods: { balance_of_private: () => ({ simulate: async () => ({ result: await balance() }) }) },
    },
    lastSent: () => undefined,
  }) as unknown as Deployment;

const fee = {
  paymentMethod: { getAsset: () => undefined },
  gasSettings: { gasLimits: {} },
} as unknown as Fee;
const account = AztecAddress.fromBigIntUnsafe(11n);

const settle = async (done: () => boolean) => {
  for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(done()).toBe(true);
};

describe('the live node switch', () => {
  let store: ReturnType<typeof createStore>;
  let worker: FakeWorker;

  beforeAll(async () => {
    Object.defineProperty(globalThis, 'location', {
      value: new URL('https://yacana.test/mine/'),
      configurable: true,
      writable: true,
    });
    guard = await import('@yacana/web-kit/browser/node-guard');
    guard.installNodeGuard();
    boot = await import('../src/boot.ts');
  });
  beforeEach(() => {
    store = createStore();
    worker = new FakeWorker();
  });

  test('pause → drain → the handle and the guard move → the view is rebuilt from the new node → mining resumes', async () => {
    const events: string[] = [];
    // The old node's balance read is held open until released: the drain must wait for it.
    let releaseRead: (() => void) | undefined;
    const held = new Promise<void>((r) => {
      releaseRead = r;
    });
    let reads = 0;
    const oldDeployment = fakeDeployment(async () => {
      reads++;
      if (reads === 2) await held;
      return 5n;
    });
    const rebuilt = fakeDeployment(async () => 9n);
    const switchable: SwitchableNode = {
      node: {} as never,
      use: (url) => events.push(`use ${url}`),
      current: () => 'https://a.example',
    };
    const controller = controllerFor({
      store,
      spawnWorker: () => worker as unknown as Worker,
      threads: 1,
      deployment: oldDeployment,
      account,
      fee,
      chainId: 1n,
      rollupVersion: 1n,
      consent: OPEN,
      recover: async () => {
        events.push('rebuild');
        return { deployment: rebuilt, fee, rebuilt: true } satisfies Rebound;
      },
    });
    await controller.ready();
    await controller.begin();
    controller.start();
    await settle(() => worker.sent.some((m) => m.type === 'mine'));
    expect(store.get(balanceAtom)).toBe(5n);

    // A refresh in flight on the old node, then the switch.
    const inFlight = controller.refresh();
    await new Promise((r) => setTimeout(r, 20));
    const switching = boot.switchNodeLive({
      controller,
      switchable,
      url: 'https://b.example',
      deadlineMs: 5_000,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(store.get(minerAtom).phase).not.toBe('mining');
    expect(events).toEqual([]); // still draining: the held read has not landed
    releaseRead?.();
    await inFlight;
    await switching;
    expect(events).toEqual(['use https://b.example', 'rebuild']);
    expect(guard.currentNodeEndpoint()).toBe('https://b.example/');
    // The rebuilt view was read (its balance) and mining resumed on it.
    await settle(() => store.get(balanceAtom) === 9n);
    await settle(() => store.get(minerAtom).phase === 'mining');
  });

  test("a node whose open epoch is lower than the old one's claim: the switch publishes the new node's numbers", async () => {
    const rebuilt = fakeDeployment(async () => 9n);
    const switchable: SwitchableNode = {
      node: {} as never,
      use: () => {},
      current: () => 'https://a.example',
    };
    const controller = controllerFor({
      store,
      spawnWorker: () => worker as unknown as Worker,
      threads: 1,
      deployment: fakeDeployment(async () => 5n),
      account,
      fee,
      chainId: 1n,
      rollupVersion: 1n,
      consent: OPEN,
      recover: async () => ({ deployment: rebuilt, fee, rebuilt: true }) satisfies Rebound,
    });
    await controller.ready();
    await controller.begin();
    // The old node (a liar, or a longer chain) said epoch 100; the new one says 3 (the fake's open_epoch).
    store.set(epochAtom, { epoch: 100n, seed: 0n, target: 1n << 122n, openedAt: 0n, claims: 1 });
    await boot.switchNodeLive({ controller, switchable, url: 'https://b.example', deadlineMs: 5_000 });
    await settle(() => store.get(balanceAtom) === 9n);
    expect(store.get(epochAtom)?.epoch).toBe(3n);
  });

  test('a switch made while idle rebuilds and reads, but does not start mining on its own', async () => {
    const rebuilt = fakeDeployment(async () => 9n);
    const switchable: SwitchableNode = {
      node: {} as never,
      use: () => {},
      current: () => 'https://a.example',
    };
    const controller = controllerFor({
      store,
      spawnWorker: () => worker as unknown as Worker,
      threads: 1,
      deployment: fakeDeployment(async () => 5n),
      account,
      fee,
      chainId: 1n,
      rollupVersion: 1n,
      consent: OPEN,
      recover: async () => ({ deployment: rebuilt, fee, rebuilt: true }) satisfies Rebound,
    });
    await controller.ready();
    await controller.begin(); // never started: the miner is idle
    await boot.switchNodeLive({ controller, switchable, url: 'https://b.example', deadlineMs: 5_000 });
    await settle(() => store.get(balanceAtom) === 9n); // the rebuilt view was read
    expect(store.get(minerAtom).phase).toBe('idle'); // …but mining did not start
  });

  test('a rebuild that fails on the new node is retried from the former one; failing there too abandons the prover', async () => {
    const moves: string[] = [];
    let current = 'https://a.example';
    const switchable: SwitchableNode = {
      node: {} as never,
      use: (url) => {
        moves.push(url);
        current = url;
      },
      current: () => current,
    };
    let attempts = 0;
    const make = (recover: () => Promise<Rebound>) =>
      controllerFor({
        store,
        spawnWorker: () => worker as unknown as Worker,
        threads: 1,
        deployment: fakeDeployment(async () => 5n),
        account,
        fee,
        chainId: 1n,
        rollupVersion: 1n,
        consent: OPEN,
        recover,
      });
    // Neither node rebuilds: the switch rejects with `kept: false` and the prover is given up.
    const dead = make(async () => {
      attempts++;
      throw new Error('the fresh node would not sync');
    });
    await dead.ready();
    await dead.begin();
    const failed = boot.switchNodeLive({
      controller: dead,
      switchable,
      url: 'https://b.example',
      deadlineMs: 5_000,
    });
    await expect(failed).rejects.toThrow(/would not sync/);
    await expect(failed).rejects.toMatchObject({ kept: false });
    expect(attempts).toBe(2);
    expect(moves).toEqual(['https://b.example', 'https://a.example']);
    expect(guard.currentNodeEndpoint()).toBe(guard.normaliseEndpoint('https://a.example'));
    expect(store.get(minerAtom).proverDead).toBe(true);
    dead.dispose();

    // The former node answers: the handle is back on it, the view rebuilt, the prover alive, `kept: true`.
    store = createStore();
    worker = new FakeWorker();
    moves.length = 0;
    const alive = make(async () => {
      if (current === 'https://b.example') throw new Error('the fresh node would not sync');
      return { deployment: fakeDeployment(async () => 5n), fee, rebuilt: true };
    });
    await alive.ready();
    await alive.begin();
    const kept = boot.switchNodeLive({
      controller: alive,
      switchable,
      url: 'https://b.example',
      deadlineMs: 5_000,
    });
    await expect(kept).rejects.toMatchObject({ kept: true });
    expect(moves).toEqual(['https://b.example', 'https://a.example']);
    expect(store.get(minerAtom).proverDead).toBeFalsy();
    expect(store.get(epochAtom)).not.toBeNull(); // the former node's view was read again
    alive.dispose();
  });

  test('a tracked operation is drained before the swap, and none may start across the switch', async () => {
    const events: string[] = [];
    let finishOp: (() => void) | undefined;
    const switchable: SwitchableNode = {
      node: {} as never,
      use: (u) => events.push(`use ${u}`),
      current: () => 'https://a.example',
    };
    const controller = controllerFor({
      store,
      spawnWorker: () => worker as unknown as Worker,
      threads: 1,
      deployment: fakeDeployment(async () => 5n),
      account,
      fee,
      chainId: 1n,
      rollupVersion: 1n,
      consent: OPEN,
      recover: async () =>
        ({ deployment: fakeDeployment(async () => 9n), fee, rebuilt: true }) satisfies Rebound,
    });
    await controller.ready();
    await controller.begin();
    const op = controller.track(
      () =>
        new Promise<void>((r) => {
          finishOp = () => {
            events.push('op done');
            r();
          };
        }),
    );
    const switching = boot.switchNodeLive({
      controller,
      switchable,
      url: 'https://b.example',
      deadlineMs: 5_000,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([]); // the swap waits for the operation
    await expect(controller.track(async () => 1)).rejects.toThrow(/switch is underway/);
    finishOp?.();
    await op;
    await switching;
    expect(events).toEqual(['op done', 'use https://b.example']);
  });

  test('a lost-race rebuild that goes terminal while the drain waits fails the switch', async () => {
    const switchable: SwitchableNode = {
      node: {} as never,
      use: () => {},
      current: () => 'https://a.example',
    };
    const controller = controllerFor({
      store,
      spawnWorker: () => worker as unknown as Worker,
      threads: 1,
      deployment: fakeDeployment(async () => 5n),
      account,
      fee,
      chainId: 1n,
      rollupVersion: 1n,
      consent: OPEN,
      recover: async () =>
        ({ deployment: fakeDeployment(async () => 9n), fee, rebuilt: true }) satisfies Rebound,
    });
    await controller.ready();
    await controller.begin();
    // The prover dies while the switch is draining (a rebuild that failed, a crashed worker).
    store.set(minerAtom, { ...store.get(minerAtom), proverDead: true });
    await expect(
      boot.switchNodeLive({ controller, switchable, url: 'https://b.example', deadlineMs: 5_000 }),
    ).rejects.toThrow(/only a reload recovers/);
  });

  test('signed out (no controller) the switch is the handle and the guard alone', async () => {
    const used: string[] = [];
    const switchable: SwitchableNode = { node: {} as never, use: (u) => used.push(u), current: () => 'x' };
    await boot.switchNodeLive({
      controller: undefined,
      switchable,
      url: 'https://c.example/rpc',
      deadlineMs: 1,
    });
    expect(used).toEqual(['https://c.example/rpc']);
    expect(guard.currentNodeEndpoint()).toBe('https://c.example/rpc');
  });

  test('the view marker: missing or another endpoint means a rebuild; the same endpoint does not', async () => {
    const stored = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => stored.get(k) ?? null,
        setItem: (k: string, v: string) => stored.set(k, v),
      },
      configurable: true,
      writable: true,
    });
    const a = await guard.endpointFingerprint('https://a.example/rpc');
    expect(boot.viewBuiltOn('pxe-1')).toBeNull();
    boot.markViewBuiltOn('pxe-1', a);
    expect(boot.viewBuiltOn('pxe-1')).toBe(a);
    // `/rpc/` is another endpoint (the SDK posts the path as given): it means a rebuild.
    expect(boot.viewBuiltOn('pxe-1') === (await guard.endpointFingerprint('https://a.example/rpc/'))).toBe(
      false,
    );
    expect(boot.viewBuiltOn('pxe-1') === (await guard.endpointFingerprint('https://a.example/rpc?n=2'))).toBe(
      false,
    );
  });
});
