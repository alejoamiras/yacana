// The controller's side of a Retry and a Start against a fake Worker: an unchanged config posts
// nothing, a forced one rebuilds, the page's view of Presto follows the Worker's messages and is
// cleared by a rebuild, and Stop is counted so a probe that outlived one can tell.
import { describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { createStore } from 'jotai';
import type { Deployment, Fee } from '../src/chain.ts';
import { MinerController } from '../src/controller.ts';
import { type ConsentHooks, PRESTO_DEFAULT, prestoAtom } from '../src/presto.ts';
import type { FromWorker, ToWorker } from '../src/worker-protocol.ts';

class FakeWorker {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: ToWorker[] = [];
  postMessage(m: ToWorker) {
    this.sent.push(m);
    if (m.type === 'init' || m.type === 'reconfigure')
      queueMicrotask(() =>
        this.emit({ type: 'ready', threads: m.threads, initMs: 0, prover: m.presto ? 'presto' : 'wasm' }),
      );
  }
  terminate() {}
  emit(m: FromWorker) {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const reconfigures = (w: FakeWorker) => w.sent.filter((m) => m.type === 'reconfigure');

const OPEN: ConsentHooks = { allowed: () => true, promote() {}, forget() {} };

function controller(worker: FakeWorker, consent: ConsentHooks = OPEN) {
  const store = createStore();
  const c = new MinerController({
    store,
    spawnWorker: () => worker as unknown as Worker,
    threads: 2,
    presto: PRESTO_DEFAULT,
    consent,
    deployment: {} as Deployment,
    account: AztecAddress.fromBigIntUnsafe(11n),
    fee: {} as Fee,
    chainId: 1n,
    rollupVersion: 1n,
  });
  return { store, c };
}

describe('revoke', () => {
  test('it reaches the Worker at once, ahead of a mine queued behind a held initialization', async () => {
    // A Worker whose init never answers until told: everything posted through `ready` waits behind it.
    class HeldWorker extends FakeWorker {
      release: (() => void) | undefined;
      override postMessage(m: ToWorker) {
        this.sent.push(m);
        if (m.type === 'init')
          this.release = () => this.emit({ type: 'ready', threads: m.threads, initMs: 0, prover: 'presto' });
      }
    }
    const worker = new HeldWorker();
    const { c } = controller(worker);
    // A native rebuild queued behind `ready`, as a `mine` would be, before consent is withdrawn.
    c.reconfigure(4, PRESTO_DEFAULT, { force: true });
    c.revoke();
    expect(worker.sent.map((m) => m.type)).toEqual(['init', 'revoke']);
    worker.release?.();
    await tick();
    expect(worker.sent.map((m) => m.type).slice(0, 2)).toEqual(['init', 'revoke']);
    // What was queued is sent as consent stands now: no rebuild hands the Worker the endpoint again.
    expect(reconfigures(worker).length).toBeGreaterThan(0);
    expect(reconfigures(worker).every((m) => m.type === 'reconfigure' && m.presto === null)).toBe(true);
    expect(c.currentPresto).toBeNull();
    c.dispose();
  });
});

describe('reconfigure for Presto', () => {
  test('the same config posts nothing; force rebuilds; dropping the endpoint rebuilds on WASM', async () => {
    const worker = new FakeWorker();
    const { store, c } = controller(worker);
    await c.ready();
    expect(store.get(prestoAtom).selected).toBe('presto');
    c.reconfigure(2, PRESTO_DEFAULT);
    c.reconfigure(2, { ...PRESTO_DEFAULT });
    await tick();
    expect(reconfigures(worker)).toEqual([]);
    c.reconfigure(2, PRESTO_DEFAULT, { force: true });
    await tick();
    expect(reconfigures(worker)).toEqual([{ type: 'reconfigure', threads: 2, presto: PRESTO_DEFAULT }]);
    c.reconfigure(2, null);
    await tick();
    expect(reconfigures(worker)).toHaveLength(2);
    expect(c.currentPresto).toBeNull();
    expect(store.get(prestoAtom).selected).toBe('wasm');
    c.dispose();
  });

  test('a thread change while native is sticky posts nothing and rides the next browser build', async () => {
    const worker = new FakeWorker();
    const { c } = controller(worker);
    await c.ready();
    c.reconfigure(6);
    await tick();
    expect(reconfigures(worker)).toEqual([]);
    expect(c.currentThreads).toBe(6);
    // Presto dropped out: the browser prover is built with the threads kept meanwhile.
    c.reconfigure(c.currentThreads, null);
    await tick();
    expect(reconfigures(worker)).toEqual([{ type: 'reconfigure', threads: 6, presto: null }]);
    c.dispose();
  });

  test('a sticky fallback is the Worker’s verdict until a rebuild; Stop is counted', async () => {
    const worker = new FakeWorker();
    const { store, c } = controller(worker);
    await c.ready();
    worker.emit({ type: 'prover', kind: 'wasm', sticky: true, reason: 'denied' });
    expect(store.get(prestoAtom)).toMatchObject({ active: 'wasm', fallbackReason: 'denied' });
    c.reconfigure(2, PRESTO_DEFAULT, { force: true });
    await tick();
    expect(store.get(prestoAtom)).toMatchObject({
      selected: 'presto',
      active: null,
      fallbackReason: undefined,
    });
    expect(c.stopCount).toBe(0);
    c.stop();
    c.stop();
    expect(c.stopCount).toBe(2);
    c.dispose();
    expect(store.get(prestoAtom).selected).toBeNull();
  });
});

describe('consent at the Worker boundary', () => {
  test('nothing native is published or remembered without it; a revoke tells the Worker first; an invalid proof forgets', async () => {
    let allowed = true;
    const log: string[] = [];
    const hooks: ConsentHooks = {
      allowed: () => allowed,
      promote: () => void log.push('promote'),
      forget: () => void log.push('forget'),
    };
    const worker = new FakeWorker();
    const { store, c } = controller(worker, hooks);
    await c.ready();
    expect(store.get(prestoAtom).selected).toBe('presto');
    worker.emit({ type: 'native-verified' });
    expect(log).toEqual(['promote']);
    // Consent gone (another tab's revoke, say) before the Worker's messages land: none of them show.
    allowed = false;
    worker.emit({ type: 'native-verified' });
    worker.emit({ type: 'prover', kind: 'presto', sticky: false });
    worker.emit({ type: 'presto-phase', phase: 'downloading' });
    expect(log).toEqual(['promote']);
    expect(store.get(prestoAtom)).toMatchObject({ active: null, phase: undefined });
    worker.emit({ type: 'ready', threads: 2, initMs: 0, prover: 'presto' });
    expect(store.get(prestoAtom).selected).toBe('wasm');
    c.revoke();
    await tick();
    expect(worker.sent.slice(-2)).toEqual([
      { type: 'revoke' },
      { type: 'reconfigure', threads: 2, presto: null },
    ]);
    expect(c.currentPresto).toBeNull();
    // Consent back, but the Worker was never handed the endpoint again: still nothing native.
    allowed = true;
    worker.emit({ type: 'prover', kind: 'presto', sticky: false });
    expect(store.get(prestoAtom).active).toBeNull();
    worker.emit({ type: 'prover', kind: 'wasm', sticky: true, reason: 'invalid-proof' });
    expect(log).toEqual(['promote', 'forget']);
    c.dispose();
  });
});
