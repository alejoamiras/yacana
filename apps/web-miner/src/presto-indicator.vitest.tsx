import { cleanup, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Shell } from './App';
import { initial } from './lib/reducer';
import { initialPresto, prestoAtom } from './presto';
import { Mine } from './routes/Mine';
import { bootAtom, epochAtom, minerAtom, nowAtom, rulesAtom } from './state';

afterEach(cleanup);
beforeEach(() =>
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })),
);

const mining = () => {
  const store = createStore();
  store.set(minerAtom, {
    ...initial,
    phase: 'mining',
    recent: [840, 850],
    proofs: 12,
    samples: [{ t: 0, score: 1.2 }],
    since: 1_699_999_970_000,
    sinceT: 0,
  });
  store.set(bootAtom, {
    phase: 'ready',
    account: '0x1',
    threads: 11,
    record: {
      v: 1,
      id: 'r',
      method: 'words',
      createdAt: 0,
      askEveryOpen: false,
      backedUp: true,
      account: { address: '0x1', index: 0 },
    },
  });
  store.set(epochAtom, { epoch: 71n, seed: 7n, target: 1n << 122n, openedAt: 0n, claims: 3 });
  store.set(rulesAtom, { N: 4, EXPECTED_EPOCH_SECONDS: 300n, T_MAX: 1200n, REWARD: 4n * 10n ** 18n });
  store.set(nowAtom, 1_700_000_000_000);
  return store;
};

describe('the native indicator', () => {
  test('the pill gains ✦ presto only while a native proof is what proved last; it drops with the WASM message', () => {
    const store = mining();
    store.set(prestoAtom, { ...initialPresto, selected: 'presto', active: null });
    const { rerender } = render(
      <Provider store={store}>
        <Shell>
          <p />
        </Shell>
      </Provider>,
    );
    // Selected is not proved: nothing yet.
    expect(screen.getByTestId('phase').textContent).toBe('mining');
    expect(screen.queryByTestId('native')).toBeNull();
    store.set(prestoAtom, { ...initialPresto, selected: 'presto', active: 'presto' });
    rerender(
      <Provider store={store}>
        <Shell>
          <p />
        </Shell>
      </Provider>,
    );
    expect(screen.getByTestId('native').textContent).toContain('presto');
    expect(screen.getByTestId('phase').getAttribute('data-prover')).toBe('presto');
    store.set(prestoAtom, { ...initialPresto, selected: 'presto', active: 'wasm', fallbackReason: 'denied' });
    rerender(
      <Provider store={store}>
        <Shell>
          <p />
        </Shell>
      </Provider>,
    );
    expect(screen.queryByTestId('native')).toBeNull();
    expect(screen.getByTestId('phase').getAttribute('data-prover')).toBe('wasm');
  });

  test("the footer's ✦ follows what proved; the epoch tile's Presto card replaces the slider on the sticky state alone", () => {
    const store = mining();
    // Consented by this page's click at the record's revision (the page has no record: revision 0).
    const consented = { ...initialPresto, consentRev: 0 };
    store.set(prestoAtom, { ...consented, selected: 'presto', active: 'presto' });
    const { rerender } = render(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    const again = () =>
      rerender(
        <Provider store={store}>
          <Mine controller={() => undefined} />
        </Provider>,
      );
    expect(screen.getByTestId('rate-line').textContent).toBe('0.8 s per proof · ✦ presto · 12 proofs');
    expect(screen.getByTestId('presto-card').dataset.standing).toBe('proving');
    expect(screen.getByTestId('presto-card').textContent).toContain('proving on this machine');
    expect(screen.getByRole('link', { name: /About Presto/ }).getAttribute('href')).toBe(
      'https://presto.build',
    );
    expect(screen.queryByRole('slider')).toBeNull();
    // A win's claim is still Presto's work: the card does not fall back to "proves when you start".
    store.set(minerAtom, { ...store.get(minerAtom), phase: 'claiming' });
    again();
    expect(screen.getByTestId('presto-card').dataset.standing).toBe('proving');
    expect(screen.queryByRole('slider')).toBeNull();
    store.set(minerAtom, { ...store.get(minerAtom), phase: 'mining' });
    // One refused proof: the footer drops its ✦, the row stays (the Worker has not given up on native).
    store.set(prestoAtom, { ...consented, selected: 'presto', active: 'wasm' });
    again();
    expect(screen.getByTestId('rate-line').textContent).toBe('0.8 s per proof · 12 proofs');
    expect(screen.getByTestId('presto-card').dataset.standing).toBe('proving');
    // The Worker's sticky verdict: the slider and its line are back, the card says what happened.
    store.set(prestoAtom, {
      ...consented,
      status: { available: true, needsDownload: false, schemes: ['ultra_honk'], protocol: 'https' },
      selected: 'presto',
      active: 'wasm',
      fallbackReason: 'denied',
    });
    again();
    expect(screen.getByTestId('presto-card').dataset.standing).toBe('absent');
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByTestId('power-caption').textContent).toContain('one stays with the page');
    // The header names the window from the start until it is three minutes old.
    expect(screen.getByTestId('loop-window').textContent).toBe('live · since 22:12');
  });
});

describe('the slider beside Presto', () => {
  test('found under consent, not mining yet: the slider leaves at once and the card says who decides; absent brings it back', () => {
    const store = mining();
    store.set(minerAtom, { ...store.get(minerAtom), phase: 'idle' });
    const consented = { ...initialPresto, consentRev: 0 };
    const eligible = {
      available: true,
      needsDownload: false,
      schemes: ['ultra_honk'],
      protocol: 'https',
    } as const;
    store.set(prestoAtom, { ...consented, status: eligible });
    const { rerender } = render(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    expect(screen.getByTestId('presto-card').dataset.standing).toBe('found');
    expect(screen.getByTestId('presto-card').textContent).toContain(
      'proves when you start · its own speed setting decides',
    );
    expect(screen.queryByRole('slider')).toBeNull();
    store.set(prestoAtom, {
      ...consented,
      status: { available: false, reason: 'offline' },
    });
    rerender(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    expect(screen.getByTestId('presto-card').dataset.standing).toBe('absent');
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(false);
  });
});
