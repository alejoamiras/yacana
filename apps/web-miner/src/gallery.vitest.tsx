// The state lists as drawn, rendered over a made-up journal: every word a crossing can lead with,
// what arrives in every state, what was sent ahead, the old app in its four states, the old-tab
// bar. With `GALLERY_DIR` set, each render's markup is written there to be screenshotted under the
// built stylesheet.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Crossing } from '@yacana/bridge/journal';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { anvil } from 'viem/chains';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createConfig, http } from 'wagmi';
import { TAKING_LONG_AFTER_MS } from './bridge/copy';
import type { BridgeSession } from './bridge/session';
import { ActivityList } from './features/ActivityList';
import { MigrationCard } from './features/MigrationCard';
import { OldApp } from './features/OldApp';
import { OldTabNotice } from './features/OldTabNotice';
import type { MasterRecord } from './keys/store';
import { BalanceTile } from './routes/Wallet';
import type { Session } from './session';
import { balanceAtom, bootAtom, bridgeAtom, bridgeSessionAtom, journalAtom, nowAtom } from './state';

const ONE = 10n ** BigInt(PARAMS.DECIMALS);
const PORTAL = `0x${'ab'.repeat(20)}` as const;
const HOLDER = '0x9f3A5c1E7b2D4f6A8c0E1b3D5f7A9c1E3b5D21c0' as const;
const TX = `0x${'7e'.repeat(32)}` as const;
const MINUTE = 60_000;
const NOW = Date.UTC(2026, 8, 11, 19, 30);
const SECONDS = Math.floor(NOW / 1000);
const HOUR = 3600;

const crossing = (id: string, patch: Partial<Crossing>): Crossing => ({
  id,
  kind: 1,
  chainId: '11155111',
  portal: PORTAL,
  version: '5',
  index: 0,
  amount: (8n * ONE).toString(),
  state: 'proving',
  createdAt: NOW - 38 * MINUTE,
  updatedAt: NOW - 38 * MINUTE,
  ethAddress: HOLDER,
  ...patch,
});
const settled = {
  txHash: TX,
  block: 1_204,
  epoch: '412',
  proofDeadline: String(SECONDS + 3 * HOUR + 10 * 60),
};

const standing = {
  registered: true,
  miner: `0x${'0a'.repeat(20)}` as const,
  registryIndex: 0n,
  paused: false,
  pausedUntil: 0n,
  headroom: 500n * ONE,
  deadline: (1n << 256n) - 1n,
  flipAt: 0n,
  afterNextAt: 0n,
  pausedSeconds: 0n,
  retireSent: false,
  depositsClosed: false,
};
const session = {
  bridge: { claim: () => Promise.resolve(), reader: { blockTime: () => Promise.resolve(BigInt(SECONDS)) } },
} as unknown as Session;
const ready: MasterRecord = {
  v: 1,
  id: 'k',
  method: 'words',
  createdAt: NOW,
  askEveryOpen: false,
  backedUp: true,
  account: { address: '0xacc', index: 0 },
};

