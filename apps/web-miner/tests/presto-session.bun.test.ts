// What the user's Start, Look and "use the browser" do about Presto, through the real probe against
// a fake whose answers this suite releases by hand, a consent record on a storage double shared by
// tabs, and a permission the suite settles when it likes. Nothing reaches the fake without consent.
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { createStore } from 'jotai';
import { type Lna, lnaAtom, type PrestoEndpoint, prestoAtom } from '../src/presto.ts';
import { type ConsentDeps, type ConsentLock, createConsent } from '../src/presto-consent.ts';
import { Session } from '../src/session.ts';
import { bootAtom } from '../src/state.ts';

/** A Presto that answers `/health` only when this suite says so, and counts every time it was asked. */
function heldPresto() {
  let holding = false;
  const waiting: (() => void)[] = [];
  let arrived: (() => void) | undefined;
  const state = { hits: 0 };
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch() {
      state.hits++;
      arrived?.();
      if (holding) await new Promise<void>((r) => waiting.push(r));
      return Response.json({
        status: 'ok',
        api_version: 1,
        schemes: ['chonk', 'ultra_honk'],
        version: '1.2.1',
        aztec_version: '6.0.0',
        bb_available: true,
      });
    },
  });
  const endpoint: PrestoEndpoint = {
    host: '127.0.0.1',
    port: Number(server.port),
    httpsPort: Number(server.port),
    httpsOnly: false,
  };
  return {
    server,
    endpoint,
    state,
    health: `http://127.0.0.1:${server.port}/health`,
    /** From here on `/health` waits; returns the next request's arrival and the release of every waiter. */
    hold() {
      holding = true;
      const request = new Promise<void>((r) => (arrived = r));
      return {
        request,
        answer() {
          holding = false;
          for (const r of waiting.splice(0)) r();
        },
      };
    },
  };
}

interface Recorded {
  threads: number;
  presto: PrestoEndpoint | null;
  force: boolean;
}

/** The controller as the session uses it for Presto: its Start, its Stop counter, what it was told. */
function fakeController(presto: PrestoEndpoint | null = null) {
  const calls: Recorded[] = [];
  const log: string[] = [];
  let stops = 0;
  let current = presto;
  return {
    calls,
    log,
    stop: () => stops++,
    current: () => current,
    controller: {
      start() {
        log.push('start');
      },
      get stopCount() {
        return stops;
      },
      get currentThreads() {
        return 4;
      },
      get currentPresto() {
        return current;
      },
      reconfigure(threads: number, next: PrestoEndpoint | null = current, o?: { force?: boolean }) {
        current = next;
        calls.push({ threads, presto: next, force: o?.force === true });
      },
      revoke() {
        current = null;
        log.push('revoke');
      },
    } as never,
  };
}

/** One origin's storage as its tabs see it (a write reaches the other tabs' listeners), with an optional held lock. */
function origin() {
  const map = new Map<string, string>();
  const tabs = new Set<Set<(key: string | null) => void>>();
  return {
    map,
    tab(lock?: ConsentLock): ConsentDeps {
      const me = new Set<(key: string | null) => void>();
      tabs.add(me);
      return {
        storage: {
          getItem: (k) => map.get(k) ?? null,
          setItem(k, v) {
            map.set(k, v);
            for (const other of tabs) if (other !== me) for (const cb of other) cb(k);
          },
        },
        lock,
        onStorage(cb) {
          me.add(cb);
          return () => me.delete(cb);
        },
      };
    },
  };
}

/** A permission the suite settles: `state` answers at once; `held` answers when released. */
function permission(state: Lna | 'held') {
  let release: ((s: PermissionState) => void) | undefined;
  const query = () =>
    state === 'held'
      ? new Promise<PermissionStatus>((r) => {
          release = (s) => r({ state: s, onchange: null } as unknown as PermissionStatus);
        })
      : Promise.resolve({ state, onchange: null } as unknown as PermissionStatus);
  return {
    permissions: { query } as Pick<Permissions, 'query'>,
    release: (s: PermissionState) => release?.(s),
  };
}

let fake: ReturnType<typeof heldPresto>;
beforeAll(() => {
  installNodeGuard();
  fake = heldPresto();
});
afterAll(() => {
  fake?.server.stop(true);
  uninstallNodeGuard();
});

