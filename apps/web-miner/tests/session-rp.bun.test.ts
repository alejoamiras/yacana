import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { createStore } from 'jotai';
import { DB_NAME, type MasterRecord, putRecord } from '../src/keys/store.ts';
import { Session } from '../src/session.ts';
import { bootAtom } from '../src/state.ts';

beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

// The fake IndexedDB is one per process: the slot another file left behind would refuse a create here.
const reset = () =>
  new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => resolve();
  });

// The ceremonies are faked to capture their options and stop the attempt there.
const RP = 'yacana.network';
const SUFFIX = '-yacana.alejo-amiras.workers.dev';
const PREVIEW = `feature-x${SUFFIX}`;
const STOP = new Error('ceremony reached');

const env = {
  VITE_RP_ID: process.env.VITE_RP_ID,
  VITE_PREVIEW_HOST_SUFFIX: process.env.VITE_PREVIEW_HOST_SUFFIX,
};
const savedLocation = globalThis.location;

beforeEach(async () => {
  process.env.VITE_RP_ID = RP;
  process.env.VITE_PREVIEW_HOST_SUFFIX = SUFFIX;
  await reset();
});
afterEach(() => {
  // Assigning undefined to process.env stores the string "undefined": absent variables are deleted instead.
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  Object.defineProperty(globalThis, 'location', { value: savedLocation, configurable: true, writable: true });
});

const serveFrom = (hostname: string) =>
  Object.defineProperty(globalThis, 'location', { value: { hostname }, configurable: true, writable: true });

function harness() {
  const store = createStore();
  const seen = { create: [] as string[], assert: [] as string[] };
  const session = new Session(store, { nodeUrl: 'x', miner: 'm', token: 't' } as never, {
    startImpl: (async () => {
      throw new Error('never reached');
    }) as never,
    preflightImpl: async () => {
      store.set(bootAtom, { phase: 'signedOut', slot: { record: null, staged: null, revision: 0 } });
      return {
        publicEpoch: { start() {}, stop() {}, tick: async () => {} },
        switchable: { use() {}, current: () => 'https://a.example/rpc' },
      } as never;
    },
    createPasskey: async (o) => {
      seen.create.push(o.rpId);
      throw STOP;
    },
    assertPasskey: async (o) => {
      seen.assert.push(o.rpId);
      throw STOP;
    },
  });
  return { store, session, seen };
}

/** Unsealed, so `open()` reaches WebAuthn instead of the device key. */
const knownPasskey: MasterRecord = {
  v: 1,
  id: 'k',
  method: 'passkey',
  createdAt: 1,
  credentialId: 'AQID',
  askEveryOpen: true,
  backedUp: false,
  account: { address: `0x${'ab'.repeat(32)}`, index: 0 },
};

const failure = (store: ReturnType<typeof createStore>) => {
  const boot = store.get(bootAtom);
  return boot.phase === 'signedOut' ? boot.error?.message : `phase ${boot.phase}`;
};

describe('the relying party the session hands to WebAuthn', () => {
  test('on a preview, the preview host itself, for creation, a known record and restore', async () => {
    serveFrom(PREVIEW);
    const { store, session, seen } = harness();
    await session.ready;
    await session.createWithPasskey();
    expect(failure(store)).toBe(STOP.message);
    await session.restoreWithPasskey();
    // A record on the device takes the slot: Welcome's open reaches the ceremony for it.
    await putRecord(knownPasskey);
    await session.open(knownPasskey);
    expect(seen.create).toEqual([PREVIEW]);
    expect(seen.assert).toEqual([PREVIEW, PREVIEW]);
  });

  test('in production, the pinned RP ID', async () => {
    serveFrom(RP);
    const { session, seen } = harness();
    await session.ready;
    await session.createWithPasskey();
    await session.restoreWithPasskey();
    expect(seen.create).toEqual([RP]);
    expect(seen.assert).toEqual([RP]);
  });

  test('on an unknown host, creation and restore stop at the guard: no ceremony, no derivation', async () => {
    serveFrom('x-yacana.other.workers.dev');
    const { store, session, seen } = harness();
    await session.ready;
    await session.createWithPasskey();
    expect(failure(store)).toMatch(/cannot be created or restored on this host. Open yacana.network/);
    await session.restoreWithPasskey();
    expect(failure(store)).toMatch(/cannot be created or restored/);
    expect(() => session.newWords()).toThrow(/cannot be created or restored/);
    await session.restoreWithWords(`${'abandon '.repeat(11)}about`);
    expect(failure(store)).toMatch(/cannot be created or restored/);
    expect(seen.create).toEqual([]);
    expect(seen.assert).toEqual([]);
  });
});
