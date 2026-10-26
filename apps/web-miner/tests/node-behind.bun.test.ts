// bun: a node the health store finds behind the rollup pauses mining with its own reason, and its
// catching up resumes it — the store's verdict is injected; what is checked is the controller's answer.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { resetNodeHealth, setHealthForTests } from '@yacana/web-kit/browser/node-health';
import { createStore } from 'jotai';
import type { Deployment, Fee } from '../src/chain.ts';
import { MinerController } from '../src/controller.ts';
import { minerAtom } from '../src/state.ts';
import type { FromWorker, ToWorker } from '../src/worker-protocol.ts';

beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

/** Consent as the controller tests need it: in force, with nothing to remember. */
const OPEN = { allowed: () => true, promote() {}, forget() {} };

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
const deployment = {
  node: { getL1Constants: async () => ({ slotDuration: 36, epochDuration: 32, proofSubmissionEpochs: 1 }) },
  miner: {
    address: AztecAddress.fromBigIntUnsafe(7n),
    methods: {
      open_epoch: () => sim(3n),
      epoch_params: () => sim({ target: 1n << 122n, seed: 7n, opened_at: 0n }),
      claims_in: () => sim(1n),
    },
  },
  token: { methods: { balance_of_private: () => sim(0n) } },
  lastSent: () => undefined,
} as unknown as Deployment;
const fee = {
  paymentMethod: { getAsset: () => undefined },
  gasSettings: { gasLimits: {} },
} as unknown as Fee;

const settle = async (done: () => boolean) => {
  for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(done()).toBe(true);
};

describe('a node behind the rollup', () => {
  beforeEach(resetNodeHealth);

  test('pauses mining with the behind notice; catching up clears the notice and resumes', async () => {
    const store = createStore();
    const worker = new FakeWorker();
    const controller = new MinerController({
      store,
      spawnWorker: () => worker as unknown as Worker,
      threads: 1,
      deployment,
      account: AztecAddress.fromBigIntUnsafe(11n),
      fee,
      chainId: 1n,
      rollupVersion: 1n,
      consent: OPEN,
    });
    await controller.ready();
    await controller.begin();
    controller.start();
    await settle(() => worker.sent.some((m) => m.type === 'mine'));
    expect(store.get(minerAtom).phase).toBe('mining');

    setHealthForTests({
      behind: true,
      tip: { block: 1, checkpoint: 1, timestamp: Date.now() / 1000 - 240, observedAt: Date.now() },
    });
    await settle(() => store.get(minerAtom).notice?.kind === 'behind');
    expect(store.get(minerAtom).phase).toBe('idle');
    expect(store.get(minerAtom).notice).toMatchObject({ kind: 'behind', title: 'node behind' });
    expect(store.get(minerAtom).notice?.body).toContain('its chain is 4 min old');

    setHealthForTests({ behind: false });
    await settle(() => store.get(minerAtom).phase === 'mining');
    expect(store.get(minerAtom).notice).toBeNull();
    expect(worker.sent.filter((m) => m.type === 'mine')).toHaveLength(2);
    controller.dispose();
  });
});