function harness(o: { consent?: ConsentDeps; lna?: Lna | 'held' } = {}) {
  const store = createStore();
  const consent = createConsent(o.consent ?? { storage: null });
  const perm = permission(o.lna ?? 'granted');
  const session = new Session(store, { nodeUrl: 'x', miner: 'm', token: 't' } as never, {
    preflightImpl: async () => {
      store.set(bootAtom, { phase: 'signedOut', slot: { record: null, staged: null, revision: 0 } });
      return { publicEpoch: { start() {}, stop: async () => {} }, presto: fake.endpoint } as never;
    },
    consent,
    permissions: perm.permissions,
  });
  const c = fakeController();
  session.controller = c.controller;
  return { store, session, consent, c, perm };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('Start', () => {
  test('with nothing consented: mining starts at once, Presto is not asked, the Worker gets no endpoint', async () => {
    const { session, c, store } = harness();
    await session.ready;
    const before = fake.state.hits;
    session.startMining();
    expect(c.log).toEqual(['start']);
    await settle();
    expect(fake.state.hits).toBe(before);
    expect(c.calls).toEqual([]);
    expect(store.get(prestoAtom).status).toBeNull();
  });

  test('remembered: one probe under `granted`, none under `prompt`; a permission that never settles holds it without holding mining', async () => {
    const remembered = () => {
      const o = origin();
      o.map.set('yacana.presto', JSON.stringify({ used: true, rev: 0 }));
      return o.tab();
    };
    const granted = harness({ consent: remembered(), lna: 'granted' });
    await granted.session.ready;
    let before = fake.state.hits;
    granted.session.startMining();
    await settle();
    expect(fake.state.hits).toBe(before + 1);
    expect(granted.c.calls).toEqual([{ threads: 4, presto: fake.endpoint, force: false }]);

    const prompt = harness({ consent: remembered(), lna: 'prompt' });
    await prompt.session.ready;
    before = fake.state.hits;
    prompt.session.startMining();
    await settle();
    expect(fake.state.hits).toBe(before);
    expect(prompt.c.calls).toEqual([]);

    const held = harness({ consent: remembered(), lna: 'held' });
    await held.session.ready;
    before = fake.state.hits;
    held.session.startMining();
    expect(held.c.log).toEqual(['start']);
    await settle();
    expect(held.store.get(lnaAtom)).toBe('pending');
    expect(fake.state.hits).toBe(before);
    // Settling as `denied` releases nothing; the page reads it and the card can say blocked.
    held.perm.release('denied');
    await settle();
    expect(fake.state.hits).toBe(before);
    expect(held.c.calls).toEqual([]);
  });
});

describe('Look and "use the browser"', () => {
  test('a Look consents at the record’s revision and rebuilds with the endpoint; the page guard admits Presto until the browser is chosen', async () => {
    const { session, c, store, consent } = harness();
    await session.ready;
    await session.lookForPresto();
    expect(store.get(prestoAtom)).toMatchObject({ consentRev: 0, looking: false });
    expect(store.get(prestoAtom).status?.available).toBe(true);
    expect(session.consented()).toBe(true);
    expect(c.calls).toEqual([{ threads: 4, presto: fake.endpoint, force: true }]);
    expect((await fetch(fake.health)).status).toBe(200);
    const pending = session.chooseBrowser();
    // Synchronously: no consent, nothing native in the atom, the Worker told, the guard shut.
    expect(session.consented()).toBe(false);
    expect(store.get(prestoAtom)).toMatchObject({ consentRev: null, status: null, selected: null });
    expect(c.log).toEqual(['revoke']);
    expect(c.current()).toBeNull();
    await expect(fetch(fake.health)).rejects.toThrow(/blocked endpoint/);
    await pending;
    expect(consent.read()).toEqual({ used: false, rev: 1 });
    // A Start afterwards asks nothing: the click's consent is gone with the revision.
    const before = fake.state.hits;
    session.startMining();
    await settle();
    expect(fake.state.hits).toBe(before);
  });

  test('Look → use the browser → Look, the first look held: its late answer lands nowhere, the second consents anew', async () => {
    const { session, c, store } = harness();
    await session.ready;
    const held = fake.hold();
    const first = session.lookForPresto();
    await held.request;
    const gen = store.get(prestoAtom).gen;
    await session.chooseBrowser();
    expect(store.get(prestoAtom).gen).toBeGreaterThan(gen);
    const second = session.lookForPresto();
    await settle();
    expect(store.get(prestoAtom)).toMatchObject({ consentRev: 1, looking: true });
    held.answer();
    await Promise.all([first, second]);
    expect(store.get(prestoAtom)).toMatchObject({ consentRev: 1, looking: false });
    expect(store.get(prestoAtom).status?.available).toBe(true);
    // Two rebuilds with the endpoint would mean the first look's answer got through.
    expect(c.calls.filter((r) => r.presto !== null)).toHaveLength(1);
  });

  test('a Stop while the probe is out withdraws it: the answer changes nothing', async () => {
    const { session, c, store } = harness();
    await session.ready;
    const held = fake.hold();
    const look = session.lookForPresto();
    await held.request;
    c.stop();
    held.answer();
    await look;
    expect(store.get(prestoAtom).status?.available).toBe(true); // the answer is shown
    expect(c.calls).toEqual([]); // but the prover is left alone
  });

  test('two tabs: a revoke in one turns the other’s consent off at once and tears it down, click or memory alike', async () => {
    const o = origin();
    const a = harness({ consent: o.tab() });
    const b = harness({ consent: o.tab() });
    await Promise.all([a.session.ready, b.session.ready]);
    await b.session.lookForPresto();
    expect(b.session.consented()).toBe(true);
    expect(b.c.current()).toEqual(fake.endpoint);
    await a.session.chooseBrowser();
    expect(b.session.consented()).toBe(false);
    expect(b.c.log).toEqual(['revoke']);
    expect(b.c.current()).toBeNull();
    expect(b.store.get(prestoAtom).consentRev).toBeNull();
  });

  test('remembered, the probe out: a revoke from another tab before the answer, and the answer installs nothing', async () => {
    const o = origin();
    o.map.set('yacana.presto', JSON.stringify({ used: true, rev: 0 }));
    const a = harness({ consent: o.tab() });
    const b = harness({ consent: o.tab() });
    await Promise.all([a.session.ready, b.session.ready]);
    const held = fake.hold();
    b.session.startMining();
    await held.request;
    // Nothing native stands in B yet (no status, no endpoint, no click): the record alone moves.
    await a.session.chooseBrowser();
    expect(b.session.consented()).toBe(false);
    held.answer();
    await settle();
    expect(b.c.calls).toEqual([]);
    expect(b.c.current()).toBeNull();
    expect(b.store.get(prestoAtom).status).toBeNull();
  });

  test('a Look waiting on a promotion, the browser chosen meanwhile: the Look is dropped, nothing is asked', async () => {
    const o = origin();
    const grants: (() => void)[] = [];
    const lock: ConsentLock = (_n, fn) =>
      new Promise((resolve, reject) => grants.push(() => fn().then(resolve, reject)));
    const { session, c, store, consent } = harness({ consent: o.tab(lock) });
    await session.ready;
    const promotion = consent.promote(0); // held: the first write in the queue
    const look = session.lookForPresto(); // waits for it
    const chosen = session.chooseBrowser(); // the revoke queues behind it
    const before = fake.state.hits;
    grants.shift()?.(); // the promotion lands; the Look resumes under a revoke still pending
    await promotion;
    await settle();
    expect(fake.state.hits).toBe(before);
    expect(store.get(prestoAtom)).toMatchObject({ consentRev: null, looking: false });
    expect(session.consented()).toBe(false);
    grants.shift()?.();
    await Promise.all([look, chosen]);
    expect(consent.read()).toEqual({ used: false, rev: 1 });
    expect(c.calls).toEqual([]);
  });

  test('a held lock: the browser is chosen before the revoke commits; a Look meanwhile waits for it and consents at the new revision', async () => {
    const o = origin();
    o.map.set('yacana.presto', JSON.stringify({ used: true, rev: 3 }));
    let grant: (() => void) | undefined;
    const lock: ConsentLock = (_n, fn) =>
      new Promise((resolve, reject) => (grant = () => fn().then(resolve, reject)));
    const { session, c, store, consent } = harness({ consent: o.tab(lock) });
    await session.ready;
    expect(session.consented()).toBe(true);
    const revoking = session.chooseBrowser();
    expect(session.consented()).toBe(false);
    expect(c.log).toEqual(['revoke']);
    const before = fake.state.hits;
    session.startMining();
    await settle();
    expect(fake.state.hits).toBe(before);
    const look = session.lookForPresto();
    await settle();
    expect(fake.state.hits).toBe(before); // waiting on the revoke
    grant?.();
    await revoking;
    await look;
    expect(consent.read()).toEqual({ used: false, rev: 4 });
    expect(store.get(prestoAtom).consentRev).toBe(4);
    expect(fake.state.hits).toBe(before + 1);
  });
});
