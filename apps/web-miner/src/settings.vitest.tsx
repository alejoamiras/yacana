import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@yacana/ui';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Connection } from './config';
import { initialPresto, prestoAtom } from './presto';
import { CONSENT_KEY } from './presto-consent';
import { Settings } from './routes/Settings';
import type { Session } from './session';
import { bootAtom } from './state';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.removeItem(CONSENT_KEY);
});
// jsdom has no matchMedia; the theme provider reads it for `system`.
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubEnv('VITE_SOURCE_COMMIT', '0d9d1ea1db43abcdef');
  vi.stubEnv('VITE_SITE_MODE', 'e2e');
  vi.stubEnv('VITE_BB_VERSION', '5.2.0');
  vi.stubEnv('VITE_AZTEC_NODE_URL', 'https://node.example/rpc');
});

const connection: Connection = {
  nodeUrl: 'https://node.example/rpc',
  ethRpcUrl: '',
  miner: '0x1',
  token: '0x2',
  firstEpoch: 0,
};

const session = () =>
  ({
    nodeUrl: 'https://node.example/rpc',
    ethRpcUrl: '',
    probeNode: vi.fn(),
    switchNode: vi.fn(),
    setStayOpen: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    lookForPresto: vi.fn(async () => {}),
    chooseBrowser: vi.fn(async () => {}),
  }) as unknown as Session;

function mount(signedIn: boolean, store = createStore()) {
  if (signedIn)
    store.set(bootAtom, {
      phase: 'ready',
      account: '0x22a9db0000000000000000000000000000000000000000000000000000000612a',
      threads: 11,
      record: {
        v: 1,
        id: 'r',
        method: 'passkey',
        createdAt: 0,
        askEveryOpen: true,
        backedUp: true,
        account: { address: '0x22a9db0000000000000000000000000000000000000000000000000000000612a', index: 0 },
      },
    });
  return render(
    <Provider store={store}>
      <ThemeProvider defaultTheme="dark">
        <Settings connection={connection} controller={() => undefined} session={session()} />
      </ThemeProvider>
    </Provider>,
  );
}

describe('Settings', () => {
  test('the six sections in order, Presto’s card asking before the slider, the slider’s sentence, the about line; no diagnostics', () => {
    const { container } = mount(true);
    const headers = Array.from(container.querySelectorAll('[data-slot=tile-header]')).map(
      (h) => h.firstElementChild?.textContent,
    );
    expect(headers).toEqual(['network', 'mining', 'alerts', 'account', 'appearance', 'about']);
    const card = screen.getByTestId('presto-card');
    expect(card.getAttribute('data-standing')).toBe('ask');
    expect(
      card.compareDocumentPosition(screen.getByRole('slider')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(false);
    expect(screen.getByLabelText('browser threads')).toBe(screen.getByRole('slider'));
    expect(screen.getByTestId('power-note').textContent).toBe(
      'This slider affects browser proving only; one core stays with the page.',
    );
    expect(screen.getByTestId('presto-get').getAttribute('href')).toBe('https://presto.build');
    expect(screen.getByTestId('about-line').textContent).toContain(
      'Yacana runs in your browser. Whoever serves this page controls it; the source is public — run your own build if that matters.',
    );
    expect(screen.queryByTestId('copy-diagnostics')).toBeNull();
    expect(screen.getByTestId('node-chip')).toBeTruthy();
  });

  test('the account: address, method, Stay open with its two sentences, Sign out opens the hold dialog', () => {
    mount(true);
    expect(screen.getByTestId('settings-account').textContent).toBe('0x22a9db…612a');
    expect(screen.getByText('passkey')).toBeTruthy();
    const stay = screen.getByRole('switch', { name: /Stay open on this device/ });
    expect(stay.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/On: anyone who can use this browser could open and spend/).textContent).toBe(
      'On: anyone who can use this browser could open and spend from this account without your passkey. Off: one touch per open.',
    );
    fireEvent.click(screen.getByTestId('sign-out'));
    expect(screen.getByTestId('sign-out-dialog')).toBeTruthy();
  });

  test('the old origin: the node reports but is not a setting, no mining or alerts, the account beside the apex', () => {
    vi.stubEnv('VITE_APP_ROLE', 'old');
    vi.stubEnv('VITE_ROLLUP_VERSION', '5');
    vi.stubEnv('VITE_RP_ID', 'yacana.network');
    // A node pinned by the page URL reads as custom: read-only offers no way back to the default either.
    vi.stubEnv('VITE_AZTEC_NODE_URL', 'https://default.example/rpc');
    const { container } = mount(true);
    const headers = Array.from(container.querySelectorAll('[data-slot=tile-header]')).map(
      (h) => h.firstElementChild?.textContent,
    );
    expect(headers).toEqual(['network', 'account', 'appearance', 'about']);
    expect(screen.getByTestId('node-row')).toBeTruthy();
    expect(screen.queryByTestId('node-change')).toBeNull();
    expect(screen.getByTestId('node-row').textContent).toContain('custom');
    expect(screen.queryByTestId('node-default')).toBeNull();
    expect(screen.getByText('passkey · the same account as yacana.network')).toBeTruthy();
    expect(container.textContent).toContain('this origin');
    expect(screen.getByTestId('about-line').textContent).toContain(
      'The old app, kept so what is still on V5 can leave.',
    );
  });

  test('signed out: the way in, and the node row still there', () => {
    mount(false);
    expect(screen.getByTestId('sign-in-settings')).toBeTruthy();
    expect(screen.queryByTestId('sign-out')).toBeNull();
    expect(screen.getByTestId('node-row')).toBeTruthy();
  });

  test('Presto remembered: the card says so, the slider is shown but not in force, its sentence says why', () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ used: true, rev: 0 }));
    mount(true);
    expect(screen.getByTestId('presto-card').getAttribute('data-standing')).toBe('remembered');
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('power-note').textContent).toBe(
      'Not in use while Presto proves; Presto’s own speed setting decides. Yacana falls back to these threads if Presto drops out.',
    );
  });
});

describe('Settings: Presto found, and the mini window', () => {
  test('Presto found by this page’s click: the slider locks with its sentence at once; absent unlocks it', () => {
    const store = createStore();
    const eligible = {
      available: true,
      needsDownload: false,
      schemes: ['ultra_honk'],
      protocol: 'https',
    } as const;
    store.set(prestoAtom, { ...initialPresto, consentRev: 0, status: eligible });
    const { rerender } = mount(true, store);
    expect(screen.getByTestId('presto-card').getAttribute('data-standing')).toBe('found');
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('power-note').textContent).toBe(
      'Not in use while Presto proves; Presto’s own speed setting decides. Yacana falls back to these threads if Presto drops out.',
    );
    store.set(prestoAtom, {
      ...initialPresto,
      consentRev: 0,
      status: { available: false, reason: 'offline' },
    });
    rerender(
      <Provider store={store}>
        <ThemeProvider defaultTheme="dark">
          <Settings connection={connection} controller={() => undefined} session={session()} />
        </ThemeProvider>
      </Provider>,
    );
    expect(screen.getByTestId('presto-card').getAttribute('data-standing')).toBe('absent');
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(false);
  });

  test('the mini window: one switch that opens it with the Start click, off by default, none without the API', () => {
    mount(true);
    const row = screen.getByRole('switch', { name: /Open the mini window when mining starts/ });
    expect(row.getAttribute('aria-checked')).toBe('false');
    // jsdom has no Document Picture-in-Picture.
    expect(row.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('switch', { name: /^Mini window/ })).toBeNull();
  });
});
