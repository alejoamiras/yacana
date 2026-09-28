// The bridge page as the screen shows it: the phases, a card per version with the turnstile's
// sentences, the portal's keys, the no-bridge state; and the announcement line the shell carries.
import { cleanup, render, screen } from '@testing-library/react';
import type { VersionFlows } from '@yacana/bridge/portal-reader';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hosted } from '../../tests/host';
import type { BridgeSnapshot } from '../bridge-beat';
import { Bridge } from '../pages/Bridge';
import { bridgeAtom, nowAtom } from '../state';
import { Announcement } from './Announcement';

const ONE = 10n ** BigInt(PARAMS.DECIMALS);
const NEVER = (1n << 256n) - 1n;
const NOW = 1_800_000_000_000;
const BRIDGE = {
  chainId: '31337',
  portal: `0x${'ab'.repeat(20)}`,
  yaca: `0x${'cd'.repeat(20)}`,
  registry: `0x${'ef'.repeat(20)}`,
  operators: `0x${'12'.repeat(20)}`,
  l1RpcUrl: 'http://localhost:1',
};

const version = (v: bigint, patch: Partial<VersionFlows> = {}): VersionFlows => ({
  version: v,
  registered: true,
  miner: `0x${'11'.repeat(32)}`,
  registryIndex: v,
  flipAt: 0n,
  afterNextAt: 0n,
  paused: false,
  headroom: 128n * ONE,
  deadline: NEVER,
  retireSent: false,
  depositsClosed: false,
  exited: 40n * ONE,
  inbound: 3n * ONE,
  cap: 165n * ONE,
  pausedUntil: 0n,
  pausedSeconds: 0n,
  launchAt: 1_799_000_000n,
  ...patch,
});

const snapshot: BridgeSnapshot = {
  versions: [
    version(5n, {
      flipAt: 1_799_500_000n,
      afterNextAt: 1_801_000_000n,
      deadline: 1_801_000_000n,
      retireSent: true,
    }),
    version(6n),
  ],
  canonical: { version: 6n, index: 1n },
  policy: {
    perHour: 12n * ONE,
    allowance: 100n * ONE,
    exitFloor: 3600n,
    pauseMax: 30n * 86400n,
    pauseBudget: 60n * 86400n,
  },
  operators: BRIDGE.operators,
  forwarders: [`0x${'34'.repeat(20)}`],
  chainTime: BigInt(Math.floor(NOW / 1000)),
  readAt: NOW,
};

const mount = (ui: React.ReactNode, setup: (s: ReturnType<typeof createStore>) => void = () => {}) => {
  const store = createStore();
  store.set(nowAtom, NOW);
  setup(store);
  render(<Provider store={store}>{hosted(ui)}</Provider>);
  return store;
};

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.stubEnv('VITE_ROLLUP_VERSION', '6');
  vi.stubEnv('VITE_BRIDGE', JSON.stringify(BRIDGE));
  vi.stubEnv('VITE_MIGRATION', '');
});

describe('the bridge page', () => {
  test('a card per registered version, the live one marked; the phases of this build’s version; the keys', () => {
    mount(<Bridge />, (s) => s.set(bridgeAtom, { phase: 'ready', snapshot, unreachable: false }));
    const cards = screen.getAllByTestId('bridge-version');
    expect(cards.map((c) => `${c.dataset.version}:${c.dataset.live}`)).toEqual(['5:0', '6:1']);
    const lines = screen.getAllByTestId('version-line').map((l) => l.textContent);
    expect(lines[0]).toBe('upgraded from on 2027-01-09 · last day 2027-01-26');
    expect(lines[1]).toBe('the live version · mining, deposits and withdrawals here');
    expect(screen.getAllByTestId('exit-limit')[1]?.textContent).toContain(
      `128 ${PARAMS.TOKEN_SYMBOL} may leave V6 right now · grows 12 ${PARAMS.TOKEN_SYMBOL} an hour`,
    );
    expect(screen.getByTestId('pause-line').textContent).toContain('not paused');
    // V6's phases: launched, nothing announced, no flip; the FAQ one link away.
    const steps = screen.getByTestId('bridge-phases').querySelectorAll('[data-slot=timeline] > li');
    expect(Array.from(steps).map((s) => (s as HTMLElement).dataset.state)).toEqual([
      'done',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
    // The six figures, the portal's state and the bar on the live card stand without the extras.
    expect(screen.getAllByTestId(/^kpi-/)).toHaveLength(6);
    expect(screen.getByTestId('kpi-bridge').textContent).toContain('open');
    expect(screen.getByTestId('bridge-turnstile').textContent).toContain('history unavailable');
    expect(screen.getByTestId('bridge-coins').textContent).toContain('one pool across 2 versions');
    expect(screen.getByTestId('bridge-faq').getAttribute('href')).toBe('/faq');
    // The explorer's base is read when the module loads, so the chips carry no link here: the labels count.
    const chips = screen
      .getByTestId('bridge-portal')
      .querySelectorAll('[data-slot=chip-link] > span:first-child');
    expect(Array.from(chips).map((c) => c.textContent)).toEqual([
      'portal',
      'YACA',
      'registry',
      'multisig',
      'relayer',
    ]);
    // The rules are the FAQ's; the panel links there and says nothing more than who the keys are.
    expect(screen.getByTestId('bridge-rules').getAttribute('href')).toBe('/faq#rules');
    expect(screen.getByTestId('bridge-portal').textContent).not.toMatch(/who may|deadline/);
  });

  test('a silent RPC keeps the last numbers and says so; a failed first read says what failed', () => {
    mount(<Bridge />, (s) => s.set(bridgeAtom, { phase: 'ready', snapshot, unreachable: true }));
    expect(screen.getByTestId('bridge-stale')).toBeTruthy();
    expect(screen.getAllByTestId('bridge-version')).toHaveLength(2);
    cleanup();
    mount(<Bridge />, (s) => s.set(bridgeAtom, { phase: 'error', message: 'no portal at 0xab' }));
    expect(screen.getByTestId('bridge-error').textContent).toContain('no portal at 0xab');
    expect(screen.queryAllByTestId('bridge-version')).toHaveLength(0);
  });

  test('a deployment without a portal says so', () => {
    vi.stubEnv('VITE_BRIDGE', '');
    mount(<Bridge />, (s) => s.set(bridgeAtom, { phase: 'none' }));
    expect(screen.getByTestId('no-bridge').textContent).toContain('no bridge yet');
  });
});

describe('the announcement line', () => {
  test('nothing on a quiet version; one line with the expected day and the FAQ when a migration is announced', () => {
    const { container } = render(hosted(<Announcement />));
    expect(container.innerHTML).toBe('');
    cleanup();
    vi.stubEnv(
      'VITE_MIGRATION',
      JSON.stringify({ toIndex: '2', announcedAt: '1799900000', expectedFlipAt: '1800500000' }),
    );
    render(hosted(<Announcement />));
    const line = screen.getByTestId('announcement');
    expect(line.textContent).toContain('arrives around 2027-01-21. Mining on V6 ends when the upgrade lands');
    expect(line.querySelector('a')?.getAttribute('href')).toBe('/faq');
  });
});
