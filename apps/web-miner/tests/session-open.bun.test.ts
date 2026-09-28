import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import { createStore } from 'jotai';
import type { Started } from '../src/boot.ts';
import { type Consent, createConsent } from '../src/presto-consent.ts';
import { Session } from '../src/session.ts';
import { bootAtom, type Endpoints, endpointsAtom, epochAtom, mineIntentAtom } from '../src/state.ts';

// The attempt bookkeeping (generation, cancel, supersession) with the ceremony and the wallet-level
// work both faked: the wallet's own stop-on-abort lives in startSession and is covered by the E2E.
const fakePre = () => {
  const calls = { start: 0, stop: 0, used: [] as string[] };
  const publicEpoch = { start: () => calls.start++, stop: () => calls.stop++, tick: async () => {} };
  let current = 'https://a.example/rpc';
  const switchable = {
    use: (url: string) => {
      calls.used.push(url);
      current = url;
    },
    current: () => current,
  };
  return { pre: { publicEpoch, switchable } as never, calls };
};

/** A Session whose preflight and startImpl are fakes; `runAttempt` is exercised through the real methods. */
function harness(startImpl: (...a: never[]) => Promise<Started>, consent?: Consent) {
  const store = createStore();
  const pre = fakePre();
  const session = new Session(store, { nodeUrl: 'x', miner: 'm', token: 't' } as never, {
    startImpl: startImpl as never,
    consent,
    preflightImpl: async () => {
      store.set(bootAtom, { phase: 'signedOut', slot: { record: null, staged: null, revision: 0 } });
      return pre.pre;
    },
  });
  return { store, session, pre };
}

const started = (dispose = () => {}): Started => ({
  controller: { dispose } as never,
  wallet: () => ({}) as never,
  threads: 4,
});

// A ceremony that resolves at once with a throwaway master and record.
const ceremony = () => ({
  record: { id: 'r', account: { address: `0x${'ab'.repeat(32)}`, index: 0 } } as never,
  master: new Uint8Array(32).fill(7),
});
// runAttempt is the internal the open methods share; exercise it directly with a controllable ceremony.
const runAttempt = (s: Session, c: () => unknown, label = 'passkey') =>
  (s as unknown as { runAttempt: (l: string, c: () => unknown) => Promise<void> }).runAttempt(label, c);

