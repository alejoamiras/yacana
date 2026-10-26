import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type ChainSink, markUnreachable, type Reads, readAll } from './chain';
import type { Launch, Live, Reader } from './live';
import type { LaunchStatus, LiveStatus } from './state';

// web-kit's fetch guard, held for this suite alone: later suites in the run get the realm's fetch back.
beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

const reader = {} as Reader;
const launch: Launch = { genesis: { target: 1n, seed: 0n, launchAt: 0 }, lottery: { mix: 0n, reveals: 0 } };
const live = { rows: [], open: 0 } as unknown as Live;

/** A sink that applies updaters like React's state setter. */
function stateSink() {
  const state: { live: LiveStatus; launch: LaunchStatus } = {
    live: { phase: 'loading' },
    launch: { phase: 'loading' },
  };
  const sink: ChainSink = {
    live: (s) => {
      state.live = typeof s === 'function' ? s(state.live) : s;
    },
    launch: (s) => {
      state.launch = typeof s === 'function' ? s(state.launch) : s;
    },
  };
  return { state, sink };
}

describe('readAll', () => {
  test('launch mode reads the lottery on its own; the live read waits for launch()', async () => {
    const seen: string[] = [];
    const { state, sink } = stateSink();
    const spy: ChainSink = {
      live: (s) => {
        sink.live(s);
        seen.push(`live:${state.live.phase}`);
      },
      launch: (s) => {
        sink.launch(s);
        seen.push(`launch:${state.launch.phase}`);
      },
    };
    const reads: Reads = {
      live: async () => {
        seen.push('readLive');
        return live;
      },
      launch: async () => launch,
      launched: async () => false,
    };
    await readAll(reader, spy, true, reads);
    expect(seen).toEqual(['launch:ready', 'live:unlaunched']);
    seen.length = 0;
    await readAll(reader, spy, true, { ...reads, launched: async () => true });
    expect(seen).toEqual(['launch:ready', 'readLive', 'live:ready']);
    seen.length = 0;
    await readAll(reader, spy, false, reads);
    expect(seen).toEqual(['readLive', 'live:ready']);
  });

  test('a failed poll marks what was read stale, the lottery included; the next read clears it', async () => {
    const { state, sink } = stateSink();
    const reads: Reads = { live: async () => live, launch: async () => launch, launched: async () => false };
    await readAll(reader, sink, true, reads);
    expect(state).toMatchObject({
      live: { phase: 'unlaunched' },
      launch: { phase: 'ready', unreachable: false },
    });
    markUnreachable(sink);
    expect(state.launch).toMatchObject({ phase: 'ready', unreachable: true });
    await readAll(reader, sink, true, reads);
    expect(state.launch).toMatchObject({ phase: 'ready', unreachable: false });
  });
});
