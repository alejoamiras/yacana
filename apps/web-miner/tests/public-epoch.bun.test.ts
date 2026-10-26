import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { createStore } from 'jotai';
import type { EpochInfo } from '../src/lib/reducer.ts';
import { startPublicEpoch } from '../src/public-epoch.ts';
import { epochAtom } from '../src/state.ts';

// web-kit's fetch guard, held for this suite alone: later suites in the run get the realm's fetch back.
beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

const info = (epoch: number, claims = 0): EpochInfo => ({
  epoch: BigInt(epoch),
  seed: 7n,
  target: 1n << 122n,
  openedAt: 1_000n,
  claims,
});

describe('the public epoch poll', () => {
  test('fills the atom, keeps the claims fresh, never regresses the epoch, stops on handover', async () => {
    const store = createStore();
    const answers = [info(38, 1), info(38, 2), info(37, 4), info(39, 0)];
    const poll = startPublicEpoch(store, async () => answers.shift() ?? info(99), { intervalMs: 60_000 });
    poll.start();
    await poll.tick(); // the read start() put out
    expect(store.get(epochAtom)).toMatchObject({ epoch: 38n, claims: 1 });
    await poll.tick();
    expect(store.get(epochAtom)).toMatchObject({ epoch: 38n, claims: 2 });
    await poll.tick(); // an older epoch than shown: dropped
    expect(store.get(epochAtom)).toMatchObject({ epoch: 38n, claims: 2 });
    poll.stop(); // the controller takes the atom
    store.set(epochAtom, info(40, 1));
    await poll.tick(); // stopped: no read, no write
    expect(answers).toHaveLength(1);
    expect(store.get(epochAtom)).toMatchObject({ epoch: 40n, claims: 1 });
  });

  test('stop() resolves once the read out has settled, and a restart reads afresh', async () => {
    const store = createStore();
    let release: ((v: EpochInfo) => void) | undefined;
    let reads = 0;
    const poll = startPublicEpoch(
      store,
      () => {
        reads++;
        return new Promise<EpochInfo>((r) => {
          release = r;
        });
      },
      { intervalMs: 60_000 },
    );
    poll.start(); // read 1 is out
    let stopped = false;
    const stopping = poll.stop().then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(stopped).toBe(false); // the read is still out: a switch waits here
    release?.(info(38, 1));
    await stopping;
    expect(store.get(epochAtom)).toBeNull(); // it belonged to the stopped generation
    poll.start(); // a fresh read, not the settled one
    expect(reads).toBe(2);
    release?.(info(39, 0));
    await poll.tick();
    expect(store.get(epochAtom)).toMatchObject({ epoch: 39n });
    await poll.stop();
  });

  test('stop() drains a read left out by an earlier stop that nobody awaited', async () => {
    const store = createStore();
    const releases: ((v: EpochInfo) => void)[] = [];
    const poll = startPublicEpoch(
      store,
      () =>
        new Promise<EpochInfo>((r) => {
          releases.push(r);
        }),
      { intervalMs: 60_000 },
    );
    poll.start(); // read 1 out
    void poll.stop(); // the handover: not awaited
    poll.start(); // read 2 out
    expect(releases).toHaveLength(2);
    releases[1]?.(info(40, 0));
    await poll.tick(); // read 2 lands (this run's)
    let drained = false;
    const stopping = poll.stop().then(() => {
      drained = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(drained).toBe(false); // read 1 is still out
    releases[0]?.(info(38, 0));
    await stopping;
    expect(store.get(epochAtom)).toMatchObject({ epoch: 40n });
  });

  test('a read that was out when the poll stopped writes nothing', async () => {
    const store = createStore();
    let release: (() => void) | undefined;
    const poll = startPublicEpoch(
      store,
      () =>
        new Promise<EpochInfo>((r) => {
          release = () => r(info(38, 3));
        }),
      { intervalMs: 60_000 },
    );
    poll.start();
    const first = poll.tick();
    poll.stop();
    store.set(epochAtom, info(41, 0));
    release?.();
    await first;
    expect(store.get(epochAtom)).toMatchObject({ epoch: 41n, claims: 0 });
  });
});