describe('a node switch around the attempt', () => {
  test('refused while an attempt is opening; the attempt is untouched', async () => {
    let releaseSteps: (() => void) | undefined;
    const { store, session } = harness(async (_s, _p, _c, _r, _m, opts: { signal: AbortSignal }) => {
      await new Promise<void>((r) => (releaseSteps = r));
      opts.signal.throwIfAborted();
      return started();
    });
    await session.ready;
    const run = runAttempt(session, ceremony);
    await new Promise((r) => setTimeout(r, 5));
    expect(store.get(bootAtom).phase).toBe('opening');
    await expect(session.switchNode('https://b.example/rpc')).rejects.toThrow(/an account is opening/);
    releaseSteps?.();
    await run;
    expect(store.get(bootAtom).phase).toBe('ready');
  });

  test('an attempt begun while a switch is in flight waits for it before its ceremony', async () => {
    let releaseDrain: (() => void) | undefined;
    const { store, session, pre } = harness(async () => started());
    await session.ready;
    // The poll's drain holds the switch open; the attempt must not open a wallet under it.
    (pre.pre as { publicEpoch: { stop: () => Promise<void> } }).publicEpoch.stop = () =>
      new Promise<void>((r) => {
        releaseDrain = r;
      });
    const switching = session.switchNode('https://b.example/rpc');
    await new Promise((r) => setTimeout(r, 5));
    let ceremonies = 0;
    const run = runAttempt(session, () => {
      ceremonies++;
      return ceremony();
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(ceremonies).toBe(0);
    expect(store.get(bootAtom).phase).toBe('opening');
    releaseDrain?.();
    await switching;
    await run;
    expect(ceremonies).toBe(1);
    expect(pre.calls.used).toEqual(['https://b.example/rpc']);
    expect(store.get(bootAtom).phase).toBe('ready');
  });

  test('the endpoints the views follow: switching while the swap runs, the node it ended on, an RPC change at once', async () => {
    const { store, session } = harness(async () => started());
    await session.ready;
    const seen: (Endpoints | null)[] = [];
    store.sub(endpointsAtom, () => seen.push(store.get(endpointsAtom)));
    await session.switchNode('https://b.example/rpc');
    await session.switchEthRpc('https://rpc-2.example/');
    expect(seen.map((e) => [e?.nodeUrl, e?.ethRpcUrl, e?.switching])).toEqual([
      ['https://a.example/rpc', undefined, true],
      ['https://b.example/rpc', undefined, false],
      ['https://b.example/rpc', 'https://rpc-2.example/', false],
    ]);
  });

  test('signed out, the public poll stops across the swap, the epoch is cleared, and it restarts on the new node', async () => {
    const { store, session, pre } = harness(async () => started());
    await session.ready;
    store.set(epochAtom, { epoch: 100n, seed: 0n, target: 1n << 122n, openedAt: 0n, claims: 1 });
    const before = { ...pre.calls };
    await session.switchNode('https://b.example/rpc');
    expect(pre.calls.used).toEqual(['https://b.example/rpc']);
    expect(pre.calls.stop).toBe(before.stop + 1);
    expect(pre.calls.start).toBe(before.start + 1);
    expect(store.get(epochAtom)).toBeNull();
  });
});

describe('the opening attempt', () => {
  test('a cancel after the ceremony ends in signedOut with no error and zeros the master', async () => {
    let releaseSteps: (() => void) | undefined;
    let seenSignal: AbortSignal | undefined;
    const master = new Uint8Array(32).fill(7);
    const { store, session, pre } = harness(async (_s, _p, _c, _r, _m, opts: { signal: AbortSignal }) => {
      seenSignal = opts.signal;
      await new Promise<void>((r) => (releaseSteps = r));
      opts.signal.throwIfAborted();
      return started();
    });
    await session.ready;
    const run = runAttempt(session, () => ({ record: ceremony().record, master }));
    await new Promise((r) => setTimeout(r, 5));
    expect(store.get(bootAtom).phase).toBe('opening');
    const cancel = session.cancelOpening();
    releaseSteps?.(); // the steps settle; the signal is now aborted
    await Promise.all([run, cancel]);
    expect(seenSignal?.aborted).toBe(true);
    expect(store.get(bootAtom).phase).toBe('signedOut');
    expect((store.get(bootAtom) as { error?: string }).error).toBeUndefined();
    expect(pre.calls.start).toBe(1); // the epoch is handed back to the public poll
    expect(Array.from(master)).toEqual(Array.from(new Uint8Array(32))); // zeroed
  });

  test('a dismissal during the ceremony is inert; Cancel works once it is over', async () => {
    let finishCeremony: (() => void) | undefined;
    let releaseSteps: (() => void) | undefined;
    const { store, session } = harness(async (_s, _p, _c, _r, _m, opts: { signal: AbortSignal }) => {
      await new Promise<void>((r) => (releaseSteps = r));
      opts.signal.throwIfAborted();
      return started();
    });
    await session.ready;
    const run = runAttempt(session, async () => {
      await new Promise<void>((r) => (finishCeremony = r));
      return ceremony();
    });
    await new Promise((r) => setTimeout(r, 5));
    await session.cancelOpening(); // during the ceremony: a no-op
    expect(store.get(bootAtom).phase).toBe('opening');
    finishCeremony?.();
    await new Promise((r) => setTimeout(r, 5));
    const cancel = session.cancelOpening(); // after it: aborts
    releaseSteps?.();
    await Promise.all([run, cancel]);
    expect(store.get(bootAtom).phase).toBe('signedOut');
  });

  test('a newer attempt aborts its predecessor and waits it out; the predecessor publishes nothing', async () => {
    const signals: AbortSignal[] = [];
    let call = 0;
    const { store, session } = harness(async (_s, _p, _c, _r, _m, opts: { signal: AbortSignal }) => {
      call++;
      signals.push(opts.signal);
      if (call === 1) {
        // The predecessor honours the signal between its steps, as startSession does.
        await new Promise<void>((resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
          setTimeout(resolve, 60_000);
        });
      }
      return started();
    });
    await session.ready;
    const first = runAttempt(session, ceremony);
    await new Promise((r) => setTimeout(r, 5));
    const second = runAttempt(session, ceremony); // aborts the first and waits for its cleanup
    await Promise.all([first, second]);
    expect(signals[0]?.aborted).toBe(true);
    expect(call).toBe(2); // one PXE at a time: the second began only after the first ended
    expect(store.get(bootAtom).phase).toBe('ready'); // the second won, the first published no signedOut
  });

  test('a cancel that lands as the last step settles disposes the returned controller and stops its wallet', async () => {
    let release: (() => void) | undefined;
    let disposed = false;
    let stopped = false;
    const { store, session } = harness(async () => {
      await new Promise<void>((r) => (release = r));
      // Resolves anyway: the abort landed after the last signal check, as it can after begin().
      return {
        controller: {
          dispose: () => {
            disposed = true;
          },
        } as never,
        wallet: () =>
          ({
            stop: async () => {
              stopped = true;
            },
          }) as never,
        threads: 4,
      };
    });
    await session.ready;
    const run = runAttempt(session, ceremony);
    await new Promise((r) => setTimeout(r, 5));
    const cancel = session.cancelOpening();
    release?.();
    await Promise.all([run, cancel]);
    expect(store.get(bootAtom).phase).toBe('signedOut');
    expect(disposed).toBe(true);
    expect(stopped).toBe(true);
  });

  test('the wallet is stopped before the cancel resolves and before signed out is published', async () => {
    let release: (() => void) | undefined;
    let stopped = false;
    let phaseWhenStopped: string | undefined;
    const { store, session } = harness(async () => {
      await new Promise<void>((r) => (release = r));
      return {
        controller: { dispose: () => {} } as never,
        wallet: () =>
          ({
            stop: async () => {
              await new Promise((r) => setTimeout(r, 30)); // a slow shutdown
              phaseWhenStopped = store.get(bootAtom).phase;
              stopped = true;
            },
          }) as never,
        threads: 4,
      };
    });
    await session.ready;
    const run = runAttempt(session, ceremony);
    await new Promise((r) => setTimeout(r, 5));
    const cancel = session.cancelOpening();
    release?.();
    await cancel;
    expect(stopped).toBe(true); // the cancel waited for the shutdown
    expect(phaseWhenStopped).toBe('opening'); // and signed out was published only after it
    await run;
    expect(store.get(bootAtom).phase).toBe('signedOut');
  });

  test('a queued attempt superseded while it waited never runs its ceremony', async () => {
    const prompted: string[] = [];
    let releaseA: (() => void) | undefined;
    let call = 0;
    const { store, session } = harness(async (_s, _p, _c, _r, _m, opts: { signal: AbortSignal }) => {
      // Only the first attempt's steps wait; a later one resolves at once.
      if (++call === 1)
        await new Promise<void>((resolve, reject) => {
          releaseA = resolve;
          opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
        });
      return started();
    });
    await session.ready;
    const a = runAttempt(session, () => {
      prompted.push('a');
      return ceremony();
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = runAttempt(session, () => {
      prompted.push('b'); // must never happen: c supersedes b while b waits on a
      return ceremony();
    });
    const c = runAttempt(session, () => {
      prompted.push('c');
      return ceremony();
    });
    releaseA?.();
    await Promise.all([a, b, c]);
    expect(prompted).toEqual(['a', 'c']);
    expect(store.get(bootAtom).phase).toBe('ready');
  });

  test('a failure (not a cancel) shows signedOut with the error', async () => {
    const { store, session } = harness(async () => {
      throw new Error('the node did not answer the first read');
    });
    await session.ready;
    await runAttempt(session, ceremony);
    const boot = store.get(bootAtom) as { phase: string; error?: { message: string } };
    expect(boot.phase).toBe('signedOut');
    expect(boot.error?.message).toMatch(/did not answer/);
  });
});

describe('consent during the opening', () => {
  test('a revoke while the account opens reaches the controller at adoption: the revoke lands before its first start, which is local', async () => {
    const map = new Map([['yacana.presto', JSON.stringify({ used: true, rev: 0 })]]);
    const consent = createConsent({
      storage: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) },
    });
    let release: (() => void) | undefined;
    const log: string[] = [];
    let presto: unknown = { host: '127.0.0.1', port: 1, httpsPort: 1, httpsOnly: false };
    // The controller startSession built with the endpoint consent allowed at the time.
    const controller = {
      dispose() {},
      start: () => log.push(presto ? 'start-native' : 'start-local'),
      revoke() {
        presto = null;
        log.push('revoke');
      },
      get currentPresto() {
        return presto;
      },
      get stopCount() {
        return 0;
      },
    };
    const { store, session } = harness(async () => {
      await new Promise<void>((r) => (release = r));
      return { controller, wallet: () => ({}), threads: 4 } as never;
    }, consent);
    await session.ready;
    expect(session.consented()).toBe(true);
    store.set(mineIntentAtom, true);
    const run = runAttempt(session, ceremony);
    await new Promise((r) => setTimeout(r, 5));
    // The session has no controller yet: the record moves, nothing native is there to tear down.
    await consent.revoke();
    expect(session.consented()).toBe(false);
    release?.();
    await run;
    expect(store.get(bootAtom).phase).toBe('ready');
    expect(log).toEqual(['revoke', 'start-local']);
  });
});