const OUT = process.env.GALLERY_DIR;
const keep = (name: string, html: string) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.html`), html);
};

const mount = (ui: ReactNode, setup: (store: ReturnType<typeof createStore>) => void = () => {}) => {
  const store = createStore();
  store.set(nowAtom, NOW);
  store.set(bridgeAtom, { verdict: { kind: 'before' }, standing, readAt: NOW, rpcFailing: false });
  setup(store);
  return render(<Provider store={store}>{ui}</Provider>);
};

const words = () => screen.getAllByTestId('crossing-word').map((w) => w.textContent);
const on = { claimL1: () => {}, forward: () => {}, redeem: () => {}, again: () => {}, settings: () => {} };
const list = <ActivityList session={session} account="0xacc" on={on} />;

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubEnv('VITE_ROLLUP_VERSION', '5');
  vi.stubEnv('VITE_MIGRATION', '');
  vi.stubEnv('VITE_RP_ID', 'yacana.network');
  vi.stubEnv(
    'VITE_BRIDGE',
    JSON.stringify({
      chainId: '11155111',
      portal: PORTAL,
      yaca: `0x${'ca'.repeat(20)}`,
      registry: `0x${'ee'.repeat(20)}`,
      operators: `0x${'01'.repeat(20)}`,
      l1RpcUrl: 'http://rpc.test',
    }),
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe('the journal, every state', () => {
  test('an exit and a send-ahead in each state lead with their word, and nothing promises a relayer', () => {
    const at = (m: number) => ({ createdAt: NOW - m * MINUTE, updatedAt: NOW - m * MINUTE });
    const { container } = mount(list, (s) =>
      s.set(journalAtom, [
        crossing('proving', { state: 'proving', ...at(1) }),
        crossing('sent', { state: 'sent', txHash: TX, ...at(2) }),
        crossing('pending', { state: 'proven-pending', ...settled, ...at(3) }),
        crossing('witnessed', { state: 'witnessed', ...settled, ...at(4) }),
        crossing('ready', { state: 'ready', ...settled, ...at(5) }),
        crossing('minted', { state: 'minted-l1', ...settled, l1TxHash: TX, ...at(6) }),
        crossing('paused', { state: 'paused', ...settled, ...at(7) }),
        crossing('headroom', { state: 'headroom', ...settled, ...at(8) }),
        crossing('closed', { state: 'closed', ...settled, ...at(9) }),
        crossing('lost', { state: 'never-proven', ...settled, amount: (4n * ONE).toString(), ...at(10) }),
        crossing('held', { kind: 2, state: 'held', ...settled, ...at(11) }),
        crossing('unregistered', { kind: 2, state: 'not-registered', ...settled, ...at(12) }),
        crossing('redeemed', { kind: 2, state: 'minted-l1', ...settled, l1TxHash: TX, ...at(13) }),
      ]),
    );
    expect(screen.getAllByTestId('crossing')).toHaveLength(13);
    expect(words()).toEqual([
      'proving · 60 s',
      'sent',
      'reaching Ethereum',
      'reached Ethereum',
      'ready to claim',
      'claimed',
      'paused',
      'waiting for the limit',
      'last day passed',
      'undone',
      'held for the next version',
      'waiting for Yacana',
      'redeemed',
    ]);
    expect(container.textContent).not.toMatch(/relayer/i);
    // Every money-loss row says what happened to the money; no row says "safe".
    expect(container.textContent).not.toMatch(/\bsafe\b/i);
    keep('journal-states', container.innerHTML);
  });

  test('a silent RPC is said on the balance tile; a send-ahead that needs the upgrade read says so on its row', () => {
    const { container } = mount(
      <>
        <BalanceTile
          balance={8n * ONE}
          onSend={() => {}}
          onToEthereum={() => {}}
          onDeposit={() => {}}
          onSettings={() => {}}
        />
        {list}
      </>,
      (s) => {
        s.set(bridgeAtom, {
          verdict: { kind: 'unknown' },
          standing,
          readAt: NOW - 6 * MINUTE,
          rpcFailing: true,
        });
        s.set(journalAtom, [
          crossing('ready', { state: 'ready', ...settled }),
          crossing('held', { kind: 2, state: 'held', ...settled, createdAt: NOW - 40 * MINUTE }),
        ]);
      },
    );
    expect(screen.getByTestId('money-reason').textContent).toContain("Ethereum RPC isn't answering");
    // The Wallet is only money: no count of wins, no wins row; "private" explains itself on hover.
    expect(container.textContent).not.toMatch(/\bclaims? ·|wins ·/);
    expect(screen.queryByTestId('wins-row')).toBeNull();
    expect(screen.getByText('private').getAttribute('data-slot')).toBe('tip-trigger');
    expect(words()).toEqual(['ready to claim', "can't read the upgrade"]);
    expect(screen.getByTestId('row-settings')).toBeTruthy();
    keep('journal-rpc-silent', container.innerHTML);
  });
});

describe('the arrivals, every state', () => {
  test('sends from an earlier version and deposits show as they come, claimable ones with the tap', () => {
    const from4 = { kind: 2 as const, version: '4', target: '5', ...settled, l1TxHash: TX };
    const at = (m: number) => ({ createdAt: NOW - m * MINUTE });
    const { container } = mount(list, (s) =>
      s.set(journalAtom, [
        crossing('forwarded', { ...from4, state: 'forwarded', ...at(1) }),
        crossing('claimable', { ...from4, state: 'claimable', inboxIndex: '7', ...at(2) }),
        crossing('landed', {
          ...from4,
          state: 'minted-l2',
          claimBlock: 1_204,
          updatedAt: NOW - 2 * MINUTE,
          ...at(3),
        }),
        crossing('unanswered', { kind: 3, state: 'proving', amount: (12n * ONE).toString(), ...at(4) }),
        crossing('deposited', {
          kind: 3,
          state: 'deposited',
          l1TxHash: TX,
          amount: (12n * ONE).toString(),
          ...at(5),
        }),
        crossing('arriving', {
          kind: 3,
          state: 'claimable',
          inboxIndex: '9',
          amount: (12n * ONE).toString(),
          ...at(6),
        }),
      ]),
    );
    expect(words()).toEqual([
      'arriving',
      'ready to claim',
      'claimed',
      'waiting for your wallet',
      'crossing to Aztec',
      'ready to claim',
    ]);
    expect(screen.getAllByTestId('row-claim')).toHaveLength(2);
    // A deposit's amount is signed and in this balance's unit, like every other row's.
    expect(screen.getAllByTestId('row-amount')[3]?.textContent).toBe(`+12 ${PARAMS.TOKEN_SYMBOL}`);
    expect(screen.getAllByTestId('crossing')[2]?.textContent).toContain(
      `8 ${PARAMS.TOKEN_SYMBOL} in your balance`,
    );
    keep('arrival-states', container.innerHTML);
  });
});

describe('what was sent ahead', () => {
  test('from the card that sent it: proving, undone, held, arrived', () => {
    vi.stubEnv(
      'VITE_MIGRATION',
      JSON.stringify({
        toIndex: '1',
        announcedAt: String(SECONDS - 3 * 86_400),
        expectedFlipAt: String(SECONDS + 2 * 86_400),
      }),
    );
    const { container } = mount(
      <>
        <MigrationCard onSendAhead={() => {}} onHow={() => {}} />
        {list}
      </>,
      (s) => {
        s.set(balanceAtom, 6n * ONE);
        s.set(journalAtom, [
          crossing('unproven', {
            kind: 2,
            state: 'proven-pending',
            ...settled,
            amount: (48n * ONE).toString(),
            createdAt: NOW - MINUTE,
          }),
          crossing('undone', {
            kind: 2,
            state: 'never-proven',
            ...settled,
            amount: (48n * ONE).toString(),
            createdAt: NOW - 2 * MINUTE,
          }),
          crossing('slow', {
            kind: 2,
            state: 'held',
            ...settled,
            createdAt: NOW - 3 * MINUTE,
            updatedAt: NOW - TAKING_LONG_AFTER_MS - MINUTE,
          }),
          crossing('arrived', {
            kind: 2,
            state: 'minted-l2',
            ...settled,
            target: '6',
            createdAt: NOW - 4 * MINUTE,
            updatedAt: NOW - 2 * MINUTE,
          }),
        ]);
      },
    );
    expect(screen.getByTestId('migration-card').dataset.moment).toBe('announced');
    expect(screen.getByTestId('sent-ahead-status').textContent).toContain('sent ahead');
    // Announced, the upgrade has a name and the held row waits for it by that name.
    expect(words()).toEqual(['reaching Ethereum', 'undone', 'held for V1', 'claimed']);
    expect(screen.getAllByTestId('row-redeem')).toHaveLength(1);
    expect(screen.getAllByTestId('row-again')).toHaveLength(1);
    expect(screen.getByTestId('row-again').textContent).toBe('Send ahead again');
    keep('sent-ahead-states', container.innerHTML);
  });
});

const proof = (ageS: number) => ({ at: BigInt(SECONDS - ageS), checkpoint: 1n, block: 1n });
// Signed in, the bridge session is open: its wagmi config is what the rows and the dialogs mount under.
const config = createConfig({ chains: [anvil], transports: { [anvil.id]: http('http://127.0.0.1:9') } });
const old = (setup: (store: ReturnType<typeof createStore>) => void, s?: Session) => {
  vi.stubEnv('VITE_APP_ROLE', 'old');
  return mount(<OldApp session={s} />, (store) => {
    store.set(bootAtom, { phase: 'ready', account: '0xacc', threads: 1, record: ready });
    store.set(bridgeSessionAtom, { config } as unknown as BridgeSession);
    setup(store);
  });
};
const withProof = (age: number) => (s: ReturnType<typeof createStore>) => {
  s.set(bridgeAtom, {
    verdict: { kind: 'before' },
    standing,
    readAt: NOW,
    rpcFailing: false,
    proof: proof(age),
  });
  s.set(balanceAtom, 35n * (ONE / 10n));
  s.set(journalAtom, [
    crossing('held', { kind: 2, state: 'held', ...settled, amount: (48n * ONE).toString() }),
  ]);
};

describe('the old app', () => {
  test('still here: the hero with the live chip, the card with the way out, the rows without a forward', () => {
    const { container } = old(withProof(12 * 60), session);
    expect(screen.getByTestId('retired').dataset.state).toBe('live');
    expect(screen.getByTestId('retired').textContent).toContain('Send what’s still here ahead.');
    expect(screen.getByTestId('proof-chip').textContent).toBe('V5 proved an epoch 12 min ago');
    expect(screen.getByTestId('old-card').dataset.state).toBe('still-here');
    expect(screen.getByTestId('send-ahead').textContent).toBe('Send ahead to the next version');
    expect(screen.getByTestId('to-ethereum').textContent).toBe('or bridge to Ethereum');
    expect(screen.getAllByTestId('crossing')).toHaveLength(1);
    expect(screen.queryByTestId('row-forward')).toBeNull();
    expect(screen.getByTestId('recovery-save')).toBeTruthy();
    keep('old-app', container.innerHTML);
  });

  test('a deposit on the old origin is the row the apex draws: the kind leads, the amount is signed, no address it lacks', () => {
    old((s) => {
      withProof(12 * 60)(s);
      s.set(journalAtom, [
        crossing('dep', {
          kind: 3,
          state: 'claimable',
          inboxIndex: '7',
          amount: (2n * ONE).toString(),
          ethAddress: `0x${'00'.repeat(20)}`,
        }),
      ]);
    }, session);
    expect(screen.getByTestId('row-title').textContent).toBe('From Ethereum');
    expect(screen.getByTestId('row-amount').textContent).toBe(`+2 ${PARAMS.TOKEN_SYMBOL}`);
    expect(screen.getByTestId('crossing').textContent).toContain('found on Ethereum');
    expect(screen.getByTestId('crossing').textContent).not.toContain('0x0000');
  });

  test('silent for hours: the chip amber, the body saying the version may have stopped', () => {
    const { container } = old(withProof(3 * 3600), session);
    expect(screen.getByTestId('retired').dataset.state).toBe('silent');
    expect(screen.getByTestId('proof-chip').dataset.tone).toBe('warn');
    expect(screen.getByTestId('retired').textContent).toContain(
      'V5 hasn’t proved an epoch for 3 hours and may have stopped.',
    );
    expect(screen.getByTestId('old-card').dataset.state).toBe('still-here');
    keep('old-app-silent', container.innerHTML);
  });

  test('stopped, from the record alone: nothing more leaves, no retry; the held row stays, with its redeem', () => {
    vi.stubEnv('VITE_LIFECYCLE', JSON.stringify({ stoppedProvingAt: String(SECONDS - 86_400) }));
    const { container } = old((s) => {
      withProof(60)(s);
      s.set(journalAtom, [
        ...s.get(journalAtom),
        // A recovery file can bring an older version's crossing: its retry would still send from V5.
        crossing('undone', { kind: 2, state: 'never-proven', version: '4', ...settled }),
      ]);
    }, session);
    expect((screen.getByTestId('row-again') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('row-disabled').textContent).toBe(
      'V5 stopped proving: nothing more can leave.',
    );
    expect(screen.getByTestId('retired').dataset.state).toBe('quiet');
    expect(screen.getByTestId('retired').textContent).toContain(
      'V5 has stopped proving. Nothing more can leave.',
    );
    expect(screen.getByTestId('proof-chip').textContent).toBe('V5 stopped proving · Sep 10');
    expect(screen.getByTestId('old-card').dataset.state).toBe('quiet');
    expect(screen.getByTestId('old-card').textContent).toContain('cannot leave');
    expect(screen.getByTestId('row-redeem')).toBeTruthy();
    keep('old-app-quiet', container.innerHTML);
  });

  test('the node gone: the fact as the chip, no log in, no list, the apex one link away', () => {
    vi.stubEnv('VITE_APP_ROLE', 'old');
    vi.stubEnv(
      'VITE_LIFECYCLE',
      JSON.stringify({ stoppedProvingAt: String(SECONDS - 86_400), nodeRetired: true }),
    );
    const { container } = mount(<OldApp />);
    expect(screen.getByTestId('retired').dataset.state).toBe('gone');
    expect(screen.getByTestId('retired').textContent).toContain(
      'V5’s node has shut down. Nothing more can leave from here.',
    );
    expect(screen.getByTestId('proof-chip').textContent).toBe('V5’s node has shut down');
    expect(screen.getByTestId('open-apex').getAttribute('href')).toBe('https://yacana.network');
    expect(screen.queryByTestId('sign-in-mine')).toBeNull();
    expect(screen.queryByTestId('activity')).toBeNull();
    keep('old-app-gone', container.innerHTML);
  });
});

describe('the old-tab bar', () => {
  const behind = async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ miner: '0xdef', rollupVersion: '7' }))),
    );
    const view = render(<OldTabNotice miner="0xabc" rollupVersion="6" />);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.getByTestId('old-tab').textContent).toContain('This tab is behind.'));
    return view;
  };

  test('a tab behind a redeploy says so, with the old app one link away', async () => {
    vi.stubEnv('VITE_OLD_APP_ORIGIN', 'https://v6.yacana.network');
    const { container } = await behind();
    expect(screen.getByTestId('old-tab').textContent).toContain('sent ahead from the old app');
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://v6.yacana.network');
    keep('old-tab', container.innerHTML);
  });

  test('with no old origin, it says so and offers Reload alone: no old app, no link', async () => {
    vi.stubEnv('VITE_OLD_APP_ORIGIN', '');
    await behind();
    expect(screen.getByTestId('old-tab').textContent).not.toContain('old app');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
