import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { anvil } from 'viem/chains';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createConfig, http } from 'wagmi';
import type { BridgeSession } from '../bridge/session';
import { INTRO_KEY, parseIntro } from '../intro';
import { Mine } from '../routes/Mine';
import type { Session } from '../session';
import { bootAtom, bridgeSessionAtom, mineIntentAtom, minerAtom, signInAtom } from '../state';
import { useIntroEnds } from './use-page-behaviour';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
});
// jsdom has no matchMedia; the score loop's reduced-motion hook reads it.
beforeEach(() =>
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })),
);

const READY = {
  phase: 'ready',
  account: '0xacc',
  threads: 1,
  record: {
    v: 1,
    id: 'k',
    method: 'words',
    createdAt: 0,
    askEveryOpen: false,
    backedUp: true,
    account: { address: '0xacc', index: 0 },
  },
} as const;

/** The cockpit as the page mounts it, with the hook that puts the strip away once mining runs. */
function Page({ onStart }: { onStart: () => void }) {
  useIntroEnds();
  return <Mine controller={() => undefined} onStart={onStart} />;
}

function mount(store = createStore(), onStart: () => void = vi.fn()) {
  render(
    <Provider store={store}>
      <Page onStart={onStart} />
    </Provider>,
  );
  return store;
}

const rows = () => screen.getByTestId('cockpit').className;

describe('the first visit’s strip', () => {
  test('shows on a first visit as the cockpit’s first row; its × puts it away for good', () => {
    mount();
    const strip = screen.getByTestId('intro');
    expect(strip.textContent).toContain('Yacana is private money, mined by proving.');
    expect(strip.textContent).toContain('mints 4 tYACA into an account only you can open');
    const how = screen.getByRole('link', { name: /How it works/ });
    expect([how.getAttribute('href'), how.getAttribute('target')]).toEqual(['/#how', '_blank']);
    expect(screen.getByTestId('cockpit').firstElementChild).toBe(strip);
    expect(rows()).toContain('xl:grid-rows-[auto_auto_auto_1fr]');
    fireEvent.click(screen.getByTestId('intro-dismiss'));
    expect(screen.queryByTestId('intro')).toBeNull();
    expect(rows()).toContain('xl:grid-rows-[auto_auto_1fr]');
    expect(JSON.parse(localStorage.getItem(INTRO_KEY) ?? 'null')).toEqual({ dismissed: true });
    cleanup();
    mount();
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  test('signed out, Start opens the sign-in with the intent and the strip stays until mining runs', () => {
    const store = createStore();
    store.set(bootAtom, { phase: 'signedOut', slot: { record: null, staged: null, revision: 0 } });
    const onStart = vi.fn();
    mount(store, onStart);
    fireEvent.click(screen.getByTestId('intro-start'));
    expect([store.get(signInAtom), store.get(mineIntentAtom), onStart.mock.calls.length]).toEqual([
      true,
      true,
      1,
    ]);
    expect(screen.getByTestId('intro')).toBeTruthy();
    act(() => store.set(minerAtom, { ...store.get(minerAtom), phase: 'mining' }));
    expect(screen.queryByTestId('intro')).toBeNull();
    expect(parseIntro(localStorage.getItem(INTRO_KEY))).toBe(true);
  });

  test('signed in, Start mines, and mining puts the strip away', () => {
    const store = createStore();
    store.set(bootAtom, READY);
    const onStart = vi.fn(() => store.set(minerAtom, { ...store.get(minerAtom), phase: 'mining' }));
    mount(store, onStart);
    fireEvent.click(screen.getByTestId('intro-start'));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  test('a storage that throws still shows it, and its × still puts it away on this page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mount();
    expect(screen.getByTestId('intro')).toBeTruthy();
    fireEvent.click(screen.getByTestId('intro-dismiss'));
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  test('only `{ dismissed: true }` dismisses', () => {
    expect([
      parseIntro(null),
      parseIntro('{"dismissed":"yes"}'),
      parseIntro('[true]'),
      parseIntro('not json'),
      parseIntro('{"dismissed":true}'),
    ]).toEqual([false, false, false, false, true]);
  });

  test('a dismissal in another tab puts it away here; a foreign value does not', () => {
    mount();
    const from = (newValue: string) =>
      act(() => void window.dispatchEvent(new StorageEvent('storage', { key: INTRO_KEY, newValue })));
    from('{"dismissed":"yes"}');
    expect(screen.getByTestId('intro')).toBeTruthy();
    from('{"dismissed":true}');
    expect(screen.queryByTestId('intro')).toBeNull();
  });
});

describe('the strip in the cockpit’s rows', () => {
  test('the strip, a notice and the upgrade card: each its own row before the one that takes the slack', () => {
    const now = Math.floor(Date.now() / 1000);
    vi.stubEnv(
      'VITE_MIGRATION',
      JSON.stringify({
        toIndex: '1',
        announcedAt: String(now - 86_400),
        expectedFlipAt: String(now + 2 * 86_400),
      }),
    );
    const store = createStore();
    store.set(bootAtom, READY);
    const config = createConfig({ chains: [anvil], transports: { [anvil.id]: http('http://127.0.0.1:9') } });
    store.set(bridgeSessionAtom, { config } as unknown as BridgeSession);
    store.set(minerAtom, {
      ...store.get(minerAtom),
      notice: { kind: 'offline', title: 'node away', body: '…' },
    });
    render(
      <Provider store={store}>
        <Mine controller={() => undefined} session={{} as Session} />
      </Provider>,
    );
    expect(screen.getByTestId('migration-card')).toBeTruthy();
    expect(rows()).toContain('xl:grid-rows-[auto_auto_auto_auto_auto_1fr]');
  });

  test('with a notice and the strip, each takes its own row before the one that takes the slack', () => {
    const store = createStore();
    store.set(minerAtom, {
      ...store.get(minerAtom),
      notice: { kind: 'offline', title: 'node away', body: '…' },
    });
    mount(store);
    expect(rows()).toContain('xl:grid-rows-[auto_auto_auto_auto_1fr]');
  });
});
